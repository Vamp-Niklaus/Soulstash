const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');
const { getDb, SOURCE_CONFIGS_COLLECTION, MULTIMOVIES_CONFIG_DOC_ID } = require('../db');
const { INDIAN_LANGS, normalize, computeFinalScore } = require('../util');
const { METRICS_COLLECTION, RATINGS_COLLECTION, RATINGS_METRICS_DOC_ID, normalizeMediaType, resolveImdbRating, validVoteAverage } = require('../util/imdbRatings');
const {
  PREFERRED_SERVER_ORDER,
  buildSearchKey,
  scrapeMultimoviesTitle,
  resolveMatchedPage,
  buildSourceHistoryRecord,
  mergeSourceHistoryRecord,
  extractPageMetadata
} = require('../util/multimoviesScraper');
const { optionalAuth } = require('../middleware/auth');
const { playwrightFetch } = require('../util/playwrightFetch');
const ytSearch = require('yt-search');

const TMDB_BEARER_TOKEN = process.env.TMDB_BEARER_TOKEN;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL || 'https://api.tmdb.org';
const WATCHMODE_API_KEY = process.env.WATCHMODE_API_KEY || process.env.WATCHMODE;
const fetch = global.fetch;
const PLAYER_SOURCES_COLLECTION = 'PlayerSources';
const MOVIE_SOURCES_COLLECTION = 'Movie_Sources';
const TV_SHOW_URLS_COLLECTION = 'TVShowURLs';
const DEFAULT_MULTIMOVIES_BASE_URL = 'https://multimovies.fyi/';
const DEFAULT_MULTIMOVIES_ROOT_URL = 'https://multimovies.fyi/';

const refreshLocks = new Set();

