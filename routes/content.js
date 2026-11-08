const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');
const { getDb, SOURCE_CONFIGS_COLLECTION, MULTIMOVIES_CONFIG_DOC_ID } = require('../db');
const { INDIAN_LANGS, normalize, computeFinalScore } = require('../util');
const { evaluateAdultItem, loadAdultTree, getAdultKeywordsParam, loadAdultKeywords } = require('../util/adultDecisionTree');
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
const TMDB_BASE_URL = (process.env.TMDB_BASE_URL || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');
const WATCHMODE_API_KEY = process.env.WATCHMODE_API_KEY || process.env.WATCHMODE;
const fetch = global.fetch;
const PLAYER_SOURCES_COLLECTION = 'PlayerSources';
const MOVIE_SOURCES_COLLECTION = 'Movie_Sources';
const TV_SHOW_URLS_COLLECTION = 'TVShowURLs';
const DEFAULT_MULTIMOVIES_BASE_URL = 'https://multimovies.fyi/';
const DEFAULT_MULTIMOVIES_ROOT_URL = 'https://multimovies.fyi/';

const refreshLocks = new Set();

const DIRECT_SOURCES = [
  { id: 'vidlink', label: 'VidLink', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://vidlink.pro/tv/${t}/${s || 1}/${e || 1}` : `https://vidlink.pro/movie/${t}` },
  { id: 'vidrift', label: 'VidRift', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://embed.vidrift.net/embed/tv/${t}/${s || 1}/${e || 1}` : `https://embed.vidrift.net/embed/movie/${t}` },
  { id: 'vidly', label: 'Vidly', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://vidly.pro/tv/${t}/${s || 1}/${e || 1}` : `https://vidly.pro/movie/${t}` },
  { id: 'framextv', label: 'FrameXTV', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://framextv.cc/embed/tv/${t}/${s || 1}/${e || 1}` : `https://framextv.cc/embed/movie/${t}` },
  { id: 'cineverse', label: 'Cineverse', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=${t}&s=${s || 1}&e=${e || 1}` : `https://rozgarlelo.modiplay.xyz/embed/tmdb/movie?id=${t}` },
  { id: 'vidbolt', label: 'VidBolt', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://vidbolt.xyz/tv/${t}/${s || 1}/${e || 1}` : `https://vidbolt.xyz/movie/${t}` },
  { id: 'filmu', label: 'Filmu', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://embed.filmu.in/tv/${t}/${s || 1}/${e || 1}` : `https://embed.filmu.in/movie/${t}` },
  { id: 'vidout', label: 'VIDOUT', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? `https://vidout.pages.dev/tv/${t}/s${s || 1}/e${e || 1}` : `https://vidout.pages.dev/movie/${t}` },
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
  let youtubeUrl = youtubeUrls[0] || (identity?.youtubeTrailerKey ? `https://www.youtube-nocookie.com/embed/${identity.youtubeTrailerKey}` : '');
  const youtubeSource = youtubeUrl
    ? {
        id: 'youtube',
        key: 'youtube',
        label: 'YouTube',
        urls: youtubeUrls.length ? youtubeUrls : [youtubeUrl],
        url: youtubeUrl,
        embeddable: true
      }
    : null;


  const knownKeys = new Set([...PREFERRED_SERVER_ORDER, 'youtube']);
  const dynamicSources = Object.keys(record?.sources || {})
    .filter((k) => !knownKeys.has(k))
    .map((k) => {
      const urls = sanitizeProviderUrls(record?.sources?.[k]);
      return urls[0] ? { id: k, key: k, label: k, urls, url: urls[0], embeddable: true } : null;
    })
    .filter(Boolean);

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
    sources: [...multimoviesSources, ...directSources, ...(youtubeSource ? [youtubeSource] : []), ...dynamicSources]
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
  const root = rootUrl || DEFAULT_MULTIMOVIES_ROOT_URL;

  // Pattern 1: nav-btn
  let match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*nav-btn[^"']*["'][^>]*>/i);
  if (match?.[1]) return new URL(match[1], root).toString();

  // Pattern 2: cta-primary
  match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*cta-primary[^"']*["'][^>]*>/i);
  if (match?.[1]) return new URL(match[1], root).toString();

  // Pattern 3: Legacy btn-main
  match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*btn-main[^"']*["'][^>]*>/i);
  if (match?.[1]) return new URL(match[1], root).toString();

  // Fallback: any link starting with https://multimovies.
  const fallbackRegex = /href=["'](https?:\/\/multimovies\.[a-z0-9]+[\/]?)["']/ig;
  let fallbackMatch;
  while ((fallbackMatch = fallbackRegex.exec(html)) !== null) {
    if (fallbackMatch[1]) {
      return new URL(fallbackMatch[1], root).toString();
    }
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
  const normalizedItems = (Array.isArray(items) ? items : []).filter((item) => {
    if (!item?.id) return false;
    const mt = String(item?.media_type || '').toLowerCase();
    return mt === 'movie' || mt === 'tv' || mt === 'series';
  });

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
    const mt = String(item?.media_type || '').toLowerCase();
    if (!item?.id || (mt !== 'movie' && mt !== 'tv' && mt !== 'series')) {
      return item;
    }

    const mediaType = (mt === 'tv' || mt === 'series') ? 'Series' : 'Movie';
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

const ADULT_KEYWORDS = {
  toString() {
    return getAdultKeywordsParam();
  }
};
const CONTENT_CACHE_COLLECTION = 'ContentCache';

async function getMongoCache(key) {
  try {
    const db = getDb();
    if (!db) return null;
    const doc = await db.collection(CONTENT_CACHE_COLLECTION).findOne({ _id: key });
    if (!doc) return null;
    if (Date.now() - new Date(doc.updatedAt).getTime() > (doc.ttl || 600000)) {
      return null;
    }
    return doc.data;
  } catch {
    return null;
  }
}

async function setMongoCache(key, data, ttlMs = 10 * 60 * 1000) {
  try {
    const db = getDb();
    if (!db) return;
    await db.collection(CONTENT_CACHE_COLLECTION).updateOne(
      { _id: key },
      { $set: { data, ttl: ttlMs, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch {
    // Non-critical
  }
}

function isAdult(item, options = {}) {
  return evaluateAdultItem(item, null, options);
}

function shouldShow(item, adminMode = 0, options = {}) {
  if (adminMode === 1) return true; // Mode 1: All Content (Normal + Adult shown - returns 1 always)
  if (adminMode === 2) return isAdult(item, options); // Mode 2: Reverse Filter (Adult only)
  return !isAdult(item, options); // Mode 0 / Public: Normal Filter (Adult content hidden)
}

function shouldSuppressContent(item, adminMode = 0, options = {}) {
  // If content is not visible to this user under their current adminMode, suppress it
  return !shouldShow(item, adminMode, options);
}

function isAnimeContent(item) {
  const hasAnimation = Array.isArray(item?.genres) &&
    item.genres.some((g) => (typeof g === 'string' ? g : g?.name) === 'Animation' || g?.id === 16);
  if (!hasAnimation && Array.isArray(item?.genre_ids) && item.genre_ids.includes(16)) return true;
  if (!hasAnimation) return false;
  const asianLangs = ['ja', 'zh', 'ko'];
  const asianCountries = ['JP', 'CN', 'KR'];
  const originCountry = item.origin_country || item.production_countries || [];
  const isAsianCountry = Array.isArray(originCountry)
    ? originCountry.some((c) => asianCountries.includes(typeof c === 'string' ? c : c?.iso_3166_1))
    : asianCountries.includes(String(originCountry));
  return asianLangs.includes(item.original_language) || isAsianCountry;
}

async function resolveUserAdminInfo(req) {
  if (!req.user?.userId && !req.user?.username) {
    return { isAdmin: false, adminMode: 0 };
  }
  try {
    const query = req.user?.userId ? { _id: new ObjectId(req.user.userId) } : { username: req.user.username };
    const user = await getDb()
      .collection('users')
      .findOne(query, { projection: { admin: 1, adminMode: 1, showAdult: 1 } });
    const isAdmin = user?.admin === true || user?.admin === 'true' || user?.admin === 1;
    if (!isAdmin) return { isAdmin: false, adminMode: 0 };
    return {
      isAdmin: true,
      adminMode: Number(user?.adminMode ?? (user?.showAdult === true ? 1 : 0))
    };
  } catch (error) {
    console.error('[Content] Failed to resolve admin info', error);
    return { isAdmin: false, adminMode: 0 };
  }
}

async function resolveAdminMode(req) {
  const { adminMode } = await resolveUserAdminInfo(req);
  return adminMode;
}

async function resolveIncludeAdult(req) {
  const mode = await resolveAdminMode(req);
  return mode === 1 || mode === 2;
}

async function canAccessContentForUser(req, content = {}, mediaType = 'Movie') {
  const adminMode = await resolveAdminMode(req);
  return shouldShow(content, adminMode);
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
      ? `https://api.themoviedb.org/3/movie/${numericTmdbId}?append_to_response=videos&language=en-US`
      : `https://api.themoviedb.org/3/tv/${numericTmdbId}?append_to_response=videos&language=en-US`;
  const episodeUrl =
    normalizedMediaType === 'series'
      ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/season/${Number(seasonNumber || 1)}/episode/${Number(episodeNumber || 1)}?append_to_response=videos&language=en-US`
      : '';
  const ep1Url =
    normalizedMediaType === 'series' && (Number(seasonNumber || 1) !== 1 || Number(episodeNumber || 1) !== 1)
      ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/season/1/episode/1?append_to_response=videos&language=en-US`
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

  const allVideos = [
    ...(episodeDetail?.videos?.results || []),
    ...(ep1Detail?.videos?.results || []),
    ...(detail?.videos?.results || [])
  ];
  const ytVideo = allVideos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
                  allVideos.find((v) => v.site === 'YouTube' && (v.type === 'Teaser' || v.type === 'Clip')) ||
                  allVideos.find((v) => v.site === 'YouTube');
  const youtubeTrailerKey = ytVideo?.key || '';
  
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
    episodeRuntime: episodeDetail?.runtime || detail.episode_run_time?.[0] || 40,
    youtubeTrailerKey
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

      let finalYtUrl = '';
      if (bestYtVideo) {
        const durationMin = Math.round(bestYtVideo.seconds / 60);
        console.log(`[YouTube Scraper] ✓ Best full match (query #${bestQueryIndex + 1}): "${bestYtVideo.title}" | ${durationMin} min | score=${Math.round(bestScore)}`);
        finalYtUrl = `https://www.youtube-nocookie.com/embed/${bestYtVideo.videoId}`;
      } else if (identity.youtubeTrailerKey) {
        console.log(`[YouTube Scraper] Using official TMDB trailer/video: ${identity.youtubeTrailerKey}`);
        finalYtUrl = `https://www.youtube-nocookie.com/embed/${identity.youtubeTrailerKey}`;
      } else {
        try {
          const trailerRes = await ytSearch(`${titleYear} official trailer`);
          const firstVid = trailerRes?.videos?.[0];
          if (firstVid?.videoId) {
            finalYtUrl = `https://www.youtube-nocookie.com/embed/${firstVid.videoId}`;
          }
        } catch (e) {}
      }

      if (finalYtUrl) {
        const ytPlayer = {
          sourceKey: 'youtube',
          serverName: 'YOUTUBE',
          url: finalYtUrl,
          preferred: false,
          available: true
        };
        // Persist to DB + push to connected client immediately
        await onSource([ytPlayer]);
      } else {
        console.log(`[YouTube Scraper] No suitable video found across ${ytQueries.length} queries.`);
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
    36: 10768, // History -> War & Politics
    9648: 9648, // Mystery -> Mystery
    878: 10765, // Sci-Fi -> Sci-Fi & Fantasy
    10752: 10768, // War -> War & Politics
    37: 37,    // Western -> Western
    // Native TV genres:
    10759: 10759, 10762: 10762, 10763: 10763, 10764: 10764,
    10765: 10765, 10766: 10766, 10767: 10767, 10768: 10768
  };
  return map[id] !== undefined ? map[id] : null;
}

function mapTvGenreToMovieGenre(genreId) {
  if (!genreId) return null;
  const id = parseInt(genreId, 10);
  const map = {
    28: '28', 12: '12', 16: '16', 35: '35', 80: '80', 99: '99', 18: '18',
    10751: '10751', 14: '14', 36: '36', 27: '27', 10402: '10402', 9648: '9648',
    10749: '10749', 878: '878', 10770: '10770', 53: '53', 10752: '10752', 37: '37',
    10759: '28|12',
    10765: '878|14',
    10768: '10752|36',
    10762: '10751',
    10764: '99'
  };
  return map[id] !== undefined ? map[id] : String(genreId);
}

function getFourMonthWindow(windowIndex = 0) {
  const now = new Date();
  const MONTHS_PER_WINDOW = 4;
  const endMonthsAgo = windowIndex * MONTHS_PER_WINDOW;
  const endDateObj = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - endMonthsAgo, now.getUTCDate()));
  const lteDate = endDateObj.toISOString().split('T')[0];

  const startMonthsAgo = (windowIndex + 1) * MONTHS_PER_WINDOW;
  const startDateObj = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - startMonthsAgo, now.getUTCDate()));
  const gteDate = startDateObj.toISOString().split('T')[0];
  return { gteDate, lteDate };
}

function getDateWindow(daysBack = 210) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const startObj = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const startDate = startObj.toISOString().split('T')[0];
  return { today, startDate };
}

// ── Hidden Genres & Kartoons Genre Mixing ────────────────────────────────────
const HIDDEN_GENRE_IDS = new Set([10763, 10764, 10766, 10767, '10763', '10764', '10766', '10767']);
const HIDDEN_GENRE_NAMES = new Set(['news', 'reality', 'soap', 'talk']);

function isHiddenGenre(g) {
  if (!g) return false;
  const id = g.id !== undefined ? g.id : g;
  const name = String(g.name || '').toLowerCase();
  return HIDDEN_GENRE_IDS.has(id) || HIDDEN_GENRE_NAMES.has(name);
}

function normalizeKartoonsTitle(s = '') {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areTitlesPairable(tmdbTitle, kartoonTitle, tmdbYear, kartoonYear) {
  if (!tmdbTitle || !kartoonTitle) return false;
  const tNorm = normalizeKartoonsTitle(tmdbTitle);
  const kNorm = normalizeKartoonsTitle(kartoonTitle);
  if (!tNorm || !kNorm) return false;

  if (tNorm === kNorm) return true;

  const y1 = Number(String(tmdbYear || '').slice(0, 4));
  const y2 = Number(String(kartoonYear || '').slice(0, 4));
  const yearMatches = !y1 || !y2 || Math.abs(y1 - y2) <= 1;

  if (yearMatches) {
    if (tNorm.includes(kNorm) || kNorm.includes(tNorm)) {
      const minLen = Math.min(tNorm.length, kNorm.length);
      if (minLen >= 4) return true;
    }
  }
  return false;
}

async function fetchKartoonsGenreItems(category, page = 1, searchQuery = '') {
  try {
    const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
    const [showsRes, moviesRes] = await Promise.all([
      fetch(`https://api.kartoons.me/api/shows?page=${page}&category=${encodeURIComponent(category)}${searchParam}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000)
      }).catch(() => null),
      fetch(`https://api.kartoons.me/api/movies?page=${page}&category=${encodeURIComponent(category)}${searchParam}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000)
      }).catch(() => null)
    ]);

    const showsData = showsRes?.ok ? await showsRes.json().catch(() => null) : null;
    const moviesData = moviesRes?.ok ? await moviesRes.json().catch(() => null) : null;

    const rawShows = Array.isArray(showsData) ? showsData : (showsData?.data || []);
    const rawMovies = Array.isArray(moviesData) ? moviesData : (moviesData?.data || []);

    const shows = (Array.isArray(rawShows) ? rawShows : []).map(s => ({ ...s, type: 'show' }));
    const movies = (Array.isArray(rawMovies) ? rawMovies : []).map(m => ({ ...m, type: 'movie' }));

    return [...shows, ...movies];
  } catch (err) {
    console.warn('[API] Kartoons genre items fetch failed:', err.message);
    return [];
  }
}

function mergeKartoonsIntoItems(existingItems, kartoonList) {
  if (!Array.isArray(kartoonList) || !kartoonList.length) return existingItems;
  const result = [...existingItems];
  const newKartoonEntries = [];

  for (const kItem of kartoonList) {
    const kTitle = kItem.title || '';
    const kYear = kItem.startYear || kItem.releaseYear || kItem.endYear || null;

    // Check if an existing TMDB item is pairable
    const matched = result.find(tItem => {
      const tTitle = tItem.title || tItem.name || tItem.original_title || tItem.original_name || '';
      const tYear = tItem.release_date || tItem.first_air_date || tItem.release_year || null;
      return areTitlesPairable(tTitle, kTitle, tYear, kYear);
    });

    if (matched) {
      matched.kartoons_slug = kItem.slug;
      matched.has_kartoons = true;
      matched.kartoons_title = kItem.title;
      matched.kartoons_id = kItem._id;
    } else {
      const isMovie = kItem.type === 'movie';
      const year = Number(kYear) || null;
      newKartoonEntries.push({
        id: `kartoons-${kItem.slug}`,
        slug: kItem.slug,
        title: kItem.title,
        name: kItem.title,
        poster_path: kItem.image || kItem.coverImage || '',
        backdrop_path: kItem.coverImage || kItem.image || '',
        vote_average: Number(kItem.rating) || 0,
        release_date: year ? `${year}-01-01` : '',
        first_air_date: year ? `${year}-01-01` : '',
        release_year: year,
        media_type: isMovie ? 'Movie' : 'Series',
        is_kartoons: true,
        kartoons_slug: kItem.slug,
        is_hindi: true,
        popularity: (Number(kItem.rating) || 7) * 10
      });
    }
  }

  if (!newKartoonEntries.length) return result;

  const interleaved = [];
  let kIdx = 0;
  for (let i = 0; i < result.length; i++) {
    interleaved.push(result[i]);
    if ((i + 1) % 3 === 0 && kIdx < newKartoonEntries.length) {
      interleaved.push(newKartoonEntries[kIdx++]);
    }
  }
  while (kIdx < newKartoonEntries.length) {
    interleaved.push(newKartoonEntries[kIdx++]);
  }
  return interleaved;
}

function mergeSeasonEpisodesWithKartoons(tmdbEpisodes, kartoonEpisodes, kartoonSlug, seasonNumber) {
  if (!Array.isArray(kartoonEpisodes) || !kartoonEpisodes.length) {
    return tmdbEpisodes;
  }

  const matchedKartoonIds = new Set();
  const mergedEpisodes = [];

  const normTitle = (s = '') =>
    String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(the|a|an)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Step 1: For each TMDB episode, find matching Kartoons episode by Title or Episode Number
  for (let i = 0; i < tmdbEpisodes.length; i++) {
    const tmdbEp = { ...tmdbEpisodes[i] };
    const tmdbNorm = normTitle(tmdbEp.name);
    const tmdbNum = Number(tmdbEp.episode_number);

    let kMatch = null;

    // A. Priority 1: Match by Episode Title
    if (tmdbNorm.length >= 3 && !/^episode\s*\d+$/i.test(tmdbNorm)) {
      kMatch = kartoonEpisodes.find((k) => {
        if (matchedKartoonIds.has(k._id)) return false;
        const kNorm = normTitle(k.title);
        if (!kNorm) return false;
        return kNorm === tmdbNorm || kNorm.includes(tmdbNorm) || tmdbNorm.includes(kNorm);
      });
    }

    // B. Priority 2: Match by Episode Number
    if (!kMatch) {
      kMatch = kartoonEpisodes.find((k) => {
        if (matchedKartoonIds.has(k._id)) return false;
        return Number(k.episodeNumber) === tmdbNum;
      });
    }

    if (kMatch) {
      matchedKartoonIds.add(kMatch._id);
      tmdbEp.kartoons_episode_id = kMatch._id;
      tmdbEp.kartoons_slug = kartoonSlug;
      tmdbEp.has_kartoons = true;
      tmdbEp.kartoons_title = kMatch.title;
      if (!tmdbEp.still_path && (kMatch.thumbnail || kMatch.image)) {
        tmdbEp.still_path = kMatch.thumbnail || kMatch.image;
      }
    }

    mergedEpisodes.push(tmdbEp);
  }

  // Step 2: Handle any extra Kartoons episodes that were not matched (insert as .1, .2, etc.)
  const unmatchedKartoonEps = kartoonEpisodes.filter((k) => !matchedKartoonIds.has(k._id));

  for (const kEp of unmatchedKartoonEps) {
    const kNum = Number(kEp.episodeNumber) || 1;
    let insertAfterIdx = -1;
    let baseEpNum = 1;

    for (let j = 0; j < mergedEpisodes.length; j++) {
      const epNum = parseFloat(mergedEpisodes[j].episode_number) || 0;
      if (epNum <= kNum) {
        insertAfterIdx = j;
        baseEpNum = Math.floor(epNum);
      } else {
        break;
      }
    }

    if (insertAfterIdx === -1) {
      insertAfterIdx = 0;
      baseEpNum = 0;
    }

    let extraCount = 1;
    for (let j = 0; j < mergedEpisodes.length; j++) {
      const epStr = String(mergedEpisodes[j].episode_number || '');
      if (epStr.startsWith(`${baseEpNum}.`)) {
        extraCount++;
      }
    }

    const decimalNumber = `${baseEpNum}.${extraCount}`;

    const extraItem = {
      id: `kartoons-${kEp._id}`,
      episode_number: decimalNumber,
      display_episode_number: decimalNumber,
      season_number: seasonNumber,
      name: kEp.title || `Episode ${decimalNumber}`,
      overview: kEp.description || '',
      still_path: kEp.thumbnail || kEp.image || '',
      air_date: kEp.airDate || '',
      runtime: null,
      vote_average: Number(kEp.rating) || 0,
      kartoons_episode_id: kEp._id,
      kartoons_slug: kartoonSlug,
      has_kartoons: true,
      is_kartoons_extra: true
    };

    mergedEpisodes.splice(insertAfterIdx + 1, 0, extraItem);
  }

  return mergedEpisodes;
}

async function refreshCategoryCache(genre, year, page, limit, adminMode) {
  try {
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const adultFilter = adminMode !== 0 ? '&include_adult=true' : '&include_adult=false';
    const adultKeywords = adminMode === 2 ? ADULT_KEYWORDS : '';
    const targetCount = page === 1 ? Math.max(limit, 14) : limit;

    let finalItems = [];
    let currentPage = page;
    let totalPages = 1;
    let totalResults = 0;

    const isBollywood = String(genre).toLowerCase() === 'bollywood';

    while (finalItems.length < targetCount && currentPage <= page + 6) {
      let movieUrl = null;
      let tvUrl = null;
      if (isBollywood) {
        const { gteDate, lteDate } = getFourMonthWindow(0);
        if (adminMode === 2) {
          movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentPage}&include_adult=true${adultKeywords}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
          tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentPage}&include_adult=true${adultKeywords}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
        } else {
          movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentPage}${adultFilter}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
          tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentPage}${adultFilter}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
        }
      } else {
        const voteCountFilter = adminMode === 2 ? '' : '&vote_count.gte=5';
        const movieGid = mapTvGenreToMovieGenre(genre);
        const tvGid = mapMovieGenreToTvGenre(genre);
        if (!genre || movieGid !== null) {
          movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentPage}${adultFilter}${voteCountFilter}${adultKeywords}&sort_by=popularity.desc`;
          if (movieGid) movieUrl += `&with_genres=${movieGid}`;
          if (year)  movieUrl += `&primary_release_year=${year}`;
        }
        if (!genre || tvGid !== null) {
          tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentPage}${adultFilter}${voteCountFilter}${adultKeywords}&sort_by=popularity.desc`;
          if (tvGid) tvUrl += `&with_genres=${tvGid}`;
          if (year)  tvUrl += `&first_air_date_year=${year}`;
        }
      }

      const [movieResp, tvResp] = await Promise.all([
        movieUrl ? tmdbFetch(movieUrl, opts, 'Discover Movies Bg').catch(() => null) : null,
        tvUrl ? tmdbFetch(tvUrl, opts, 'Discover TV Bg').catch(() => null) : null
      ]);
      if (!movieResp?.ok && !tvResp?.ok) break;
      const movieData = movieResp?.ok ? await movieResp.json() : null;
      const tvData = tvResp?.ok ? await tvResp.json() : null;

      totalPages = Math.max(Number(movieData?.total_pages) || 0, Number(tvData?.total_pages) || 0, totalPages);
      totalResults = Math.max((Number(movieData?.total_results) || 0) + (Number(tvData?.total_results) || 0), totalResults);

      const pageMovies = (movieData?.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        ...(isBollywood ? { is_bollywood_endpoint: true } : {})
      }));
      const pageTv = (tvData?.results || []).map(i => ({
        ...i,
        media_type: 'Series',
        ...(isBollywood ? { is_bollywood_endpoint: true } : {})
      }));

      let pageItems = [...pageMovies, ...pageTv].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      if (String(genre) !== '16') {
        pageItems = pageItems.filter(item => !isAnimeContent(item));
      }
      pageItems = pageItems.filter(item => shouldShow(item, adminMode));

      for (const item of pageItems) {
        if (!finalItems.some(existing => existing.id === item.id)) {
          finalItems.push(item);
        }
      }

      if ((pageMovies.length === 0 && pageTv.length === 0) || currentPage >= totalPages) break;
      currentPage++;
    }

    if (adminMode === 2 && finalItems.length < (page === 1 ? 14 : limit)) {
      const supMovieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${page}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const supTvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${page}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const [supMovieResp, supTvResp] = await Promise.all([
        tmdbFetch(supMovieUrl, opts, 'Discover Adult Sup Movie Bg').catch(() => null),
        tmdbFetch(supTvUrl, opts, 'Discover Adult Sup TV Bg').catch(() => null)
      ]);
      const supMovieData = supMovieResp?.ok ? await supMovieResp.json() : null;
      const supTvData = supTvResp?.ok ? await supTvResp.json() : null;
      const supItems = [
        ...(supMovieData?.results || []).map(i => ({ ...i, media_type: 'Movie', ...(isBollywood ? { is_bollywood_endpoint: true } : {}) })),
        ...(supTvData?.results || []).map(i => ({ ...i, media_type: 'Series', ...(isBollywood ? { is_bollywood_endpoint: true } : {}) }))
      ].filter(item => shouldShow(item, adminMode));

      for (const item of supItems) {
        if (finalItems.length >= (page === 1 ? 14 : limit)) break;
        if (!finalItems.some(existing => existing.id === item.id)) {
          finalItems.push(item);
        }
      }
    }

    finalItems = await attachCachedRatings(finalItems);

    const isKids = String(genre) === '10762' || String(genre).toLowerCase() === 'kids';
    const isAnimation = String(genre) === '16' || String(genre).toLowerCase() === 'animation';
    if (isKids || isAnimation) {
      const category = isKids ? 'Cartoon' : 'Anime';
      const kItems = await fetchKartoonsGenreItems(category, page);
      finalItems = mergeKartoonsIntoItems(finalItems, kItems);
    }

    finalItems = finalItems.slice(0, targetCount);

    const safeTotalPages = Math.max(
      totalPages > 1 ? totalPages : 500,
      finalItems.length >= limit ? page + 10 : (finalItems.length > 0 ? page + 1 : page)
    );
    const safeTotalResults = Math.max(totalResults, safeTotalPages * limit);

    const cacheKey = `movies_page${page}_genre${genre || 'all'}_year${year || 'all'}_mode${adminMode}`;
    const payload = { movies: finalItems, pagination: { page, limit, total: safeTotalResults, pages: safeTotalPages } };
    
    if (payload.movies.length > 0) {
      categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
      await setMongoCache(cacheKey, payload, CATEGORIES_CACHE_DURATION);
      console.log(`[API] Background category revalidate success count=${payload.movies.length} key=${cacheKey}`);
    }
  } catch (err) {
    console.error('[API] Background category refresh failed:', err);
  } finally {
    const lockKey = `revalidating_category_page${page}_genre${genre || 'all'}_year${year || 'all'}_mode${adminMode}`;
    global[lockKey] = false;
  }
}

async function refreshTrendingCache(limit = 12, adminMode = 0) {
  try {
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const fetchWithDeadline = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Trending request timed out')), 7000))
      ]);

    let all = [];
    if (adminMode === 2) {
      const movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;

      const [movieResult, tvResult] = await Promise.allSettled([
        fetchWithDeadline(tmdbFetch(movieUrl, opts, 'Trending Movies Bg')),
        fetchWithDeadline(tmdbFetch(tvUrl, opts, 'Trending TV Bg'))
      ]);

      const movieResp = movieResult.status === 'fulfilled' ? movieResult.value : null;
      const tvResp = tvResult.status === 'fulfilled' ? tvResult.value : null;
      const movieData = movieResp?.ok ? await movieResp.json().catch(() => null) : null;
      const tvData = tvResp?.ok ? await tvResp.json().catch(() => null) : null;

      const movieItems = (movieData?.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        adult: true,
        _isAdultDiscover: true
      }));
      const tvItems = (tvData?.results || []).map(i => ({
        ...i,
        media_type: 'Series',
        adult: true,
        _isAdultDiscover: true
      }));
      all = [...movieItems, ...tvItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else {
      const trendingUrl = 'https://api.themoviedb.org/3/trending/all/day?language=en-US&page=1';
      const trendingResp = await fetchWithDeadline(tmdbFetch(trendingUrl, opts, 'Trending All Bg')).catch(() => null);
      if (trendingResp?.ok) {
        const data = await trendingResp.json().catch(() => null);
        all = (data?.results || []).map(i => ({
          ...i,
          media_type: (i.media_type === 'tv' || i.media_type === 'series') ? 'Series' : 'Movie'
        }));
      }
    }

    const finalItems = all;
    if (finalItems.length > 0) {
      if (adminMode === 2) {
        trendingCacheAdult = finalItems;
        trendingCacheAdultTime = Date.now();
        await setMongoCache('trending_mode_2_page_1', finalItems, CACHE_DURATION);
      } else {
        trendingCache = finalItems;
        trendingCacheTime = Date.now();
        await setMongoCache('trending_mode_0_page_1', finalItems, CACHE_DURATION);
      }
      console.log(`[API] Background trending revalidate success count=${finalItems.length} mode=${adminMode}`);
    }
  } catch (err) {
    console.error('[API] Background trending refresh failed:', err);
  } finally {
    if (adminMode === 2) global.trendingAdultRevalidating = false;
    else global.trendingRevalidating = false;
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

function normalizePerson(person, adminMode = 0) {
  const rawKnownFor = Array.isArray(person?.known_for) ? person.known_for : [];
  const filteredKnownFor = rawKnownFor.filter(item => shouldShow(item, adminMode));
  return {
    id: person.id,
    media_type: 'Person',
    title: person.name || '',
    name: person.name || '',
    gender: person.gender,
    adult: Boolean(person.adult),
    poster_path: person.profile_path || null,
    profile_path: person.profile_path || null,
    known_for_department: person.known_for_department || 'Cast & Crew',
    known_for: filteredKnownFor
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

// ── Similar Content ─────────────────────────────────────────────────────────
async function getSimilarContent(req, res, mediaType) {
  try {
    const { id } = req.params;
    const initialPage = Number(req.query.page) || 1;
    const { isAdmin, adminMode } = await resolveUserAdminInfo(req);

    // If the content itself should be suppressed for this user or has suppressed collection parts, do not show similar movies
    const parentUrl = mediaType === 'movie'
      ? `https://api.themoviedb.org/3/movie/${id}?language=en-US`
      : `https://api.themoviedb.org/3/tv/${id}?language=en-US`;
    const parentResp = await tmdbFetch(parentUrl, { method: 'GET', headers: tmdbHeaders() }, `Check Parent ${mediaType} ${id}`).catch(() => null);
    if (parentResp?.ok) {
      const parentData = await parentResp.json();
      if (shouldSuppressContent(parentData, adminMode)) {
        return res.json({ page: initialPage, results: [], total_pages: 0, total_results: 0 });
      }
      if (parentData?.belongs_to_collection?.id) {
        try {
          const colResp = await tmdbFetch(
            `https://api.themoviedb.org/3/collection/${parentData.belongs_to_collection.id}?language=en-US`,
            { method: 'GET', headers: tmdbHeaders() },
            `Check Collection Parts ${parentData.belongs_to_collection.id}`
          ).catch(() => null);
          if (colResp?.ok) {
            const colData = await colResp.json();
            if (Array.isArray(colData?.parts) && colData.parts.some((p) => shouldSuppressContent(p, adminMode))) {
              return res.json({ page: initialPage, results: [], total_pages: 0, total_results: 0 });
            }
          }
        } catch {}
      }
    }

    let results = [];
    let currentPage = initialPage;
    let totalPages = initialPage;
    let data = null;
    const seenIds = new Set([Number(id)]); // Exclude the current item itself

    while (results.length < 10 && currentPage <= initialPage + 4) {
      const tmdbPath = mediaType === 'movie'
        ? `https://api.themoviedb.org/3/movie/${id}/similar?page=${currentPage}&language=en-US`
        : `https://api.themoviedb.org/3/tv/${id}/similar?page=${currentPage}&language=en-US`;

      try {
        const resp = await tmdbFetch(tmdbPath, { method: 'GET', headers: tmdbHeaders() }, `Similar ${mediaType} ${id}`);
        if (!resp.ok) {
          if (resp.status === 404 && !data) {
            return res.json({ page: initialPage, results: [], total_pages: 0, total_results: 0 });
          }
          break;
        }
        const pageData = await resp.json();
        if (!data) data = pageData;
        const pageResults = Array.isArray(pageData?.results) ? pageData.results : [];
        totalPages = pageData?.total_pages || currentPage;

        const filtered = pageResults.filter(item => {
          if (!item || !item.id) return false;
          const itemIdNum = Number(item.id);
          if (seenIds.has(itemIdNum)) return false; // Deduplicate and prevent self-match
          seenIds.add(itemIdNum);

          return shouldShow(item, adminMode);
        });
        results.push(...filtered);

        if (currentPage >= totalPages) break;
        currentPage++;
      } catch (err) {
        if (err.message && err.message.includes('404')) {
          if (!data) return res.json({ page: initialPage, results: [], total_pages: 0, total_results: 0 });
          break;
        }
        throw err;
      }
    }

    if (data) {
      res.json({ ...data, results, page: initialPage });
    } else {
      res.json({ page: initialPage, results: [], total_pages: 0, total_results: 0 });
    }
  } catch (err) {
    console.error(`getSimilar error: ${err.message}`);
    res.status(500).json({ error: 'Failed to load similar content' });
  }
}

router.get('/movies/:id/similar', (req, res) => getSimilarContent(req, res, 'movie'));
router.get('/series/:id/similar', (req, res) => getSimilarContent(req, res, 'tv'));

router.get('/tmdb-collection/:id', async (req, res) => {
  try {
    const { adminMode } = await resolveUserAdminInfo(req);
    const resp = await tmdbFetch(`https://api.themoviedb.org/3/collection/${req.params.id}?language=en-US`, { method: 'GET', headers: tmdbHeaders() }, `Collection ${req.params.id}`);
    if (!resp.ok) return res.status(resp.status).json({ error: 'Collection not found' });
    const colData = await resp.json();
    if (Array.isArray(colData?.parts) && colData.parts.some((p) => shouldSuppressContent(p, adminMode))) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json(colData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch collection', details: err.message });
  }
});

router.get('/person/:id/images', async (req, res) => {
  try {
    const resp = await tmdbFetch(`https://api.themoviedb.org/3/person/${req.params.id}/images`, { method: 'GET', headers: tmdbHeaders() }, `Person Images ${req.params.id}`);
    if (!resp.ok) return res.status(resp.status).json({ error: 'Images not found' });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch person images', details: err.message });
  }
});

router.get('/imdb/person/:personId/filmography', async (req, res) => {
  try {
    const { scrapeImdbFilmography } = require('../util/imdbScraper');
    const filmography = await scrapeImdbFilmography(req.params.personId);
    res.json(filmography);
  } catch (err) {
    res.status(500).json({ error: 'Failed to scrape IMDB filmography', details: err.message });
  }
});

router.get('/movies', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { genre, year, search, sortBy = 'popularity', sortOrder = 'desc' } = req.query;
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const adminMode = await resolveAdminMode(req);

    const cacheKey = `movies_page${page}_genre${genre || 'all'}_year${year || 'all'}_mode${adminMode}`;
    const lockKey = `revalidating_category_page${page}_genre${genre || 'all'}_year${year || 'all'}_mode${adminMode}`;

    if (page === 1 && !search && sortBy === 'popularity' && sortOrder === 'desc' && adminMode === 0) {
      if (categoriesCache.has(cacheKey)) {
        const cached = categoriesCache.get(cacheKey);
        const isStale = Date.now() - cached.time > CATEGORIES_CACHE_DURATION;
        if (isStale && !global[lockKey]) {
          global[lockKey] = true;
          setTimeout(() => refreshCategoryCache(genre, year, page, limit, adminMode), 0);
        }
        if (cached?.data?.pagination) {
          cached.data.pagination.pages = Math.max(Number(cached.data.pagination.pages) || 0, 500);
        }
        return res.json(cached.data);
      }
      const mongoData = await getMongoCache(cacheKey);
      if (mongoData && mongoData.movies?.length) {
        if (!mongoData.pagination) mongoData.pagination = {};
        mongoData.pagination.pages = Math.max(Number(mongoData.pagination.pages) || 0, 500);
        categoriesCache.set(cacheKey, { time: Date.now(), data: mongoData });
        return res.json(mongoData);
      }
    }

    if (search) {
      const yearMatch = String(search).match(/\b(19\d{2}|20\d{2})\b/);
      const year_query = yearMatch ? yearMatch[1] : null;
      const altered_query = year_query ? String(search).replace(year_query, '').replace(/\s+/g, ' ').trim() : '';
      const hasYear = Boolean(year_query && altered_query.length >= 2);

      const adultFilter = adminMode !== 0 ? '&include_adult=true' : '&include_adult=false';
      const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(search)}${adultFilter}&language=en-US&page=${page}`;
      const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(search)}${adultFilter}&language=en-US&page=${page}`;

      const requests = [
        tmdbFetch(movieUrl, opts, `Search Movie "${search}"`).catch(() => null),
        tmdbFetch(tvUrl, opts, `Search TV "${search}"`).catch(() => null)
      ];

      // Dual approach: also search split title + year
      if (hasYear && page === 1) {
        const splitMovieUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(altered_query)}&primary_release_year=${year_query}${adultFilter}&language=en-US&page=1`;
        const splitTvUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(altered_query)}&first_air_date_year=${year_query}${adultFilter}&language=en-US&page=1`;
        requests.push(
          tmdbFetch(splitMovieUrl, opts, `Search Movie "${altered_query}" (${year_query})`).catch(() => null),
          tmdbFetch(splitTvUrl, opts, `Search TV "${altered_query}" (${year_query})`).catch(() => null)
        );
      }

      const responses = await Promise.all(requests);
      const movieResp = responses[0];
      const tvResp = responses[1];
      const splitMovieResp = responses[2] || null;
      const splitTvResp = responses[3] || null;

      if (!movieResp?.ok && !tvResp?.ok && !splitMovieResp?.ok && !splitTvResp?.ok) {
        return res.status(500).json({ error: 'Failed to search' });
      }

      const movieData = movieResp?.ok ? await movieResp.json() : null;
      const tvData = tvResp?.ok ? await tvResp.json() : null;
      const splitMovieData = splitMovieResp?.ok ? await splitMovieResp.json() : null;
      const splitTvData = splitTvResp?.ok ? await splitTvResp.json() : null;

      const rawMovies = [
        ...(movieData?.results ? movieData.results.map(i => ({ ...i, media_type: 'Movie' })) : []),
        ...(splitMovieData?.results ? splitMovieData.results.map(i => ({ ...i, media_type: 'Movie' })) : [])
      ];
      const rawTv = [
        ...(tvData?.results ? tvData.results.map(i => ({ ...i, media_type: 'Series' })) : []),
        ...(splitTvData?.results ? splitTvData.results.map(i => ({ ...i, media_type: 'Series' })) : [])
      ];

      const seen = new Set();
      const deduped = [];
      for (const item of [...rawMovies, ...rawTv]) {
        const key = `${item.media_type || 'Movie'}:${item.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      }

      const all = deduped.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      let finalItems = await attachCachedRatings(all);

      const isKids = String(genre) === '10762' || String(genre).toLowerCase() === 'kids';
      const isAnimation = String(genre) === '16' || String(genre).toLowerCase() === 'animation';
      if (isKids || isAnimation) {
        const category = isKids ? 'Cartoon' : 'Anime';
        const kItems = await fetchKartoonsGenreItems(category, page, search);
        finalItems = mergeKartoonsIntoItems(finalItems, kItems);
      }

      const totalResults = (movieData?.total_results || 0) + (tvData?.total_results || 0);
      const totalPages = Math.max(movieData?.total_pages || 1, tvData?.total_pages || 1);

      return res.json({ movies: finalItems, pagination: { page, limit, total: totalResults, pages: totalPages } });
    }

    const adultFilter = adminMode !== 0 ? '&include_adult=true' : '&include_adult=false';
    const adultKeywords = adminMode === 2 ? ADULT_KEYWORDS : '';
    const sortMap = { popularity: 'popularity', release_date: 'release_date', vote_average: 'vote_average' };
    const sortParam = sortMap[sortBy] ? `&sort_by=${sortMap[sortBy]}.${sortOrder}` : '&sort_by=popularity.desc';
    const targetCount = page === 1 ? Math.max(limit, 14) : limit;

    let finalItems = [];
    const isBollywood = String(genre).toLowerCase() === 'bollywood';

    if (isBollywood) {
      const PAGES_PER_WINDOW = 3;
      let currentWindow = Math.floor((page - 1) / PAGES_PER_WINDOW);
      let currentTmdbPage = ((page - 1) % PAGES_PER_WINDOW) + 1;
      let attempts = 0;

      while (finalItems.length < targetCount && attempts < 8) {
        attempts++;
        const { gteDate, lteDate } = getFourMonthWindow(currentWindow);

        let movieUrl;
        let tvUrl;
        if (adminMode === 2) {
          movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentTmdbPage}&include_adult=true${adultKeywords}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
          tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentTmdbPage}&include_adult=true${adultKeywords}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
        } else {
          movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentTmdbPage}${adultFilter}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
          tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentTmdbPage}${adultFilter}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
        }

        const [movieResp, tvResp] = await Promise.all([
          tmdbFetch(movieUrl, opts, `Bollywood Movies W${currentWindow} P${currentTmdbPage}`).catch(() => null),
          tmdbFetch(tvUrl, opts, `Bollywood TV W${currentWindow} P${currentTmdbPage}`).catch(() => null)
        ]);

        if (!movieResp?.ok && !tvResp?.ok) {
          currentWindow++;
          currentTmdbPage = 1;
          continue;
        }

        const movieData = movieResp?.ok ? await movieResp.json() : null;
        const tvData = tvResp?.ok ? await tvResp.json() : null;

        const windowTotalPages = Math.max(Number(movieData?.total_pages) || 1, Number(tvData?.total_pages) || 1);
        const rawMovies = (movieData?.results || []).map(i => ({
          ...i,
          media_type: 'Movie',
          is_bollywood_endpoint: true,
          ...(adminMode === 2 ? { adult: true, _isAdultDiscover: true } : {})
        }));
        const rawTv = (tvData?.results || []).map(i => ({
          ...i,
          media_type: 'Series',
          is_bollywood_endpoint: true,
          ...(adminMode === 2 ? { adult: true, _isAdultDiscover: true } : {})
        }));

        let pageItems = [...rawMovies, ...rawTv].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        pageItems = pageItems.filter(item => !isAnimeContent(item));
        pageItems = pageItems.filter(item => shouldShow(item, adminMode));

        for (const item of pageItems) {
          if (!finalItems.some(existing => existing.id === item.id)) {
            finalItems.push(item);
          }
        }

        if (currentTmdbPage < windowTotalPages && currentTmdbPage < PAGES_PER_WINDOW) {
          currentTmdbPage++;
        } else {
          currentWindow++;
          currentTmdbPage = 1;
        }
      }

      finalItems = await attachCachedRatings(finalItems);
      finalItems = finalItems.slice(0, targetCount);

      const safeTotalPages = Math.max(page + 20, 500);
      const payload = {
        movies: finalItems,
        pagination: {
          page,
          limit,
          total: safeTotalPages * limit,
          pages: safeTotalPages
        }
      };

      if (page === 1 && !search && sortBy === 'popularity' && sortOrder === 'desc' && payload.movies.length > 0) {
        categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
        await setMongoCache(cacheKey, payload, CATEGORIES_CACHE_DURATION);
      }

      return res.json(payload);
    }

    let currentPage = page;
    let totalPages = 1;
    let totalResults = 0;

    while (finalItems.length < targetCount && currentPage <= page + 6) {
      const voteCountFilter = adminMode === 2 ? '' : '&vote_count.gte=5';
      const movieGid = mapTvGenreToMovieGenre(genre);
      const tvGid = mapMovieGenreToTvGenre(genre);

      let movieUrl = null;
      let tvUrl = null;

      if (!genre || movieGid !== null) {
        movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentPage}${adultFilter}${voteCountFilter}${adultKeywords}${sortParam}`;
        if (movieGid) movieUrl += `&with_genres=${movieGid}`;
        if (year)  movieUrl += `&primary_release_year=${year}`;
      }

      if (!genre || tvGid !== null) {
        tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${currentPage}${adultFilter}${voteCountFilter}${adultKeywords}${sortParam}`;
        if (tvGid) tvUrl += `&with_genres=${tvGid}`;
        if (year)  tvUrl += `&first_air_date_year=${year}`;
      }

      const [movieResp, tvResp] = await Promise.all([
        movieUrl ? tmdbFetch(movieUrl, opts, 'Discover Movies').catch(() => null) : null,
        tvUrl ? tmdbFetch(tvUrl, opts, 'Discover TV').catch(() => null) : null
      ]);

      if (!movieResp?.ok && !tvResp?.ok) break;

      const movieData = movieResp?.ok ? await movieResp.json() : null;
      const tvData = tvResp?.ok ? await tvResp.json() : null;

      totalPages = Math.max(Number(movieData?.total_pages) || 0, Number(tvData?.total_pages) || 0, totalPages);
      totalResults = Math.max((Number(movieData?.total_results) || 0) + (Number(tvData?.total_results) || 0), totalResults);

      const pageMovies = (movieData?.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        ...(isBollywood ? { is_bollywood_endpoint: true } : {})
      }));
      const pageTv = (tvData?.results || []).map(i => ({
        ...i,
        media_type: 'Series',
        ...(isBollywood ? { is_bollywood_endpoint: true } : {})
      }));

      let pageItems = [...pageMovies, ...pageTv].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

      if (String(genre) !== '16') {
        pageItems = pageItems.filter(item => !isAnimeContent(item));
      }

      pageItems = pageItems.filter(item => shouldShow(item, adminMode));

      for (const item of pageItems) {
        if (!finalItems.some(existing => existing.id === item.id)) {
          finalItems.push(item);
        }
      }

      if ((pageMovies.length === 0 && pageTv.length === 0) || currentPage >= totalPages) break;
      currentPage++;
    }

    if (adminMode === 2 && finalItems.length < (page === 1 ? 14 : limit)) {
      const supMovieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${page}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const supTvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${page}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const [supMovieResp, supTvResp] = await Promise.all([
        tmdbFetch(supMovieUrl, opts, 'Discover Adult Supplement Movie').catch(() => null),
        tmdbFetch(supTvUrl, opts, 'Discover Adult Supplement TV').catch(() => null)
      ]);
      const supMovieData = supMovieResp?.ok ? await supMovieResp.json() : null;
      const supTvData = supTvResp?.ok ? await supTvResp.json() : null;
      const supItems = [
        ...(supMovieData?.results || []).map(i => ({ ...i, media_type: 'Movie', ...(isBollywood ? { is_bollywood_endpoint: true } : {}) })),
        ...(supTvData?.results || []).map(i => ({ ...i, media_type: 'Series', ...(isBollywood ? { is_bollywood_endpoint: true } : {}) }))
      ].filter(item => shouldShow(item, adminMode));

      for (const item of supItems) {
        if (finalItems.length >= (page === 1 ? 14 : limit)) break;
        if (!finalItems.some(existing => existing.id === item.id)) {
          finalItems.push(item);
        }
      }
    }

    finalItems = await attachCachedRatings(finalItems);

    const isKids = String(genre) === '10762' || String(genre).toLowerCase() === 'kids';
    const isAnimation = String(genre) === '16' || String(genre).toLowerCase() === 'animation';
    if (isKids || isAnimation) {
      const category = isKids ? 'Cartoon' : 'Anime';
      const kItems = await fetchKartoonsGenreItems(category, page);
      finalItems = mergeKartoonsIntoItems(finalItems, kItems);
    }

    finalItems = finalItems.slice(0, targetCount);

    const safeTotalPages = Math.max(
      totalPages > 1 ? totalPages : 500,
      finalItems.length >= limit ? page + 10 : (finalItems.length > 0 ? page + 1 : page)
    );
    const safeTotalResults = Math.max(totalResults, safeTotalPages * limit);

    const payload = { movies: finalItems, pagination: { page, limit, total: safeTotalResults, pages: safeTotalPages } };
    
    if (page === 1 && !search && sortBy === 'popularity' && sortOrder === 'desc' && payload.movies.length > 0) {
      categoriesCache.set(cacheKey, { time: Date.now(), data: payload });
      await setMongoCache(cacheKey, payload, CATEGORIES_CACHE_DURATION);
    }

    res.json(payload);
  } catch (err) {
    console.error('Error fetching movies:', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

// GET /api/movies/:id/images and /api/movie/:id/images
router.get(['/movies/:id/images', '/movie/:id/images'], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/movie/${id}/images?include_image_language=en,null`,
      { method: 'GET', headers: tmdbHeaders() },
      `Movie Images ${id}`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: 'Failed to fetch movie images' });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movie images', details: err.message });
  }
});

// GET /api/series/:id/images and /api/tv/:id/images
router.get(['/series/:id/images', '/tv/:id/images'], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const resp = await tmdbFetch(
      `https://api.themoviedb.org/3/tv/${id}/images?include_image_language=en,null`,
      { method: 'GET', headers: tmdbHeaders() },
      `Series Images ${id}`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: 'Failed to fetch series images' });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch series images', details: err.message });
  }
});

// GET /api/movies/:id and /api/movie/:id
router.get(['/movies/:id', '/movie/:id'], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { type = 'movie' } = req.query;
    const isSeries = type === 'series' || type === 'tv';
    const mediaType = isSeries ? 'Series' : 'Movie';

    const detailUrl = isSeries
      ? `https://api.themoviedb.org/3/tv/${id}?append_to_response=videos,similar,images&include_image_language=en,null&language=en-US`
      : `https://api.themoviedb.org/3/movie/${id}?append_to_response=videos,similar,images&include_image_language=en,null&language=en-US`;
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
    const { isAdmin, adminMode } = await resolveUserAdminInfo(req);
    const isCurrentSuppressed = shouldSuppressContent(content, adminMode);

    if (isCurrentSuppressed) {
      // If the content itself is suppressed under the viewer's adminMode, hide collection and similar movies
      content.belongs_to_collection = null;
      content.similar = { results: [], total_pages: 0, total_results: 0 };
    } else {
      if (content?.similar?.results && Array.isArray(content.similar.results)) {
        content.similar.results = content.similar.results.filter(item => shouldShow(item, adminMode));
      }

      // Automatically embed TMDB collection parts for franchises (e.g. Spider-Man Collection)
      if (content?.belongs_to_collection?.id) {
        try {
          const colResp = await tmdbFetch(
            `https://api.themoviedb.org/3/collection/${content.belongs_to_collection.id}?language=en-US`,
            { method: 'GET', headers: tmdbHeaders() },
            `Collection ${content.belongs_to_collection.id}`
          );
          if (colResp.ok) {
            const colData = await colResp.json();
            if (colData && Array.isArray(colData.parts)) {
              const hasSuppressedPart = colData.parts.some((part) => shouldSuppressContent(part, adminMode));
              if (hasSuppressedPart) {
                // If any movie in the collection is suppressed for this user, hide collection data and similar movies
                content.belongs_to_collection = null;
                if (content.similar) {
                  content.similar = { results: [], total_pages: 0, total_results: 0 };
                }
              } else {
                content.belongs_to_collection = {
                  ...content.belongs_to_collection,
                  ...colData,
                  parts: colData.parts.filter(item => shouldShow(item, adminMode))
                };
              }
            }
          }
        } catch (colErr) {
          console.warn(`[Content] Failed to enrich belongs_to_collection ${content.belongs_to_collection.id}: ${colErr.message}`);
        }
      }
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
        `https://api.themoviedb.org/3/tv/${id}?append_to_response=videos,similar,images&include_image_language=en,null&language=en-US`,
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
    const { isAdmin, adminMode } = await resolveUserAdminInfo(req);
    const isCurrentSuppressed = shouldSuppressContent(s, adminMode);

    if (isCurrentSuppressed) {
      s.similar = { results: [], total_pages: 0, total_results: 0 };
    } else if (s?.similar?.results && Array.isArray(s.similar.results)) {
      s.similar.results = s.similar.results.filter(item => shouldShow(item, adminMode));
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
      ...s,
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
      genres: Array.isArray(s.genres) && s.genres.length ? s.genres : [{ id: 18, name: 'Drama' }],
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
      certification: certification || 'TV-MA',
      images: s.images || { backdrops: [], posters: [] },
      similar: s.similar || { results: [] },
      videos: s.videos || { results: [] }
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
    let episodes = Array.isArray(season.episodes)
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
      : [];

    // Check if series title was provided in query or fetch TV info to lookup Kartoons match
    let seriesTitle = String(req.query.title || '').trim();
    let seriesYear = Number(req.query.year) || null;

    if (!seriesTitle) {
      try {
        const tvResp = await tmdbFetch(
          `https://api.themoviedb.org/3/tv/${id}?language=en-US`,
          { method: 'GET', headers: tmdbHeaders() },
          `TV Series ${id} Quick Info`
        ).catch(() => null);
        if (tvResp?.ok) {
          const tvData = await tvResp.json().catch(() => null);
          seriesTitle = tvData?.name || tvData?.title || tvData?.original_name || '';
          seriesYear = tvData?.first_air_date ? Number(tvData.first_air_date.slice(0, 4)) : null;
        }
      } catch (err) {}
    }

    if (seriesTitle) {
      try {
        const cleanTitle = seriesTitle
          .replace(/\s*S\d+E\d+.*$/i, '')
          .replace(/\s*Season\s*\d+.*$/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        const searchRes = await fetch(`https://api.kartoons.me/api/shows?search=${encodeURIComponent(cleanTitle)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000)
        }).catch(() => null);

        if (searchRes?.ok) {
          const searchJson = await searchRes.json().catch(() => null);
          const candidates = Array.isArray(searchJson) ? searchJson : (searchJson?.data || []);
          const match = candidates.find((c) => areTitlesPairable(cleanTitle, c.title, seriesYear, c.startYear || c.releaseYear));

          if (match?.slug) {
            let kEpRes = await fetch(`https://api.kartoons.me/api/shows/${encodeURIComponent(match.slug)}/season/season-${seasonNumber}/all-episodes`, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(6000)
            }).catch(() => null);

            let kEpData = kEpRes?.ok ? await kEpRes.json().catch(() => null) : null;
            let rawEps = Array.isArray(kEpData) ? kEpData : (kEpData?.data || kEpData?.episodes || []);

            if (!rawEps.length) {
              const showDetailRes = await fetch(`https://api.kartoons.me/api/shows/${encodeURIComponent(match.slug)}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(5000)
              }).catch(() => null);
              if (showDetailRes?.ok) {
                const sDetail = await showDetailRes.json().catch(() => null);
                const sData = sDetail?.data || sDetail;
                const seasons = Array.isArray(sData?.seasons) ? sData.seasons : [];
                const targetS = seasons.find((s) => Number(s.seasonNumber) === seasonNumber) || seasons.find((s) => Number(s.episodeCount || 0) > 0);
                if (targetS) {
                  const sNum = Number(targetS.seasonNumber) || 1;
                  kEpRes = await fetch(`https://api.kartoons.me/api/shows/${encodeURIComponent(match.slug)}/season/season-${sNum}/all-episodes`, {
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(6000)
                  }).catch(() => null);
                  kEpData = kEpRes?.ok ? await kEpRes.json().catch(() => null) : null;
                  rawEps = Array.isArray(kEpData) ? kEpData : (kEpData?.data || kEpData?.episodes || []);
                }
              }
            }

            if (rawEps.length > 0) {
              episodes = mergeSeasonEpisodesWithKartoons(episodes, rawEps, match.slug, seasonNumber);
            }
          }
        }
      } catch (kErr) {
        console.warn(`[API] Kartoons season merge failed for series ${id}:`, kErr.message);
      }
    }

    res.json({
      id: season.id,
      season_number: season.season_number,
      name: season.name,
      overview: season.overview || '',
      poster_path: season.poster_path,
      air_date: season.air_date,
      episodes
    });
  } catch (err) {
    console.error('Error fetching series season:', err);
    res.status(500).json({ error: 'Failed to fetch season details', details: err.message });
  }
});

