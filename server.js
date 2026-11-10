/**
 * Soulstash SPA Server
 * 
 * Serves the compiled React SPA from `spa/dist` and static assets.
 * The legacy Node.js backend has been migrated to the Go backend
 * (`https://soulstash-backend.onrender.com`) and archived in `old-backend-no-longer-used/`.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const GO_BACKEND_URL = process.env.BACKEND_URL || 'https://soulstash-backend.onrender.com';
const SPA_DIST = path.join(__dirname, 'spa', 'dist');
const SPA_INDEX = path.join(SPA_DIST, 'index.html');

// CORS
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://soulstash.onrender.com', 'https://app.soulstash.onrender.com', 'http://localhost', 'https://localhost', 'capacitor://localhost', 'http://tauri.localhost']
  : ['http://localhost:3000', 'http://127.0.0.1:3000', /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Health Check Endpoints (for Render and uptime monitors)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'soulstash-spa', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'soulstash-spa', timestamp: new Date().toISOString() });
});

// Forward /api/* and /image/* to Go backend if requested on the SPA server
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/image/')) {
    return next();
  }

  try {
    const targetUrl = new URL(req.originalUrl, GO_BACKEND_URL).toString();
    const headers = { ...req.headers };
    delete headers.host;

    const fetchOptions = {
      method: req.method,
      headers,
      redirect: 'manual'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = req;
      fetchOptions.duplex = 'half';
    }

    const backendRes = await fetch(targetUrl, fetchOptions);

    res.status(backendRes.status);
    backendRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (backendRes.body) {
      const reader = backendRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error(`[API Proxy Error] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(502).json({ error: 'Backend service unavailable', message: err.message });
  }
});

// Static assets with caching
app.use('/images', express.static(path.join(__dirname, 'assets', 'images'), {
  maxAge: '30d'
}));

app.use('/js', express.static(path.join(__dirname, 'spa', 'public', 'js'), {
  maxAge: '1d'
}));

app.use('/assets', express.static(path.join(SPA_DIST, 'assets'), {
  maxAge: '1y',
  immutable: true
}));

// Serve all static files from spa/dist
app.use(express.static(SPA_DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// SPA client-side routing fallback: all non-asset requests return index.html
app.use((req, res) => {
  if (fs.existsSync(SPA_INDEX)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(SPA_INDEX);
  } else {
    res.status(503).send('Soulstash SPA build not found. Please run `npm run build` first.');
  }
});

app.listen(PORT, () => {
  console.log(`[Soulstash SPA] Server running on port ${PORT}`);
  console.log(`[Soulstash SPA] Serving static SPA from: ${SPA_DIST}`);
  console.log(`[Soulstash SPA] API requests proxying to Go backend: ${GO_BACKEND_URL}`);
});
