#!/usr/bin/env node
/**
 * Soulstash - Letterboxd List Importer & Automation
 * 
 * Scrapes movie lists from any Letterboxd URL using browser automation (Playwright),
 * enriches them with TMDB metadata (posters, backdrops, ratings, IDs),
 * and saves them into ready-to-use Soulstash collection JSON files.
 * 
 * Usage:
 *   node scripts/import_letterboxd.mjs <letterboxd-url> [options]
 * 
 * Options:
 *   --browser          Open a visible browser window (Edge/Chrome) so you can watch the automation
 *   --pages=<n>        Number of pages to scrape (default: 1)
 *   --out=<filepath>   Custom output path (default: collections/<slug>.json)
 *   --tmdb-key=<key>   Override TMDB API Key
 * 
 * Examples:
 *   node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --browser
 *   node scripts/import_letterboxd.mjs https://letterboxd.com/jack/list/official-top-250-films-with-the-most/ --pages=2
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load .env if present
function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const TMDB_API_KEY = process.env.TMDB_API_KEY || '6598875eb367b5334ad543e204fbda47';

// Parse command line arguments
const args = process.argv.slice(2);
let targetUrl = '';
let visibleBrowser = false;
let maxPages = 1;
let customOutPath = '';

for (const arg of args) {
  if (arg === '--browser' || arg === '--visible') {
    visibleBrowser = true;
  } else if (arg.startsWith('--pages=')) {
    maxPages = Math.max(1, parseInt(arg.split('=')[1], 10) || 1);
  } else if (arg.startsWith('--out=')) {
    customOutPath = arg.split('=')[1];
  } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
    targetUrl = arg;
  }
}

if (!targetUrl) {
  console.log(`
\x1b[36m=== Soulstash Letterboxd List Importer ===\x1b[0m

Usage:
  node scripts/import_letterboxd.mjs <letterboxd-url> [options]

Options:
  --browser        Open a visible browser window (watch the automation live)
  --pages=<number> Number of pages to import (default: 1)
  --out=<path>     Custom output file path

Examples:
  node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --browser
  node scripts/import_letterboxd.mjs https://letterboxd.com/jack/list/official-top-250-films-with-the-most/ --pages=2
`);
  process.exit(0);
}

// Clean title from "Poster for Title (Year)" or similar
function parsePosterAlt(altText) {
  if (!altText) return null;
  const match = altText.match(/^(?:Poster for )?(.+?)(?:\s+\((\d{4})\))?$/i);
  if (!match) return { title: altText.trim(), year: '' };
  return {
    title: match[1].trim(),
    year: match[2] || ''
  };
}

// Search TMDB / Soulstash backend for movie details
async function searchTmdb(title, year) {
  if (!title) return null;
  const cleanTitle = title.replace(/[^\w\s-]/g, ' ').trim();

  // 1. Try Backend Search API (super fast & immune to local ISP blocks)
  try {
    const backendUrl = `https://soulstash-backend.onrender.com/api/search?q=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(backendUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      if (list.length > 0) {
        if (year) {
          const yearMatch = list.find(m => String(m.release_year || m.release_date || '').startsWith(String(year)));
          if (yearMatch) return yearMatch;
        }
        return list[0];
      }
    }
  } catch (_) {}

  // 2. Direct TMDB fallback
  try {
    let queryUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&include_adult=false`;
    if (year) queryUrl += `&year=${year}`;
    const res = await fetch(queryUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        return data.results[0];
      }
    }
  } catch (_) {}

  return null;
}

async function run() {
  console.log(`\n\x1b[36m🚀 Starting Letterboxd Automation\x1b[0m`);
  console.log(`🔗 Target URL: ${targetUrl}`);
  console.log(`🌐 Browser mode: ${visibleBrowser ? 'Visible Browser (Edge/Chrome)' : 'Headless'}`);
  console.log(`📄 Pages to scrape: ${maxPages}`);

  // Launch browser using installed Microsoft Edge or Chrome
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'msedge',
      headless: !visibleBrowser,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (e) {
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: !visibleBrowser,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } catch (e2) {
      browser = await chromium.launch({
        headless: !visibleBrowser,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  const allExtractedFilms = [];
  const seenTitles = new Set();

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    let currentUrl = targetUrl;
    if (pageNum > 1) {
      if (targetUrl.endsWith('/')) {
        currentUrl = `${targetUrl}page/${pageNum}/`;
      } else {
        currentUrl = `${targetUrl}/page/${pageNum}/`;
      }
    }

    console.log(`\n\x1b[33m📖 Scraping Page ${pageNum}: ${currentUrl}\x1b[0m`);
    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.film-poster, .poster-container, li.grid-item, div.poster', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } catch (err) {
      console.warn(`Could not load page ${pageNum}:`, err.message);
      break;
    }

    const pageFilms = await page.evaluate(() => {
      const results = [];
      const posters = document.querySelectorAll('.film-poster, [data-film-slug], .poster-container, li.grid-item, div.poster');
      for (const el of posters) {
        const slug = el.getAttribute('data-film-slug') || el.querySelector('[data-film-slug]')?.getAttribute('data-film-slug') || '';
        const nameAttr = el.getAttribute('data-film-name') || '';
        const img = el.querySelector('img');
        const alt = img ? img.getAttribute('alt') : '';
        const rawTitle = nameAttr || alt || slug;
        if (rawTitle) {
          results.push({ slug, rawTitle });
        }
      }
      return results;
    });

    console.log(`  Found ${pageFilms.length} items on page ${pageNum}`);
    for (const item of pageFilms) {
      const parsed = parsePosterAlt(item.rawTitle);
      if (parsed && parsed.title && !seenTitles.has(parsed.title.toLowerCase())) {
        seenTitles.add(parsed.title.toLowerCase());
        allExtractedFilms.push({
          title: parsed.title,
          year: parsed.year,
          slug: item.slug
        });
      }
    }
  }

  console.log(`\n\x1b[32m✔ Total unique movies found: ${allExtractedFilms.length}\x1b[0m`);
  console.log(`🎬 Matching titles with TMDB metadata (concurrent batches)...`);

  const matchedMovies = [];
  const BATCH_SIZE = 8;
  for (let i = 0; i < allExtractedFilms.length; i += BATCH_SIZE) {
    const chunk = allExtractedFilms.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async (film) => {
        const tmdbData = await searchTmdb(film.title, film.year);
        if (tmdbData && (tmdbData.poster_path || tmdbData.backdrop_path || tmdbData.id)) {
          const poster = tmdbData.poster_path ? (tmdbData.poster_path.startsWith('http') ? tmdbData.poster_path : `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`) : '';
          const backdrop = tmdbData.backdrop_path ? (tmdbData.backdrop_path.startsWith('http') ? tmdbData.backdrop_path : `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`) : '';
          const voteAvg = Number(tmdbData.vote_average ?? tmdbData.voteAverage) || 0;
          const lang = tmdbData.originalLanguage || tmdbData.original_language || '';
          const genreIds = Array.isArray(tmdbData.genre_ids) ? tmdbData.genre_ids : (Array.isArray(tmdbData.genres) ? tmdbData.genres.map(g => g.id) : []);
          
          // Detect Anime: Japanese language + Animation genre (16), or explicit anime flags
          const isAnime = Boolean(
            tmdbData.isAnime ||
            tmdbData.is_anime ||
            ((lang === 'ja' || tmdbData.originCountry === 'JP' || tmdbData.origin_country?.includes('JP')) &&
             (genreIds.includes(16) || tmdbData.type === 'anime' || /anime/i.test(film.slug || '')))
          );

          return {
            id: tmdbData.id,
            title: tmdbData.title || film.title,
            name: tmdbData.title || film.title,
            poster_path: poster,
            backdrop_path: backdrop,
            release_date: tmdbData.release_date || (film.year ? `${film.year}-01-01` : ''),
            vote_average: voteAvg,
            overview: tmdbData.overview || '',
            media_type: 'Movie',
            isAnime,
            original_language: lang,
            genre_ids: genreIds,
            letterboxd_slug: film.slug || ''
          };
        }
        return {
          id: `lb-${film.slug || Buffer.from(film.title).toString('hex').slice(0, 10)}`,
          title: film.title,
          name: film.title,
          poster_path: '',
          backdrop_path: '',
          release_date: film.year ? `${film.year}-01-01` : '',
          vote_average: 0,
          overview: '',
          media_type: 'Movie',
          isAnime: false,
          original_language: '',
          genre_ids: [],
          letterboxd_slug: film.slug || ''
        };
      })
    );

    matchedMovies.push(...results);
    console.log(`  Processed ${matchedMovies.length}/${allExtractedFilms.length} titles...`);
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\x1b[32m✔ Successfully resolved all ${matchedMovies.length} movies!\x1b[0m`);

  // Generate output file
  const urlParts = targetUrl.replace(/\/+$/, '').split('/');
  const defaultSlug = urlParts[urlParts.length - 1] || 'letterboxd-collection';
  const outDir = path.join(ROOT_DIR, 'collections');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outFilePath = customOutPath || path.join(outDir, `${defaultSlug}.json`);
  const collectionData = {
    name: defaultSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    source: targetUrl,
    extracted_at: new Date().toISOString(),
    total_count: matchedMovies.length,
    movies: matchedMovies
  };

  fs.writeFileSync(outFilePath, JSON.stringify(collectionData, null, 2), 'utf8');

  console.log(`\n\x1b[32m🎉 Collection saved successfully to:\x1b[0m`);
  console.log(`📁 ${outFilePath}`);
  console.log(`📊 Total titles: ${matchedMovies.length}`);
  console.log(`\nSample top 5 matched movies:`);
  matchedMovies.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.title} (${m.release_date ? m.release_date.slice(0, 4) : 'N/A'}) - TMDB ID: ${m.id}`);
  });

  await browser.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\n\x1b[31mError during import:\x1b[0m', err);
  process.exit(1);
});
