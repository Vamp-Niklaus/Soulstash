const router = require('express').Router();
const path = require('path');
const fs = require('fs').promises;
const SPA_SOURCE = path.join(__dirname, '..', 'spa', 'index.html');
const SPA_DIST = path.join(__dirname, '..', 'spa', 'dist', 'index.html');
const DEV_VITE_ORIGIN = process.env.VITE_DEV_SERVER_ORIGIN || 'http://localhost:5173';
const DEV_VITE_HEALTH_ENDPOINT = `${DEV_VITE_ORIGIN}/src/main.jsx`;
let viteProbeCache = { ok: false, checkedAt: 0 };

async function isViteDevServerAvailable() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const now = Date.now();
  if (now - viteProbeCache.checkedAt < 2000) {
    return viteProbeCache.ok;
  }

  try {
    const response = await fetch(DEV_VITE_HEALTH_ENDPOINT, { method: 'HEAD' });
    viteProbeCache = {
      ok: response.ok,
      checkedAt: now
    };
    return response.ok;
  } catch {
    viteProbeCache = {
      ok: false,
      checkedAt: now
    };
    return false;
  }
}

const sendSpa = async (res) => {
  if (await isViteDevServerAvailable()) {
    let html = await fs.readFile(SPA_SOURCE, 'utf8');
    html = html.replace(/^\s*<script src="\/components\/navbar\.js"><\/script>\s*$/m, '');
    html = html.replace(/^\s*<script src="\/js\/navbar-patches\.js"><\/script>\s*$/m, '');
    html = html.replace(
      /<script type="module" src="\/src\/main\.jsx"><\/script>/,
      `<script type="module">
        import RefreshRuntime from "${DEV_VITE_ORIGIN}/@react-refresh"
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => () => {}
      </script>\n  <script type="module" src="${DEV_VITE_ORIGIN}/@vite/client"></script>\n  <script type="module" src="${DEV_VITE_ORIGIN}/src/main.jsx"></script>`
    );
    return res.type('html').send(html);
  }

  try {
    await fs.access(SPA_DIST);
    return res.sendFile(SPA_DIST);
  } catch {}

  if (process.env.NODE_ENV !== 'production') {
    let html = await fs.readFile(SPA_SOURCE, 'utf8');
    html = html.replace(/^\s*<script src="\/components\/navbar\.js"><\/script>\s*$/m, '');
    html = html.replace(/^\s*<script src="\/js\/navbar-patches\.js"><\/script>\s*$/m, '');
    html = html.replace(
      /<script type="module" src="\/src\/main\.jsx"><\/script>/,
      `<script type="module">
        import RefreshRuntime from "${DEV_VITE_ORIGIN}/@react-refresh"
        RefreshRuntime.injectIntoGlobalHook(window)
        window.$RefreshReg$ = () => {}
        window.$RefreshSig$ = () => () => {}
      </script>\n  <script type="module" src="${DEV_VITE_ORIGIN}/@vite/client"></script>\n  <script type="module" src="${DEV_VITE_ORIGIN}/src/main.jsx"></script>`
    );
    return res.type('html').send(html);
  }
  return res.sendFile(SPA_SOURCE);
};

// ── HTML page routes ──────────────────────────────────────────────────────────
router.get('/',               (req, res) => sendSpa(res));
router.get('/explore',        (req, res) => sendSpa(res));
router.get('/login',          (req, res) => sendSpa(res));
router.get('/register',       (req, res) => sendSpa(res));
router.get('/collections',    (req, res) => sendSpa(res));
router.get('/edit',           (req, res) => sendSpa(res));
router.get('/terms-of-service',  (req, res) => sendSpa(res));
router.get('/privacy-policy',    (req, res) => sendSpa(res));
router.get('/movie/:id',      (req, res) => sendSpa(res));
router.get('/series/:id',     (req, res) => sendSpa(res));
router.get('/person/:id',     (req, res) => sendSpa(res));
router.get('/admin',          (req, res) => sendSpa(res));
router.get('/collection/:collectionName', (req, res) => sendSpa(res));

// User profile page
router.get('/user/:username', (req, res) => sendSpa(res));

// User collections listing page
router.get('/user/:username/collections', (req, res) => sendSpa(res));

// User collection base path (redirect in SPA)
router.get('/user/:username/collection', (req, res) => sendSpa(res));

// User collection page
router.get('/user/:username/collection/:collectionName', (req, res) => sendSpa(res));

module.exports = router;
