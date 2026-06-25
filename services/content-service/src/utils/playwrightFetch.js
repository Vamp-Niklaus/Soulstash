'use strict';

/**
 * playwrightFetch.js
 *
 * ALL fetching — on Render AND local — goes through Playwright.
 * Plain fetch is completely removed for GET requests.
 *
 * Browser is a persistent singleton launched once at startup (warmBrowser).
 */

const { chromium } = require('playwright');
const IS_PROD = process.env.NODE_ENV === 'production';

// Force Playwright to look inside node_modules on Render
// because the build script installed it there using PLAYWRIGHT_BROWSERS_PATH=0
if (process.env.RENDER) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const CF_STATUSES = new Set([403, 429, 503]);

function isCfBlock(status, html = '') {
  if (!CF_STATUSES.has(status)) return false;
  const lower = html.slice(0, 4000).toLowerCase();
  return (
    lower.includes('just a moment') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('enable javascript') ||
    /var\s+__cf_chl/i.test(html) ||
    /<title>\s*(?:just a moment|attention required|cloudflare)/i.test(html)
  );
}

function makeFakeResponse(status, html, finalUrl) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    text: async () => html,
    json: async () => JSON.parse(html)
  };
}

// ── Playwright bootstrap ───────────────────────────────────────────────────────

let _browserInstance = null;
let _launchPromise = null;


const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled'
];

async function _doLaunch() {
  const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH || 'default';
  console.log(`[Playwright] Launching browser (Path: ${browserPath})...`);
  try {
    const browser = await chromium.launch({
      headless: true,
      args: LAUNCH_ARGS,
      ignoreDefaultArgs: ['--enable-automation']
    });
    console.log('[Playwright] Browser ready');

    browser.on('disconnected', () => {
      if (_browserInstance === browser) {
        console.log('[Playwright] Browser disconnected — will re-launch on next request');
        _browserInstance = null;
        _launchPromise = null;
      }
    });

    process.once('exit', () => { 
      if (_browserInstance) {
        _browserInstance.close().catch(() => {});
      }
    });
    
    return browser;
  } catch (err) {
    console.error('[Playwright] Launch failed:', err.message);
    throw err;
  }
}

/**
 * Returns the shared browser singleton. Launches once, reuses forever.
 */
async function getBrowser() {
  if (_browserInstance && _browserInstance.isConnected()) {
    return _browserInstance;
  }

  // If there's an existing launch in progress, wait for it
  if (_launchPromise) {
    return _launchPromise;
  }

  _launchPromise = _doLaunch()
    .then((b) => { 
      _browserInstance = b; 
      _launchPromise = null; 
      return b; 
    })
    .catch((err) => { 
      _launchPromise = null; 
      throw err; 
    });

  return _launchPromise;
}

/**
 * warmBrowser() — pre-launch the browser at server start.
 */
async function warmBrowser() {
  try {
    await getBrowser();
    console.log('[Playwright] Browser pre-warmed and ready');
  } catch (err) {
    console.warn('[Playwright] Pre-warm failed (will retry on first request):', err.message);
  }
}

// ── Per-request tab ───────────────────────────────────────────────────────────

async function _fetchOneTab(url, extraHeaders = {}) {
  const browser = await getBrowser();
  // Using a context with a standard user agent and viewport
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9', ...extraHeaders }
  });

  const page = await context.newPage();

  try {
    // ── Stealth: patch JS properties CF checks ──
    await page.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Spoof languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      // Add window.chrome
      if (!window.chrome) {
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      }
    });
    
    // Block heavy resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate with 'domcontentloaded'
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ── CF challenge polling ───────────────────────────────────────────────────
    const CF_POLL_INTERVAL_MS = 500;
    const CF_POLL_MAX_MS = 20000;
    const CF_POLL_ATTEMPTS = CF_POLL_MAX_MS / CF_POLL_INTERVAL_MS;

    let cfCleared = false;
    for (let i = 0; i < CF_POLL_ATTEMPTS; i++) {
      const title = await page.title().catch(() => '');
      const htmlSnippet = await page.evaluate(() => document.documentElement.innerHTML.slice(0, 4000)).catch(() => '');
      const looksLikeCf = /just a moment/i.test(title) || isCfBlock(0, htmlSnippet);
      
      if (!looksLikeCf) { 
        cfCleared = true; 
        break; 
      }
      // Still on CF challenge — wait and retry
      await new Promise(r => setTimeout(r, CF_POLL_INTERVAL_MS));
    }

    // ── Wait for player content selectors (JS-rendered) ──────────────────────
    if (cfCleared) {
      const CONTENT_SELECTORS = 'li.dooplay_player_option, iframe[src], #player, .source-box, .embed-container';
      try {
        await page.waitForSelector(CONTENT_SELECTORS, { timeout: 2500 });
      } catch {
        // Fallback: small sleep if no specific selector matched yet
        await new Promise(r => setTimeout(r, 800));
      }
    }

    const finalUrl = page.url();
    const status = response?.status() ?? 200;
    const html = await page.content();

    if (!cfCleared || isCfBlock(status, html)) {
      throw new Error(`CF_BLOCK:${status}`);
    }

    return makeFakeResponse(status, html, finalUrl);
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Fetch with Playwright, retrying up to 3 times on CF blocks.
 */
async function fetchWithPlaywright(url, extraHeaders = {}) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await _fetchOneTab(url, extraHeaders);
    } catch (err) {
      lastError = err;
      const isCf = String(err.message).startsWith('CF_BLOCK:');
      if (!isCf || attempt === maxAttempts) throw err;
      console.log(`[Playwright] CF block on attempt ${attempt}/${maxAttempts} for ${url} — retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

/**
 * Execute a POST from INSIDE an already-navigated Playwright page.
 */
async function fetchPostInPage(page, ajaxUrl, bodyParams) {
  const result = await page.evaluate(async ({ ajaxUrl, bodyString }) => {
    try {
      const resp = await fetch(ajaxUrl, {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest'
        },
        body: bodyString
      });
      const text = await resp.text();
      return { status: resp.status, ok: resp.ok, text };
    } catch (e) {
      return { status: 0, ok: false, text: '', error: e.message };
    }
  }, { ajaxUrl, bodyString: bodyParams.toString() });

  if (!result.ok) return null;
  try { return JSON.parse(result.text); } catch { return null; }
}

// ── Timeout helper ────────────────────────────────────────────────────────────

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT:${ms}ms ${label}`)), ms)
    )
  ]);
}

/**
 * playwrightFetch — replacement for puppeteerFetch.
 */
async function playwrightFetch(url, options = {}) {
  const method = String(options?.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    return global.fetch(url, options);
  }

  return withTimeout(fetchWithPlaywright(url, options.headers), 90000, url);
}

async function closeBrowser() {
  if (_browserInstance) {
    try { await _browserInstance.close(); } catch { /* ignore */ }
    _browserInstance = null;
    _launchPromise = null;
  }
}

module.exports = {
  playwrightFetch,
  closeBrowser,
  warmBrowser,
  getBrowser,
  fetchPostInPage,
  isChromeAvailable: () => true, // Playwright manages its own binaries
  makeFakeResponse,
  isCfBlock
};