const DIRECT_SOURCES = [
  { id: 'videasy', label: 'VIDEASY', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://player.videasy.to/tv/${t}/${s || 1}/${e || 1}?color=F97316&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true` : `https://player.videasy.to/movie/${t}?color=F97316&overlay=true` },
  { id: 'vidfast', label: 'vidfast', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://vidfast.pro/tv/${t}/${s || 1}/${e || 1}?autoPlay=true&title=true&poster=true&theme=F97316&nextButton=true&autoNext=true` : `https://vidfast.pro/movie/${t}?autoPlay=true&title=true&poster=true&theme=F97316` }
];

// â”€â”€ TMDB fetch with retry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function tmdbFetch(url, options, context = 'TMDB API') {
  if (url.startsWith('https://api.themoviedb.org')) {
    url = url.replace('https://api.themoviedb.org', TMDB_BASE_URL);
  }
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[TMDB] ${context} attempt ${attempt}/${maxRetries} -> ${url}`);
      return await fetch(url, options);
    } catch (err) {
      console.error(`[TMDB] ${context} network error on attempt ${attempt}: ${err.message}${err.cause?.message ? ` | cause: ${err.cause.message}` : ''}`);
      if (attempt === maxRetries) {
        console.error(`âŒ ${context} failed after ${maxRetries} attempts`);
        throw new Error(`${context} failed: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

const tmdbHeaders = () => ({
  accept: 'application/json',
  Authorization: `Bearer ${String(process.env.TMDB_BEARER_TOKEN || TMDB_BEARER_TOKEN || '').trim()}`
});

function normalizePlayerMediaType(value = '') {
  return String(value).trim().toLowerCase() === 'movie' ? 'movie' : 'series';
}

function sanitizeProviderUrls(urls = []) {
  return (Array.isArray(urls) ? urls : []).filter((rawUrl) => {
    if (!rawUrl) return false;
    try {
      const parsed = new URL(rawUrl);
      const pathname = parsed.pathname || '/';
      return (
        /\/(?:e|embed|v|svid|file|files)\//i.test(pathname) ||
        pathname.toLowerCase().endsWith('.html') ||
        Boolean(parsed.hash) ||
        Boolean(parsed.search)
      );
    } catch {
      return false;
    }
  });
}

function buildPlayerSourcePayload(record = {}, identity = null, isScraping = false) {
  const mediaType = record.mediaType || identity?.mediaType || 'movie';
  const tmdbId = record.tmdbId || identity?.tmdbId || null;
  const season = record.seasonNumber || identity?.seasonNumber || 1;
  const episode = record.episodeNumber || identity?.episodeNumber || 1;

  const multimoviesSources = PREFERRED_SERVER_ORDER.map((sourceKey, index) => {
    const urls = sanitizeProviderUrls(record?.sources?.[sourceKey]);
    const url = urls[0] || '';
    if (!url && isScraping) {
      return {
        id: sourceKey,
        key: sourceKey,
        label: `H${index + 1}`,
        url: '',
        pending: true,
        embeddable: true
      };
    }
    if (!url) return null;
    return {
      id: sourceKey,
      key: sourceKey,
      label: `H${index + 1}`,
      urls,
      url,
      embeddable: true
    };
  }).filter(Boolean);

  const directSources = (tmdbId) ? DIRECT_SOURCES.map(s => ({
    id: s.id,
    key: s.id,
    label: s.label,
    url: s.template(mediaType, tmdbId, season, episode),
    embeddable: true,
    isDirect: true
  })) : [];

  const youtubeUrls = sanitizeProviderUrls(record?.sources?.youtube);
  const youtubeSource = youtubeUrls[0]
    ? {
        id: 'youtube',
        key: 'youtube',
        label: 'YouTube',
        urls: youtubeUrls,
        url: youtubeUrls[0],
        embeddable: true
      }
    : null;


  return {
    searchKey: record.searchKey || '',
    tmdbId,
    imdbId: record.imdbId || identity?.imdbId || '',
    mediaType,
    seasonNumber: record.seasonNumber || identity?.seasonNumber || null,
    episodeNumber: record.episodeNumber || identity?.episodeNumber || null,
    updatedAt: record.updatedAt || null,
    scraping: isScraping,
    notAvailable: Boolean(record.notAvailable),
    downloads: Array.isArray(record.downloads) ? record.downloads.filter(Boolean) : [],
    sources: [...multimoviesSources, ...directSources, ...(youtubeSource ? [youtubeSource] : [])]
  };

}

function normalizeUrlList(values = [], fallback = '') {
  const list = Array.isArray(values) ? values : [];
  const normalized = list
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return normalized.length ? normalized : (fallback ? [fallback] : []);
}

function prependConfigValue(values = [], nextValue = '') {
  const normalizedValue = String(nextValue || '').trim();
  const normalizedValues = normalizeUrlList(values);
  if (!normalizedValue) return normalizedValues;
  if (normalizedValues[0] === normalizedValue) return normalizedValues;
  return [normalizedValue, ...normalizedValues];
}

async function getMultimoviesConfig() {
  const stored = await getDb().collection(SOURCE_CONFIGS_COLLECTION).findOne({ _id: MULTIMOVIES_CONFIG_DOC_ID });
  return {
    _id: MULTIMOVIES_CONFIG_DOC_ID,
    className: 'multimovies',
    available: stored?.available !== false,
    rootUrls: normalizeUrlList(stored?.rootUrls, DEFAULT_MULTIMOVIES_ROOT_URL),
    baseUrls: normalizeUrlList(stored?.baseUrls, DEFAULT_MULTIMOVIES_BASE_URL),
    updatedAt: stored?.updatedAt || null
  };
}

async function saveMultimoviesConfig(update = {}) {
  const current = await getMultimoviesConfig();
  const nextRootUrls = update.rootUrl !== undefined
    ? prependConfigValue(current.rootUrls, update.rootUrl)
    : current.rootUrls;
  const nextBaseUrls = update.baseUrl !== undefined
    ? prependConfigValue(current.baseUrls, update.baseUrl)
    : current.baseUrls;
  const nextAvailable = update.available !== undefined ? Boolean(update.available) : current.available;

  const nextDoc = {
    _id: MULTIMOVIES_CONFIG_DOC_ID,
    className: 'multimovies',
    available: nextAvailable,
    rootUrls: nextRootUrls,
    baseUrls: nextBaseUrls,
    updatedAt: new Date()
  };

  await getDb().collection(SOURCE_CONFIGS_COLLECTION).updateOne(
    { _id: MULTIMOVIES_CONFIG_DOC_ID },
    {
      $set: nextDoc,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );

  return nextDoc;
}

function extractMultimoviesBaseUrlFromRoot(html = '', rootUrl = '') {
  const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*btn-main[^"']*["'][^>]*>\s*Visit\s*MultiMovies\s*<\/a>/i);
  if (match?.[1]) {
    return new URL(match[1], rootUrl || DEFAULT_MULTIMOVIES_ROOT_URL).toString();
  }
  return '';
}

async function resolveMultimoviesBaseUrlFromRoot(rootUrl) {
  const response = await playwrightFetch(rootUrl);

  if (!response.ok) {
    throw new Error(`Root URL request failed with status ${response.status}`);
  }

  const html = await response.text();
  const baseUrl = extractMultimoviesBaseUrlFromRoot(html, rootUrl);
  if (!baseUrl) {
    throw new Error('Unable to extract base URL from root URL');
  }

  return baseUrl;
}

async function scrapeWithMultimoviesConfig(identity, options = {}) {
  const { onTableHit, onSource } = options;
  const initialConfig = await getMultimoviesConfig();
  const currentBaseUrl = initialConfig.baseUrls[0] || DEFAULT_MULTIMOVIES_BASE_URL;
  const buildScrapeInput = () => ({
    mediaType: identity.mediaType,
    title: identity.title,
    year: identity.year,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
    episodeTitle: identity.episodeTitle,
    synopsis: identity.overview,
    director: [],
    cast: []
  });
  const logger = {
    log: (...args) => console.log(...args)
  };

  const attemptScrape = async (baseUrl, scrapeOptions = {}) => {
    const { onTableHit, onSource } = scrapeOptions;
    try {
      const input = buildScrapeInput();
      const scraperOptions = {
        baseUrl,
        logger,
        fetchImpl: playwrightFetch,
        onSource: options.onSource
      };

      const db = getDb();
      const overviewStr = String(identity.overview || '').trim();
      let preMatchedUrl = '';
      let preMatchedHtml = null;
      let preMatchedMetadata = null;

      const reqId = options.reqId || Math.random().toString(36).substr(2, 4).toUpperCase();
      const logPrefix = `[Req-${reqId}] [Method 2]`;
      console.log(`\n############# Method 2 (Req ${reqId}) ################`);
      console.log(`${logPrefix} Checking Database by Synopsis Match...`);
      
      const expectedDesc = identity.mediaType === 'series' 
        ? (identity.episode1Overview || identity.seriesOverview || overviewStr)
        : overviewStr;
      
      if (identity.mediaType === 'series') {
        const { normalizeMultimoviesSlug, synopsisStats, extractPageMetadata, fullyMatchesTarget, fetchHtmlText } = require('../util/multimoviesScraper');
        let seriesSlug = normalizeMultimoviesSlug(identity.title);
        let tvShowDoc = null;
        
        if (seriesSlug) {
          console.log(`${logPrefix} [Priority 1] Searching TVShowURLs by tmdbId: ${identity.tmdbId} or slug: "${seriesSlug}"`);
          tvShowDoc = await db.collection(TV_SHOW_URLS_COLLECTION).findOne({ tmdbId: identity.tmdbId });
          
          if (tvShowDoc) {
            console.log(`${logPrefix} [Success] Exact tmdbId match found in TVShowURLs!`);
          } else if (expectedDesc && expectedDesc.length > 20) {
            const candidateDocs = await db.collection(TV_SHOW_URLS_COLLECTION).find({
              url: { $regex: seriesSlug, $options: 'i' }
            }).toArray();
            
            for (const doc of candidateDocs) {
              if (doc.episode1_description && expectedDesc) {
                const stats = synopsisStats(expectedDesc, doc.episode1_description);
                if (stats.phraseMatched || stats.overlapRatio >= 0.35) {
                  tvShowDoc = doc;
                  console.log(`${logPrefix} [Success] Synopsis match found! URL: ${doc.url}`);
                  await db.collection(TV_SHOW_URLS_COLLECTION).updateOne(
                    { _id: doc._id },
                    { $set: { tmdbId: identity.tmdbId } }
                  ).catch(() => {});
                  console.log(`${logPrefix} Linked tmdbId ${identity.tmdbId} to this TVShowURLs document.`);
                  break;
                }
              }
            }
          } else {
            console.log(`${logPrefix} [Failure] No tmdbId match, and synopsis too short for safe fallback search.`);
          }
        }

        if (tvShowDoc) {
          const seasonKey = `s${identity.seasonNumber}`;
          const episodeKey = `e${identity.episodeNumber}`;
          const combinedKey = `${seasonKey}${episodeKey}`;
          const epData = tvShowDoc.episodes?.[combinedKey];
          
          console.log(`${logPrefix} [Priority 2] Checking if requested episode ${combinedKey} exists in matched document...`);
          if (epData && Object.keys(epData).some(k => epData[k] && epData[k].length)) {
            console.log(`${logPrefix} [Success] Sources found in DB for episode!`);
            const players = PREFERRED_SERVER_ORDER.map(sourceKey => {
              const urls = epData[sourceKey];
              const url = Array.isArray(urls) ? urls[0] : (typeof urls === 'string' ? urls : '');
              if (!url) return null;
              return { sourceKey, serverName: sourceKey.toUpperCase(), url, available: true, preferred: true };
            }).filter(Boolean);

            if (players.length) {
              console.log(`[Req-${reqId}] [Player Sources] Returning immediate DB hit for: ${tvShowDoc.url} ${combinedKey}`);
              const tableResult = {
                ok: true,
                status: 'success',
                reason: 'tvshowurls-hit',
                searchKey: buildSearchKey(input),
                pageUrl: tvShowDoc.episode1 || tvShowDoc.url,
                players,
                downloads: epData.downloads || []
              };

              if (tvShowDoc.episodes) {
                const bulkUpdates = {};
                for (const [key, data] of Object.entries(tvShowDoc.episodes)) {
                  const epSources = {};
                  let hasSource = false;
                  for (const k of PREFERRED_SERVER_ORDER) {
                    const urls = data[k];
                    const u = Array.isArray(urls) ? urls[0] : (typeof urls === 'string' ? urls : '');
                    if (u) { epSources[k] = [u]; hasSource = true; }
                  }
                  if (hasSource) {
                    bulkUpdates[`episodes.${key}.sources`] = epSources;
                    bulkUpdates[`episodes.${key}.downloads`] = data.downloads || [];
                    bulkUpdates[`episodes.${key}.lastScrapeAttempt`] = Date.now();
                  }
                }
                if (Object.keys(bulkUpdates).length > 0) {
                  bulkUpdates.updatedAt = new Date();
                  await db.collection('PlayerSources').updateOne(
                    { tmdbId: identity.tmdbId, mediaType: 'series' },
                    { $set: bulkUpdates, $setOnInsert: { createdAt: new Date() } },
                    { upsert: true }
                  ).catch(e => console.error(`${logPrefix} Bulk update failed:`, e.message));
                  console.log(`${logPrefix} Bulk inserted ${Object.keys(tvShowDoc.episodes).length} episodes into PlayerSources cache!`);
                }
              }

              if (typeof onTableHit === 'function') {
                await onTableHit(tableResult).catch(err => console.error(`${logPrefix} onTableHit failed:`, err.message));
              }
            }
          } else {
            console.log(`${logPrefix} [Failure] Episode ${combinedKey} not found in DB document.`);
          }

          console.log(`${logPrefix} [Priority 3] Extracting accurate base slug from document's episode1...`);
          if (tvShowDoc.episode1) {
            try {
              const urlPath = new URL(tvShowDoc.episode1).pathname;
              const baseMatch = urlPath.match(/\/episodes\/(.+?)-\d+x\d+(?:-\d+)?\/?$/);
              if (baseMatch && baseMatch[1]) {
                seriesSlug = baseMatch[1];
                console.log(`${logPrefix} [Success] Adjusted search slug to: ${seriesSlug}`);
              }
            } catch(e) {}
          }
        }

        if (seriesSlug && identity.seasonNumber && identity.episodeNumber) {
          console.log(`${logPrefix} [Priority 5] Proceeding to URL derivation/verification...`);
          const epSlug = `${seriesSlug}-${identity.seasonNumber}x${identity.episodeNumber}`;
          let learnedSuffix = null;
          try {
            if (tvShowDoc && tvShowDoc.episode1) {
              const urlPath = new URL(tvShowDoc.episode1).pathname;
              const suffixMatch = urlPath.match(/-(\d+)x\d+(-\d+)\/?$/);
              if (suffixMatch) {
                learnedSuffix = suffixMatch[2] || '';
                console.log(`${logPrefix} URL Suffix "${learnedSuffix}" inherited from tvShowDoc episode1.`);
              }
            }
            if (learnedSuffix === null) {
              const existingMaster = await db.collection('PlayerSources').findOne({ tmdbId: identity.tmdbId, mediaType: 'series' });
              if (existingMaster?.episodes) {
                for (const [, epData] of Object.entries(existingMaster.episodes)) {
                  if (epData?.pageUrl) {
                    try {
                      const urlPath = new URL(epData.pageUrl).pathname;
                      const suffixMatch = urlPath.match(/-(\d+)x\d+(-\d+)\/?$/);
                      if (suffixMatch) {
                        learnedSuffix = suffixMatch[2] || '';
                        console.log(`${logPrefix} URL Suffix "${learnedSuffix}" inherited from sibling episode.`);
                        break;
                      }
                    } catch(e) {}
                  }
                }
              }
            }
          } catch (e) {}
          
          let verifiedEpUrl = null;
          if (learnedSuffix !== null) {
            verifiedEpUrl = `${baseUrl.replace(/\/+$/, '')}/episodes/${epSlug}${learnedSuffix}/`;
            console.log(`${logPrefix} Trusted URL Suffix "${learnedSuffix}" from DB. Target URL: ${verifiedEpUrl}`);
          } else if (identity.episode1Overview && identity.episode1Overview.length > 20) {
            console.log(`${logPrefix} Unknown suffix! Fetching 1x1 episodes to determine series URL format...`);
            const s1e1Slug = `${seriesSlug}-1x1`;
            const candidateS1Urls = [
              `${baseUrl.replace(/\/+$/, '')}/episodes/${s1e1Slug}/`,
              `${baseUrl.replace(/\/+$/, '')}/episodes/${s1e1Slug}-2/`,
              `${baseUrl.replace(/\/+$/, '')}/episodes/${s1e1Slug}-3/`
            ];
            let foundS1Url = null;
            for (const s1Url of candidateS1Urls) {
              try {
                console.log(`${logPrefix} Verifying 1x1 candidate: ${s1Url}`);
                const pageRes = await fetchHtmlText(s1Url, playwrightFetch);
                if (!pageRes || !pageRes.html) continue;
                const metadata = extractPageMetadata(pageRes.html, pageRes.finalUrl || s1Url);
                const matchState = fullyMatchesTarget(metadata, { title: identity.title, year: identity.year, synopsis: identity.episode1Overview });
                if (matchState.ok) {
                  console.log(`${logPrefix} [Success] 1x1 synopsis matches TMDB episode1Overview! Format confirmed.`);
                  foundS1Url = s1Url;
                  const suffixMatch = new URL(foundS1Url).pathname.match(/-(\d+)x\d+(-\d+)\/?$/);
                  learnedSuffix = suffixMatch ? (suffixMatch[2] || '') : '';
                  const seriesUrl = foundS1Url.replace('/episodes/', '/tvshows/').replace(/-\d+x\d+(-\d+)?\/?$/, '/');
                  await db.collection(TV_SHOW_URLS_COLLECTION).updateOne(
                    { url: seriesUrl },
                    { $set: { episode1: foundS1Url, episode1_description: metadata.synopsis, episode1_name: metadata.episodeTitle } },
                    { upsert: true }
                  ).catch(() => {});
                  break;
                }
              } catch (e) { console.log(`${logPrefix} [Error] 1x1 check failed: ${e.message}`); }
            }
            if (foundS1Url) {
              verifiedEpUrl = `${baseUrl.replace(/\/+$/, '')}/episodes/${epSlug}${learnedSuffix}/`;
              console.log(`${logPrefix} Applied discovered suffix "${learnedSuffix}" to requested episode: ${verifiedEpUrl}`);
            }
          }
          if (verifiedEpUrl) {
            preMatchedUrl = verifiedEpUrl;
            console.log(`${logPrefix} Handing verified URL over to Method 3 scraper: ${preMatchedUrl}`);
          }
        }
      } else if (expectedDesc && expectedDesc.length > 20) {
        const movieSource = await db.collection(MOVIE_SOURCES_COLLECTION).findOne({ overview: overviewStr });
        if (movieSource && movieSource.url) {
          console.log(`[Player Sources] Movie_Sources overview match for movie: ${identity.title}`);
          preMatchedUrl = movieSource.url;
        } else {
          console.log(`[Method 2] Failed. No match found in Movie_Sources by synopsis.`);
        }
      }

      console.log(`\n############# Method 3 ################`);
      console.log(`[Method 3] Manual Scraping...`);
      let pageResult;
      if (preMatchedUrl) {
         if (preMatchedHtml) {
             // Use the HTML already fetched during Method 2 verification â€” no re-fetch needed!
             console.log(`[Player Sources] Using pre-fetched HTML from Method 2 verification for: ${preMatchedUrl}`);
             pageResult = {
                 ok: true,
                 status: 'matched',
                 pageUrl: preMatchedUrl,
                 pagePath: new URL(preMatchedUrl).pathname,
                 html: preMatchedHtml,
                 metadata: preMatchedMetadata || extractPageMetadata(preMatchedHtml, preMatchedUrl),
                 matchScore: 1,
                 matchReason: 'pre-matched-by-overview'
             };
         } else {
             try {
                 console.log(`[Player Sources] Fetching pre-matched URL: ${preMatchedUrl}`);
                 const response = await playwrightFetch(preMatchedUrl);
                 if (response.ok) {
                     const html = await response.text();
                     pageResult = {
                         ok: true,
                         status: 'matched',
                         pageUrl: preMatchedUrl,
                         pagePath: new URL(preMatchedUrl).pathname,
                         html,
                         metadata: extractPageMetadata(html, preMatchedUrl),
                         matchScore: 1,
                         matchReason: 'pre-matched-by-overview'
                     };
                 }
             } catch (err) {
                 console.error(`[Player Sources] Failed to fetch pre-matched URL:`, err.message);
             }
         }
      }

      // 1. Resolve the matched page first if no pre-match
      if (!pageResult || !pageResult.ok) {
        pageResult = await resolveMatchedPage(input, { ...scraperOptions, fetchImpl: global.fetch });
        
        if (!pageResult || !pageResult.ok) {
          console.log(`[Player Sources] global.fetch resolveMatchedPage failed (${pageResult?.reason}), retrying with playwrightFetch...`);
          pageResult = await resolveMatchedPage(input, scraperOptions);
        }
      }

      if (!pageResult || !pageResult.ok) {
        return pageResult || { ok: false };
      }

      // --- NEW: Store overview for future matches ---
      if (overviewStr && overviewStr.length > 20 && pageResult.pageUrl) {
         if (identity.mediaType === 'series') {
            const seriesUrl = pageResult.pageUrl.replace('/episodes/', '/tvshows/').replace(/-\d+x\d+(-\d+)?\/?$/, '/');
            db.collection(TV_SHOW_URLS_COLLECTION).updateOne(
              { url: seriesUrl },
              { $set: { overview: overviewStr } }
            ).catch(() => {});
         } else {
            db.collection(MOVIE_SOURCES_COLLECTION).updateOne(
              { url: pageResult.pageUrl },
              { $set: { overview: overviewStr } }
            ).catch(() => {});
         }
      }

      // 2. Check the Movie_Sources table for this URL
      if (pageResult.pageUrl) {
        // --- NEW: Check TVShowURLs for series ---
        if (identity.mediaType === 'series') {
          try {
            const seriesUrl = pageResult.pageUrl
              .replace('/episodes/', '/tvshows/')
              .replace(/-\d+x\d+(-\d+)?\/?$/, '/');
            
            console.log(`[Player Sources] Checking TVShowURLs for seriesUrl: ${seriesUrl}`);
            const tvShowDoc = await getDb().collection(TV_SHOW_URLS_COLLECTION).findOne({ url: seriesUrl });
            
            if (tvShowDoc) {
              const seasonKey = `s${identity.seasonNumber}`;
              const episodeKey = `e${identity.episodeNumber}`;
              const epData = tvShowDoc[seasonKey]?.[episodeKey];
              
              if (epData && epData.sources) {
                const players = PREFERRED_SERVER_ORDER.map(sourceKey => {
                  const urls = epData.sources[sourceKey];
                  const url = Array.isArray(urls) ? urls[0] : (typeof urls === 'string' ? urls : '');
                  if (!url) return null;
                  return {
                    sourceKey,
                    serverName: sourceKey.toUpperCase(),
                    url,
                    available: true,
                    preferred: true
                  };
                }).filter(Boolean);

                if (players.length) {
                  console.log(`[Player Sources] TVShowURLs Hit for ${seriesUrl} ${seasonKey}x${episodeKey}`);
                  const tableResult = {
                    ok: true,
                    status: 'success',
                    reason: 'tvshowurls-hit',
                    searchKey: buildSearchKey(input),
                    pageUrl: pageResult.pageUrl,
                    players,
                    downloads: epData.downloads || []
                  };

                  if (typeof onTableHit === 'function') {
                    await onTableHit(tableResult).catch(err => console.error('[Player Sources] onTableHit (TVShowURLs) failed:', err.message));
                  }
                  
                  // RETURN HERE to avoid "scraping twice"
                  return tableResult;
                }
              }
            }
          } catch (tvErr) {
            console.error('[Player Sources] TVShowURLs lookup error:', tvErr.message);
          }
        }

        try {
          const db = getDb();
          const movieSource = await db.collection(MOVIE_SOURCES_COLLECTION).findOne({
            url: pageResult.pageUrl
          });

          if (movieSource && movieSource.sources) {
            const players = PREFERRED_SERVER_ORDER.map((sourceKey, index) => {
              const urls = movieSource.sources[sourceKey] || [];
              const url = urls[0] || '';
              if (!url) return null;
              return {
                sourceKey,
                serverName: sourceKey.toUpperCase(),
                url,
                available: true,
                preferred: true
              };
            }).filter(Boolean);

            if (players.length) {
              const tableResult = {
                ok: true,
                status: 'success',
                reason: 'table-hit',
                searchKey: buildSearchKey(input),
                pageUrl: pageResult.pageUrl,
                pagePath: pageResult.pagePath,
                metadata: pageResult.metadata,
                players,
                downloads: movieSource.downloads || [],
                matchStats: pageResult.matchStats || null
              };

              if (typeof onTableHit === 'function') {
                await onTableHit(tableResult).catch(err => {
                  console.error('[Player Sources] onTableHit callback failed:', err.message);
                });
              }

              // RETURN HERE to avoid "scraping twice"
              return tableResult;
            }
          }
        } catch (dbError) {
          console.error('[Player Sources] Movie_Sources lookup error:', dbError.message);
        }
      }

      // 3. Fallback to full scraper (passing the resolved pageResult to avoid re-fetching)
      return await scrapeMultimoviesTitle(input, {
        ...scraperOptions,
        pageResult
      });
    } catch (error) {
      console.error('[Player Sources] scrape attempt failed', {
        baseUrl,
        message: error.message
      });
      return {
        ok: false,
        status: 'failure',
        reason: 'base-url-fetch-failed',
        errorMessage: error.message
      };
    }
  };

  let scrapeResult = await attemptScrape(currentBaseUrl, { onTableHit, onSource });

  const shouldTryRootFallback =
    !scrapeResult.ok &&
    ['page-not-found', 'no-matching-slug', 'no-player-links-found', 'base-url-fetch-failed', 'cloudflare-blocked', 'title-mismatch'].includes(String(scrapeResult.reason || '').trim());

  if (!shouldTryRootFallback) {
    return scrapeResult;
  }

  const currentRootUrl = initialConfig.rootUrls[0] || DEFAULT_MULTIMOVIES_ROOT_URL;
  try {
    const refreshedBaseUrl = await resolveMultimoviesBaseUrlFromRoot(currentRootUrl);
    await saveMultimoviesConfig({ rootUrl: currentRootUrl, baseUrl: refreshedBaseUrl, available: true });

      if (refreshedBaseUrl && refreshedBaseUrl !== currentBaseUrl) {
        scrapeResult = await attemptScrape(refreshedBaseUrl, { onTableHit, onSource });
      }
  } catch (error) {
    console.error('[Player Sources] multimovies root fallback failed', {
      rootUrl: currentRootUrl,
      message: error.message
    });
    await saveMultimoviesConfig({ available: false });
  }

  return scrapeResult;
}

async function attachImdbIds(items = [], mediaType) {
  const enriched = await Promise.all(
    (Array.isArray(items) ? items : []).map(async (item) => {
      if (!item?.id) return item;
      if (item?.imdb_id) return item;
      const imdbResult = await resolveImdbRating(item.id, mediaType, item).catch(() => ({ imdbID: '' }));
      return {
        ...item,
        imdb_id: imdbResult?.imdbID || item?.imdb_id || ''
      };
    })
  );

  return enriched;
}

async function attachCachedRatings(items = []) {
  const normalizedItems = (Array.isArray(items) ? items : []).filter(
    (item) => item?.id && (item?.media_type === 'movie' || item?.media_type === 'tv')
  );

  if (!normalizedItems.length) {
    return Array.isArray(items) ? items : [];
  }

  const tmdbIds = [...new Set(normalizedItems.map((item) => Number(item.id)).filter(Boolean))];
  const ratingRecords = await getDb()
    .collection(RATINGS_COLLECTION)
    .find({ tmdbID: { $in: tmdbIds } })
    .toArray();

  const ratingMap = new Map(
    ratingRecords.map((record) => [`${record.mediaType}:${record.tmdbID}`, record])
  );

  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item?.id || (item?.media_type !== 'movie' && item?.media_type !== 'tv')) {
      return item;
    }

    const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
    const match = ratingMap.get(`${mediaType}:${Number(item.id)}`);
    if (!match) {
      return item;
    }

    return {
      ...item,
      imdb_id: String(item?.imdb_id || match?.imdbID || '').trim(),
      imdb_rating: match?.imdb_rating,
      vote_average: validVoteAverage(item?.vote_average) ?? validVoteAverage(match?.vote_average) ?? item?.vote_average,
      rating_lookup_attempted: true
    };
  });
}

async function canAccessContentForUser(req, content = {}, mediaType = 'Movie') {
  const includeAdult = await resolveIncludeAdult(req);
  if (!includeAdult && content?.adult === true) {
    return false;
  }

  if (includeAdult) {
    return true;
  }

  const imdbId = String(content?.imdb_id || '').trim();
  if (imdbId) {
    return true;
  }

  const imdbResult = await resolveImdbRating(content?.id, mediaType, content).catch(() => ({ imdbID: '' }));
  content.imdb_id = imdbResult?.imdbID || content?.imdb_id || '';
  return Boolean(String(content.imdb_id || '').trim());
}

function extractMovieDirectors(detail = {}, crew = []) {
  if (Array.isArray(detail?.director) && detail.director.length) {
    return detail.director.filter(Boolean);
  }

  if (typeof detail?.director === 'string' && detail.director.trim()) {
    return [detail.director.trim()];
  }

  const directors = Array.isArray(crew)
    ? crew
        .filter((person) => person?.job === 'Director' || person?.known_for_department === 'Directing')
        .map((person) => person?.name)
        .filter(Boolean)
    : [];

  return [...new Set(directors)].slice(0, 5);
}

function extractSeriesDirectors(detail = {}, crew = []) {
  const creators = Array.isArray(detail?.created_by)
    ? detail.created_by.map((person) => person?.name).filter(Boolean)
    : [];

  if (creators.length) {
    return [...new Set(creators)].slice(0, 5);
  }

  return extractMovieDirectors(detail, crew);
}

async function fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const normalizedMediaType = normalizePlayerMediaType(mediaType);
  const numericTmdbId = Number(tmdbId || 0);
  if (!numericTmdbId) {
    throw new Error('Valid tmdbId is required.');
  }

  const detailUrl =
    normalizedMediaType === 'movie'
      ? `https://api.themoviedb.org/3/movie/${numericTmdbId}?language=en-US`
      : `https://api.themoviedb.org/3/tv/${numericTmdbId}?language=en-US`;
  const episodeUrl =
    normalizedMediaType === 'series'
      ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/season/${Number(seasonNumber || 1)}/episode/${Number(episodeNumber || 1)}?language=en-US`
      : '';
  const ep1Url =
    normalizedMediaType === 'series' && (Number(seasonNumber || 1) !== 1 || Number(episodeNumber || 1) !== 1)
      ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/season/1/episode/1?language=en-US`
      : '';

  const [detailResp, episodeResp, ep1Resp] = await Promise.all([
    tmdbFetch(detailUrl, { method: 'GET', headers: tmdbHeaders() }, `Player Detail ${normalizedMediaType} ${numericTmdbId}`),
    episodeUrl
      ? tmdbFetch(episodeUrl, { method: 'GET', headers: tmdbHeaders() }, `Player Episode ${normalizedMediaType} ${numericTmdbId} ${Number(seasonNumber || 1)}x${Number(episodeNumber || 1)}`).catch(() => null)
      : Promise.resolve(null),
    ep1Url
      ? tmdbFetch(ep1Url, { method: 'GET', headers: tmdbHeaders() }, `Player Episode 1 ${normalizedMediaType} ${numericTmdbId}`).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (!detailResp.ok) {
    throw new Error(`TMDB detail lookup failed with status ${detailResp.status}`);
  }

  const detail = await detailResp.json();
  const episodeDetail = episodeResp?.ok ? await episodeResp.json() : {};
  const ep1Detail = ep1Resp?.ok ? await ep1Resp.json() : {};
  
  const title = normalizedMediaType === 'movie' ? detail.title || detail.original_title || '' : detail.name || detail.original_name || '';
  const yearValue = detail.release_date || detail.first_air_date || '';
  const year = Number(String(yearValue).slice(0, 4)) || null;
  const overview = normalizedMediaType === 'movie'
    ? String(detail?.overview || '').trim()
    : String(episodeDetail?.overview || detail?.overview || '').trim();
  const episodeTitle = normalizedMediaType === 'series'
    ? String(episodeDetail?.name || '').trim()
    : '';
  
  const seriesOverview = normalizedMediaType === 'series'
    ? String(detail?.overview || '').trim()
    : '';
    
  const episode1Overview = normalizedMediaType === 'series'
    ? (Number(seasonNumber || 1) === 1 && Number(episodeNumber || 1) === 1
        ? overview
        : String(ep1Detail?.overview || '').trim())
    : '';

  return {
    mediaType: normalizedMediaType,
    tmdbId: numericTmdbId,
    imdbId: String(detail?.imdb_id || '').trim(),
    title,
    year,
    seasonNumber: normalizedMediaType === 'series' ? Number(seasonNumber || 1) : null,
    episodeNumber: normalizedMediaType === 'series' ? Number(episodeNumber || 1) : null,
    overview,
    seriesOverview,
    episode1Overview,
    episodeTitle,
    directors: [],
    cast: [],
    runtime: detail.runtime || 120,
    episodeRuntime: episodeDetail?.runtime || detail.episode_run_time?.[0] || 40
  };
}

async function refreshPlayerSourceRecord(identity) {
  const reqId = Math.random().toString(36).substr(2, 4).toUpperCase();
  const searchKey = buildSearchKey(identity);
  // Also lock a cheap per-episode key so Method 1 can detect active scrapes
  // without needing the full searchKey (which requires a TMDB fetch to build).
  const episodeLockKey = identity.mediaType === 'series'
    ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}`
    : null;
  if (refreshLocks.has(searchKey)) return;
  refreshLocks.add(searchKey);
  if (episodeLockKey) refreshLocks.add(episodeLockKey);

  try {
    console.log('[Player Sources] refresh START', {
      mediaType: identity.mediaType,
      tmdbId: identity.tmdbId,
      imdbId: identity.imdbId,
      title: identity.title,
      episodeTitle: identity.episodeTitle,
      year: identity.year,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
      overviewPreview: String(identity.overview || '').slice(0, 220)
    });

    const collection = getDb().collection(PLAYER_SOURCES_COLLECTION);

  const onSource = async (sources = []) => {
    try {
      if (!sources.length) return;
      const incoming = buildSourceHistoryRecord({ players: sources, searchKey: identity.searchKey || searchKey }, identity);
      const updateFilter = identity.mediaType === 'series'
        ? { tmdbId: identity.tmdbId, mediaType: 'series' }
        : { tmdbId: identity.tmdbId, mediaType: 'movie' };

      const existingDoc = await collection.findOne(updateFilter);
      const epKey = identity.mediaType === 'series' ? `s${identity.seasonNumber}e${identity.episodeNumber}` : null;
      
      let existingSources = {};
      let existingDownloads = [];
      if (identity.mediaType === 'series') {
        existingSources = existingDoc?.episodes?.[epKey]?.sources || {};
        existingDownloads = existingDoc?.episodes?.[epKey]?.downloads || [];
      } else {
        existingSources = existingDoc?.sources || {};
        existingDownloads = existingDoc?.downloads || [];
      }

      const merged = mergeSourceHistoryRecord({ sources: existingSources, downloads: existingDownloads }, incoming);
      
      const updateSet = { updatedAt: new Date() };
      if (identity.mediaType === 'series') {
        updateSet[`episodes.${epKey}.sources`] = merged.sources;
        updateSet[`episodes.${epKey}.downloads`] = merged.downloads;
      } else {
        updateSet.sources = merged.sources;
        updateSet.downloads = merged.downloads;
      }

      await collection.updateOne(updateFilter, { $set: updateSet, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      console.log(`[Player Sources] Incremental update: Found ${sources.length} sources for ${identity.mediaType} ${identity.tmdbId}`);
    } catch (err) {
      console.error('[Player Sources] Incremental update failed:', err.message);
    }
  };

  const onTableHit = async (tableResult) => {
    await onSource(tableResult.players || []);
    console.log(`[Player Sources] Table-hit cache updated for ${identity.mediaType} ${identity.tmdbId}`);
  };

  const scrapePromise = scrapeWithMultimoviesConfig(identity, { onTableHit, onSource, reqId }).catch(err => {
    console.error('[Multimovies Scraper] failed:', err.message);
    return { ok: false, reason: 'failed' };
  });

  // YouTube Scraper (no API key â€” uses yt-search public scraping)
  const youtubePromise = (async () => {
    try {
      const tmdbRuntimeMin = (identity.mediaType === 'series' ? identity.episodeRuntime : identity.runtime) || 0;
      const t = identity.title || '';
      const yr = identity.year || '';
      const titleYear = yr ? `${t} ${yr}` : t;

      // Cast names for a more targeted query
      let castSnippet = '';
      if (Array.isArray(identity.cast) && identity.cast.length > 0) {
        if (identity.cast.length > 1) {
          castSnippet = `${identity.cast[0]} and ${identity.cast[1]}`;
        } else {
          castSnippet = identity.cast[0];
        }
      }

      const ytQueries = identity.mediaType === 'movie'
        ? [
            castSnippet ? `${t} hindi ${castSnippet} full movie hd 1080` : `${titleYear} full movie hindi 1080p`,
            `${titleYear} full movie hindi dubbed`,
            `${titleYear} full movie 1080p`,
            `${titleYear} full movie`,
            `${t} full movie hindi`
          ]
        : [
            `${titleYear} S${String(identity.seasonNumber||1).padStart(2,'0')}E${String(identity.episodeNumber||1).padStart(2,'0')} hindi dubbed`,
            `${titleYear} episode ${identity.episodeNumber||1} hindi dubbed`,
            `${titleYear} season ${identity.seasonNumber||1} episode ${identity.episodeNumber||1} hindi`,
            `${t} S${String(identity.seasonNumber||1).padStart(2,'0')}E${String(identity.episodeNumber||1).padStart(2,'0')}`,
            `${titleYear} episode ${identity.episodeNumber||1}`
          ];

      // Normalise a title string for comparison
      const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const titleWords = normTitle(t).split(' ').filter(Boolean);

      const isStrictTitleMatch = (videoTitle) => {
        const vt = normTitle(videoTitle);
        const mt = normTitle(t);
        if (vt.includes(mt)) return true;
        // Fallback: check if at least 50% of the words from the title are in the video title
        if (titleWords.length > 0) {
          const matchedWords = titleWords.filter(w => vt.includes(w) || vt.split(' ').includes(w));
          if (matchedWords.length / titleWords.length >= 0.5) return true;
        }
        return false;
      };

      const titleSimilarity = (videoTitle) => {
        const vt = normTitle(videoTitle);
        if (!titleWords.length) return 0;
        const matched = titleWords.filter(w => vt.includes(w)).length;
        return matched / titleWords.length; // 0â€“1
      };

      const scoreVideo = (v, queryIndex) => {
        const vt = v.title.toLowerCase();
        let score = 0;
        // Query-position bonus (earlier = more specific)
        score += (ytQueries.length - queryIndex) * 4;
        // Title similarity (0â€“100 points)
        score += titleSimilarity(v.title) * 100;
        // Language
        if (vt.includes('hindi dubbed')) score += 50;
        else if (vt.includes('hindi')) score += 20;
        // Quality
        if (vt.includes('1080p') || vt.includes('1080 p') || vt.includes('hd')) score += 30;
        if (vt.includes('full movie') || vt.includes('full episode')) score += 10;
        // Runtime proximity (smaller diff = more points, max 30)
        if (tmdbRuntimeMin) {
          const diffMin = Math.abs((v.seconds / 60) - tmdbRuntimeMin);
          score += Math.max(0, 30 - diffMin);
        } else {
          if (v.seconds >= 3600) score += 25;      // 60+ min
          else if (v.seconds >= 1800) score += 12; // 30+ min
        }
        return score;
      };

      let bestYtVideo = null;
      let bestScore = -Infinity;
      let bestQueryIndex = 0;

      for (let qi = 0; qi < ytQueries.length; qi++) {
        const query = ytQueries[qi];
        console.log(`[YouTube Scraper] Query ${qi + 1}/${ytQueries.length}: "${query}"`);
        try {
          const ytRes = await ytSearch(query);
          const videos = Array.isArray(ytRes?.videos) ? ytRes.videos.slice(0, 15) : [];
          for (const v of videos) {
            // Absolute minimum: 20 minutes (avoids trailers / clips)
            if (v.seconds < 1200) continue;
            // Runtime floor: must be >= 75% of TMDB runtime (user requirement)
            if (tmdbRuntimeMin && (v.seconds / 60) < tmdbRuntimeMin * 0.75) continue;
            // Strict title match check
            if (!isStrictTitleMatch(v.title)) continue;
            
            const s = scoreVideo(v, qi);
            if (
              s > bestScore ||
              // Same score â€” prefer longer video
              (s === bestScore && bestYtVideo && v.seconds > bestYtVideo.seconds)
            ) {
              bestScore = s;
              bestYtVideo = v;
              bestQueryIndex = qi;
            }
          }
          // Early exit: first query + high confidence score
          if (bestYtVideo && bestScore >= 80 && qi === 0) break;
        } catch (qErr) {
          console.warn(`[YouTube Scraper] query "${query}" failed:`, qErr.message);
        }
      }

      if (bestYtVideo) {
        const durationMin = Math.round(bestYtVideo.seconds / 60);
        console.log(`[YouTube Scraper] âœ“ Best match (query #${bestQueryIndex + 1}): "${bestYtVideo.title}" | ${durationMin} min | score=${Math.round(bestScore)} | titleSim=${(titleSimilarity(bestYtVideo.title) * 100).toFixed(0)}%`);
        const ytPlayer = {
          sourceKey: 'youtube',
          serverName: 'YOUTUBE',
          url: `https://www.youtube-nocookie.com/embed/${bestYtVideo.videoId}`,
          preferred: false,
          available: true
        };
        // Persist to DB + push to connected SSE client immediately
        await onSource([ytPlayer]);
      } else {
        console.log(`[YouTube Scraper] No suitable video found across ${ytQueries.length} queries (runtime floor: ${tmdbRuntimeMin ? `${Math.round(tmdbRuntimeMin * 0.75)} min` : 'n/a'}).`);
      }
    } catch (ytErr) {
      console.error('[YouTube Scraper] failed:', ytErr.message);
    }
  })();

  const [scrapeResult] = await Promise.all([scrapePromise, youtubePromise]);

  console.log(`************************** Scraped Sources Result [Req-${reqId}] [TMDB ${identity.tmdbId}] [url: ${scrapeResult?.pageUrl || '(none)'}]`);
  console.log(JSON.stringify(scrapeResult?.players || [], null, 2));


  if (!scrapeResult.ok && !(Array.isArray(scrapeResult.downloads) && scrapeResult.downloads.length)) {
    const isDefinitivelyAbsent = ['page-not-found', 'no-matching-slug'].includes(scrapeResult.reason);
    
    // Always stamp lastScrapeAttempt on any failure so the 2-min throttle fires
    // and prevents an immediate retry loop (e.g. CF blocking the embed iframe).
    const updateFilter = identity.mediaType === 'series'
      ? { tmdbId: identity.tmdbId, mediaType: 'series' }
      : { tmdbId: identity.tmdbId, mediaType: 'movie' };

    const failureStamp = {
      lastScrapeAttempt: Date.now(),
      updatedAt: new Date()
    };
    if (identity.mediaType === 'series') {
      const epKey = `s${identity.seasonNumber}e${identity.episodeNumber}`;
      failureStamp[`episodes.${epKey}.lastScrapeAttempt`] = Date.now();
    }
    await collection.updateOne(
      updateFilter,
      { $set: failureStamp, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    ).catch(e => console.error('[Player Sources] Failed to stamp lastScrapeAttempt:', e.message));

    if (isDefinitivelyAbsent && searchKey) {
      const existing = await collection.findOne({ searchKey });
      const hasSources = PREFERRED_SERVER_ORDER.some(k => (existing?.sources?.[k] || []).length > 0);
      if (!hasSources) {
        const updateSet = {
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          imdbId: identity.imdbId || '',
          title: identity.title || '',
          year: identity.year || null,
          notAvailable: true,
          lastScrapeAttempt: Date.now(),
          updatedAt: new Date()
        };

        if (identity.mediaType === 'series') {
          const epKey = `s${identity.seasonNumber}e${identity.episodeNumber}`;
          updateSet[`episodes.${epKey}.sources`] = Object.fromEntries(PREFERRED_SERVER_ORDER.map(k => [k, []]));
          updateSet[`episodes.${epKey}.downloads`] = [];
        } else {
          updateSet.sources = Object.fromEntries(PREFERRED_SERVER_ORDER.map(k => [k, []]));
          updateSet.downloads = [];
        }

        await collection.updateOne(
          updateFilter,
          {
            $set: updateSet,
            $setOnInsert: { createdAt: new Date() }
          },
          { upsert: true }
        );
        console.log('[Player Sources] marked as not-available on site', { tmdbId: identity.tmdbId, reason: scrapeResult.reason });
      }
    }
    return { ok: false, reason: scrapeResult.reason || 'Multimovies scrape failed.' };
  }


  const incomingRecord = buildSourceHistoryRecord(scrapeResult, identity);
  
  const updateFilter = identity.mediaType === 'series'
    ? { tmdbId: identity.tmdbId, mediaType: 'series' }
    : { tmdbId: identity.tmdbId, mediaType: 'movie' };

  // DISABLED: Bulk episode injection from TVShowURLs is unsafe because the TVShowURLs doc
  // matched by overview could belong to a DIFFERENT series with the same title (e.g., anime
  // vs live-action One Piece). Only the individually scraped+verified episode should be saved.
  // To re-enable, TVShowURLs would need a tmdbId field for strict matching.


  const existingDoc = await collection.findOne(updateFilter);
  const existingRecord = identity.mediaType === 'series' && existingDoc?.episodes
    ? { sources: existingDoc.episodes[`s${identity.seasonNumber}e${identity.episodeNumber}`]?.sources || {}, downloads: existingDoc.episodes[`s${identity.seasonNumber}e${identity.episodeNumber}`]?.downloads || [] }
    : existingDoc || {};

  const mergedRecord = mergeSourceHistoryRecord(existingRecord || {}, incomingRecord);

  const updateSet = {
    tmdbId: identity.tmdbId,
    imdbId: identity.imdbId || '',
    mediaType: identity.mediaType,
    title: identity.title || '',
    year: identity.year || null,
    searchKey: identity.mediaType === 'series' ? `series-master-${identity.tmdbId}` : incomingRecord.searchKey,
    lastScrapeAttempt: Date.now(),
    updatedAt: new Date()
  };

  if (identity.mediaType === 'series') {
    const epKey = `s${identity.seasonNumber}e${identity.episodeNumber}`;
    updateSet[`episodes.${epKey}.sources`] = mergedRecord.sources;
    updateSet[`episodes.${epKey}.downloads`] = mergedRecord.downloads;
    if (scrapeResult.pageUrl) {
      updateSet[`episodes.${epKey}.pageUrl`] = scrapeResult.pageUrl;
    }
    updateSet.isWholeSeries = true;
  } else {
    updateSet.sources = mergedRecord.sources;
    updateSet.downloads = mergedRecord.downloads;
  }

  await collection.updateOne(
    updateFilter,
    {
      $set: updateSet,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );

    console.log('[Player Sources] refresh DONE', {
      tmdbId: identity.tmdbId,
      imdbId: identity.imdbId,
      mediaType: identity.mediaType
    });

    return mergedRecord;
  } finally {
    refreshLocks.delete(searchKey);
    if (episodeLockKey) refreshLocks.delete(episodeLockKey);
  }
}