// GET /api/person/:id and /api/people/:id
router.get(['/person/:id', '/people/:id'], async (req, res) => {
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

// GET /api/person/:id/credits and /api/people/:id/credits
router.get(['/person/:id/credits', '/people/:id/credits'], async (req, res) => {
  try {
    const personId = req.params.id;
    console.log(`[API] /api/person/${personId}/credits hit`);
    const adminMode = await resolveAdminMode(req);
    const includeAdult = await resolveIncludeAdult(req);

    // Fetch person detail (for imdb_id) + combined credits in parallel
    const [personResp, creditsResp] = await Promise.all([
      tmdbFetch(`https://api.themoviedb.org/3/person/${personId}?language=en-US`, { method: 'GET', headers: tmdbHeaders() }, `Person Detail ${personId}`).catch(() => null),
      tmdbFetch(`https://api.themoviedb.org/3/person/${personId}/combined_credits?language=en-US`, { method: 'GET', headers: tmdbHeaders() }, `Person Credits ${personId}`)
    ]);

    if (!creditsResp || !creditsResp.ok) {
      return res.status(404).json({ error: 'Person credits not found' });
    }

    const personDetail = personResp?.ok ? await personResp.json() : {};
    const imdbPersonId = String(personDetail?.imdb_id || '').trim();
    const payload = await creditsResp.json();

    const filterCredits = (items = []) =>
      (Array.isArray(items) ? items : []).filter((item) => {
        if (item?.media_type !== 'movie' && item?.media_type !== 'tv') return false;
        if (!shouldShow(item, adminMode)) return false;
        const votes = Number(item?.vote_count || 0);
        if (votes <= 0 && !item?.imdb_id) return false;
        const releaseDate = String(item?.release_date || item?.first_air_date || '').trim();
        return Boolean(releaseDate);
      });

    const cast = filterCredits(payload.cast);
    const crew = filterCredits(payload.crew);

    const wantsNdjson = req.headers['content-type']?.includes('ndjson') || req.headers.accept?.includes('ndjson') || req.query.stream === '1' || true;

    if (wantsNdjson) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      const write = (obj) => {
        if (!clientClosed && !res.writableEnded) res.write(JSON.stringify(obj) + '\n');
      };

      // 1. Send initial credits immediately for instant UI render
      write({ type: 'credits', cast, crew });

      const eligible = [...cast, ...crew].filter((item) => item?.id && (item?.media_type === 'movie' || item?.media_type === 'tv'));
      const seen = new Set();
      const unique = eligible.filter((item) => {
        const key = `${item.media_type === 'tv' ? 'Series' : 'Movie'}:${Number(item.id)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (!unique.length) {
        write({ type: 'done' });
        return res.end();
      }

      // 2. Start IMDB scrape in-process directly using Playwright (NO microservice HTTP latency!)
      const imdbScrapePromise = imdbPersonId
        ? (async () => {
            try {
              const { scrapeImdbFilmography } = require('../util/imdbScraper');
              const filmography = await scrapeImdbFilmography(imdbPersonId);
              const imdbMap = new Map();
              if (Array.isArray(filmography)) {
                filmography.forEach((entry) => {
                  const normTitle = String(entry.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                  const year = Number(entry.year) || 0;
                  if (normTitle && year) {
                    imdbMap.set(`${normTitle}_${year}`, entry);
                    imdbMap.set(`${normTitle}_${year - 1}`, entry);
                    imdbMap.set(`${normTitle}_${year + 1}`, entry);
                  }
                });
              }
              return imdbMap;
            } catch (err) {
              console.warn('[PersonCredits] IMDB filmography scrape error:', err.message);
              return new Map();
            }
          })()
        : Promise.resolve(new Map());

      // 3. Check DB ratings cache
      const db = getDb();
      const tmdbIds = unique.map((item) => Number(item.id));
      const cachedRecords = await db.collection(RATINGS_COLLECTION).find({ tmdbID: { $in: tmdbIds } }).toArray().catch(() => []);
      const cacheMap = new Map();
      for (const record of cachedRecords) {
        cacheMap.set(`${record.mediaType}:${record.tmdbID}`, record);
      }

      const cachedResults = [];
      const needsFetch = [];
      for (const item of unique) {
        const key = `${item.media_type === 'tv' ? 'Series' : 'Movie'}:${Number(item.id)}`;
        const record = cacheMap.get(key);
        if (record && record.imdb_rating && record.imdb_rating > 0 && record.imdb_rating !== 10.0) {
          cachedResults.push({
            tmdbID: Number(item.id),
            mediaType: item.media_type === 'tv' ? 'Series' : 'Movie',
            imdb_id: String(record.imdbID || item.imdb_id || '').trim(),
            imdb_rating: record.imdb_rating,
            vote_average: record.vote_average ?? item.vote_average ?? null,
            rating_lookup_attempted: true
          });
        } else {
          needsFetch.push(item);
        }
      }

      if (cachedResults.length) {
        write({ type: 'ratings', items: cachedResults });
      }

      // 4. Await IMDB filmography scrape & match
      const imdbMap = await imdbScrapePromise;
      const imdbMatched = [];
      const stillNeedsFetch = [];

      for (const item of needsFetch) {
        const title = item.title || item.name || '';
        const normTitle = String(title).toLowerCase().replace(/[^a-z0-9]/g, '');
        const year = Number(String(item.release_date || item.first_air_date || '').slice(0, 4)) || 0;
        const match = imdbMap.get(`${normTitle}_${year}`);
        if (match && match.imdb_rating) {
          imdbMatched.push({ item, match });
        } else {
          stillNeedsFetch.push(item);
        }
      }

      if (imdbMatched.length) {
        const imdbResults = [];
        for (const { item, match } of imdbMatched) {
          const tmdbID = Number(item.id);
          const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
          const imdbRating = Number(match.imdb_rating) || null;
          const voteAverage = Number(item.vote_average) || null;
          const imdbId = match.imdb_id || '';
          const doc = {
            tmdbID,
            mediaType,
            imdbID: imdbId,
            imdb_rating: imdbRating || 10.0,
            vote_average: voteAverage,
            lookup_attempted: true,
            source: 'imdb_scrape',
            updatedAt: new Date()
          };
          db.collection(RATINGS_COLLECTION).updateOne({ tmdbID, mediaType }, { $set: doc, $setOnInsert: { createdAt: new Date() } }, { upsert: true }).catch(() => {});
          imdbResults.push({ tmdbID, mediaType, imdb_id: imdbId, imdb_rating: imdbRating, vote_average: voteAverage, rating_lookup_attempted: true });
        }
        write({ type: 'ratings', items: imdbResults });
      }

      // 5. Fallback for remaining using OMDB in batches of 6
      if (stillNeedsFetch.length) {
        const batchSize = 6;
        for (let i = 0; i < stillNeedsFetch.length && !clientClosed; i += batchSize) {
          const batch = stillNeedsFetch.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (item) => {
              const tmdbID = Number(item.id);
              const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
              try {
                const resolved = await resolveImdbRating(tmdbID, mediaType).catch(() => null);
                return resolved ? {
                  tmdbID,
                  mediaType,
                  imdb_id: resolved.imdbID || '',
                  imdb_rating: resolved.imdb_rating && resolved.imdb_rating !== 10.0 ? resolved.imdb_rating : null,
                  vote_average: resolved.vote_average ?? null,
                  rating_lookup_attempted: true
                } : null;
              } catch {
                return null;
              }
            })
          );
          const validResults = batchResults.filter(Boolean);
          if (validResults.length && !clientClosed) {
            write({ type: 'ratings', items: validResults });
          }
        }
      }

      write({ type: 'done' });
      return res.end();
    } else {
      payload.cast = await attachCachedRatings(cast);
      payload.crew = await attachCachedRatings(crew);
      res.json(payload);
    }
  } catch (err) {
    console.error('Error fetching person credits:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch person credits', details: err.message });
    } else {
      res.end();
    }
  }
});

let trendingCacheAdult = null;
let trendingCacheAdultTime = 0;

// GET /api/trending
router.get('/trending', trendingLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;
    const page = parseInt(req.query.page) || 1;
    console.log(`[API] /api/trending hit limit=${limit} page=${page}`);
    const now = Date.now();
    const adminMode = await resolveAdminMode(req);

    const filterTrending = (movies = []) => movies.filter(m => shouldShow(m, adminMode));

    if (page === 1) {
      if (adminMode === 2) {
        if (trendingCacheAdult && trendingCacheAdult.length >= limit) {
          const isStale = now - trendingCacheAdultTime > CACHE_DURATION;
          if (isStale && !global.trendingAdultRevalidating) {
            global.trendingAdultRevalidating = true;
            setTimeout(() => refreshTrendingCache(limit, 2), 0);
          }
          return res.json({ movies: trendingCacheAdult.slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
        }
        const mongoData = await getMongoCache('trending_mode_2_page_1');
        if (mongoData && mongoData.length >= limit) {
          trendingCacheAdult = mongoData;
          trendingCacheAdultTime = now;
          return res.json({ movies: mongoData.slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
        }
      } else {
        if (trendingCache && trendingCache.length >= limit) {
          const isStale = now - trendingCacheTime > CACHE_DURATION;
          if (isStale && !global.trendingRevalidating) {
            global.trendingRevalidating = true;
            setTimeout(() => refreshTrendingCache(limit, 0), 0);
          }
          return res.json({ movies: filterTrending(trendingCache).slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
        }
        const mongoData = await getMongoCache('trending_mode_0_page_1');
        if (mongoData && mongoData.length >= limit) {
          trendingCache = mongoData;
          trendingCacheTime = now;
          return res.json({ movies: filterTrending(mongoData).slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
        }
      }
    }

    const opts = { method: 'GET', headers: tmdbHeaders() };
    const fetchWithDeadline = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Trending request timed out')), 7000))
      ]);
      
    const TMDB_PAGES_PER_BATCH = limit > 20 ? 2 : 1;
    const startTmdbPage = (page - 1) * TMDB_PAGES_PER_BATCH + 1;
    const endTmdbPage = startTmdbPage + TMDB_PAGES_PER_BATCH - 1;

    let all = [];
    let totalPages = 1;

    for (let tmdbP = startTmdbPage; tmdbP <= endTmdbPage; tmdbP++) {
      if (adminMode === 2) {
        const movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${tmdbP}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
        const tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${tmdbP}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;

        const [movieResult, tvResult] = await Promise.allSettled([
          fetchWithDeadline(tmdbFetch(movieUrl, opts, `Trending Movies P${tmdbP}`)),
          fetchWithDeadline(tmdbFetch(tvUrl, opts, `Trending TV P${tmdbP}`))
        ]);

        const movieResp = movieResult.status === 'fulfilled' ? movieResult.value : null;
        const tvResp = tvResult.status === 'fulfilled' ? tvResult.value : null;

        const movieData = movieResp?.ok ? await movieResp.json() : { results: [], total_pages: 1 };
        const tvData = tvResp?.ok ? await tvResp.json() : { results: [], total_pages: 1 };
        totalPages = Math.max(totalPages, Number(movieData.total_pages) || 0, Number(tvData.total_pages) || 0);

        const movieItems = (movieData.results || []).map(i => ({
          ...i,
          media_type: 'Movie',
          adult: true,
          _isAdultDiscover: true
        }));
        const tvItems = (tvData.results || []).map(i => ({
          ...i,
          media_type: 'Series',
          adult: true,
          _isAdultDiscover: true
        }));
        all.push(...movieItems, ...tvItems);
      } else {
        const trendingUrl = `https://api.themoviedb.org/3/trending/all/day?language=en-US&page=${tmdbP}`;
        const trendingResp = await fetchWithDeadline(tmdbFetch(trendingUrl, opts, `Trending All P${tmdbP}`)).catch(() => null);
        if (trendingResp?.ok) {
          const data = await trendingResp.json().catch(() => ({ results: [], total_pages: 1 }));
          totalPages = Math.max(totalPages, Number(data.total_pages) || 1);
          const pItems = (data.results || []).map(i => ({
            ...i,
            media_type: (i.media_type === 'tv' || i.media_type === 'series') ? 'Series' : 'Movie'
          }));
          all.push(...pItems);
        }
      }
    }

    let finalItems = [];
    if (adminMode === 2) {
      all.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    for (const item of all) {
      if (!finalItems.some(existing => existing.id === item.id)) {
        finalItems.push(item);
      }
    }

    if (!finalItems.length) {
      const fallbackCache = adminMode === 2 ? trendingCacheAdult : trendingCache;
      if (page === 1 && fallbackCache?.length) {
        console.log('[API] /api/trending using stale cache fallback');
        return res.json({ movies: filterTrending(fallbackCache).slice(0, limit), pagination: { page: 1, limit, pages: 500 } });
      }
      return res.json({ movies: [], pagination: { page, limit, pages: 1 } });
    }

    if (page === 1) {
      if (adminMode === 2) {
        trendingCacheAdult = finalItems;
        trendingCacheAdultTime = now;
        await setMongoCache('trending_mode_2_page_1', finalItems, CACHE_DURATION);
      } else {
        trendingCache = finalItems;
        trendingCacheTime = now;
        await setMongoCache('trending_mode_0_page_1', finalItems, CACHE_DURATION);
      }
    }
    
    const safeTotalPages = Math.max(
      totalPages > 1 ? totalPages : 500,
      finalItems.length >= limit ? page + 10 : (finalItems.length > 0 ? page + 1 : page)
    );
    const filtered = filterTrending(finalItems);
    console.log(`[API] /api/trending success count=${filtered.length} mode=${adminMode}`);
    res.json({ movies: filtered.slice(0, limit), pagination: { page, limit, pages: safeTotalPages } });
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.status(500).json({ error: 'Failed to fetch trending content' });
  }
});

// GET /api/popular
router.get('/popular', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const adminMode = await resolveAdminMode(req);
    const opts = { method: 'GET', headers: tmdbHeaders() };
    const today = new Date().toISOString().split('T')[0];

    const targetCount = page === 1 ? Math.max(limit, 14) : limit;
    let finalItems = [];
    let currentTmdbPage = page;
    let totalPages = 1;
    let totalResults = 0;
    let attempts = 0;

    while (finalItems.length < targetCount && attempts < 5) {
      attempts++;
      let popUrl;
      if (adminMode === 2) {
        popUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentTmdbPage}&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc&primary_release_date.lte=${today}`;
      } else {
        popUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${currentTmdbPage}&include_adult=false&sort_by=popularity.desc&primary_release_date.lte=${today}`;
      }

      const popResp = await tmdbFetch(popUrl, opts, `Popular Movies P${currentTmdbPage}`).catch(() => null);
      if (!popResp?.ok) break;
      const popData = await popResp.json();
      totalPages = Math.max(Number(popData.total_pages) || 0, totalPages);
      totalResults = Math.max(Number(popData.total_results) || 0, totalResults);

      let pItems = (popData.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        ...(adminMode === 2 ? { adult: true, _isAdultDiscover: true } : {})
      }));
      pItems = pItems.filter(item => !isAnimeContent(item));
      pItems = pItems.filter(item => shouldShow(item, adminMode));

      for (const item of pItems) {
        if (!finalItems.some(existing => existing.id === item.id)) {
          finalItems.push(item);
        }
      }

      if (currentTmdbPage >= totalPages || (popData.results || []).length === 0) break;
      currentTmdbPage++;
    }

    finalItems = await attachCachedRatings(finalItems);
    const safeTotalPages = Math.max(totalPages > 1 ? totalPages : 500, page + 10);

    res.json({
      movies: finalItems.slice(0, targetCount),
      pagination: {
        page,
        limit,
        total: Math.max(totalResults, safeTotalPages * limit),
        pages: safeTotalPages
      }
    });
  } catch (err) {
    console.error('Error fetching popular:', err);
    res.status(500).json({ error: 'Failed to fetch popular content' });
  }
});

