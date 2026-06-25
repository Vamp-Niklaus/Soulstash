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