async function watchmodeFetch(url, context = 'Watchmode API') {
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Watchmode] ${context} attempt ${attempt}/${maxRetries} -> ${url}`);
      return await fetch(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      console.error(`[Watchmode] ${context} network error on attempt ${attempt}: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error(`${context} failed: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

function watchmodeTypeMatches(item, mediaType) {
  const normalized = String(item?.type || item?.media_type || '').toLowerCase();
  if (mediaType === 'movie') return normalized === 'movie';
  return normalized === 'tv_series' || normalized === 'series' || normalized === 'tv';
}

function extractWatchmodeUrl(source) {
  return (
    source?.web_url ||
    source?.url ||
    source?.link ||
    source?.deep_link ||
    source?.ios_url ||
    source?.android_url ||
    ''
  );
}

async function resolveWatchmodeTitleId({ tmdbId, imdbId, mediaType }) {
  if (!WATCHMODE_API_KEY) {
    throw new Error('Watchmode API key is not configured.');
  }

  const searchValues = [imdbId, tmdbId].filter(Boolean);

  for (const searchValue of searchValues) {
    const url = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(WATCHMODE_API_KEY)}&search_value=${encodeURIComponent(String(searchValue))}&search_type=2`;
    const response = await watchmodeFetch(url, `Watchmode search ${searchValue}`);
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({}));
    const results = Array.isArray(payload?.title_results) ? payload.title_results : [];
    const exactMatch = results.find((item) => {
      const itemTmdbId = Number(item?.tmdb_id || item?.tmdbid || 0);
      const sameTmdb = tmdbId ? itemTmdbId === Number(tmdbId) : false;
      const sameImdb = imdbId ? String(item?.imdb_id || '').trim() === String(imdbId).trim() : false;
      return watchmodeTypeMatches(item, mediaType) && (sameTmdb || sameImdb);
    });
    if (exactMatch?.id) {
      return exactMatch.id;
    }

    const firstTypedMatch = results.find((item) => watchmodeTypeMatches(item, mediaType) && item?.id);
    if (firstTypedMatch?.id) {
      return firstTypedMatch.id;
    }
  }

  return null;
}