let genresCache = null;
let genresCacheTime = 0;
const GENRES_CACHE_DURATION = 24 * 60 * 60 * 1000;

async function fetchCombinedGenres() {
  const [mResp, tvResp] = await Promise.all([
    tmdbFetch('https://api.themoviedb.org/3/genre/movie/list?language=en-US', { method: 'GET', headers: tmdbHeaders() }, 'Genres Bg Movie').catch(() => null),
    tmdbFetch('https://api.themoviedb.org/3/genre/tv/list?language=en-US', { method: 'GET', headers: tmdbHeaders() }, 'Genres Bg TV').catch(() => null)
  ]);
  const mData = mResp?.ok ? await mResp.json().catch(() => null) : null;
  const tvData = tvResp?.ok ? await tvResp.json().catch(() => null) : null;
  const seen = new Set();
  const merged = [];
  for (const g of [...(mData?.genres || []), ...(tvData?.genres || [])]) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    if (isHiddenGenre(g)) continue;
    merged.push({ id: g.id, name: g.name });
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshGenresCache() {
  try {
    const finalData = await fetchCombinedGenres();
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

    const finalData = await fetchCombinedGenres();
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
let homeCacheAdult = null;
let homeCacheAdultTime = 0;
const HOME_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const HOME_CATEGORY_LIMIT = 20; // movies per genre shelf
const HOME_PRELOAD_GENRES = 8;  // how many genre shelves to pre-bake

function filterHomePayload(payload, adminMode) {
  if (!payload) return payload;
  const filteredCategories = {};
  for (const [gid, movies] of Object.entries(payload.categories || {})) {
    filteredCategories[gid] = (movies || []).filter(m => shouldShow(m, adminMode));
  }
  const filteredTrending = (payload.trending || []).filter(m => shouldShow(m, adminMode));
  const filteredPopular = (payload.popular || []).filter(m => shouldShow(m, adminMode));
  return {
    ...payload,
    trending: filteredTrending,
    popular: filteredPopular,
    categories: filteredCategories
  };
}

async function buildHomePayload(adminMode = 0) {
  const opts = { method: 'GET', headers: tmdbHeaders() };

  // 1. Trending
  let trending = [];
  try {
    const fetchWithDeadline = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000))]);

    if (adminMode === 2) {
      const movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
      const tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;

      const [movieResult, tvResult] = await Promise.allSettled([
        fetchWithDeadline(tmdbFetch(movieUrl, opts, 'Home Trending Adult Movies')),
        fetchWithDeadline(tmdbFetch(tvUrl, opts, 'Home Trending Adult TV'))
      ]);
      const movieData = movieResult.status === 'fulfilled' && movieResult.value?.ok ? await movieResult.value.json() : { results: [] };
      const tvData = tvResult.status === 'fulfilled' && tvResult.value?.ok ? await tvResult.value.json() : { results: [] };

      const mItems = (movieData.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        adult: true,
        _isAdultDiscover: true
      }));
      const tItems = (tvData.results || []).map(i => ({
        ...i,
        media_type: 'Series',
        adult: true,
        _isAdultDiscover: true
      }));

      const all = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      trending = all.slice(0, 18);
    } else {
      const trendingUrl = 'https://api.themoviedb.org/3/trending/all/day?language=en-US&page=1';
      const trendingResp = await fetchWithDeadline(tmdbFetch(trendingUrl, opts, 'Home Trending All')).catch(() => null);
      if (trendingResp?.ok) {
        const data = await trendingResp.json();
        const all = (data.results || []).map(i => ({
          ...i,
          media_type: (i.media_type === 'tv' || i.media_type === 'series') ? 'Series' : 'Movie'
        }));
        trending = all.slice(0, 18);
      }
    }

    if (trending.length) {
      if (adminMode === 2) {
        trendingCacheAdult = trending;
        trendingCacheAdultTime = Date.now();
      } else {
        trendingCache = trending;
        trendingCacheTime = Date.now();
      }
    }
  } catch (e) { console.warn('[Home] Trending fetch failed:', e.message); }

  // 2. Popular Movies
  let popular = [];
  try {
    const fetchWithDeadline = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000))]);
    const today = new Date().toISOString().split('T')[0];
    const popUrl = adminMode === 2
      ? `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc&primary_release_date.lte=${today}`
      : `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=false&sort_by=popularity.desc&primary_release_date.lte=${today}`;

    const popResp = await fetchWithDeadline(tmdbFetch(popUrl, opts, 'Home Popular Movies')).catch(() => null);
    if (popResp?.ok) {
      const popData = await popResp.json();
      let pItems = (popData.results || []).map(i => ({
        ...i,
        media_type: 'Movie',
        ...(adminMode === 2 ? { adult: true, _isAdultDiscover: true } : {})
      }));
      pItems = pItems.filter(item => !isAnimeContent(item));
      pItems = pItems.filter(item => shouldShow(item, adminMode));
      pItems = await attachCachedRatings(pItems);
      popular = pItems.slice(0, 18);
    }
  } catch (e) {
    console.warn('[Home] Popular fetch failed:', e.message);
  }

  // 3. Genres
  let genres = [];
  if (genresCache && genresCache.length) {
    genres = genresCache;
  } else {
    try {
      const merged = await fetchCombinedGenres();
      if (merged.length) {
        genres = merged;
        genresCache = genres;
        genresCacheTime = Date.now();
      }
    } catch (e) { console.warn('[Home] Genres fetch failed:', e.message); }
  }

  // 4. First N genre shelves
  const targetGenres = [{ id: "bollywood", name: "Latest in India" }, ...genres.filter(g => !isHiddenGenre(g)).slice(0, HOME_PRELOAD_GENRES - 1)];
  const categories = {};

  const fetchGenreMovies = async (genre) => {
    try {
      let finalItems = [];
      let pageNum = 1;
      const maxPages = adminMode === 2 ? 4 : 3;
      const isBollywood = String(genre?.id).toLowerCase() === 'bollywood';

      while (finalItems.length < 14 && pageNum <= maxPages) {
        let movieUrl = null;
        let tvUrl = null;
        if (adminMode === 2) {
          if (isBollywood) {
            const { gteDate, lteDate } = getFourMonthWindow(0);
            movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${pageNum}&include_adult=true${ADULT_KEYWORDS}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
            tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${pageNum}&include_adult=true${ADULT_KEYWORDS}&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
          } else {
            const movieGid = mapTvGenreToMovieGenre(genre.id);
            const tvGid = mapMovieGenreToTvGenre(genre.id);
            if (movieGid) movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${pageNum}&include_adult=true${ADULT_KEYWORDS}&with_genres=${movieGid}&sort_by=popularity.desc`;
            if (tvGid) tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${pageNum}&include_adult=true${ADULT_KEYWORDS}&with_genres=${tvGid}&sort_by=popularity.desc`;
          }
        } else {
          const strictRatingFilter = '&certification_country=US&certification.lte=R&vote_average.gte=0.1&vote_count.gte=5';
          if (isBollywood) {
            const { gteDate, lteDate } = getFourMonthWindow(0);
            movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${pageNum}&include_adult=false&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&primary_release_date.gte=${gteDate}&primary_release_date.lte=${lteDate}&sort_by=popularity.desc`;
            tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${pageNum}&include_adult=false&with_origin_country=IN&with_original_language=hi|ta|te|ml|kn|bn|mr|pa&first_air_date.gte=${gteDate}&first_air_date.lte=${lteDate}&sort_by=popularity.desc`;
          } else {
            const movieGid = mapTvGenreToMovieGenre(genre.id);
            const tvGid = mapMovieGenreToTvGenre(genre.id);
            if (movieGid) movieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=${pageNum}&include_adult=false${strictRatingFilter}&sort_by=popularity.desc&with_genres=${movieGid}`;
            if (tvGid) tvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=${pageNum}&include_adult=false&vote_count.gte=5&sort_by=popularity.desc&with_genres=${tvGid}`;
          }
        }

        const [movieResp, tvResp] = await Promise.all([
          movieUrl ? tmdbFetch(movieUrl, opts, `Home Genre ${genre.name} Movie P${pageNum}`).catch(() => null) : null,
          tvUrl ? tmdbFetch(tvUrl, opts, `Home Genre ${genre.name} TV P${pageNum}`).catch(() => null) : null
        ]);

        if (!movieResp?.ok && !tvResp?.ok) break;

        const movieData = movieResp?.ok ? await movieResp.json() : null;
        const tvData = tvResp?.ok ? await tvResp.json() : null;

        let mItems = (movieData?.results || []).map(i => ({
          ...i,
          media_type: 'Movie',
          ...(isBollywood ? { is_bollywood_endpoint: true } : {}),
          ...(adminMode === 2 ? { adult: true, _isAdultDiscover: true } : {})
        }));
        let tItems = (tvData?.results || []).map(i => ({
          ...i,
          media_type: 'Series',
          ...(isBollywood ? { is_bollywood_endpoint: true } : {})
        }));

        if (adminMode !== 2) {
          mItems = (await attachImdbIds(mItems, 'Movie')).filter((item) => String(item?.imdb_id || '').trim());
          tItems = (await attachImdbIds(tItems, 'Series')).filter((item) => String(item?.imdb_id || '').trim());
          if (String(genre.id) !== '16') {
            mItems = mItems.filter(item => !isAnimeContent(item));
            tItems = tItems.filter(item => !isAnimeContent(item));
          }
          mItems = mItems.filter(item => shouldShow(item, adminMode));
          tItems = tItems.filter(item => shouldShow(item, adminMode));
        }

        let combined = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        for (const item of combined) {
          if (!finalItems.some(x => x.id === item.id)) {
            finalItems.push(item);
          }
        }

        const maxTotalP = Math.max(Number(movieData?.total_pages) || 1, Number(tvData?.total_pages) || 1);
        if (pageNum >= maxTotalP || (mItems.length === 0 && tItems.length === 0)) break;
        pageNum++;
      }

      if (adminMode === 2 && finalItems.length < 14) {
        const supMovieUrl = `https://api.themoviedb.org/3/discover/movie?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
        const supTvUrl = `https://api.themoviedb.org/3/discover/tv?language=en-US&page=1&include_adult=true${ADULT_KEYWORDS}&sort_by=popularity.desc`;
        const [supMovieResp, supTvResp] = await Promise.all([
          tmdbFetch(supMovieUrl, opts, `Home Adult Sup Movie ${genre.name}`).catch(() => null),
          tmdbFetch(supTvUrl, opts, `Home Adult Sup TV ${genre.name}`).catch(() => null)
        ]);
        const supMovieData = supMovieResp?.ok ? await supMovieResp.json() : null;
        const supTvData = supTvResp?.ok ? await supTvResp.json() : null;
        const supItems = [
          ...(supMovieData?.results || []).map(i => ({ ...i, media_type: 'Movie', adult: true, _isAdultDiscover: true })),
          ...(supTvData?.results || []).map(i => ({ ...i, media_type: 'Series', adult: true, _isAdultDiscover: true }))
        ];
        for (const item of supItems) {
          if (finalItems.length >= 14) break;
          if (!finalItems.some(x => x.id === item.id)) {
            finalItems.push(item);
          }
        }
      }

      finalItems = await attachCachedRatings(finalItems);

      const isKids = String(genre?.id) === '10762' || String(genre?.name || '').toLowerCase() === 'kids';
      const isAnimation = String(genre?.id) === '16' || String(genre?.name || '').toLowerCase() === 'animation';
      if (isKids || isAnimation) {
        const category = isKids ? 'Cartoon' : 'Anime';
        const kItems = await fetchKartoonsGenreItems(category, 1);
        finalItems = mergeKartoonsIntoItems(finalItems, kItems);
      }

      finalItems = finalItems.slice(0, HOME_CATEGORY_LIMIT);
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

  return { trending, popular, genres: [{ id: 'bollywood', name: 'Latest in India' }, ...genres.filter(g => !isHiddenGenre(g))], categories };
}

async function refreshHomeCache(adminMode = 0) {
  try {
    const payload = await buildHomePayload(adminMode);
    if (payload.trending.length || Object.keys(payload.categories).length) {
      if (adminMode === 2) {
        homeCacheAdult = payload;
        homeCacheAdultTime = Date.now();
        await setMongoCache('home_mode_2', payload, HOME_CACHE_DURATION);
      } else {
        homeCache = payload;
        homeCacheTime = Date.now();
        await setMongoCache('home_mode_0', payload, HOME_CACHE_DURATION);
      }
      console.log(`[API] /api/home revalidated mode=${adminMode}: trending=${payload.trending.length} categories=${Object.keys(payload.categories).length}`);
    }
  } catch (e) {
    console.error(`[API] /api/home background refresh failed mode=${adminMode}:`, e.message);
  } finally {
    if (adminMode === 2) global.homeAdultRevalidating = false;
    else global.homeRevalidating = false;
  }
}

// GET /api/home
router.get('/home', async (req, res) => {
  try {
    const adminMode = await resolveAdminMode(req);
    const now = Date.now();
    const isAdultMode = adminMode === 2;

    const inMemCache = isAdultMode ? homeCacheAdult : homeCache;
    const inMemTime = isAdultMode ? homeCacheAdultTime : homeCacheTime;

    if (inMemCache) {
      const isStale = now - inMemTime > HOME_CACHE_DURATION;
      const isRevalidating = isAdultMode ? global.homeAdultRevalidating : global.homeRevalidating;
      if (isStale && !isRevalidating) {
        if (isAdultMode) global.homeAdultRevalidating = true;
        else global.homeRevalidating = true;
        setTimeout(() => refreshHomeCache(adminMode), 0);
      }
      return res.json(filterHomePayload(inMemCache, adminMode));
    }

    const mongoKey = isAdultMode ? 'home_mode_2' : 'home_mode_0';
    const mongoData = await getMongoCache(mongoKey);
    if (mongoData) {
      if (isAdultMode) {
        homeCacheAdult = mongoData;
        homeCacheAdultTime = now;
      } else {
        homeCache = mongoData;
        homeCacheTime = now;
      }
      return res.json(filterHomePayload(mongoData, adminMode));
    }

    const payload = await buildHomePayload(adminMode);
    if (payload.trending.length || Object.keys(payload.categories).length) {
      if (isAdultMode) {
        homeCacheAdult = payload;
        homeCacheAdultTime = now;
      } else {
        homeCache = payload;
        homeCacheTime = now;
      }
      await setMongoCache(mongoKey, payload, HOME_CACHE_DURATION);
    }
    res.json(filterHomePayload(payload, adminMode));
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
      items.push({ tmdbID, mediaType, imdb_id: rawItem?.imdb_id, vote_average: rawItem?.vote_average });
    }

    if (!items.length) {
      return res.status(400).json({ error: 'No valid items to enrich' });
    }

    // Always stream back NDJSON so frontend gets items one-by-one
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientClosed = false;
    req.on('close', () => { clientClosed = true; });

    const writeEvent = (payload) => {
      if (!clientClosed && !res.writableEnded) res.write(JSON.stringify(payload) + '\n');
    };

    const CONCURRENCY = 6;
    let nextIndex = 0;
    let resolvedCount = 0;

    const worker = async () => {
      while (!clientClosed) {
        const index = nextIndex++;
        if (index >= items.length) return;
        const item = items[index];
        try {
          const rating = await resolveImdbRating(item.tmdbID, item.mediaType).catch(() => null);
          resolvedCount++;
          if (rating && !clientClosed) {
            writeEvent({
              type: 'item',
              item: {
                tmdbID: rating.tmdbID,
                mediaType: rating.mediaType,
                imdbID: rating.imdbID || '',
                imdb_rating: rating.imdb_rating && rating.imdb_rating !== 10.0 ? rating.imdb_rating : null,
                vote_average: rating.vote_average ?? null,
                lookup_attempted: true
              },
              resolved: resolvedCount,
              total: items.length
            });
          }
        } catch (err) {
          resolvedCount++;
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
    await Promise.all(workers);

    writeEvent({ type: 'done', total: items.length, resolved: resolvedCount });
    res.end();
  } catch (err) {
    console.error('Error enriching IMDB ratings:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to enrich IMDB ratings' });
    } else {
      res.end();
    }
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

      const responseData = { query: q, results, page: Number(req.query.page) || 1, hasMore: false };
      lastSearchResults.set(requestId, { data: responseData, timestamp: Date.now() });
      searchRequests.delete(requestId);
      return res.json(responseData);
    }
    const yearMatch = base_query.match(/\b(19\d{2}|20\d{2})\b/);
    const year_query = yearMatch ? yearMatch[1] : null;
    const altered_query = year_query ? base_query.replace(year_query, '').replace(/\s+/g, ' ').trim() : base_query;
    const hasYear = Boolean(year_query);

    const headers = tmdbHeaders();
    const adminMode = await resolveAdminMode(req);
    const allowMissingImdb = true;
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
      const batchPage = Math.max(Number(req.query.page) || 1, 1);
      const PAGES_PER_BATCH = 2;
      const startTmdbPage = (batchPage - 1) * PAGES_PER_BATCH + 1;
      const endTmdbPage = startTmdbPage + PAGES_PER_BATCH - 1;
      let maxTmdbPagesFound = 1;

      const isContentAdultSafe = (item) => {
        if (adminMode === 0) {
          return item?.adult !== true && !item?._isAdultDiscover;
        }
        return shouldShow(item, adminMode);
      };

      const isTitleMatchOrAboveScore = (item, qStr, baseScore) => {
        const t1 = (item.title || item.name || '').toLowerCase();
        const t2 = (item.originalTitle || item.original_name || '').toLowerCase();
        const qLower = (qStr || '').toLowerCase().trim();
        if (qLower && (t1.startsWith(qLower) || t2.startsWith(qLower) || t1 === qLower || t2 === qLower)) {
          return true;
        }
        return baseScore > 25;
      };

      const normalizeChunk = (items, mediaType, batchNum = 1) => {
        return (Array.isArray(items) ? items : [])
          .filter(item => item?.id && (mediaType === 'person' || isContentAdultSafe(item)))
          .map(item => {
            if (mediaType === 'person') {
              return {
                ...normalizePerson(item, adminMode),
                batch: batchNum,
                _isIndian: isIndianPerson(item),
                _popularity: Number(item?.popularity || 0)
              };
            }
            const normalized = normalize(item, mediaType);
            const rawScore = computeFinalScore(normalized, hasYear ? altered_query : q, year_query);
            const batchPenalty = (Number(batchNum) - 1) * 1000;
            return {
              ...normalized,
              batch: batchNum,
              _rawScore: rawScore,
              score: rawScore - batchPenalty,
              isIndian: INDIAN_LANGS.has(normalized.originalLanguage) || normalized.originCountry.includes('IN')
            };
          })
          .filter(item => mediaType === 'person' || isTitleMatchOrAboveScore(item, q, item._rawScore ?? item.score))
          .sort((a, b) => {
            if (mediaType === 'person') {
              if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
              const aHasPhoto = Boolean(a.profile_path || a.poster_path);
              const bHasPhoto = Boolean(b.profile_path || b.poster_path);
              if (aHasPhoto !== bHasPhoto) return aHasPhoto ? -1 : 1;
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
          .map(({ _isIndian, _popularity, _rawScore, ...item }) => item);
      };
      const fetchPage = async (tmdbType, query, page, year = null, batchNum = 1) => {
        if (clientClosed) return;
        const shouldIncludeAdult = tmdbType === 'person' ? true : (adminMode !== 0);
        const yearParam = year ? (tmdbType === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?query=${encodeURIComponent(query)}&include_adult=${shouldIncludeAdult ? 'true' : 'false'}&language=en-US&page=${page}${yearParam}`;
        try {
          const response = await tmdbFetch(url, { headers }, `TMDB stream ${tmdbType} "${query}" p${page}`);
          const data = response.ok ? await response.json() : { results: [] };
          if (data?.total_pages && data.total_pages > maxTmdbPagesFound) {
            maxTmdbPagesFound = data.total_pages;
          }
          const items = normalizeChunk(data.results, tmdbType, batchNum)
            .filter(item => {
              const key = `${item.media_type}:${item.id}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, maxResults);
          if (items.length) {
            writeEvent({
              type: 'results',
              query: q,
              page: batchNum,
              tmdbPage: page,
              source: tmdbType,
              results: items,
              total_pages: data?.total_pages || 1
            });
          }
        } catch {
          writeEvent({ type: 'page-error', query: q, page: batchNum, tmdbPage: page, source: tmdbType });
        }
      };

      writeEvent({ type: 'start', query: q, page: batchPage });
      if (type === 'content' || type === 'all') {
        for (let tmdbP = startTmdbPage; tmdbP <= endTmdbPage; tmdbP++) {
          if (clientClosed) break;
          await Promise.all([
            fetchPage('movie', base_query, tmdbP, null, batchPage),
            fetchPage('tv', base_query, tmdbP, null, batchPage)
          ]);
        }
        if (hasYear && altered_query.length >= 2 && batchPage === 1) {
          await Promise.all([
            fetchPage('movie', altered_query, 1, year_query, batchPage),
            fetchPage('tv', altered_query, 1, year_query, batchPage)
          ]);
        }
      }
      if (type === 'cast' || type === 'all') {
        for (let tmdbP = startTmdbPage; tmdbP <= endTmdbPage; tmdbP++) {
          if (clientClosed) break;
          await fetchPage('person', base_query, tmdbP, null, batchPage);
        }
      }
      const hasMore = endTmdbPage < maxTmdbPagesFound;
      writeEvent({ type: 'done', query: q, page: batchPage, hasMore });
      return res.end();
    }

    const batchPage = Math.max(Number(req.query.page) || 1, 1);
    const PAGES_PER_BATCH = 2;
    const startTmdbPage = (batchPage - 1) * PAGES_PER_BATCH + 1;
    const endTmdbPage = startTmdbPage + PAGES_PER_BATCH - 1;
    let maxTmdbPagesFound = 1;

    const queuePages = (type, query, startPage, endPage, year = null) => {
      for (let page = startPage; page <= endPage; page++) {
        const shouldIncludeAdult = type === 'person' ? true : (adminMode !== 0);
        const yearParam = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
        const url = `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(query)}&include_adult=${shouldIncludeAdult ? 'true' : 'false'}&language=en-US&page=${page}${yearParam}`;
        promises.push(
          tmdbFetch(url, { headers }, `TMDB ${type} "${query}" p${page}`)
            .then(r => r.ok ? r.json() : { results: [] })
            .then(data => {
              if (data?.total_pages && data.total_pages > maxTmdbPagesFound) {
                maxTmdbPagesFound = data.total_pages;
              }
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
      queuePages('movie', base_query, startTmdbPage, endTmdbPage);
      queuePages('tv', base_query, startTmdbPage, endTmdbPage);
      if (hasYear && altered_query.length >= 2 && batchPage === 1) {
        queuePages('movie', altered_query, 1, 1, year_query);
        queuePages('tv', altered_query, 1, 1, year_query);
      }
    }

    if (type === 'cast' || type === 'all') {
      queuePages('person', base_query, startTmdbPage, endTmdbPage);
    }

    await Promise.all(promises);

    let results = [];
    if (type === 'content' || type === 'all') {
      const isContentAdultSafe = (item) => {
        if (adminMode === 0) {
          return item?.adult !== true && !item?._isAdultDiscover;
        }
        return shouldShow(item, adminMode);
      };

      const isTitleMatchOrAboveScore = (item, qStr, baseScore) => {
        const t1 = (item.title || item.name || '').toLowerCase();
        const t2 = (item.originalTitle || item.original_name || '').toLowerCase();
        const qLower = (qStr || '').toLowerCase().trim();
        if (qLower && (t1.startsWith(qLower) || t2.startsWith(qLower) || t1 === qLower || t2 === qLower)) {
          return true;
        }
        return baseScore > 25;
      };

      const batchPenalty = (batchPage - 1) * 1000;
      let scored = [
        ...allMovies.filter(isContentAdultSafe).map(m => normalize(m, 'movie')),
        ...allTv.filter(isContentAdultSafe).map(t => normalize(t, 'tv'))
      ]
        .map(item => {
          const rawScore = computeFinalScore(item, hasYear ? altered_query : q, year_query);
          return {
            ...item,
            batch: batchPage,
            _rawScore: rawScore,
            score: rawScore - batchPenalty,
            isIndian: INDIAN_LANGS.has(item.originalLanguage) || item.originCountry.includes('IN')
          };
        })
        .filter(item => isTitleMatchOrAboveScore(item, q, item._rawScore ?? item.score))
        .map(({ _rawScore, ...item }) => item);

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
        ...normalizePerson(person, adminMode),
        _isIndian: isIndianPerson(person),
        _popularity: Number(person?.popularity || 0)
      }))
      .sort((a, b) => {
        if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
        const aHasPhoto = Boolean(a.profile_path || a.poster_path);
        const bHasPhoto = Boolean(b.profile_path || b.poster_path);
        if (aHasPhoto !== bHasPhoto) return aHasPhoto ? -1 : 1;
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

    const responseData = { query: q, results, page: batchPage, hasMore: endTmdbPage < maxTmdbPagesFound };
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

async function flushAllMongoCache() {
  try {
    homeCache = null;
    homeCacheTime = 0;
    homeCacheAdult = null;
    homeCacheAdultTime = 0;
    categoriesCache.clear();
    trendingCache = null;
    trendingCacheTime = 0;
    trendingCacheAdult = null;
    trendingCacheAdultTime = 0;

    const db = getDb();
    if (!db) return;
    await db.collection(CONTENT_CACHE_COLLECTION).deleteMany({
      _id: { $in: ['home_mode_0', 'home_mode_1', 'home_mode_2', 'trending_mode_0_page_1', 'trending_mode_2_page_1'] }
    });
    await db.collection(CONTENT_CACHE_COLLECTION).deleteMany({
      _id: { $regex: '^(movies_page|popular_page|trending_page)' }
    });
    console.log('[ContentCache] Flushed home, trending, and category cache successfully');
  } catch (err) {
    console.warn('[ContentCache] flushAllMongoCache error:', err.message);
  }
}

async function deleteMongoCategoryCache() {
  try {
    const db = getDb();
    if (!db) return;
    await db.collection(CONTENT_CACHE_COLLECTION).deleteMany({
      _id: { $in: ['home_mode_0', 'home_mode_1', 'home_mode_2', 'trending_mode_0_page_1', 'trending_mode_2_page_1'] }
    });
    await db.collection(CONTENT_CACHE_COLLECTION).deleteMany({ _id: { $regex: '^(movies_page|popular_page)' } });
  } catch {}
}

function clearCategoriesCache() {
  categoriesCache.clear();
  homeCache = null;
  homeCacheTime = 0;
  homeCacheAdult = null;
  homeCacheAdultTime = 0;
  trendingCache = null;
  trendingCacheTime = 0;
  trendingCacheAdult = null;
  trendingCacheAdultTime = 0;
  deleteMongoCategoryCache().catch(() => {});
}
router.clearCategoriesCache = clearCategoriesCache;
router.flushAllMongoCache = flushAllMongoCache;
router.tmdbFetch = tmdbFetch;
router.tmdbHeaders = tmdbHeaders;

module.exports = router;
