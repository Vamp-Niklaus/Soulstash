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
        const { normalizeMultimoviesSlug, synopsisStats, extractPageMetadata, fullyMatchesTarget, fetchHtmlText } = require('./multimoviesScraper');
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