async function resolveWatchmodeFallback({ tmdbId, imdbId, mediaType }) {
  const titleId = await resolveWatchmodeTitleId({ tmdbId, imdbId, mediaType });
  if (!titleId) {
    return null;
  }

  const regionAttempts = ['IN', 'US', 'GB', 'CA', ''];
  for (const region of regionAttempts) {
    const regionParam = region ? `&regions=${encodeURIComponent(region)}` : '';
    const url = `https://api.watchmode.com/v1/title/${encodeURIComponent(titleId)}/sources/?apiKey=${encodeURIComponent(WATCHMODE_API_KEY)}${regionParam}`;
    const response = await watchmodeFetch(url, `Watchmode title sources ${titleId} ${region || 'all'}`);
    if (!response.ok) continue;
    const payload = await response.json().catch(() => []);
    const sources = Array.isArray(payload) ? payload : [];
    const ranked = sources
      .map((source) => ({
        ...source,
        extractedUrl: extractWatchmodeUrl(source)
      }))
      .filter((source) => source.extractedUrl)
      .sort((a, b) => {
        const typeScore = (value) => {
          const normalized = String(value || '').toLowerCase();
          if (normalized === 'sub') return 0;
          if (normalized === 'free') return 1;
          if (normalized === 'buy') return 3;
          if (normalized === 'rent') return 4;
          return 2;
        };
        return typeScore(a.type) - typeScore(b.type);
      });

    const best = ranked[0];
    if (best?.extractedUrl) {
      return {
        url: best.extractedUrl,
        label: best.name || best.source_name || 'Watchmode',
        embeddable: false,
        region: region || 'all'
      };
    }
  }

  return null;
}

router.use(optionalAuth);

async function resolveIncludeAdult(req) {
  if (!req.user?.userId) return false;
  try {
    const user = await getDb()
      .collection('users')
      .findOne({ _id: new ObjectId(req.user.userId) }, { projection: { admin: 1, showAdult: 1 } });
    const isAdmin = user?.admin === true || user?.admin === 'true' || user?.admin === 1;
    return Boolean(isAdmin && user?.showAdult);
  } catch (error) {
    console.error('[Content] Failed to resolve adult preference', error);
    return false;
  }
}

function pickMovieCertification(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const preferredRegions = ['US', 'IN', 'GB', 'CA'];

  for (const region of preferredRegions) {
    const match = results.find((item) => item?.iso_3166_1 === region);
    const rating =
      match?.release_dates
        ?.map((entry) => String(entry?.certification || '').trim())
        .find(Boolean) || '';
    if (rating) return rating;
  }

  for (const item of results) {
    const rating =
      item?.release_dates
        ?.map((entry) => String(entry?.certification || '').trim())
        .find(Boolean) || '';
    if (rating) return rating;
  }

  return '';
}

function pickSeriesCertification(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const preferredRegions = ['US', 'IN', 'GB', 'CA'];

  for (const region of preferredRegions) {
    const match = results.find((item) => item?.iso_3166_1 === region);
    const rating = String(match?.rating || '').trim();
    if (rating) return rating;
  }

  const fallback = results.map((item) => String(item?.rating || '').trim()).find(Boolean);
  return fallback || '';
}

let trendingCache = null;
let trendingCacheTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const categoriesCache = new Map();
const CATEGORIES_CACHE_DURATION = 24 * 60 * 60 * 1000;

function mapMovieGenreToTvGenre(movieGenreId) {
  if (!movieGenreId) return null;
  const id = parseInt(movieGenreId, 10);
  const map = {
    28: 10759, // Action -> Action & Adventure
    12: 10759, // Adventure -> Action & Adventure
    16: 16,    // Animation -> Animation
    35: 35,    // Comedy -> Comedy
    80: 80,    // Crime -> Crime
    99: 99,    // Documentary -> Documentary
    18: 18,    // Drama -> Drama
    10751: 10751, // Family -> Family
    14: 10765, // Fantasy -> Sci-Fi & Fantasy
    9648: 9648, // Mystery -> Mystery
    878: 10765, // Sci-Fi -> Sci-Fi & Fantasy
    10752: 10768, // War -> War & Politics
    37: 37,    // Western -> Western
  };
  return map[id] !== undefined ? map[id] : null;
}

async function refreshCategoryCache(genre, year, page, limit, includeAdult, allowMissingImdb) {
  try {
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const voteCountFilter = includeAdult ? '' : '&vote_count.gte=50'; // Enforce minimum quality to avoid weird/adult/placeholder posters
    const adultFilter = includeAdult ? '&include_adult=true' : '&include_adult=false'; // Always enforce no adult content for discovery
    const adultKeywords = includeAdult ? '&with_keywords=190370|13054|210024|156416' : '';
    
    let movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${page}${adultFilter}${voteCountFilter}${adultKeywords}&sort_by=popularity.desc`;
    if (genre) movieUrl += `&with_genres=${genre}`;
    if (year)  movieUrl += `&primary_release_year=${year}`;

    let tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${page}${adultFilter}${voteCountFilter}${adultKeywords}&sort_by=popularity.desc`;
    if (genre) {
      const tvGenre = mapMovieGenreToTvGenre(genre);
      if (tvGenre) tvUrl += `&with_genres=${tvGenre}`;
      else tvUrl = null; // Skip TV if genre has no mapping
    }
    if (year) tvUrl += `&first_air_date_year=${year}`;

    const requests = [
      tmdbFetch(movieUrl, opts, 'Discover Movies Bg').then(r => r.ok ? r.json() : null).catch(() => null)
    ];
    if (tvUrl) {
      requests.push(tmdbFetch(tvUrl, opts, 'Discover TV Bg').then(r => r.ok ? r.json() : null).catch(() => null));
    } else {
      requests.push(Promise.resolve(null));
    }

    const [movieData, tvData] = await Promise.all(requests);

    if (!movieData && !tvData) return;

    let movies = movieData?.results ? movieData.results.map(i => ({ ...i, media_type: 'Movie' })) : [];
    let tvShows = tvData?.results ? tvData.results.map(i => ({ ...i, media_type: 'Series' })) : [];

    const all = [...movies, ...tvShows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    let finalItems = all.slice(0, Math.max(limit * 2, limit));

    if (!allowMissingImdb) {
      finalItems = (await attachImdbIds(finalItems, 'Movie')).filter((item) => String(item?.imdb_id || '').trim() || item.media_type === 'Series');
    }
    finalItems = await attachCachedRatings(finalItems);
    
    const cacheKey = `movies_page${page}_genre${genre || 'all'}_year${year || 'all'}_adult${includeAdult}`;
    const totalResults = (movieData?.total_results || 0) + (tvData?.total_results || 0);
    const totalPages = Math.max(movieData?.total_pages || 1, tvData?.total_pages || 1);
    
    const payload = { movies: finalItems, pagination: { page, limit, total: totalResults, pages: totalPages } };
    
    if (payload.movies.length > 0) {
      categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
      console.log(`[API] Background category revalidate success count=${payload.movies.length} key=${cacheKey}`);
    }
  } catch (err) {
    console.error('[API] Background category refresh failed:', err);
  } finally {
    const lockKey = `revalidating_category_page${page}_genre${genre || 'all'}_year${year || 'all'}_adult${includeAdult}`;
    global[lockKey] = false;
  }
}

async function refreshTrendingCache(limit = 12) {
  try {
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const fetchWithDeadline = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Trending request timed out')), 7000))
      ]);
    const [movieResult, tvResult] = await Promise.allSettled([
      fetchWithDeadline(tmdbFetch(`https://api.themoviedb.org/3/trending/movie/day?language=en-US&page=1`, opts, 'Trending Movies Bg')),
      fetchWithDeadline(tmdbFetch(`https://api.themoviedb.org/3/trending/tv/day?language=en-US&page=1`, opts, 'Trending TV Bg'))
    ]);

    const movieResp = movieResult.status === 'fulfilled' ? movieResult.value : null;
    const tvResp = tvResult.status === 'fulfilled' ? tvResult.value : null;

    if ((movieResp && !movieResp.ok) || (tvResp && !tvResp.ok)) {
      global.trendingRevalidating = false;
      return;
    }

    const movieData = movieResp?.ok ? await movieResp.json().catch(() => null) : null;
    const tvData = tvResp?.ok ? await tvResp.json().catch(() => null) : null;
    
    if (!movieData || !tvData) {
      global.trendingRevalidating = false;
      return;
    }

    const movieItems = movieData.results.map(i => ({ ...i, media_type: 'Movie' }));
    const tvItems = tvData.results.map(i => ({ ...i, media_type: 'Series' }));
    
    const all = [...movieItems, ...tvItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    
    const finalItems = all;
    if (finalItems.length > 0) {
      trendingCache = finalItems;
      trendingCacheTime = Date.now();
      console.log(`[API] Background trending revalidate success count=${finalItems.length}`);
    }
  } catch (err) {
    console.error('[API] Background trending refresh failed:', err);
  } finally {
    global.trendingRevalidating = false;
  }
}

const trendingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  message: { error: 'Too many trending requests, please wait.' }
});

// â”€â”€ Search dedup maps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const searchRequests = new Map();
const lastSearchResults = new Map();

function normalizePerson(person) {
  return {
    id: person.id,
    media_type: 'Person',
    title: person.name || '',
    name: person.name || '',
    poster_path: person.profile_path || null,
    profile_path: person.profile_path || null,
    known_for_department: person.known_for_department || 'Cast & Crew'
  };
}

function normalizeUser(user) {
  return {
    id: String(user._id),
    _id: String(user._id),
    media_type: 'User',
    title: user.username || user.fullName || '',
    name: user.fullName || user.username || '',
    username: user.username || '',
    poster_path: user.avatar || null,
    profile_path: user.avatar || null,
    fullName: user.fullName || '',
    bio: user.bio || ''
  };
}

function isIndianPerson(person) {
  const knownFor = Array.isArray(person?.known_for) ? person.known_for : [];
  return knownFor.some((item) => {
    const originCountry = Array.isArray(item?.origin_country) ? item.origin_country : [];
    const productionCountries = Array.isArray(item?.production_countries) ? item.production_countries : [];
    const productionIso = productionCountries.map((c) => c?.iso_3166_1).filter(Boolean);
    return originCountry.includes('IN') || productionIso.includes('IN') || INDIAN_LANGS.has(item?.original_language);
  });
}

// GET /api/movies
router.get('/movies', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { genre, year, search, sortBy = 'popularity', sortOrder = 'desc' } = req.query;
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const includeAdult = await resolveIncludeAdult(req);
    const allowMissingImdb = includeAdult;

    const cacheKey = `movies_page${page}_genre${genre || 'all'}_year${year || 'all'}_adult${includeAdult}`;
    const lockKey = `revalidating_category_page${page}_genre${genre || 'all'}_year${year || 'all'}_adult${includeAdult}`;

    if (page === 1 && !search && sortBy === 'popularity' && sortOrder === 'desc' && categoriesCache.has(cacheKey)) {
      const cached = categoriesCache.get(cacheKey);
      const isStale = Date.now() - cached.time > CATEGORIES_CACHE_DURATION;
      if (isStale && !global[lockKey]) {
        global[lockKey] = true;
        setTimeout(() => refreshCategoryCache(genre, year, page, limit, includeAdult, allowMissingImdb), 0);
      }
      return res.json(cached.data);
    }

    if (search) {
      const adultFilter = includeAdult ? '&include_adult=true' : '&include_adult=false';
      const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(search)}${adultFilter}&language=en-US&page=${page}`;
      const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(search)}${adultFilter}&language=en-US&page=${page}`;
      
      const [movieResp, tvResp] = await Promise.all([
        tmdbFetch(movieUrl, opts, `Search Movie "${search}"`).catch(() => null),
        tmdbFetch(tvUrl, opts, `Search TV "${search}"`).catch(() => null)
      ]);
      
      if (!movieResp?.ok && !tvResp?.ok) return res.status(500).json({ error: 'Failed to search' });
      
      const movieData = movieResp?.ok ? await movieResp.json() : null;
      const tvData = tvResp?.ok ? await tvResp.json() : null;
      
      let movies = movieData?.results ? movieData.results.map(i => ({ ...i, media_type: 'Movie' })) : [];
      let tvShows = tvData?.results ? tvData.results.map(i => ({ ...i, media_type: 'Series' })) : [];
      
      const all = [...movies, ...tvShows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      let finalItems = all.slice(0, Math.max(limit * 2, limit));

      if (!allowMissingImdb) {
        finalItems = (await attachImdbIds(finalItems, 'Movie')).filter((item) => String(item?.imdb_id || '').trim() || item.media_type === 'Series');
      }
      finalItems = await attachCachedRatings(finalItems);
      
      const totalResults = (movieData?.total_results || 0) + (tvData?.total_results || 0);
      const totalPages = Math.max(movieData?.total_pages || 1, tvData?.total_pages || 1);
      
      return res.json({ movies: finalItems, pagination: { page, limit, total: totalResults, pages: totalPages } });
    }

    const voteCountFilter = includeAdult ? '' : '&vote_count.gte=50';
    const adultFilter = includeAdult ? '&include_adult=true' : '&include_adult=false';
    const adultKeywords = includeAdult ? '&with_keywords=190370|13054|210024|156416' : '';
    const sortMap = { popularity: 'popularity', release_date: 'release_date', vote_average: 'vote_average' };
    const sortParam = sortMap[sortBy] ? `&sort_by=${sortMap[sortBy]}.${sortOrder}` : '&sort_by=popularity.desc';

    let movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${page}${adultFilter}${voteCountFilter}${adultKeywords}${sortParam}`;
    if (genre) movieUrl += `&with_genres=${genre}`;
    if (year)  movieUrl += `&primary_release_year=${year}`;

    let tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${page}${adultFilter}${voteCountFilter}${adultKeywords}${sortParam}`;
    if (genre) {
      const tvGenre = mapMovieGenreToTvGenre(genre);
      if (tvGenre) tvUrl += `&with_genres=${tvGenre}`;
      else tvUrl = null;
    }
    if (year) tvUrl += `&first_air_date_year=${year}`;

    const requests = [
      tmdbFetch(movieUrl, opts, 'Discover Movies').then(r => r.ok ? r.json() : null).catch(() => null)
    ];
    if (tvUrl) {
      requests.push(tmdbFetch(tvUrl, opts, 'Discover TV').then(r => r.ok ? r.json() : null).catch(() => null));
    } else {
      requests.push(Promise.resolve(null));
    }

    const [movieData, tvData] = await Promise.all(requests);
    if (!movieData && !tvData) return res.status(500).json({ error: 'Failed to fetch content' });

    let movies = movieData?.results ? movieData.results.map(i => ({ ...i, media_type: 'Movie' })) : [];
    let tvShows = tvData?.results ? tvData.results.map(i => ({ ...i, media_type: 'Series' })) : [];

    const all = [...movies, ...tvShows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    let finalItems = all.slice(0, Math.max(limit * 2, limit));

    if (!allowMissingImdb) {
      finalItems = (await attachImdbIds(finalItems, 'Movie')).filter((item) => String(item?.imdb_id || '').trim() || item.media_type === 'Series');
    }
    finalItems = await attachCachedRatings(finalItems);
    
    const totalResults = (movieData?.total_results || 0) + (tvData?.total_results || 0);
    const totalPages = Math.max(movieData?.total_pages || 1, tvData?.total_pages || 1);
    const payload = { movies: finalItems, pagination: { page, limit, total: totalResults, pages: totalPages } };
    
    if (page === 1 && !search && sortBy === 'popularity' && sortOrder === 'desc' && payload.movies.length > 0) {
      categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
    }

    res.json(payload);
  } catch (err) {
    console.error('Error fetching movies:', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

// GET /api/movies/:id
router.get('/movies/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { type = 'movie' } = req.query;
    const isSeries = type === 'series' || type === 'tv';
    const mediaType = isSeries ? 'Series' : 'Movie';

    const detailUrl = isSeries
      ? `https://api.themoviedb.org/3/tv/${id}?language=en-US`
      : `https://api.themoviedb.org/3/movie/${id}?language=en-US`;
    const certificationUrl = isSeries
      ? `https://api.themoviedb.org/3/tv/${id}/content_ratings`
      : `https://api.themoviedb.org/3/movie/${id}/release_dates`;

    const [detailResp, certificationResp] = await Promise.all([
      tmdbFetch(detailUrl, { method: 'GET', headers: tmdbHeaders() }, `${mediaType} ${id}`),
      tmdbFetch(
        certificationUrl,
        { method: 'GET', headers: tmdbHeaders() },
        `${mediaType} ${id} Certification`
      ).catch(() => null)
    ]);

    if (!detailResp.ok) return res.status(404).json({ error: 'Content not found', details: `TMDB returned ${detailResp.status}` });

    const content = await detailResp.json();
    const canAccess = await canAccessContentForUser(req, content, mediaType);
    if (!canAccess) {
      return res.status(404).json({ error: 'Content not found' });
    }
    const imdbResult = await resolveImdbRating(id, mediaType, content).catch((error) => {
      console.warn('[IMDB Ratings] Failed to resolve detail rating', {
        id,
        mediaType,
        message: error.message
      });
      return { imdb_rating: null, imdbID: String(content?.imdb_id || '').trim() };
    });
    let certification = '';
    if (certificationResp?.ok) {
      const certificationPayload = await certificationResp.json();
      certification = isSeries
        ? pickSeriesCertification(certificationPayload)
        : pickMovieCertification(certificationPayload);
    }
    content.media_type = mediaType;
    content.imdb_id = imdbResult.imdbID || content.imdb_id || '';
    if (imdbResult.imdb_rating != null) {
      content.imdb_rating = imdbResult.imdb_rating;
    }
    if (certification) {
      content.age_rating = certification;
      content.certification = certification;
    }
    res.json(content);
  } catch (err) {
    console.error('Error fetching content:', err);
    res.status(500).json({ error: 'Failed to fetch content', details: err.message });
  }
});

// GET /api/movie/:id/credits
router.get('/movie/:id/credits', async (req, res) => {
  try {
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/movie/${req.params.id}/credits?language=en-US`,
      { method: 'GET', headers: tmdbHeaders() },
      `Movie Credits ${req.params.id}`
    );
    if (!resp.ok) return res.status(404).json({ error: 'Credits not found' });
    res.json(await resp.json());
  } catch (err) {
    console.error('Error fetching movie credits:', err);
    res.status(500).json({ error: 'Failed to fetch movie credits', details: err.message });
  }
});

// GET /api/series/:id/credits  â€” must come before /series/:id
router.get('/series/:id/credits', async (req, res) => {
  try {
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/tv/${req.params.id}/credits?language=en-US`,
      { method: 'GET', headers: tmdbHeaders() },
      `Series Credits ${req.params.id}`
    );
    if (!resp.ok) return res.status(404).json({ error: 'Credits not found' });
    res.json(await resp.json());
  } catch (err) {
    console.error('Error fetching series credits:', err);
    res.status(500).json({ error: 'Failed to fetch series credits', details: err.message });
  }
});

// GET /api/series/:id
router.get('/series/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [resp, ratingsResp] = await Promise.all([
      tmdbFetch(
        `https://api.themoviedb.org/3/tv/${id}?language=en-US`,
        { method: 'GET', headers: tmdbHeaders() },
        `TV Series ${id}`
      ),
      tmdbFetch(
        `https://api.themoviedb.org/3/tv/${id}/content_ratings`,
        { method: 'GET', headers: tmdbHeaders() },
        `TV Series ${id} Certification`
      ).catch(() => null)
    ]);
    if (!resp.ok) return res.status(404).json({ error: 'Series not found', details: `TMDB returned ${resp.status}` });
    const s = await resp.json();
    const canAccess = await canAccessContentForUser(req, s, 'Series');
    if (!canAccess) {
      return res.status(404).json({ error: 'Series not found' });
    }
    const imdbResult = await resolveImdbRating(id, 'Series', s).catch((error) => {
      console.warn('[IMDB Ratings] Failed to resolve series detail rating', {
        id,
        message: error.message
      });
      return { imdb_rating: null, imdbID: '' };
    });
    let certification = '';
    if (ratingsResp?.ok) {
      certification = pickSeriesCertification(await ratingsResp.json());
    }
    res.json({
      id: s.id,
      title: s.name || s.original_name || 'Unknown Series',
      name: s.name || s.original_name || 'Unknown Series',
      original_name: s.original_name,
      overview: s.overview || 'No overview available.',
      poster_path: s.poster_path,
      backdrop_path: s.backdrop_path,
      first_air_date: s.first_air_date,
      last_air_date: s.last_air_date,
      release_date: s.first_air_date,
      genres: s.genres ? s.genres.map(g => g.name) : ['Drama'],
      runtime: s.episode_run_time?.[0] || 60,
      episode_run_time: s.episode_run_time,
      number_of_episodes: s.number_of_episodes,
      number_of_seasons: s.number_of_seasons,
      status: s.status,
      vote_average: s.vote_average,
      vote_count: s.vote_count,
      popularity: s.popularity,
      original_language: s.original_language,
      languages: s.languages || [s.original_language],
      production_companies: s.production_companies,
      production_countries: s.production_countries,
      networks: s.networks,
      created_by: s.created_by,
      seasons: s.seasons,
      media_type: 'Series',
      director: s.created_by?.[0]?.name || 'Unknown',
      country: s.production_countries?.[0]?.name || 'Unknown',
      language: s.original_language || 'Unknown',
      imdb_id: imdbResult.imdbID || '',
      imdb_rating: imdbResult.imdb_rating ?? undefined,
      age_rating: certification || 'TV-MA',
      certification: certification || 'TV-MA'
    });
  } catch (err) {
    console.error('Error fetching series:', err);
    res.status(500).json({ error: 'Failed to fetch series', details: err.message });
  }
});

