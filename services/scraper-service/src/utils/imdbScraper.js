'use strict';

/**
 * imdbScraper.js
 *
 * Scrapes an IMDB person filmography page and returns an array of:
 *   { title, year, imdb_rating, imdb_id }
 *
 * Matching against your credits is done by (title, year) after normalizing.
 *
 * Uses the existing Playwright singleton — no extra browser launch.
 */

const { getBrowser } = require('./playwrightFetch');

const IMDB_PERSON_URL = (imdbPersonId) =>
  `https://www.imdb.com/name/${imdbPersonId}/`;

// ── Title normalization for fuzzy matching ─────────────────────────────────────
// Lower-case, strip punctuation, collapse whitespace.
function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Scrape ─────────────────────────────────────────────────────────────────────

/**
 * Scrape an IMDB person filmography page.
 *
 * @param {string} imdbPersonId  e.g. "nm0006795"
 * @returns {Promise<Array<{ title: string, year: number|null, imdb_rating: number|null, imdb_id: string }>>}
 */
async function scrapeImdbFilmography(imdbPersonId) {
  const url = IMDB_PERSON_URL(imdbPersonId);
  console.log(`[imdbScraper] START url=${url}`);

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
    locale: 'en-US'
  });

  const page = await context.newPage();

  try {
    // Stealth patches
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      if (!window.chrome) window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    });

    // Block images, fonts, media — we only need the DOM
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the filmography list items to appear.
    // IMDB renders them server-side so domcontentloaded is enough, but give it
    // a short extra window for any JS hydration.
    try {
      await page.waitForSelector('li.ipc-metadata-list-summary-item', { timeout: 8000 });
    } catch {
      console.warn(`[imdbScraper] Timed out waiting for list items — trying to extract anyway`);
    }

    // Extract all credit list items from the page via evaluate()
    const items = await page.evaluate(() => {
      const results = [];
      const listItems = document.querySelectorAll(
        'li.ipc-metadata-list-summary-item[data-testid]'
      );

      listItems.forEach((li) => {
        try {
          // Title
          const titleEl =
            li.querySelector('a.ipc-metadata-list-summary-item__t') ||
            li.querySelector('a[href*="/title/"]');
          const title = titleEl ? titleEl.textContent.trim() : null;
          if (!title) return;

          // IMDB ID from the href: /title/tt1234567/
          const href = titleEl ? titleEl.getAttribute('href') : '';
          const imdbIdMatch = href && href.match(/\/title\/(tt\d+)\//);
          const imdb_id = imdbIdMatch ? imdbIdMatch[1] : null;

          // Rating: the <span class="ipc-rating-star--rating"> inside the li
          const ratingEl = li.querySelector('.ipc-rating-star--rating');
          const ratingRaw = ratingEl ? ratingEl.textContent.trim() : null;
          const imdb_rating = ratingRaw ? parseFloat(ratingRaw) : null;

          // Year: inside .ipc-metadata-list-summary-item__li or similar
          // IMDB puts it in a <span> or <li> inside the detail list
          let year = null;
          const yearEls = li.querySelectorAll(
            '.ipc-metadata-list-summary-item__li, .ipc-inline-list__item span'
          );
          for (const el of yearEls) {
            const text = el.textContent.trim();
            // Match a 4-digit year (1900-2099)
            const m = text.match(/\b(19|20)\d{2}\b/);
            if (m) {
              year = parseInt(m[0], 10);
              break;
            }
          }

          results.push({ title, year, imdb_rating: Number.isFinite(imdb_rating) ? imdb_rating : null, imdb_id });
        } catch {
          // Skip malformed items
        }
      });

      return results;
    });

    console.log(`[imdbScraper] DONE imdbPersonId=${imdbPersonId} found=${items.length}`);
    return items;
  } finally {
    await context.close().catch(() => {});
  }
}

// ── Match credits against scraped filmography ──────────────────────────────────

/**
 * Given a list of TMDB credit items and an IMDB filmography array,
 * returns a Map keyed by `tmdbID:mediaType` → matched IMDB entry.
 *
 * Matching rules (in order):
 *  1. Exact imdb_id match (if both sides have it) — most reliable
 *  2. Normalized title + exact year match
 *  3. Normalized title match only (±0 year, or year missing on either side)
 */
function matchCreditsToFilmography(credits, filmography) {
  // Build lookup maps from the scraped filmography
  const byImdbId = new Map();    // imdb_id → item
  const byTitleYear = new Map(); // `normalizedTitle|year` → item
  const byTitle = new Map();     // normalizedTitle → item (fallback)

  for (const item of filmography) {
    if (item.imdb_id) byImdbId.set(item.imdb_id, item);
    const normTitle = normalizeTitle(item.title);
    if (item.year) byTitleYear.set(`${normTitle}|${item.year}`, item);
    if (normTitle && !byTitle.has(normTitle)) byTitle.set(normTitle, item);
  }

  const resultMap = new Map(); // `tmdbID:mediaType` → imdb match

  for (const credit of credits) {
    const tmdbID = Number(credit.id || credit.tmdbID);
    const mediaType = credit.media_type === 'tv' ? 'Series' : 'Movie';
    const key = `${tmdbID}:${mediaType}`;

    // 1. imdb_id exact match (credits from TMDB sometimes carry imdb_id)
    const imdbIdOnCredit = typeof credit.imdb_id === 'string' ? credit.imdb_id.trim() : '';
    if (imdbIdOnCredit && byImdbId.has(imdbIdOnCredit)) {
      resultMap.set(key, byImdbId.get(imdbIdOnCredit));
      continue;
    }

    const creditTitle = normalizeTitle(credit.title || credit.name);
    const creditYear = credit.release_date
      ? parseInt(String(credit.release_date).slice(0, 4), 10)
      : credit.first_air_date
        ? parseInt(String(credit.first_air_date).slice(0, 4), 10)
        : null;

    // 2. Title + year
    if (creditYear) {
      const tyKey = `${creditTitle}|${creditYear}`;
      if (byTitleYear.has(tyKey)) {
        resultMap.set(key, byTitleYear.get(tyKey));
        continue;
      }
    }

    // 3. Title only (looser — only use when year is missing)
    if (!creditYear && byTitle.has(creditTitle)) {
      resultMap.set(key, byTitle.get(creditTitle));
    }
  }

  return resultMap;
}

module.exports = { scrapeImdbFilmography, matchCreditsToFilmography, normalizeTitle };
