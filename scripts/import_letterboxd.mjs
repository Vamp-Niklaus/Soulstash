#!/usr/bin/env node
/**
 * Soulstash - Letterboxd List Importer & Automation
 * 
 * Scrapes movie lists from any Letterboxd URL using browser automation (Playwright),
 * enriches them with TMDB metadata (posters, backdrops, ratings, IDs, IMDb ID, IMDb rating),
 * formats them in the EXACT Soulstash MongoDB collection document schema,
 * and saves them into ready-to-use JSON files or directly into MongoDB!
 * 
 * Usage:
 *   node scripts/import_letterboxd.mjs <letterboxd-url> [options]
 * 
 * Options:
 *   --browser                  Open a visible browser window (Edge/Chrome) to watch automation live
 *   --pages=<n>                Number of pages to scrape (default: 1)
 *   --out=<filepath>           Custom output JSON path (default: collections/<slug>.json)
 *   --username=<user>          Directly import into this user's account in MongoDB
 *   --collection=<name>        Target collection name in MongoDB
 * 
 * Examples:
 *   node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --browser
 *   node scripts/import_letterboxd.mjs https://letterboxd.com/jack/list/official-top-250-films-with-the-most/ --pages=2
 *   node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --username=admin --collection="Popular Films"
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
let targetUsername = '';
let targetCollectionName = '';

for (const arg of args) {
  if (arg === '--browser' || arg === '--visible') {
    visibleBrowser = true;
  } else if (arg.startsWith('--pages=')) {
    maxPages = Math.max(1, parseInt(arg.split('=')[1], 10) || 1);
  } else if (arg.startsWith('--out=')) {
    customOutPath = arg.split('=')[1];
  } else if (arg.startsWith('--username=')) {
    targetUsername = arg.split('=')[1].trim();
  } else if (arg.startsWith('--collection=')) {
    targetCollectionName = arg.split('=')[1].trim();
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
  --browser            Open a visible browser window (watch the automation live)
  --pages=<number>     Number of pages to import (default: 1)
  --out=<path>         Custom output file path
  --username=<user>    Directly save into user's account in MongoDB
  --collection=<name>  Collection name in user's account

Examples:
  node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --browser
  node scripts/import_letterboxd.mjs https://letterboxd.com/films/popular/ --username=admin --collection="Popular Films"
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

// Search TMDB / Soulstash backend for movie search result
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

// Fetch detailed movie info from backend (gets verified IMDb ID, IMDb rating, and backdrops)
async function fetchMovieDetails(id) {
  if (!id) return null;
  try {
    const res = await fetch(`https://soulstash-backend.onrender.com/api/movie/${id}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      return await res.json();
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
  console.log(`🎬 Matching titles with TMDB & IMDb metadata (concurrent batches)...`);

  const matchedMovies = [];
  const BATCH_SIZE = 8;
  for (let i = 0; i < allExtractedFilms.length; i += BATCH_SIZE) {
    const chunk = allExtractedFilms.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async (film) => {
        const tmdbData = await searchTmdb(film.title, film.year);
        if (tmdbData && (tmdbData.poster_path || tmdbData.backdrop_path || tmdbData.id)) {
          const idNum = Number(tmdbData.id) || tmdbData.id;
          let details = null;
          if (typeof idNum === 'number' && !isNaN(idNum)) {
            details = await fetchMovieDetails(idNum);
          }
          const data = details || tmdbData;

          // TMDB relative poster & backdrop paths (with leading slash)
          const rawPoster = data.poster_path || tmdbData.poster_path || '';
          const rawBackdrop = data.backdrop_path || tmdbData.backdrop_path || '';
          const cleanPoster = rawPoster ? (rawPoster.startsWith('/') ? rawPoster : `/${rawPoster.replace(/^https?:\/\/[^\/]+\/(t\/p\/[^\/]+)?\/?/, '')}`) : '';
          const cleanBackdrop = rawBackdrop ? (rawBackdrop.startsWith('/') ? rawBackdrop : `/${rawBackdrop.replace(/^https?:\/\/[^\/]+\/(t\/p\/[^\/]+)?\/?/, '')}`) : '';

          const isSeries = data.media_type === 'Series' || data.type === 'tv' || tmdbData.media_type === 'Series';
          const lang = data.originalLanguage || data.original_language || tmdbData.originalLanguage || tmdbData.original_language || '';
          const genreIds = Array.isArray(data.genre_ids) ? data.genre_ids : (Array.isArray(tmdbData.genre_ids) ? tmdbData.genre_ids : []);

          // Detect Anime: Japanese language + Animation genre (16), or explicit anime flags
          const isAnime = Boolean(
            data.isAnime ||
            tmdbData.isAnime ||
            ((lang === 'ja' || data.originCountry === 'JP' || tmdbData.originCountry === 'JP') &&
             (genreIds.includes(16) || data.genres?.some(g => g.id === 16 || g.name === 'Animation') || /anime/i.test(film.slug || '')))
          );

          const voteAvg = Number(data.vote_average ?? tmdbData.vote_average ?? data.voteAverage) || 0;
          const imdbRating = data.imdb_rating != null ? Number(Number(data.imdb_rating).toFixed(1)) : null;

          // Exact 1:1 Soulstash MongoDB collection document format:
          return {
            movieId: isSeries ? null : idNum,
            seriesId: isSeries ? idNum : null,
            id: idNum,
            title: data.title || tmdbData.title || film.title,
            poster_path: cleanPoster,
            backdrop_path: cleanBackdrop,
            release_date: data.release_date || tmdbData.release_date || (film.year ? `${film.year}-01-01` : ''),
            first_air_date: data.first_air_date || '',
            media_type: isSeries ? 'Series' : 'Movie',
            isAnime,
            vote_average: Number(voteAvg.toFixed(2)),
            imdb_id: data.imdb_id || '',
            imdb_rating: imdbRating,
            addedAt: new Date().toISOString()
          };
        }

        // Fallback item
        return {
          movieId: `lb-${film.slug || Buffer.from(film.title).toString('hex').slice(0, 10)}`,
          seriesId: null,
          id: `lb-${film.slug || Buffer.from(film.title).toString('hex').slice(0, 10)}`,
          title: film.title,
          poster_path: '',
          backdrop_path: '',
          release_date: film.year ? `${film.year}-01-01` : '',
          first_air_date: '',
          media_type: 'Movie',
          isAnime: false,
          vote_average: 0,
          imdb_id: '',
          imdb_rating: null,
          addedAt: new Date().toISOString()
        };
      })
    );

    matchedMovies.push(...results);
    console.log(`  Processed ${matchedMovies.length}/${allExtractedFilms.length} titles...`);
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n\x1b[32m✔ Successfully resolved all ${matchedMovies.length} movies in Soulstash MongoDB schema!\x1b[0m`);

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
  console.log(`\nSample top 3 matched movies (100% database schema):`);
  console.log(JSON.stringify(matchedMovies.slice(0, 3), null, 2));

  // If user passed --username, save directly into MongoDB!
  if (targetUsername) {
    const mongoUri = process.env._MONGODB_URI || process.env.MONGODB_URI;
    const dbName = process.env._MONGODB_DB_NAME || process.env.MONGODB_DB_NAME || 'tmdb';
    if (mongoUri) {
      try {
        console.log(`\nConnecting to MongoDB to save collection for @${targetUsername}...`);
        const { MongoClient } = await import('mongodb');
        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const usersCol = db.collection('users');

        const user = await usersCol.findOne({ username: new RegExp(`^${targetUsername}$`, 'i') });
        if (!user) {
          console.warn(`User "${targetUsername}" not found in MongoDB.`);
        } else {
          const colName = targetCollectionName || collectionData.name;
          const collections = Array.isArray(user.collections) ? user.collections : [];
          let targetCol = collections.find(c => c.name?.toLowerCase() === colName.toLowerCase());

          if (targetCol) {
            const existingIds = new Set((targetCol.movies || []).map(m => String(m.id || m.movieId)));
            const newMovies = matchedMovies.filter(m => !existingIds.has(String(m.id || m.movieId)));
            targetCol.movies = [...(targetCol.movies || []), ...newMovies];
            targetCol.movieCount = targetCol.movies.length;
            targetCol.updatedAt = new Date();
          } else {
            targetCol = {
              name: colName,
              description: `Imported from Letterboxd: ${targetUrl}`,
              isDeletable: true,
              isPublic: true,
              isPublished: false,
              banner: matchedMovies[0]?.backdrop_path || '',
              movieCount: matchedMovies.length,
              movies: matchedMovies,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            collections.push(targetCol);
          }

          await usersCol.updateOne(
            { _id: user._id },
            { 
              $set: { 
                collections,
                collectionVersion: (user.collectionVersion || 0) + 1,
                updatedAt: new Date()
              } 
            }
          );
          console.log(`\x1b[32m✔ Successfully updated collection "${colName}" for user @${user.username} in MongoDB!\x1b[0m`);
        }
        await client.close();
      } catch (mongoErr) {
        console.warn(`Could not save to MongoDB:`, mongoErr.message);
      }
    }
  }

  await browser.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\n\x1b[31mError during import:\x1b[0m', err);
  process.exit(1);
});