// GET /api/series/:id/season/:seasonNumber
router.get('/series/:id/season/:seasonNumber', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const seasonNumber = parseInt(req.params.seasonNumber);
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}?language=en-US`,
      { method: 'GET', headers: tmdbHeaders() },
      `TV Series ${id} Season ${seasonNumber}`
    );
    if (!resp.ok) {
      return res.status(404).json({ error: 'Season not found', details: `TMDB returned ${resp.status}` });
    }

    const season = await resp.json();
    res.json({
      id: season.id,
      season_number: season.season_number,
      name: season.name,
      overview: season.overview || '',
      poster_path: season.poster_path,
      air_date: season.air_date,
      episodes: Array.isArray(season.episodes)
        ? season.episodes.map((episode) => ({
            id: episode.id,
            episode_number: episode.episode_number,
            season_number: episode.season_number,
            name: episode.name,
            overview: episode.overview || '',
            still_path: episode.still_path,
            air_date: episode.air_date,
            runtime: episode.runtime || null,
            vote_average: episode.vote_average || 0
          }))
        : []
    });
  } catch (err) {
    console.error('Error fetching series season:', err);
    res.status(500).json({ error: 'Failed to fetch season details', details: err.message });
  }
});

// GET /api/person/:id
router.get('/person/:id', async (req, res) => {
  try {
    console.log(`[API] /api/person/${req.params.id} hit`);
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/person/${req.params.id}?language=en-US`,
      { method: 'GET', headers: tmdbHeaders() },
      `Person ${req.params.id}`
    );
    console.log(`[API] /api/person/${req.params.id} TMDB status=${resp.status}`);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[API] /api/person/${req.params.id} TMDB error body=${body.slice(0, 300)}`);
      return res.status(404).json({ error: 'Person not found' });
    }
    res.json(await resp.json());
  } catch (err) {
    console.error('Error fetching person:', err);
    res.status(500).json({ error: 'Failed to fetch person details', details: err.message });
  }
});

// GET /api/person/:id/credits
router.get('/person/:id/credits', async (req, res) => {
  try {
    console.log(`[API] /api/person/${req.params.id}/credits hit`);
    const includeAdult = await resolveIncludeAdult(req);
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/person/${req.params.id}/combined_credits?language=en-US`,
      { method: 'GET', headers: tmdbHeaders() },
      `Person Credits ${req.params.id}`
    );
    console.log(`[API] /api/person/${req.params.id}/credits TMDB status=${resp.status}`);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[API] /api/person/${req.params.id}/credits TMDB error body=${body.slice(0, 300)}`);
      return res.status(404).json({ error: 'Person credits not found' });
    }
    const payload = await resp.json();
    payload.cast = await attachCachedRatings(payload.cast);
    payload.crew = await attachCachedRatings(payload.crew);

    if (!includeAdult) {
      const filterCreditsForPublic = (items = []) =>
        (Array.isArray(items) ? items : []).filter((item) => {
          if (item?.media_type !== 'movie' && item?.media_type !== 'tv') {
            return true;
          }

          return item?.adult !== true;
        });

      payload.cast = filterCreditsForPublic(payload.cast);
      payload.crew = filterCreditsForPublic(payload.crew);
    }
    res.json(payload);
  } catch (err) {
    console.error('Error fetching person credits:', err);
    res.status(500).json({ error: 'Failed to fetch person credits', details: err.message });
  }
});

// GET /api/trending
router.get('/trending', trendingLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;
    const page = parseInt(req.query.page) || 1;
    console.log(`[API] /api/trending hit limit=${limit} page=${page}`);
    const now = Date.now();
    const includeAdult = await resolveIncludeAdult(req);

    if (page === 1 && trendingCache && !includeAdult) {
      const isStale = now - trendingCacheTime > CACHE_DURATION;
      if (isStale && !global.trendingRevalidating) {
        global.trendingRevalidating = true;
        // Trigger background refresh, but return cache immediately
        setTimeout(() => refreshTrendingCache(limit), 0);
      }
      return res.json({ movies: trendingCache.slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
    }
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const fetchWithDeadline = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Trending request timed out')), 7000))
      ]);
      
    let movieUrl = `https://api.themoviedb.org/3/trending/movie/day?language=en-US&page=${page}`;
    let tvUrl = `https://api.themoviedb.org/3/trending/tv/day?language=en-US&page=${page}`;
    
    if (includeAdult) {
      const adultKeywords = '&with_keywords=190370|13054|210024|156416';
      movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${page}&include_adult=true${adultKeywords}&sort_by=popularity.desc`;
      tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${page}&include_adult=true${adultKeywords}&sort_by=popularity.desc`;
    }

    const [movieResult, tvResult] = await Promise.allSettled([
      fetchWithDeadline(tmdbFetch(movieUrl, opts, 'Trending Movies')),
      fetchWithDeadline(tmdbFetch(tvUrl, opts, 'Trending TV'))
    ]);

    const movieResp = movieResult.status === 'fulfilled' ? movieResult.value : null;
    const tvResp = tvResult.status === 'fulfilled' ? tvResult.value : null;

    console.log(`[API] /api/trending TMDB statuses movie=${movieResp?.status || 'failed'} tv=${tvResp?.status || 'failed'}`);

    const movieBody = movieResp && !movieResp.ok ? await movieResp.text().catch(() => '') : '';
    const tvBody = tvResp && !tvResp.ok ? await tvResp.text().catch(() => '') : '';
    if ((movieResp && !movieResp.ok) || (tvResp && !tvResp.ok) || movieResult.status === 'rejected' || tvResult.status === 'rejected') {
      console.error('[API] /api/trending partial failure', {
        movieStatus: movieResp?.status || null,
        tvStatus: tvResp?.status || null,
        movieError: movieResult.status === 'rejected' ? movieResult.reason?.message : null,
        tvError: tvResult.status === 'rejected' ? tvResult.reason?.message : null,
        movieBody: movieBody.slice(0, 300),
        tvBody: tvBody.slice(0, 300)
      });
    }

    const movieData = movieResp?.ok ? await movieResp.json() : { results: [], total_pages: 1 };
    const tvData = tvResp?.ok ? await tvResp.json() : { results: [], total_pages: 1 };
    let movieItems = movieData.results.map(i => ({ ...i, media_type: 'Movie' }));
    let tvItems = tvData.results.map(i => ({ ...i, media_type: 'Series' }));
    
    const all = [...movieItems, ...tvItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const finalItems = all;

    if (!finalItems.length) {
      if (page === 1 && trendingCache?.length) {
        console.log('[API] /api/trending using stale cache fallback');
        return res.json({ movies: trendingCache.slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
      }
      return res.json({ movies: [], pagination: { page, limit, pages: 1 } });
    }

    if (page === 1 && !includeAdult) {
      trendingCache = finalItems;
      trendingCacheTime = now;
    }
    
    const totalPages = Math.max(movieData.total_pages || 1, tvData.total_pages || 1);
    console.log(`[API] /api/trending success count=${finalItems.length}`);
    res.json({ movies: finalItems, pagination: { page, limit, pages: totalPages } });
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.status(500).json({ error: 'Failed to fetch trending content' });
  }
});

let genresCache = null;
let genresCacheTime = 0;
const GENRES_CACHE_DURATION = 24 * 60 * 60 * 1000;

async function refreshGenresCache() {
  try {
    const resp = await tmdbFetch('https://api.themoviedb.org/3/genre/movie/list?language=en-US', { method: 'GET', headers: tmdbHeaders() }, 'Genres Bg');
    if (!resp.ok) return;
    const data = await resp.json();
    const finalData = data.genres.map(g => ({ id: g.id, name: g.name })).sort((a,b) => a.name.localeCompare(b.name));
    if (finalData.length > 0) {
      genresCache = finalData;
      genresCacheTime = Date.now();
      console.log(`[API] Background genres revalidate success count=${finalData.length}`);
    }
  } catch (err) {
    console.error('[API] Background genres refresh failed:', err);
  } finally {
    global.genresRevalidating = false;
  }
}

