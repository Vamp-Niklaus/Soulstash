// Force playwright cache if needed (though playwright handles its own binaries)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { initializeDatabase, getClient } = require('./db');

// ── Custom timestamped logger ─────────────────────────────────────────────────
const startTime = process.hrtime.bigint();
const originalLog = console.log;
console.log = (...args) => {
  const diffMs = Number(process.hrtime.bigint() - startTime) / 1e6;
  const ms    = Math.floor(diffMs % 1000);
  const secs  = Math.floor(diffMs / 1000) % 60;
  const mins  = Math.floor(diffMs / 60000) % 60;
  const hrs   = Math.floor(diffMs / 3600000);
  const time  = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}:${String(ms).padStart(3,'0')}`;
  const stack = new Error().stack.split('\n');
  let callerLine = stack.find(l => !l.includes('console.log') && !l.includes(__filename)) || stack[3] || stack[2];
  let func = 'anonymous', line = '?';
  let m = callerLine.match(/at (.+?) \((.+):(\d+):\d+\)/);
  if (m) { func = m[1]; line = m[3]; }
  else { m = callerLine.match(/at (.+):(\d+):\d+/); if (m) { func = m[1].split('\\').pop(); line = m[2]; } }
  originalLog(`${time}  ${func}:${line}`, ...args);
};

console.log('Server starting...');

const app = express();
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://soulstash.onrender.com', 'https://app.soulstash.onrender.com', 'http://localhost', 'https://localhost', 'capacitor://localhost']
  : ['http://localhost:3000', 'http://127.0.0.1:3000', /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', (req, res, next) => {
  const startedAt = Date.now();
  const authState = req.headers.authorization ? 'auth=yes' : 'auth=no';
  console.log(`[API] ${req.method} ${req.originalUrl} ${authState}`);

  res.on('finish', () => {
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });

  next();
});

// ── Static asset caching headers ─────────────────────────────────────────────
app.use((req, res, next) => {
  if (/\/(images|assets)\//.test(req.url)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.url.includes('/api/content')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-SPA-Content', 'true');
  }
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
}));

// ── Static files ──────────────────────────────────────────────────────────────
app.use('/images',     require('express').static(path.join(__dirname, 'assets', 'images')));
app.use('/js',         require('express').static(path.join(__dirname, 'spa', 'public', 'js')));
app.use('/assets',     require('express').static(path.join(__dirname, 'spa', 'dist', 'assets'), { setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }));
app.use(express.static(path.join(__dirname, 'spa', 'dist')));

// ── In-Memory Traffic Logging Middleware ───────────────────────────────────────
const TRAFFIC_COLLECTION_NAME = 'TrafficLogsMonolith';
let trafficLogBuffer = [];
app.use((req, res, next) => {
  if (
    req.path.startsWith('/images') ||
    req.path.startsWith('/assets') ||
    req.path.startsWith('/js') ||
    req.path.startsWith('/favicon') ||
    req.path.startsWith('/api/admin/trafficLogs')
  ) {
    return next();
  }
  const startedAt = Date.now();

  // Directly extract real user's IP in the monolith (handles Render, proxies, and direct connections)
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = (typeof forwarded === 'string' && forwarded.length > 0)
    ? forwarded.split(',')[0].trim()
    : (req.ip || req.socket?.remoteAddress || '');
  const cleanIp = rawIp.replace(/^::ffff:/, '').trim() || '127.0.0.1';

  const userAgent = req.headers['user-agent'] || '';
  let username = 'anonymous';
  if (req.headers['x-user-name']) {
    username = req.headers['x-user-name'];
  } else if (req.headers.authorization) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (payload.username) username = payload.username;
    } catch (e) {}
  }

  const device = /mobile|android|iphone/i.test(userAgent)
    ? 'mobile'
    : /ipad|tablet/i.test(userAgent)
    ? 'tablet'
    : 'desktop';

  res.on('finish', () => {
    trafficLogBuffer.push({
      ip: cleanIp,
      domain: req.headers['host'] || 'soulstash.onrender.com',
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      responseTimeMs: Date.now() - startedAt,
      username,
      userAgent,
      device,
      referer: req.headers['referer'] || req.headers['origin'] || '',
      createdAt: new Date()
    });
  });

  next();
});

setInterval(async () => {
  if (trafficLogBuffer.length > 0) {
    const batch = [...trafficLogBuffer];
    trafficLogBuffer = [];
    try {
      const db = getDb();
      if (!db) {
        trafficLogBuffer.unshift(...batch);
        return;
      }
      const trafficColl = db.collection(TRAFFIC_COLLECTION_NAME);
      await trafficColl.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }).catch(() => {});
      let geoip = null;
      try { geoip = require('geoip-lite'); } catch {}
      const docs = batch.map((log) => {
        const geo = geoip && log.ip ? geoip.lookup(log.ip) : null;
        return {
          ...log,
          country: geo?.country || 'Unknown',
          city: geo?.city || 'Unknown',
          ll: geo?.ll || null,
          createdAt: log.createdAt || new Date()
        };
      });
      await trafficColl.insertMany(docs);
    } catch (err) {
      console.error('Failed to flush traffic logs:', err.message);
    }
  }
}, 5000);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/user',   require('./routes/auth'));
app.use('/api',        require('./routes/content'));
app.use('/api',        require('./routes/collections'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/',           require('./routes/pages'));

// ── Health check & image proxy ────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/image/:path', (req, res) => res.json({ imageUrl: `https://image.tmdb.org/t/p/w500/${req.params.path}` }));

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // Pre-warm Playwright browser so the first scrape request has no cold-start delay
      const { warmBrowser } = require('./util/playwrightFetch');
      warmBrowser();
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  const client = getClient();
  if (client) await client.close();
  const { closeBrowser } = require('./util/playwrightFetch');
  await closeBrowser();
  process.exit(0);
});