// GET /api/genres
router.get('/genres', async (req, res) => {
  try {
    if (genresCache) {
      const isStale = Date.now() - genresCacheTime > GENRES_CACHE_DURATION;
      if (isStale && !global.genresRevalidating) {
        global.genresRevalidating = true;
        setTimeout(() => refreshGenresCache(), 0);
      }
      return res.json(genresCache);
    }

    const resp = await tmdbFetch(
      'https://api.themoviedb.org/3/genre/movie/list?language=en-US',
      { method: 'GET', headers: tmdbHeaders() },
      'Genres'
    );
    if (!resp.ok) return res.status(500).json({ error: 'Failed to fetch genres' });
    const data = await resp.json();
    const finalData = data.genres
      .map(g => ({ id: g.id, name: g.name }))
      .sort((a,b) => a.name.localeCompare(b.name));
      
    if (finalData.length > 0) {
      genresCache = finalData;
      genresCacheTime = Date.now();
    }
    
    res.json(finalData);
  } catch (err) {
    console.error('Error fetching genres:', err);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// â”€â”€ /api/home â€” single batch endpoint for the home page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns trending + genres + first 8 genre shelves all in one request.
// Uses existing caches (trendingCache, genresCache, categoriesCache) so no
// extra TMDB calls are made if the server is already warm.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let homeCache = null;
let homeCacheTime = 0;
const HOME_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const HOME_CATEGORY_LIMIT = 20; // movies per genre shelf
const HOME_PRELOAD_GENRES = 8;  // how many genre shelves to pre-bake

async function buildHomePayload(includeAdult) {
  const opts = { method: 'GET', headers: tmdbHeaders() };

  // 1. Trending (bypass cache if adult mode)
  let trending = [];
  if (trendingCache && trendingCache.length && !includeAdult) {
    trending = trendingCache.slice(0, 18);
  } else {
    try {
      const fetchWithDeadline = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000))]);
      
      let movieUrl = 'https://api.themoviedb.org/3/trending/movie/day?language=en-US&page=1';
      let tvUrl = 'https://api.themoviedb.org/3/trending/tv/day?language=en-US&page=1';
      
      if (includeAdult) {
        const adultKeywords = '&with_keywords=190370|13054|210024|156416';
        movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=true${adultKeywords}&sort_by=popularity.desc`;
        tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=1&include_adult=true${adultKeywords}&sort_by=popularity.desc`;
      }

      const [movieResult, tvResult] = await Promise.allSettled([
        fetchWithDeadline(tmdbFetch(movieUrl, opts, 'Home Trending Movies')),
        fetchWithDeadline(tmdbFetch(tvUrl, opts, 'Home Trending TV'))
      ]);
      const movieData = movieResult.status === 'fulfilled' && movieResult.value?.ok ? await movieResult.value.json() : { results: [] };
      const tvData = tvResult.status === 'fulfilled' && tvResult.value?.ok ? await tvResult.value.json() : { results: [] };
      
      let mItems = movieData.results.map(i => ({ ...i, media_type: 'Movie' }));
      let tItems = tvData.results.map(i => ({ ...i, media_type: 'Series' }));

      const all = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      trending = all.slice(0, 18);
      if (trending.length && !includeAdult) { trendingCache = trending; trendingCacheTime = Date.now(); }
    } catch (e) { console.warn('[Home] Trending fetch failed:', e.message); }
  }

  // 2. Genres (always from cache if warm)
  let genres = [];
  if (genresCache && genresCache.length) {
    genres = genresCache;
  } else {
    try {
      const resp = await tmdbFetch('https://api.themoviedb.org/3/genre/movie/list?language=en-US', opts, 'Home Genres');
      if (resp.ok) {
        const data = await resp.json();
        genres = data.genres
          .map(g => ({ id: g.id, name: g.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (genres.length) { genresCache = genres; genresCacheTime = Date.now(); }
      }
    } catch (e) { console.warn('[Home] Genres fetch failed:', e.message); }
  }

  // 3. First N genre shelves â€” fetch in parallel, use cache where available
  const targetGenres = [{ id: "bollywood", name: "Latest in India" }, ...genres.slice(0, HOME_PRELOAD_GENRES - 1)];
  const categories = {};

  const fetchGenreMovies = async (genre) => {
    const cacheKey = `movies_page1_genre${genre.id}_yearall_adult${includeAdult}`;
    const cached = categoriesCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CATEGORIES_CACHE_DURATION) {
      return { id: genre.id, movies: cached.data.movies };
    }
    try {
      const strictRatingFilter = includeAdult ? '' : '&certification_country=US&certification.lte=R&vote_average.gte=0.1&vote_count.gte=5';
      const adultFilter = includeAdult ? '&include_adult=true' : '&include_adult=false';
      const adultKeywords = includeAdult ? '&with_keywords=190370|13054|210024|156416' : '';
      
      let movieUrl, tvUrl;
      if (genre && genre.id === 'bollywood') {
        movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1${adultFilter}&with_original_language=hi&sort_by=primary_release_date.desc&vote_count.gte=5`;
        tvUrl = null;
      } else {
        movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1${adultFilter}${strictRatingFilter}${adultKeywords}&sort_by=popularity.desc`;
        if (genre) movieUrl += `&with_genres=${genre.id}`;

        tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=1${adultFilter}${strictRatingFilter}${adultKeywords}&sort_by=popularity.desc`;
        if (genre) {
          const tvGenre = mapMovieGenreToTvGenre(genre.id);
          if (tvGenre) tvUrl += `&with_genres=${tvGenre}`;
          else tvUrl = null;
        }
      }

      const requests = [
        tmdbFetch(movieUrl, opts, `Home Genre ${genre.name} Movie`).then(r => r.ok ? r.json() : null).catch(() => null)
      ];
      if (tvUrl) {
        requests.push(tmdbFetch(tvUrl, opts, `Home Genre ${genre.name} TV`).then(r => r.ok ? r.json() : null).catch(() => null));
      } else {
        requests.push(Promise.resolve(null));
      }

      const [movieData, tvData] = await Promise.all(requests);
      if (!movieData && !tvData) return { id: genre.id, movies: [] };

      let mItems = movieData?.results ? movieData.results.map(i => ({ ...i, media_type: 'Movie' })) : [];
      let tItems = tvData?.results ? tvData.results.map(i => ({ ...i, media_type: 'Series' })) : [];

      const all = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      let finalItems = all.slice(0, HOME_CATEGORY_LIMIT * 2);

      if (!includeAdult) {
        finalItems = (await attachImdbIds(finalItems, 'Movie')).filter((item) => String(item?.imdb_id || '').trim() || item.media_type === 'Series');
      }
      finalItems = await attachCachedRatings(finalItems);
      finalItems = finalItems.slice(0, HOME_CATEGORY_LIMIT);
      
      const payload = { movies: finalItems, pagination: { page: 1, limit: HOME_CATEGORY_LIMIT, total: 500, pages: 500 } };
      if (finalItems.length) categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
      return { id: genre.id, movies: finalItems };
    } catch (e) {
      console.warn(`[Home] Genre ${genre.id} fetch failed:`, e.message);
      return { id: genre.id, movies: [] };
    }
  };

  const genreResults = await Promise.all(targetGenres.map(fetchGenreMovies));
  for (const { id, movies } of genreResults) {
    if (movies.length) categories[String(id)] = movies;
  }

  return { trending, genres, categories };
}

async function refreshHomeCache(includeAdult) {
  try {
    const payload = await buildHomePayload(includeAdult);
    if ((payload.trending.length || Object.keys(payload.categories).length) && !includeAdult) {
      homeCache = payload;
      homeCacheTime = Date.now();
      console.log(`[API] /api/home revalidated: trending=${payload.trending.length} genres=${payload.genres.length} categories=${Object.keys(payload.categories).length}`);
    }
  } catch (e) {
    console.error('[API] /api/home background refresh failed:', e.message);
  } finally {
    global.homeRevalidating = false;
  }
}

// GET /api/home
router.get('/home', async (req, res) => {
  try {
    const includeAdult = await resolveIncludeAdult(req);
    const now = Date.now();

    // Serve from cache if fresh (bypass for adult mode)
    if (homeCache && !includeAdult) {
      const isStale = now - homeCacheTime > HOME_CACHE_DURATION;
      if (isStale && !global.homeRevalidating) {
        global.homeRevalidating = true;
        setTimeout(() => refreshHomeCache(includeAdult), 0);
      }
      return res.json(homeCache);
    }

    // Cold start â€” build and cache
    const payload = await buildHomePayload(includeAdult);
    if ((payload.trending.length || Object.keys(payload.categories).length) && !includeAdult) {
      homeCache = payload;
      homeCacheTime = now;
    }
    console.log(`[API] /api/home cold: trending=${payload.trending.length} genres=${payload.genres.length} categories=${Object.keys(payload.categories).length}`);
    res.json(payload);
  } catch (err) {
    console.error('Error building home payload:', err);
    res.status(500).json({ error: 'Failed to load home data' });
  }
});


router.get('/ratings', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 10000);
    const mediaType = req.query.mediaType ? normalizeMediaType(req.query.mediaType) : '';
    const query = mediaType ? { mediaType } : {};

    const items = await getDb()
      .collection(RATINGS_COLLECTION)
      .find(query)
      .sort({ updatedAt: -1, tmdbID: 1 })
      .limit(limit)
      .toArray();

    res.json({ items });
  } catch (err) {
    console.error('Error fetching ratings table:', err);
    res.status(500).json({ error: 'Failed to fetch ratings table' });
  }
});

router.get('/ratings/:mediaType/:tmdbID', async (req, res) => {
  try {
    const mediaType = normalizeMediaType(req.params.mediaType);
    const tmdbID = Number(req.params.tmdbID);
    if (!tmdbID) {
      return res.status(400).json({ error: 'Valid tmdbID is required' });
    }

    const item = await getDb()
      .collection(RATINGS_COLLECTION)
      .findOne({ tmdbID, mediaType });

    if (!item) {
      return res.status(404).json({ error: 'Rating row not found' });
    }

    res.json(item);
  } catch (err) {
    console.error('Error fetching rating row:', err);
    res.status(500).json({ error: 'Failed to fetch rating row' });
  }
});
router.get('/ratings/stats/counters', async (req, res) => {
  try {
    const counters = await getDb()
      .collection(METRICS_COLLECTION)
      .findOne({ _id: RATINGS_METRICS_DOC_ID });

    res.json(
      counters || {
        _id: RATINGS_METRICS_DOC_ID,
        tmdbDetailFetchCount: 0,
        omdbFetchCount: 0
      }
    );
  } catch (err) {
    console.error('Error fetching ratings counters:', err);
    res.status(500).json({ error: 'Failed to fetch ratings counters' });
  }
});

router.get('/player/sources', async (req, res) => {
  try {
    const mediaType = normalizePlayerMediaType(req.query.mediaType);
    const tmdbId = Number(req.query.tmdbId || 0);
    const imdbIdFromQuery = String(req.query.imdbId || '').trim();
    const seasonNumber = mediaType === 'series' ? Number(req.query.seasonNumber || 1) : null;
    const episodeNumber = mediaType === 'series' ? Number(req.query.episodeNumber || 1) : null;
    const forceRefresh = String(req.query.refresh || '').trim() === '1';

    if (!tmdbId) {
      return res.status(400).json({ error: 'tmdbId is required.' });
    }

    const collection = getDb().collection(PLAYER_SOURCES_COLLECTION);
    let identity = null;
    
    // --- STEP 1: Check PlayerSources first ---
    let cachedRecord = null;
    
    console.log(`\n############# Method 1 ################`);
    console.log(`[Method 1] Checking PlayerSources by tmdbID: ${tmdbId}...`);
    
    const masterDoc = await collection.findOne({ tmdbId, mediaType });
    
    if (masterDoc) {
      if (mediaType === 'series') {
        console.log(`[Method 1] Success! Found series cache for tmdbId ${tmdbId}. Extracting episode ${seasonNumber}x${episodeNumber}...`);
        const epKey = `s${seasonNumber}e${episodeNumber}`;
        const epData = masterDoc.episodes?.[epKey];
        
        if (epData) {
           cachedRecord = {
              ...masterDoc,
              seasonNumber,
              episodeNumber,
              sources: epData.sources || epData,
              downloads: epData.downloads || [],
              // Prefer per-episode scrape timestamp so throttle works correctly
              lastScrapeAttempt: epData.lastScrapeAttempt || masterDoc.lastScrapeAttempt || 0,
              notAvailable: false
           };
        } else {
           console.log(`[Method 1] Failed. Episode ${seasonNumber}x${episodeNumber} not found in series cache.`);
           
           // FAST PATH: If we have the masterDoc, we already know the title/year!
           // We can start the scraper IMMEDIATELY without waiting for TMDB.
           const fastIdentity = {
              mediaType: 'series',
              tmdbId,
              imdbId: masterDoc.imdbId || imdbIdFromQuery || '',
              title: masterDoc.title || '',
              year: masterDoc.year || null,
              seasonNumber,
              episodeNumber,
              overview: masterDoc.overview || '',
              episodeTitle: '', // We'll lack this, but the scraper can still find it
              directors: [],
              cast: []
           };

           // Per-episode lock: actively scraping â†’ skip TMDB calls entirely.
           const epLock = `series-${tmdbId}-s${seasonNumber}e${episodeNumber}`;
           if (refreshLocks.has(epLock) && !forceRefresh) {
             console.log(`[Method 1] Episode ${seasonNumber}x${episodeNumber} is actively being scraped â€” skipping TMDB calls.`);
             // return the "Wait for source" logic later? 
             // Actually, if it's already scraping, we can just proceed to the wait loop.
             identity = fastIdentity; 
           } else {
             const epStamp = masterDoc.episodes?.[`s${seasonNumber}e${episodeNumber}`]?.lastScrapeAttempt || 0;
             if (epStamp && (Date.now() - epStamp) < 120000 && !forceRefresh) {
               console.log(`[Method 1] Episode ${seasonNumber}x${episodeNumber} recently attempted (${Math.round((Date.now()-epStamp)/1000)}s ago) â€” throttled, returning scraping:false.`);
               return res.json({ sources: [], cacheHit: false, scraping: false, notAvailable: false });
             }
           }
        }
      } else {
        console.log(`[Method 1] Success! Found movie cache for tmdbId ${tmdbId}.`);
        cachedRecord = masterDoc;
      }
    } else {
      console.log(`[Method 1] Failed. No cache found for tmdbId ${tmdbId} (${mediaType}).`);
    }

    // For movies or series master-level lock (already has sources), skip wasteful calls
    if (!forceRefresh) {
      const masterLockKey = mediaType === 'series' ? `series-master-${tmdbId}` : (masterDoc?.searchKey || '');
      if (masterLockKey && refreshLocks.has(masterLockKey)) {
        console.log(`[Method 1] Master scrape lock active for ${masterLockKey}, returning cached data.`);
        const payloadBase = cachedRecord || masterDoc || { mediaType, tmdbId, seasonNumber, episodeNumber };
        const immediatePayload = buildPlayerSourcePayload(payloadBase, null, true);
        return res.json({
          ...immediatePayload,
          cacheHit: Boolean(cachedRecord),
          scraping: true
        });
      }
    }

    if (cachedRecord && !forceRefresh) {
      const now = Date.now();
      const lastAttempt = cachedRecord.lastScrapeAttempt || 0;
      const isRecentlyAttempted = (now - lastAttempt) < 120000; // 2 minutes throttle

      const payload = buildPlayerSourcePayload(cachedRecord, null, false);
      const hasRealSources = payload.sources.some(s => !s.isDirect);

      // If we have sources, OR we recently tried and failed, OR it's definitively not available:
      // return the cached state to avoid immediate retry loops.
      if (hasRealSources || (cachedRecord.notAvailable && isRecentlyAttempted) || isRecentlyAttempted) {
        let isScrapingNow = false;
        if (!isRecentlyAttempted) {
          isScrapingNow = true;
          // Trigger background refresh but fetch identity first
          fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber })
            .then(identity => refreshPlayerSourceRecord(identity))
            .catch(err => console.error('[Player Sources] Background identity/refresh failed:', err.message));
        } else {
          // If we recently attempted, check if it's still running
          const skey = cachedRecord.searchKey || buildSearchKey({ mediaType, tmdbId, seasonNumber, episodeNumber, title: cachedRecord.title || '' });
          isScrapingNow = refreshLocks.has(skey);
        }
        
        // If we already have real sources, tell the UI scraping is FALSE so it stops polling and flickering!
        // But we STILL might be scraping silently in the background.
        console.log(`*********************** PlayerSources send ${payload.sources.filter(s => !s.isDirect).length} sources (Scraping: ${isScrapingNow} but hiding from UI).`);
        return res.json({
          ...payload,
          cacheHit: true,
          scraping: false
        });
      }
    }

    // --- STEP 2: Fetch Identity (Needed if cache miss or force refresh) ---
    if (!identity) {
      if (cachedRecord || masterDoc) {
        // FAST PATH: Skip TMDB if we already have the basic identity from cache!
        identity = {
          mediaType,
          tmdbId,
          imdbId: (cachedRecord || masterDoc).imdbId || imdbIdFromQuery,
          title: (cachedRecord || masterDoc).title || (cachedRecord || masterDoc).metadata?.title || '',
          year: (cachedRecord || masterDoc).year || (cachedRecord || masterDoc).metadata?.year || null,
          seasonNumber,
          episodeNumber,
          overview: (cachedRecord || masterDoc).overview || (cachedRecord || masterDoc).metadata?.overview || '',
          episodeTitle: (cachedRecord || masterDoc).episodeTitle || '',
          directors: [],
          cast: []
        };
      } else {
        try {
          identity = await fetchTmdbPlayerIdentity({
            mediaType,
            tmdbId,
            seasonNumber,
            episodeNumber
          });
        } catch (err) {
          console.error('[Player Sources] TMDB identity lookup failed', err.message);
          return res.status(503).json({ error: 'TMDB unavailable. Please try again.', details: err.message });
        }
      }
    }

    const searchKey = buildSearchKey(identity);
    if (!cachedRecord && searchKey) {
      cachedRecord = await collection.findOne({ searchKey });
    }

    // Re-check recently attempted for the searchKey record
    const now = Date.now();
    const lastAttempt = cachedRecord?.lastScrapeAttempt || 0;
    const isRecentlyAttempted = (now - lastAttempt) < 120000;

    if (cachedRecord && !forceRefresh) {
      const payload = buildPlayerSourcePayload(cachedRecord, identity, false);
      const hasRealSources = payload.sources.some(s => !s.isDirect);

      if (hasRealSources || (cachedRecord.notAvailable && isRecentlyAttempted)) {
        const isScrapingNow = refreshLocks.has(searchKey) || !isRecentlyAttempted;
        
        if (!isRecentlyAttempted) {
          refreshPlayerSourceRecord(identity).catch(() => {});
        }
        
        if (!hasRealSources && isRecentlyAttempted) {
          console.log(`[Player Sources] No sources found in last attempt (throttled). Returning empty sources for now.`);
        }
        
        console.log(`*********************** PlayerSources (by SearchKey) send ${payload.sources.filter(s => !s.isDirect).length} sources (Scraping: ${isScrapingNow} but hiding from UI).`);
        return res.json({
          ...payload,
          cacheHit: true,
          scraping: false
        });
      }
    }

    // --- STEP 4: Scrape data and update PlayerSources (In Parallel with Step 3) ---
    // Start the scraper immediately so it can run while we check other fast paths
    const scrapePromise = refreshPlayerSourceRecord(identity);

    // --- STEP 3: Fast-Path Synchronous Table Lookup (Movie_Sources) ---
    // We do this in parallel by NOT awaiting the scrapePromise yet
    if (!cachedRecord || forceRefresh) {
      const guessUrls = [
        `https://multimovies.fyi/${identity.mediaType === 'movie' ? 'movies' : 'series'}/${searchKey}/`,
        `https://multimovies.fyi/${identity.mediaType === 'movie' ? 'movies' : 'series'}/${searchKey}-${identity.year}/`
      ];

      for (const url of guessUrls) {
        try {
          const doc = await getDb().collection(MOVIE_SOURCES_COLLECTION).findOne({ url });
          if (doc && doc.sources) {
            const players = PREFERRED_SERVER_ORDER.map((sourceKey) => {
              const urls = doc.sources[sourceKey] || [];
              const u = urls[0] || '';
              return u ? { sourceKey, serverName: sourceKey.toUpperCase(), url: u, available: true, preferred: true } : null;
            }).filter(Boolean);

            if (players.length) {
              const tableResult = {
                ok: true,
                status: 'success',
                reason: 'table-hit-guess',
                searchKey,
                pageUrl: url,
                players,
                downloads: doc.downloads || []
              };
              const incomingRecord = buildSourceHistoryRecord(tableResult, identity);
              const mergedRecord = mergeSourceHistoryRecord(cachedRecord || {}, incomingRecord);

              await collection.updateOne(
                { searchKey },
                {
                  $set: Object.fromEntries(Object.entries(mergedRecord).filter(([k]) => k !== 'createdAt')),
                  $unset: { metadata: '', pageUrl: '', pagePath: '' },
                  $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
              );

              const payload = buildPlayerSourcePayload(mergedRecord, identity, false);
              if (!isRecentlyAttempted) {
                refreshPlayerSourceRecord(identity).catch(() => {});
              }
              const isScrapingNow = refreshLocks.has(searchKey) || !isRecentlyAttempted;
              console.log("************************** Movie_Sources Hit (Fast Path)");
              return res.json({ ...payload, cacheHit: false, fastPath: true, scraping: isScrapingNow });
            }
          }
        } catch (e) {
          console.error('[Player Sources] Fast-path error:', e.message);
        }
      }
    }

    // --- STEP 5: Wait for at least one source (Incremental Resolution) ---
    // If we still have no sources, wait up to 60 seconds for the background scraper to find one
    console.log(`[Player Sources] Waiting up to 60s for first source from background scraper...`);
    let waitAttempts = 0;
    const epLock = mediaType === 'series' ? `series-${tmdbId}-s${seasonNumber}e${episodeNumber}` : null;
    
    while (waitAttempts < 120) {
      const currentDoc = await collection.findOne({ tmdbId, mediaType });
      let currentSourcesCount = 0;
      if (currentDoc) {
        if (mediaType === 'series') {
          const epData = currentDoc.episodes?.[`s${seasonNumber}e${episodeNumber}`];
          if (epData?.sources) {
            currentSourcesCount = Object.values(epData.sources).flat().filter(Boolean).length;
          }
        } else if (currentDoc.sources) {
          currentSourcesCount = Object.values(currentDoc.sources).flat().filter(Boolean).length;
        }
      }
      
      if (currentSourcesCount > 0) {
        console.log(`[Player Sources] First source found after ${waitAttempts * 0.5}s!`);
        const payload = buildPlayerSourcePayload(currentDoc, identity, false);
        return res.json({ ...payload, cacheHit: true, scraping: true });
      }
      
      // If the scraper finished and still no sources, stop waiting
      const isScrapingStill = refreshLocks.has(searchKey) || (epLock && refreshLocks.has(epLock));
      if (!isScrapingStill) break;

      await new Promise(r => setTimeout(r, 500));
      waitAttempts++;
    }

    console.log(`[Player Sources] Wait finished (attempts: ${waitAttempts}). Returning current state.`);
    const finalDoc = await collection.findOne({ tmdbId, mediaType });
    const finalPayload = buildPlayerSourcePayload(finalDoc || { mediaType, tmdbId, seasonNumber, episodeNumber }, identity, true);
    res.json({
      ...finalPayload,
      cacheHit: Boolean(finalDoc),
      scraping: refreshLocks.has(searchKey) || (epLock && refreshLocks.has(epLock))
    });

  } catch (err) {
    console.error('Error resolving player sources:', err);
    if (err.message === 'no-player-links-found' || err.message === 'page-not-found' || err.message === 'no-matching-slug') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to resolve player sources', details: err.message });
  }
});

router.get('/player/fallback', async (req, res) => {
  try {
    const mediaType = String(req.query.mediaType || '').trim().toLowerCase();
    const tmdbId = Number(req.query.tmdbId || 0);
    const imdbId = String(req.query.imdbId || '').trim();

    if (!['movie', 'series'].includes(mediaType) || !tmdbId) {
      return res.status(400).json({ error: 'mediaType and tmdbId are required.' });
    }

    if (!WATCHMODE_API_KEY) {
      return res.status(503).json({ error: 'Watchmode fallback is not configured.' });
    }

    const fallback = await resolveWatchmodeFallback({ tmdbId, imdbId, mediaType });
    if (!fallback?.url) {
      return res.status(404).json({ error: 'No Watchmode fallback found for this title.' });
    }

    res.json({
      url: fallback.url,
      label: fallback.label,
      embeddable: fallback.embeddable,
      message: 'Watchmode fallback loaded.'
    });
  } catch (err) {
    console.error('Error resolving player fallback:', err);
    res.status(500).json({ error: 'Failed to resolve player fallback', details: err.message });
  }
});

router.post('/ratings/imdb/enrich', async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'Items are required' });
    }

    const items = [];
    for (const rawItem of rawItems) {
      const tmdbID = Number(rawItem?.tmdbID || rawItem?.contentId || rawItem?.id || 0);
      const mediaType = normalizeMediaType(rawItem?.mediaType || rawItem?.media_type || rawItem?.type);
      if (!tmdbID) continue;
      items.push({ tmdbID, mediaType });
    }

    if (!items.length) {
      return res.status(400).json({ error: 'No valid items to enrich' });
    }

    console.log(`[Enrich] batch START count=${items.length} items:`, items.map(i => `${i.mediaType}:${i.tmdbID}`).join(', '));

    const results = [];
    for (const item of items) {
      const rating = await resolveImdbRating(item.tmdbID, item.mediaType).catch((error) => {
        console.warn(`[Enrich] resolveImdbRating failed tmdbID=${item.tmdbID} mediaType=${item.mediaType}:`, error.message);
        return {
          tmdbID: item.tmdbID,
          mediaType: item.mediaType,
          imdbID: '',
          imdb_rating: null,
          vote_average: null,
          source: 'error'
        };
      });
      console.log(`[Enrich]   result tmdbID=${rating.tmdbID} imdbID="${rating.imdbID}" imdb_rating=${rating.imdb_rating} vote_average=${rating.vote_average} source=${rating.source}`);
      results.push(rating);
    }

    console.log(`[Enrich] batch DONE count=${results.length}`);
    res.json({ items: results });
  } catch (err) {
    console.error('Error enriching IMDB ratings:', err);
    res.status(500).json({ error: 'Failed to enrich IMDB ratings' });
  }
});

// GET /api/search
router.get('/search', async (req, res) => {
  const { q, limit = 20, type = 'content', stream = '0' } = req.query;
  if (!q || q.length < 2) return res.json({ query: q || '', results: [] });
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  const requestId = `${q}_${limit}_${type}`;

  const cached = lastSearchResults.get(requestId);
  if (stream !== '1' && cached && Date.now() - cached.timestamp < 5000) return res.json(cached.data);

  if (searchRequests.has(requestId)) searchRequests.get(requestId).abort();
  const controller = new AbortController();
  searchRequests.set(requestId, controller);

  try {
    const base_query = q.trim();
    let users = [];
    if (type === 'users') {
      users = await getDb().collection('users')
        .find({
          $or: [
            { username: { $regex: base_query, $options: 'i' } },
            { fullName: { $regex: base_query, $options: 'i' } }
          ]
        })
        .project({ username: 1, fullName: 1, avatar: 1, bio: 1 })
        .limit(Math.max(Number(limit), 10))
        .toArray()
        .catch(() => []);

      const results = users
        .filter(user => user?.username)
        .slice(0, Number(limit))
        .map(normalizeUser);

      const responseData = { query: q, results };
      lastSearchResults.set(requestId, { data: responseData, timestamp: Date.now() });
      return res.json(responseData);
    }
    const yearMatch = base_query.match(/\b(19\d{2}|20\d{2})\b/);
    const year_query = yearMatch ? yearMatch[1] : null;
    const altered_query = year_query ? base_query.replace(year_query, '').replace(/\s+/g, ' ').trim() : base_query;
    const hasYear = Boolean(year_query);

    const headers = tmdbHeaders();
    const includeAdult = false;
    const allowMissingImdb = includeAdult;
    const allMovies = [];
    const allTv = [];
    const allPeople = [];
    const promises = [];

    if (stream === '1' && ['content', 'all', 'cast'].includes(type)) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const maxResults = Math.max(Number(limit) || 20, 20);
      const seen = new Set();
      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
      });
      const writeEvent = (payload) => {
        if (!clientClosed && !res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
      };
      const normalizeChunk = (items, mediaType) => {
        return (Array.isArray(items) ? items : [])
          .filter(item => item?.id && item?.adult !== true)
          .map(item => {
            if (mediaType === 'person') {
              return {
                ...normalizePerson(item),
                _isIndian: isIndianPerson(item),
                _popularity: Number(item?.popularity || 0)
              };
            }
            const normalized = normalize(item, mediaType);
            return {
              ...normalized,
              score: computeFinalScore(normalized, hasYear ? altered_query : q, year_query),
              isIndian: INDIAN_LANGS.has(normalized.originalLanguage) || normalized.originCountry.includes('IN')
            };
          })
          .filter(item => mediaType === 'person' || item.score > 25)
          .sort((a, b) => {
            if (mediaType === 'person') {
              if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
              return b._popularity - a._popularity;
            }
            if (hasYear) {
              const yr = Number(year_query);
              const aExact = a.release_year === yr ? 1 : 0;
              const bExact = b.release_year === yr ? 1 : 0;
              if (aExact !== bExact) return bExact - aExact;
            }
            return b.score - a.score;
          })
          .map(({ _isIndian, _popularity, ...item }) => item);
      };
      const fetchPage = async (tmdbType, query, page, year = null) => {
        if (clientClosed) return;
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=${page}${year ? `&year=${year}` : ''}`;
        try {
          const response = await tmdbFetch(url, { headers }, `TMDB stream ${tmdbType} "${query}" p${page}`);
          const data = response.ok ? await response.json() : { results: [] };
          const items = normalizeChunk(data.results, tmdbType)
            .filter(item => {
              const key = `${item.media_type}:${item.id}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, maxResults);
          if (items.length) writeEvent({ type: 'results', query: q, page, source: tmdbType, results: items });
        } catch {
          writeEvent({ type: 'page-error', query: q, page, source: tmdbType });
        }
      };

      writeEvent({ type: 'start', query: q });
      if (type === 'content' || type === 'all') {
        const mainPages = hasYear ? 3 : 7;
        for (let page = 1; page <= mainPages; page++) {
          if (clientClosed) break;
          await Promise.all([
            fetchPage('movie', base_query, page),
            fetchPage('tv', base_query, page)
          ]);
        }
        if (hasYear && altered_query.length >= 2) {
          for (let page = 1; page <= 2; page++) {
            if (clientClosed) break;
            await Promise.all([
              fetchPage('movie', altered_query, page, year_query),
              fetchPage('tv', altered_query, page, year_query)
            ]);
          }
        }
      }
      if (type === 'cast' || type === 'all') {
        for (let page = 1; page <= 3; page++) {
          if (clientClosed) break;
          await fetchPage('person', base_query, page);
        }
      }
      writeEvent({ type: 'done', query: q });
      return res.end();
    }

    const queuePages = (type, query, maxPages, year = null) => {
      for (let page = 1; page <= maxPages; page++) {
        const shouldIncludeAdult = false;
        const url = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(query)}&include_adult=${shouldIncludeAdult ? 'true' : 'false'}&language=en-US&page=${page}${year ? `&year=${year}` : ''}`;
        promises.push(
          tmdbFetch(url, { headers }, `TMDB ${type} "${query}" p${page}`)
            .then(r => r.ok ? r.json() : { results: [] })
            .then(data => {
              if (type === 'movie') {
                allMovies.push(...data.results);
              } else if (type === 'tv') {
                allTv.push(...data.results);
              } else if (type === 'person') {
                allPeople.push(...data.results);
              }
            })
            .catch(() => {})
        );
      }
    };

    if (type === 'content' || type === 'all') {
      if (!hasYear) {
        queuePages('movie', base_query, 7);
        queuePages('tv', base_query, 7);
      } else {
        queuePages('movie', base_query, 3);
        queuePages('tv', base_query, 3);
        if (altered_query.length >= 2) {
          queuePages('movie', altered_query, 2, year_query);
          queuePages('tv', altered_query, 2, year_query);
        }
      }
    }

    if (type === 'cast' || type === 'all') {
      queuePages('person', base_query, 3);
    }

    await Promise.all(promises);

    let results = [];
    if (type === 'content' || type === 'all') {
      let scored = [
        ...allMovies.filter(item => item?.adult !== true).map(m => normalize(m, 'movie')),
        ...allTv.filter(item => item?.adult !== true).map(t => normalize(t, 'tv'))
      ]
        .map(item => ({
          ...item,
          score: computeFinalScore(item, hasYear ? altered_query : q, year_query),
          isIndian: INDIAN_LANGS.has(item.originalLanguage) || item.originCountry.includes('IN')
        }))
        .filter(item => item.score > 25);

      if (!allowMissingImdb) {
        const candidateItems = scored.slice(0, Math.max(Number(limit) * 3, 24));
        const enrichedCandidates = await Promise.all(
          candidateItems.map(async (item) => {
            const mediaType = item.type === 'tv' ? 'Series' : 'Movie';
            const imdbResult = await resolveImdbRating(item.id, mediaType, item).catch(() => ({ imdbID: '' }));
            return {
              ...item,
              imdb_id: imdbResult?.imdbID || ''
            };
          })
        );
        const allowedIds = new Set(enrichedCandidates.filter((item) => item.imdb_id).map((item) => item.id));
        scored = scored.filter((item) => allowedIds.has(item.id));
      }

      if (hasYear) {
        const yr = Number(year_query);
        const exact = scored.filter(i => i.release_year === yr).sort((a, b) => b.score - a.score);
        const rest  = scored.filter(i => i.release_year !== yr).sort((a, b) => b.score - a.score);
        results = [...exact, ...rest].slice(0, limit);
      } else {
        results = scored.sort((a, b) => b.score - a.score).slice(0, limit);
      }
    }

    const personResults = allPeople
      .filter(person => person?.id && person?.name)
      .map((person) => ({
        ...normalizePerson(person),
        _isIndian: isIndianPerson(person),
        _popularity: Number(person?.popularity || 0)
      }))
      .sort((a, b) => {
        if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
        return b._popularity - a._popularity;
      });

    const userResults = users
      .filter(user => user?.username)
      .map(normalizeUser);

    if (type === 'cast') {
      results = personResults.slice(0, Number(limit));
    } else if (type === 'users') {
      results = userResults.slice(0, Number(limit));
    } else {
      const topPeople = personResults.slice(0, 4);
      const topUsers = userResults.slice(0, 4);
      const supplementalResults = [...topPeople, ...topUsers];
      const reservedSlots = Math.min(supplementalResults.length, 8, Number(limit));
      const primarySlots = Math.max(Number(limit) - reservedSlots, 0);
      results = [...results.slice(0, primarySlots), ...supplementalResults].slice(0, Number(limit));
    }

    const responseData = { query: q, results };
    lastSearchResults.set(requestId, { data: responseData, timestamp: Date.now() });
    searchRequests.delete(requestId);
    res.json(responseData);
  } catch (err) {
    searchRequests.delete(requestId);
    console.error('Search error:', err);
    res.json([]);
  }
});

// GET /api/search/users
router.get('/search/users', async (req, res) => {
  const { q, limit = 12 } = req.query;
  if (!q || q.length < 2) return res.json({ query: q || '', results: [] });
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  try {
    const base_query = q.trim();
    const users = await getDb().collection('users')
      .find({
        $or: [
          { username: { $regex: base_query, $options: 'i' } },
          { fullName: { $regex: base_query, $options: 'i' } }
        ]
      })
      .project({ username: 1, fullName: 1, avatar: 1, bio: 1 })
      .limit(Math.max(Number(limit), 10))
      .toArray();

    const results = users
      .filter(user => user?.username)
      .map(normalizeUser)
      .slice(0, Number(limit));

    res.json({ query: q, results });
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});


router.get('/scrape-embed', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url');

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    if (!response.ok) return res.status(response.status).send('Failed to fetch');

    const html = await response.text();
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    
    if (iframeMatch && iframeMatch[1]) {
      let embedUrl = iframeMatch[1];
      if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
      return res.redirect(302, embedUrl);
    }
    
    return res.status(404).send('Embed not found on page');
  } catch (err) {
    console.error('Scrape embed error:', err);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
