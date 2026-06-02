const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://multimovies.fyi';
const PREFERRED_SERVER_ORDER = ['smwh', 'rpmshre', 'upnshr', 'strmp2', 'flls'];

function createLogger(logger) {
  if (logger && typeof logger.log === 'function') {
    return logger;
  }

  return {
    log: (...args) => console.log(...args)
  };
}

function normalizeMultimoviesSlug(title = '') {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function normalizeLooseText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function pickFirstMatch(html, expressions) {
  for (const expression of expressions) {
    const match = expression.exec(html);
    if (match?.[1]) {
      return decodeHtml(match[1].trim());
    }
  }

  return '';
}

function absoluteUrl(value, baseUrl) {
  if (!value) return '';

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractHiddenInputValue(html, inputId) {
  const escaped = escapeRegExp(inputId);
  return pickFirstMatch(html, [
    new RegExp(`<input[^>]+id=["']${escaped}["'][^>]+value=["']([^"']+)["']`, 'i'),
    new RegExp(`<input[^>]+value=["']([^"']+)["'][^>]+id=["']${escaped}["']`, 'i')
  ]);
}

function extractAnyUrls(value = '', baseUrl = '') {
  const text = decodeHtml(String(value || ''));
  const found = [];
  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/gi,
    /(?:href|src|data-link|data-src)=["']([^"']+)["']/gi,
    /["']((?:https?:)?\/\/[^"'<>]+)["']/gi,
    /\b(https?:\/\/[^\s"'<>]+)\b/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const url = absoluteUrl(String(match[1] || '').replace(/\s+/g, ''), baseUrl);
      if (!url) continue;
      found.push(url);
    }
  }

  return uniqueStrings(found);
}

function filterUsefulRecoveredUrls(urls = []) {
  return uniqueStrings(urls).filter((rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      const pathname = parsed.pathname || '/';
      const hasUsefulPath =
        /\/(?:e|embed|v|svid|evid|file|files)\//i.test(pathname) ||
        pathname.toLowerCase().endsWith('.html');
      const hasUsefulSuffix = Boolean(parsed.hash || parsed.search);
      return hasUsefulPath || hasUsefulSuffix;
    } catch {
      return false;
    }
  });
}

function buildSearchKey({
  mediaType = 'movie',
  title = '',
  seasonNumber = null,
  episodeNumber = null
}) {
  const baseSlug = normalizeMultimoviesSlug(title);
  if (!baseSlug) return '';

  if (String(mediaType).toLowerCase() === 'series') {
    return `${baseSlug}-${Number(seasonNumber || 1)}x${Number(episodeNumber || 1)}`;
  }

  return baseSlug;
}

function buildCandidatePaths({
  mediaType = 'movie',
  title = '',
  seasonNumber = null,
  episodeNumber = null,
  year = null
}) {
  const media = String(mediaType).toLowerCase() === 'series' ? 'series' : 'movie';
  const baseSlug = normalizeMultimoviesSlug(title);
  if (!baseSlug) return [];

  if (media === 'series') {
    const season = Number(seasonNumber || 1);
    const episode = Number(episodeNumber || 1);
    const paths = [
      `/episodes/${baseSlug}-${season}x${episode}/`
    ];
    if (year) {
      paths.push(`/episodes/${baseSlug}-${year}-${season}x${episode}/`);
    }
    paths.push(`/episodes/${baseSlug}-live-action-${season}x${episode}/`);
    return paths;
  }

  const moviePaths = [`/movies/${baseSlug}/`];
  if (year) {
    moviePaths.push(`/movies/${baseSlug}-${year}/`);
  }
  return moviePaths;
}

function isPageNotFound(response, html = '') {
  if (!response.ok && response.status === 404) {
    return true;
  }

  const text = normalizeLooseText(html);
  return (
    text.includes('page not found') ||
    text.includes('404 error') ||
    text.includes('nothing found') ||
    /<title>\s*404/i.test(html)
  );
}

/**
 * Returns true when the response looks like a Cloudflare bot-challenge block.
 * Cloudflare challenge pages have status 403 or 429/503 and contain a
 * distinctive "just a moment" / "cf-browser-verification" fingerprint in the body.
 */
function isCloudflareBlock(response, html = '') {
  const status = response?.status || 0;
  const text = normalizeLooseText(html);
  const isCfStatus = status === 403 || status === 429 || status === 503;
  const hasCfBody =
    text.includes('just a moment') ||
    text.includes('cf-browser-verification') ||
    text.includes('enable javascript') ||
    /var\s+__cf_chl/i.test(html) ||
    /<title>\s*(?:just a moment|attention required|cloudflare)/i.test(html);
  return isCfStatus && hasCfBody;
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const raw = decodeHtml(match[1] || '').trim();
    if (!raw) continue;

    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return blocks;
}

function flattenJsonLd(block) {
  if (!block) return [];
  if (Array.isArray(block)) return block.flatMap(flattenJsonLd);
  if (Array.isArray(block['@graph'])) return block['@graph'];
  return [block];
}

function extractNamesFromLabel(html, label) {
  const escaped = escapeRegExp(label);
  const patterns = [
    new RegExp(`<b[^>]*>${escaped}<\\/b>\\s*<span[^>]*>([\\s\\S]*?)<\\/span>`, 'i'),
    new RegExp(`<strong[^>]*>${escaped}<\\/strong>\\s*<span[^>]*>([\\s\\S]*?)<\\/span>`, 'i'),
    new RegExp(`${escaped}\\s*:<\\/[^>]+>\\s*([\\s\\S]*?)<\\/`, 'i'),
    new RegExp(`${escaped}\\s*:\\s*([^<\\n]+)`, 'i')
  ];

  const rawValue = pickFirstMatch(html, patterns);
  if (!rawValue) return [];

  return uniqueStrings(
    rawValue
      .replace(/<[^>]+>/g, ',')
      .split(/,|\/|\||\u2022/)
      .map((part) => normalizeLooseText(part))
  );
}

function extractTextByHeading(html, headings = []) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const patterns = [
      new RegExp(`<h[1-6][^>]*>${escaped}<\\/h[1-6]>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i'),
      new RegExp(`<div[^>]*>${escaped}<\\/div>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i'),
      new RegExp(`<strong[^>]*>${escaped}<\\/strong>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i'),
      new RegExp(`${escaped}\\s*:?\\s*<\\/[^>]+>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i'),
      new RegExp(`<h[1-6][^>]*>${escaped}<\\/h[1-6]>[\\s\\S]*?<div[^>]*itemprop=["']description["'][^>]*>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i'),
      new RegExp(`<h[1-6][^>]*>${escaped}<\\/h[1-6]>[\\s\\S]*?<div[^>]*class=["'][^"']*wp-content[^"']*["'][^>]*>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i')
    ];

    const rawValue = pickFirstMatch(html, patterns);
    if (rawValue) {
      return decodeHtml(rawValue).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return '';
}

function synopsisTokens(value = '') {
  return normalizeLooseText(value)
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function synopsisStats(leftValue = '', rightValue = '') {
  const leftTokens = uniqueStrings(synopsisTokens(leftValue));
  const rightTokens = uniqueStrings(synopsisTokens(rightValue));

  if (!leftTokens.length || !rightTokens.length) {
    return {
      overlapRatio: 0,
      overlapCount: 0,
      leftCount: leftTokens.length,
      rightCount: rightTokens.length,
      phraseMatched: false
    };
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlapCount = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlapCount += 1;
    }
  }

  const overlapRatio = overlapCount / Math.max(1, Math.min(leftSet.size, rightSet.size));
  const leftPhrase = leftTokens.slice(0, 8).join(' ');
  const rightPhrase = rightTokens.slice(0, 8).join(' ');
  const phraseMatched =
    (leftPhrase && normalizeLooseText(rightValue).includes(leftPhrase)) ||
    (rightPhrase && normalizeLooseText(leftValue).includes(rightPhrase));

  return {
    overlapRatio,
    overlapCount,
    leftCount: leftSet.size,
    rightCount: rightSet.size,
    phraseMatched
  };
}

function looksLikeRealSynopsis(value = '', title = '') {
  const normalizedValue = normalizeLooseText(value);
  const normalizedTitle = normalizeLooseText(title);
  const tokens = synopsisTokens(normalizedValue);

  if (tokens.length < 12) {
    return false;
  }

  if (normalizedTitle && (normalizedValue === normalizedTitle || normalizedValue.startsWith(`multimovies ${normalizedTitle}`))) {
    return false;
  }

  return true;
}

function titleMatchScore(targetTitle = '', metadata = {}, episodeTitle = '', targetYear = null) {
  const expectedTitle = normalizeLooseText(targetTitle);
  const expectedEpisodeTitle = normalizeLooseText(episodeTitle);
  const allTitles = uniqueStrings([metadata.normalizedTitle, ...(metadata.alternateTitles || [])]);

  let score = 0;

  for (const value of allTitles) {
    if (!value) continue;
    if (expectedTitle && (value === expectedTitle || value.includes(expectedTitle) || expectedTitle.includes(value))) {
      score = Math.max(score, 1);
    }
    if (
      expectedEpisodeTitle &&
      (value === expectedEpisodeTitle || value.includes(expectedEpisodeTitle) || expectedEpisodeTitle.includes(value))
    ) {
      score = Math.max(score, 1);
    }
  }

  // Strong year penalization for remakes vs originals
  if (score > 0 && targetYear && metadata.years && metadata.years.length > 0) {
    const minDiff = Math.min(...metadata.years.map(y => Math.abs(y - targetYear)));
    if (minDiff > 5) {
      score = 0; // Completely reject if year is way off
    }
  }

  // Strong episode title penalization to bypass broken metadata
  if (score > 0 && expectedEpisodeTitle && metadata.episodeTitles && metadata.episodeTitles.length > 0) {
    let epFound = false;
    for (const epTitle of metadata.episodeTitles) {
      if (epTitle === expectedEpisodeTitle || epTitle.includes(expectedEpisodeTitle) || expectedEpisodeTitle.includes(epTitle)) {
        epFound = true; break;
      }
    }
    if (!epFound) score = 0; // Completely reject if episode title is not in the list
  }

  return score;
}

function extractPageMetadata(html, pageUrl) {
  const title = pickFirstMatch(html, [
    /<title>\s*([^<]+?)\s*<\/title>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i
  ]);

  const canonicalUrl =
    pickFirstMatch(html, [/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i]) || pageUrl;

  const jsonLdItems = extractJsonLdBlocks(html).flatMap(flattenJsonLd);
  const jsonNames = uniqueStrings(jsonLdItems.map((item) => item?.name).filter(Boolean));
  const publishedDates = uniqueStrings(
    jsonLdItems
      .map((item) => item?.datePublished || item?.dateCreated || item?.dateModified)
      .filter(Boolean)
  );

  const years = uniqueStrings(
    publishedDates
      .map((value) => String(value).match(/\b(19|20)\d{2}\b/)?.[0] || '')
      .filter(Boolean)
  )
    .map((value) => Number(value))
    .filter(Boolean);

  const directors = uniqueStrings([
    ...extractNamesFromLabel(html, 'Director'),
    ...extractNamesFromLabel(html, 'Directors'),
    ...jsonLdItems
      .flatMap((item) => item?.director || [])
      .map((person) => normalizeLooseText(person?.name || person))
  ]);

  const cast = uniqueStrings([
    ...extractNamesFromLabel(html, 'Cast'),
    ...extractNamesFromLabel(html, 'Actors'),
    ...extractNamesFromLabel(html, 'Stars'),
    ...jsonLdItems
      .flatMap((item) => item?.actor || [])
      .map((person) => normalizeLooseText(person?.name || person))
  ]);

  const synopsis = pickFirstMatch(html, [
    /<div[^>]*itemprop=["']description["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ]) ||
    extractTextByHeading(html, ['Synopsis', 'Overview', 'Storyline', 'Plot']) ||
    uniqueStrings(jsonLdItems.map((item) => item?.description).filter(Boolean))[0] ||
    '';

  const episodeTitles = [];
  const episodesList = [];
  const epMatches = [...html.matchAll(/class=["']episodiotitle["'][^>]*>.*?<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/ig)];
  for (const m of epMatches) {
    if (m[1] && m[2]) {
      const title = normalizeLooseText(m[2]);
      episodeTitles.push(title);
      episodesList.push({ url: absoluteUrl(m[1], pageUrl), title });
    }
  }

  return {
    title,
    normalizedTitle: normalizeLooseText(title),
    alternateTitles: uniqueStrings(jsonNames.map((value) => normalizeLooseText(value))),
    canonicalUrl,
    years,
    directors,
    cast,
    episodeTitles,
    episodesList,
    synopsis: decodeHtml(String(synopsis || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  };
}

function fuzzySetFromNames(values) {
  return new Set(values.map(normalizeLooseText).filter(Boolean));
}

function fuzzyOverlapCount(leftValues = [], rightValues = []) {
  const left = [...fuzzySetFromNames(leftValues)];
  const right = [...fuzzySetFromNames(rightValues)];
  let overlap = 0;

  for (const leftValue of left) {
    if (right.some((rightValue) => rightValue === leftValue || rightValue.includes(leftValue) || leftValue.includes(rightValue))) {
      overlap += 1;
    }
  }

  return overlap;
}

function metadataMatchesTarget(metadata, target) {
  const synopsisMatch = synopsisStats(target.synopsis, metadata.synopsis);
  const titleScore = titleMatchScore(target.title, metadata, target.episodeTitle, target.year);
  const hasUsableSynopsis = looksLikeRealSynopsis(metadata.synopsis, target.title || target.episodeTitle);

  if (target.synopsis && hasUsableSynopsis) {
    const ok = synopsisMatch.phraseMatched || synopsisMatch.overlapRatio >= 0.35;
    return {
      ok,
      reason: ok ? 'synopsis-matched' : 'synopsis-mismatch',
      score: (ok ? 1 : 0) + synopsisMatch.overlapRatio + titleScore * 0.1,
      stats: {
        synopsisOverlap: Number(synopsisMatch.overlapRatio.toFixed(3)),
        synopsisOverlapCount: synopsisMatch.overlapCount,
        synopsisPhraseMatched: synopsisMatch.phraseMatched,
        titleScore
      }
    };
  }

  return {
    ok: titleScore > 0,
    reason: titleScore > 0 ? (hasUsableSynopsis ? 'title-matched-fallback' : 'title-matched-no-usable-synopsis') : 'title-mismatch',
    score: titleScore,
    stats: {
      synopsisOverlap: Number(synopsisMatch.overlapRatio.toFixed(3)),
      synopsisOverlapCount: synopsisMatch.overlapCount,
      synopsisPhraseMatched: synopsisMatch.phraseMatched,
      titleScore,
      hasUsableSynopsis
    }
  };
}

function fullyMatchesTarget(metadata, target) {
  return metadataMatchesTarget(metadata, target);
}

function extractHelperSid(html = '') {
  return (
    extractHiddenInputValue(html, 'gdmrfid') ||
    pickFirstMatch(html, [
      /const\s+sid\s*=\s*["']([^"']+)["']/i,
      /let\s+sid\s*=\s*["']([^"']+)["']/i,
      /var\s+sid\s*=\s*["']([^"']+)["']/i,
      /sid\s*[:=]\s*["']([^"']+)["']/i
    ])
  );
}

const BLOCKED_EMBED_DOMAINS = [
  'googleapis.com',
  'googlesyndication.com',
  'googletagmanager.com',
  'doubleclick.net',
  '2mdn.net',
  'usercontent.goog',
  'google.com',
  'gstatic.com',
  'facebook.com',
  'twitter.com',
  'instagram.com',
  'disqus.com',
  'recaptcha.net',
  'cloudflare.com',
  'youtube.com',
  'youtu.be',
];

function isBlockedEmbedDomain(hostname) {
  const h = (hostname || '').toLowerCase();
  return BLOCKED_EMBED_DOMAINS.some((b) => h === b || h.endsWith('.' + b));
}

function isLikelyHelperUrl(url = '', pageUrl = '') {
  if (!url) return false;

  try {
    const parsed = new URL(url, pageUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (isBlockedEmbedDomain(hostname)) return false;

    if (
      hostname.includes('multimovies') ||
      hostname.includes('rpmhub.site') ||
      hostname.includes('uns.bio') ||
      hostname.includes('p2pplay.pro') ||
      hostname.includes('smoothpre.com') ||
      hostname.includes('iqsmartgames.com')
    ) {
      return true;
    }

    if (
      pathname.includes('/svid/') ||
      pathname.includes('/evid/') ||
      pathname.includes('/embed') ||
      /\/(?:e|v|evid)\//.test(pathname)
    ) {
      return true;
    }

    if (/\.html?$/.test(pathname)) {
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length < 2) return false;
      const parentSegment = segments[segments.length - 2];
      if (/^(js|core|api|cdn|sdk|static|assets|lib|vendor|pagead|instream|html5|survey)$/i.test(parentSegment)) return false;
      const filename = segments[segments.length - 1];
      const nameWithoutExt = filename.replace(/\.html?$/, '');
      if (nameWithoutExt.includes('.')) return false;
      return /^[a-z0-9_-]{3,60}$/i.test(nameWithoutExt);
    }
  } catch {
    return false;
  }

  return false;
}


function extractEmbedUrls(html, pageUrl) {
  const discovered = [];
  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/gi,
    /(?:href|src|data-link|data-src)=["']([^"']*\/svid\/[^"']+)["']/gi,
    /(?:href|src|data-link|data-src)=["']([^"']*\/(?:e|v|evid)\/[^"']+)["']/gi,
    /(?:href|src|data-link|data-src)=["']([^"']+\.html?(?:\?[^"']*)?)["']/gi,
    /["']((?:https?:)?\/\/[^"']+\/svid\/[^"']+)["']/gi,
    /["']((?:https?:)?\/\/[^"']+\/(?:e|v|evid)\/[^"']+)["']/gi,
    /["']((?:https?:)?\/\/[^"']+\.html?(?:\?[^"']*)?)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const url = absoluteUrl(match[1], pageUrl);
      if (!url) continue;
      if (!isLikelyHelperUrl(url, pageUrl)) continue;
      discovered.push(url);
    }
  }

  return uniqueStrings(discovered);
}

function extractLooseHelperUrls(html = '', pageUrl = '') {
  const text = String(html || '');
  const base = pickFirstMatch(text, [
    /\bplayer_base\s*=\s*["']([^"']+)["']/i,
    /\bplayerBase\s*=\s*["']([^"']+)["']/i
  ]);
  const baseUrl = absoluteUrl(base, pageUrl) || pageUrl;

  const discovered = [];
  const patterns = [
    /((?:https?:)?\/\/[^\s"'<>]+\/svid\/[a-z0-9_-]{6,})/gi,
    /((?:https?:)?\/\/[^\s"'<>]+\/evid\/[a-z0-9_-]{6,})/gi,
    /(\/svid\/[a-z0-9_-]{6,})/gi,
    /(\/evid\/[a-z0-9_-]{6,})/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const url = absoluteUrl(match[1], baseUrl);
      if (!url) continue;
      if (!isLikelyHelperUrl(url, pageUrl)) continue;
      discovered.push(url);
    }
  }

  return uniqueStrings(discovered);
}

function extractIqSmartGamesApiConfig(html = '', pageUrl = '') {
  const text = String(html || '');

  const finalId = pickFirstMatch(text, [/\bFinalID\s*=\s*["']([^"']+)["']/i]);
  const idType = pickFirstMatch(text, [/\bidType\s*=\s*["']([^"']+)["']/i]);
  const myKey = pickFirstMatch(text, [/\bmyKey\s*=\s*["']([^"']+)["']/i]);
  const playerBase = pickFirstMatch(text, [/\bplayer_base\s*=\s*["']([^"']+)["']/i, /\bplayerBase\s*=\s*["']([^"']+)["']/i]);
  const apiUrl = pickFirstMatch(text, [/\bapi_url\s*=\s*["']([^"']+)["']/i, /\bapiUrl\s*=\s*["']([^"']+)["']/i]);
  
  // Series-specific fields
  const season = pickFirstMatch(text, [/\bseason\s*=\s*["']([^"']+)["']/i]);
  const epname = pickFirstMatch(text, [/\bepname\s*=\s*["']([^"']+)["']/i]);

  if (!finalId || !playerBase) return null;

  const effectiveApiBase = absoluteUrl(apiUrl || '', pageUrl) || pageUrl;
  const effectiveIdType = idType || 'imdbid';
  
  let apiEndpoint;
  if (season && epname) {
    apiEndpoint = `${effectiveApiBase.replace(/\/+$/, '')}/myseriesapi?${encodeURIComponent(effectiveIdType)}=${encodeURIComponent(finalId)}&season=${encodeURIComponent(season)}&epname=${encodeURIComponent(epname)}${myKey ? `&key=${encodeURIComponent(myKey)}` : ''}`;
  } else {
    apiEndpoint = `${effectiveApiBase.replace(/\/+$/, '')}/mymovieapi?${encodeURIComponent(effectiveIdType)}=${encodeURIComponent(finalId)}${myKey ? `&key=${encodeURIComponent(myKey)}` : ''}`;
  }

  // New: direct links from HTML quality-links menu
  const directLinks = [];
  const linkPattern = /<div\s+class=["']quality-links["'][^>]*>\s*<a\s+[^>]*data-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkPattern.exec(text))) {
    const link = m[1];
    const name = m[2].replace(/<[^>]+>/g, '').trim();
    if (link) directLinks.push({ name: name || 'Direct', url: absoluteUrl(link, pageUrl) });
  }

  // New: fallback links from internal scripts
  const fallbackMatch = text.match(/var\s+fallbackLinks\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (fallbackMatch?.[1]) {
    try {
      // Very loose JSON-like parser for the array
      const rawArrayText = fallbackMatch[1];
      const linkRegex = /\{[\s\S]*?link\s*:\s*["']([^"']+)["'][\s\S]*?name\s*:\s*["']([^"']+)["'][\s\S]*?\}/gi;
      let item;
      while ((item = linkRegex.exec(rawArrayText))) {
        let link = item[1];
        // Handle template variables if any (sometimes they are there, sometimes not)
        link = link.replace(/\$\{FinalID\}/g, finalId).replace(/\$\{season\}/g, season || '').replace(/\$\{epname\}/g, epname || '');
        directLinks.push({ name: item[2], url: absoluteUrl(link, pageUrl) });
      }
    } catch {}
  }

  return { 
    finalId, 
    idType: effectiveIdType, 
    myKey: myKey || '', 
    playerBase: absoluteUrl(playerBase, pageUrl) || playerBase, 
    apiUrl: effectiveApiBase, 
    apiEndpoint,
    directLinks: uniqueSources(directLinks)
  };
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

async function fetchIqSmartGamesEvidUrls(embedUrl, html, fetchImpl, logger) {
  const config = extractIqSmartGamesApiConfig(html, embedUrl);
  if (!config) return [];

  if (config.directLinks && config.directLinks.length) {
    logger.log('[MultimoviesScraper] iqSmartGames direct links found in HTML', { count: config.directLinks.length });
    return config.directLinks;
  }

  logger.log('[MultimoviesScraper] iqSmartGames api config', { embedUrl, finalId: config.finalId, idType: config.idType, playerBase: config.playerBase, apiEndpoint: config.apiEndpoint });

  try {
    const result = await fetchIqSmartGamesViaPageInterception(embedUrl, config, logger);
    if (result.length) return result;
  } catch (error) {
    logger.log('[MultimoviesScraper] iqSmartGames playwright interception ERROR', { embedUrl, message: error?.message || 'unknown-error' });
  }

  try {
    const response = await global.fetch(config.apiEndpoint, {
      method: 'GET',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36', accept: 'application/json, text/plain, */*', referer: embedUrl, origin: new URL(embedUrl).origin }
    });
    if (!response.ok) return [];
    return parseIqSmartGamesApiPayload(await response.json().catch(() => ({})), config, embedUrl, logger);
  } catch (error) {
    return [];
  }
}

async function fetchIqSmartGamesViaPageInterception(embedUrl, config, logger) {
  let { getBrowser } = (() => { try { return require('./playwrightFetch'); } catch { return {}; } })();
  let browser = null;
  let ownedBrowser = false;

  if (typeof getBrowser === 'function') {
    browser = await getBrowser();
  } else {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    ownedBrowser = true;
  }

  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  let interceptedPayload = null;

  try {
    page.on('response', async (res) => {
      try {
        if (res.url().includes('mymovieapi') && !interceptedPayload) {
          const json = await res.json().catch(() => null);
          if (json) interceptedPayload = json;
        }
      } catch { /* ignore */ }
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait up to 20 seconds for the payload to be intercepted
    let waitTime = 0;
    while (!interceptedPayload && waitTime < 20000) {
      await new Promise((r) => setTimeout(r, 500));
      waitTime += 500;
    }

    if (!interceptedPayload) {
      logger.log('[MultimoviesScraper] iqSmartGames interception TIMEOUT', { embedUrl });
      return [];
    }
    return parseIqSmartGamesApiPayload(interceptedPayload, config, embedUrl, logger);
  } finally {
    await context.close().catch(() => {});
    if (ownedBrowser) await browser.close().catch(() => {});
  }
}

function parseIqSmartGamesApiPayload(payload, config, embedUrl, logger) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (!items.length) return [];

  const evidUrls = [];
  for (const item of items) {
    const slug = String(item?.fileslug || '').trim();
    if (!slug) continue;
    evidUrls.push({ name: String(item?.filename || item?.name || slug).trim(), url: `${config.playerBase.replace(/\/+$/, '')}/evid/${slug}`, slug });
  }

  return evidUrls;
}

function extractPlayerTitle(html) {
  return pickFirstMatch(html, [/<title>\s*([^<]+?)\s*<\/title>/i, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i]);
}

function extractPlayerYears(html) {
  return uniqueStrings(Array.from(html.matchAll(/\b(19|20)\d{2}\b/g)).map((match) => match[0])).map(Number).filter(Boolean);
}

function buildEnrichedMetadata(pageMetadata, playerResults) {
  const playerTitles = uniqueStrings(playerResults.map((player) => normalizeLooseText(player.playerTitle)).filter(Boolean));
  const playerYears = uniqueStrings(playerResults.flatMap((player) => player.years.map(String))).map(Number);
  return { ...pageMetadata, alternateTitles: uniqueStrings([...pageMetadata.alternateTitles, ...playerTitles]), years: uniqueStrings([...pageMetadata.years.map(String), ...playerYears.map(String)]).map(Number) };
}

function extractServerItems(html, playerUrl) {
  const htmlText = String(html || '');
  if (!/server-item/i.test(htmlText)) {
    return PREFERRED_SERVER_ORDER.map((sourceKey) => ({ sourceKey, serverName: sourceKey.toUpperCase(), meta: '', url: '', preferred: true, available: false }));
  }

  const serverItems = [];
  const liPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let match;

  const readAttr = (attrs = '', name = '') => pickFirstMatch(attrs, [new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, 'i')]);

  while ((match = liPattern.exec(htmlText))) {
    const attrs = match[1] || '';
    if (!/\bserver-item\b/i.test(attrs)) continue;

    const body = match[2] || '';
    const rawUrl = readAttr(attrs, 'data-link');
    if (!rawUrl) continue;

    const rawKey = pickFirstMatch(attrs, [/\bdata-source-key\s*=\s*["']([^"']+)["']/i, /\bdata-sourcekey\s*=\s*["']([^"']+)["']/i, /\bdata-sourceKey\s*=\s*["']([^"']+)["']/i]);
    const absolute = absoluteUrl(rawUrl, playerUrl);
    const inferred = !rawKey ? inferServerItemFromUrl(absolute) : null;
    const sourceKey = String(rawKey || inferred?.sourceKey || '').trim().toLowerCase();

    if (!sourceKey) continue;

    const serverName = pickFirstMatch(body, [/<div[^>]+class=["']server-name["'][^>]*>([\s\S]*?)<\/div>/i]) || inferred?.serverName || sourceKey.toUpperCase();
    const meta = pickFirstMatch(body, [/<div[^>]+class=["']server-meta["'][^>]*>([\s\S]*?)<\/div>/i]);

    serverItems.push({ sourceKey, serverName: decodeHtml(serverName).replace(/<[^>]+>/g, '').trim(), meta: decodeHtml(meta).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), url: absolute, preferred: PREFERRED_SERVER_ORDER.includes(sourceKey) });
  }

  const byKey = new Map(serverItems.map((item) => [item.sourceKey, item]));
  return PREFERRED_SERVER_ORDER.map((sourceKey) => {
    const found = byKey.get(sourceKey);
    return found ? { ...found, available: true } : { sourceKey, serverName: sourceKey.toUpperCase(), meta: '', url: '', preferred: true, available: false };
  });
}

function inferServerItemFromUrl(playerUrl = '') {
  const url = absoluteUrl(playerUrl, playerUrl);
  if (!url) return null;
  let hostname = '';
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return null; }

  const mappings = [
    { match: ['multimoviesshg.com'], sourceKey: 'smwh', serverName: 'SMWH' },
    { match: ['multimovies.rpmhub.site'], sourceKey: 'rpmshre', serverName: 'RPMSHRE' },
    { match: ['server1.uns.bio'], sourceKey: 'upnshr', serverName: 'UPNSHR' },
    { match: ['multimovies.p2pplay.pro'], sourceKey: 'strmp2', serverName: 'STRMP2' },
    { match: ['smoothpre.com'], sourceKey: 'flls', serverName: 'FLLS' },
    { match: ['multiembed.mov', 'multiembed.site'], sourceKey: 'mlembd', serverName: 'MLEMBD' },
    { match: ['vidsrc.me', 'vidsrc.to', 'vidsrc.xyz', 'vidsrc.in'], sourceKey: 'vdsrc', serverName: 'VDSRC' }
  ];

  const found = mappings.find((item) => item.match.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)));
  return found ? { sourceKey: found.sourceKey, serverName: found.serverName, meta: '', url, preferred: true, available: true } : null;
}

function preferResolvedPlayerUrl(embedUrl = '', finalUrl = '') {
  const resolvedEmbedUrl = absoluteUrl(embedUrl, embedUrl);
  const resolvedFinalUrl = absoluteUrl(finalUrl, embedUrl);
  if (!resolvedFinalUrl) return resolvedEmbedUrl || '';
  if (!resolvedEmbedUrl) return resolvedFinalUrl;

  try {
    const embed = new URL(resolvedEmbedUrl);
    const final = new URL(resolvedFinalUrl);
    if (embed.origin === final.origin && embed.pathname === final.pathname && (embed.hash || embed.search) && !(final.hash || final.search)) return resolvedEmbedUrl;
  } catch { return resolvedFinalUrl || resolvedEmbedUrl || ''; }
  return resolvedFinalUrl;
}

function extractDownloadUrls(html = '', baseUrl = '') {
  return uniqueStrings(extractAnyUrls(html, baseUrl).filter((url) => /ddn\.iqsmartgames\.com\/(?:file|files)\//i.test(url)));
}

function createDownloadUrlCandidates(embedUrl = '', sid = '') {
  const isValidSlug = (slug) => Boolean(slug) && /^[a-z0-9_-]{4,}$/i.test(slug) && !slug.includes('.');
  const candidates = [];
  if (isValidSlug(sid)) candidates.push(`https://ddn.iqsmartgames.com/file/${sid}`);
  try {
    const lastPathPart = new URL(embedUrl).pathname.split('/').filter(Boolean).pop() || '';
    if (isValidSlug(lastPathPart)) candidates.push(`https://ddn.iqsmartgames.com/file/${lastPathPart}`);
  } catch {}
  return uniqueStrings(candidates);
}

function normalizeServerItems(serverItems = []) {
  const byKey = new Map(serverItems.filter((item) => item?.sourceKey).map((item) => [item.sourceKey, item]));
  return PREFERRED_SERVER_ORDER.map((sourceKey) => {
    const found = byKey.get(sourceKey);
    return found ? { ...found, available: true } : { sourceKey, serverName: sourceKey.toUpperCase(), meta: '', url: '', preferred: true, available: false };
  });
}

function decodeBase64Json(value = '') {
  try { return JSON.parse(Buffer.from(String(value), 'base64').toString('utf8')); } catch { return {}; }
}

async function fetchEmbedHelperServers(embedUrl, html, fetchImpl, logger) {
  const sid = extractHelperSid(html);
  if (!sid) return [];

  const helperUrl = absoluteUrl('/embedhelper.php', embedUrl);
  const currentDomain = JSON.stringify(uniqueStrings(['multimovies.fyi', new URL(embedUrl).hostname].filter(Boolean)));
  const body = new URLSearchParams({ sid, UserFavSite: '', currentDomain });

  const requestVariants = [
    { requestUrl: helperUrl, method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36', accept: 'application/json, text/plain, */*', 'content-type': 'application/x-www-form-urlencoded', origin: new URL(embedUrl).origin, referer: embedUrl }, body: body.toString() },
    { requestUrl: `${helperUrl}?${body.toString()}`, method: 'GET', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36', accept: 'application/json, text/plain, */*', origin: new URL(embedUrl).origin, referer: embedUrl } }
  ];

  try {
    for (const variant of requestVariants) {
      const response = await fetchImpl(variant.requestUrl, { method: variant.method, headers: variant.headers, body: variant.body });
      const payload = await response.json().catch(() => ({}));
      const siteUrls = payload?.siteUrls || {};
      const mresult = typeof payload?.mresult === 'string' ? decodeBase64Json(payload.mresult) : payload?.mresult || {};
      const encryptedApiKeys = payload?.encryptedApiKeys || {};

      const serverItems = [];
      for (const sourceKey of Object.keys(encryptedApiKeys)) {
        const baseUrl = siteUrls[sourceKey];
        const code = mresult[sourceKey];
        if (baseUrl && code) serverItems.push({ sourceKey: sourceKey.toLowerCase(), serverName: sourceKey.toUpperCase(), meta: '', url: absoluteUrl(`${baseUrl}${code}`, embedUrl), preferred: PREFERRED_SERVER_ORDER.includes(sourceKey.toLowerCase()), available: true });
      }
      if (serverItems.length) return normalizeServerItems(serverItems);
    }
  } catch {}
  return [];
}

function extractKnownProviderUrls(html = '', playerUrl = '') {
  const knownHosts = ['multimoviesshg.com', 'multimovies.rpmhub.site', 'server1.uns.bio', 'multimovies.p2pplay.pro', 'smoothpre.com'];
  const normalizedText = String(html || '').replace(/\\\//g, '/').replace(/\\\\u002F/gi, '/').replace(/&quot;/g, '"');
  const discovered = new Set(uniqueStrings(extractAnyUrls(normalizedText, playerUrl)));
  for (const host of knownHosts) {
    const hostPattern = new RegExp(`((?:https?:)?//${escapeRegExp(host)}[^"'\\s<>\\\\]*)`, 'gi');
    let match;
    while ((match = hostPattern.exec(normalizedText))) {
      const absolute = absoluteUrl(match[1], playerUrl);
      if (absolute) discovered.add(absolute);
    }
  }
  return uniqueStrings([...discovered]).filter((url) => {
    try { const hostname = new URL(url).hostname.toLowerCase(); return knownHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)); } catch { return false; }
  });
}

function extractKnownProviderServerItems(html = '', playerUrl = '') {
  return extractKnownProviderUrls(html, playerUrl).map((url) => inferServerItemFromUrl(url)).filter((item) => item?.available && item?.url);
}

async function resolveServersFromPlayerPage(embedUrl, html, fetchImpl, logger, depth = 0, visited = new Set(), options = {}) {
  const { onSource } = options;
  const visitKey = `${depth}:${embedUrl}`;
  if (visited.has(visitKey) || depth > 2) return normalizeServerItems([]);
  visited.add(visitKey);

  const collectedServers = [];
  const pushServers = (items = []) => {
    const available = items.filter((item) => item?.available && item?.url);
    if (available.length && typeof onSource === 'function') {
      onSource(available);
    }
    collectedServers.push(...available);
  };

  pushServers(extractServerItems(html, embedUrl));
  pushServers(extractKnownProviderServerItems(html, embedUrl));
  pushServers(await fetchEmbedHelperServers(embedUrl, html, fetchImpl, logger));

  const nestedEmbedUrls = extractEmbedUrls(html, embedUrl).filter((url) => url && !/youtube\.com|youtu\.be/i.test(url));
  if (nestedEmbedUrls.length) {
    await Promise.all(nestedEmbedUrls.map(async (nestedUrl) => {
      try {
        const { response, html: nestedHtml, finalUrl } = await fetchHtmlText(nestedUrl, fetchImpl);
        if (response.ok) pushServers(await resolveServersFromPlayerPage(finalUrl || nestedUrl, nestedHtml, fetchImpl, logger, depth + 1, visited, { onSource }));
      } catch {}
    }));
  }

  if (!collectedServers.length) {
    const looseHelperUrls = extractLooseHelperUrls(html, embedUrl).filter((url) => url && url !== embedUrl);
    await Promise.all(looseHelperUrls.slice(0, 4).map(async (helperUrl) => {
      try {
        const { response, html: helperHtml, finalUrl } = await fetchHtmlText(helperUrl, fetchImpl);
        if (response.ok) pushServers(await resolveServersFromPlayerPage(finalUrl || helperUrl, helperHtml, fetchImpl, logger, depth + 1, visited, { onSource }));
      } catch {}
    }));
  }

  if (!collectedServers.length && depth === 0) {
    try {
      const evidResults = await fetchIqSmartGamesEvidUrls(embedUrl, html, fetchImpl, logger);
      await Promise.all(evidResults.slice(0, 5).map(async (evidItem) => {
        try {
          const { response: evidResp, html: evidHtml, finalUrl: evidFinalUrl } = await fetchHtmlText(evidItem.url, fetchImpl);
          if (evidResp.ok) pushServers(await resolveServersFromPlayerPage(evidFinalUrl || evidItem.url, evidHtml, fetchImpl, logger, depth + 1, visited, { onSource }));
        } catch {}
      }));
    } catch {}
  }

  if (!collectedServers.length) {
    const downloadCandidates = createDownloadUrlCandidates(embedUrl, extractHelperSid(html)).filter((url) => /ddn\.iqsmartgames\.com\/file\//i.test(url));
    await Promise.all(downloadCandidates.slice(0, 2).map(async (candidateUrl) => {
      try {
        const { response, html: candidateHtml, finalUrl: effectiveCandidateUrl } = await fetchHtmlText(candidateUrl, fetchImpl);
        if (response.ok) pushServers(await resolveServersFromPlayerPage(effectiveCandidateUrl, candidateHtml, fetchImpl, logger, depth + 1, visited, { onSource }));
      } catch {}
    }));
  }

  const inferredServer = inferServerItemFromUrl(embedUrl);
  if (inferredServer) pushServers([inferredServer]);

  return normalizeServerItems(collectedServers);
}

function extractPlayerResultsFromSnapshotDir(snapshotAssetDir) {
  if (!snapshotAssetDir || !fs.existsSync(snapshotAssetDir)) return [];
  const files = fs.readdirSync(snapshotAssetDir, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name)).map((entry) => path.join(snapshotAssetDir, entry.name));
  const results = [];
  for (const filePath of files) {
    try {
      const html = fs.readFileSync(filePath, 'utf8');
      const servers = extractServerItems(html, `file://${filePath.replace(/\\/g, '/')}`);
      if (servers.some((item) => item.available)) results.push({ playerUrl: filePath, playerTitle: extractPlayerTitle(html), years: extractPlayerYears(html), languageHint: /hindi|\u0939\u093f\u0928\u094d\u0926\u0940|\u0939\u093f\u0902\u0926\u0940/i.test(html) ? 'hindi' : '', servers });
    } catch {}
  }
  return results;
}

function buildBrowserHeaders(extraHeaders = {}) {
  const cfClearance = (process.env.CF_CLEARANCE || '').trim();
  const cookieParts = cfClearance ? [`cf_clearance=${cfClearance}`] : [];
  if (extraHeaders.cookie) cookieParts.push(String(extraHeaders.cookie));
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    dnt: '1',
    connection: 'keep-alive',
    ...extraHeaders,
    ...(cookieParts.length ? { cookie: cookieParts.join('; ') } : {})
  };
}

async function fetchHtmlText(url, fetchImpl, options = {}) {
  const extraHeaders = options?.headers || {};
  const requestInit = { method: 'GET', headers: buildBrowserHeaders(extraHeaders) };
  if (options?.redirect) requestInit.redirect = options.redirect;
  const response = await fetchImpl(url, requestInit);
  const html = await response.text();
  return { response, html, finalUrl: absoluteUrl(response?.url || url, url) || url };
}

function extractDtAjaxConfig(html, pageUrl) {
  const match = html.match(/var\s+dtAjax\s*=\s*(\{[\s\S]*?\})\s*;/i);
  if (!match?.[1]) return null;
  try {
    const config = JSON.parse(match[1]);
    return { raw: config, url: absoluteUrl(config.url || '', pageUrl), playerApi: absoluteUrl(config.player_api || '', pageUrl), playMethod: String(config.play_method || '').trim().toLowerCase(), playAjaxMd: String(config.play_ajaxmd || '').trim(), nonce: String(config.nonce || config._wpnonce || '').trim() };
  } catch { return null; }
}

function extractAttribute(tag, attributeName) {
  return tag.match(new RegExp(`${escapeRegExp(attributeName)}=["']([^"']+)["']`, 'i'))?.[1] || '';
}

function extractAjaxPlayerOptions(html) {
  const options = [];
  const pattern = /<li\b[^>]*class=["'][^"']*dooplay_player_option[^"']*["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const tag = match[0] || '';
    const option = { post: extractAttribute(tag, 'data-post').trim(), nume: extractAttribute(tag, 'data-nume').trim(), type: extractAttribute(tag, 'data-type').trim() };
    if (option.post && option.nume && option.type) options.push(option);
  }
  return uniqueStrings(options.map((o) => JSON.stringify(o))).map((v) => JSON.parse(v));
}

async function fetchAjaxEmbedUrls(pageHtml, pageUrl, fetchImpl, logger) {
  const dtAjax = extractDtAjaxConfig(pageHtml, pageUrl);
  if (!dtAjax?.url || dtAjax.playMethod !== 'admin_ajax') return [];

  const playerOptions = extractAjaxPlayerOptions(pageHtml);
  let { getBrowser, fetchPostInPage } = (() => { try { return require('./playwrightFetch'); } catch { return {}; } })();
  let sharedPage = null;

  if (typeof getBrowser === 'function' && typeof fetchPostInPage === 'function') {
    try {
      const browser = await getBrowser();
      sharedPage = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36', extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' } });
      await sharedPage.route('**/*', (route) => ['image', 'stylesheet', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue());
      const cfClearance = (process.env.CF_CLEARANCE || '').trim();
      if (cfClearance) await sharedPage.setCookie({ name: 'cf_clearance', value: cfClearance, domain: new URL(pageUrl).hostname, path: '/' });
      await sharedPage.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch { if (sharedPage) { await sharedPage.close().catch(() => {}); sharedPage = null; } }
  }

  const embedUrls = [];
  try {
    for (const option of playerOptions) {
      if (String(option.nume || '').toLowerCase() === 'trailer') continue;
      try {
        const body = new URLSearchParams({ action: 'doo_player_ajax', post: option.post, nume: option.nume, type: option.type });
        let payload = null;
        if (sharedPage && fetchPostInPage) try { payload = await fetchPostInPage(sharedPage, dtAjax.url, body); } catch {}
        if (!payload) {
          const response = await global.fetch(dtAjax.url, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36', accept: 'application/json, text/plain, */*', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: new URL(pageUrl).origin, referer: pageUrl, 'x-requested-with': 'XMLHttpRequest' }, body: body.toString() });
          if (response.ok) payload = await response.json().catch(() => null);
        }
        if (payload) {
          const rawEmbedValue = String(payload?.embed_url || '').trim();
          const extractedUrls = filterUsefulRecoveredUrls(extractAnyUrls(rawEmbedValue, pageUrl));
          const embedUrl = extractedUrls[0] || absoluteUrl(rawEmbedValue, pageUrl);
          if (embedUrl && !/youtube\.com|youtu\.be/i.test(embedUrl)) {
            embedUrls.push(...extractedUrls);
            embedUrls.push(embedUrl);
          }
        }
      } catch {}
    }
  } finally { if (sharedPage) await sharedPage.close().catch(() => {}); }
  return uniqueStrings(embedUrls);
}

async function resolveMatchedPage(target, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const logger = createLogger(options.logger);
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const candidatePaths = buildCandidatePaths(target);

  let bestMatch = null;
  let allBlocked = true;

  for (let i = 0; i < candidatePaths.length; i++) {
    const candidatePath = candidatePaths[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
    const pageUrl = `${baseUrl.replace(/\/+$/, '')}${candidatePath}`;

    let response, html, finalUrl;
    try {
      ({ response, html, finalUrl } = await fetchHtmlText(pageUrl, fetchImpl));
    } catch (err) {
      if (err?.message?.includes('TIMEOUT') || err?.message?.includes('CF_BLOCK')) break;
      continue;
    }

    if (isCloudflareBlock(response, html)) continue;
    allBlocked = false;

    if (isPageNotFound(response, html)) {
      continue;
    }

    const metadata = extractPageMetadata(html, pageUrl);
    const matchState = metadataMatchesTarget(metadata, target);
    const candidateResult = { ok: matchState.ok, status: matchState.ok ? 'matched' : 'mismatch', pageUrl, pagePath: candidatePath, html, metadata, matchScore: matchState.score || 0, matchReason: matchState.reason || '' };

    if (!bestMatch || matchState.score >= bestMatch.matchScore) bestMatch = candidateResult;
    if (matchState.ok) return candidateResult;

    if (matchState.reason === 'synopsis-mismatch') {
      const cleanPath = candidatePath.replace(/\/$/, '');
      let nextPath = null;
      const match = cleanPath.match(/^(.*)-(\d+)$/);
      if (match) {
        const num = parseInt(match[2], 10);
        if (num < 10) {
          nextPath = `${match[1]}-${num + 1}/`;
        }
      } else {
        nextPath = `${cleanPath}-2/`;
      }
      
      if (nextPath && !candidatePaths.includes(nextPath)) {
        candidatePaths.push(nextPath);
        logger.log(`[Method 3] Synopsis mismatch on ${cleanPath}. Dynamically queueing fallback: ${nextPath}`);
      }
    }
  }

  if (allBlocked && candidatePaths.length > 0) return { ok: false, status: 'failure', reason: 'cloudflare-blocked', candidatePaths };
  return bestMatch || { ok: false, status: 'failure', reason: 'no-matching-slug' };
}

function toArray(value) { return Array.isArray(value) ? value : [value]; }

async function scrapeMultimoviesTitle(input, options = {}) {
  const logger = createLogger(options.logger);
  if (!input?.title) throw new Error('title is required');

  const target = {
    mediaType: String(input.mediaType || 'movie').toLowerCase() === 'series' ? 'series' : 'movie',
    title: String(input.title).trim(),
    year: input.year ? Number(input.year) : null,
    seasonNumber: input.seasonNumber ? Number(input.seasonNumber) : null,
    episodeNumber: input.episodeNumber ? Number(input.episodeNumber) : null,
    episodeTitle: String(input.episodeTitle || '').trim(),
    synopsis: String(input.synopsis || input.overview || '').trim(),
    directors: uniqueStrings(toArray(input.director).map(normalizeLooseText)),
    cast: uniqueStrings(toArray(input.cast).map(normalizeLooseText))
  };

  const pageResult = options.pageResult || await resolveMatchedPage(target, options);
  if (!pageResult.ok) return pageResult;

  const fetchImpl = options.fetchImpl || global.fetch;
  const staticEmbedUrls = extractEmbedUrls(pageResult.html, pageResult.pageUrl);
  const ajaxEmbedUrls = await fetchAjaxEmbedUrls(pageResult.html, pageResult.pageUrl, fetchImpl, logger);
  const embedUrls = uniqueStrings([...staticEmbedUrls, ...ajaxEmbedUrls]);
  const playerResults = extractPlayerResultsFromSnapshotDir(options.snapshotAssetDir);
  const recoveredDownloads = [...extractDownloadUrls(pageResult.html, pageResult.pageUrl)];
  const directPageServers = extractServerItems(pageResult.html, pageResult.pageUrl);

  if (directPageServers.some((i) => i.available)) {
    if (typeof options.onSource === 'function') options.onSource(directPageServers.filter(s => s.available));
    playerResults.unshift({ playerUrl: pageResult.pageUrl, playerTitle: extractPlayerTitle(pageResult.html), years: extractPlayerYears(pageResult.html), languageHint: /hindi|\u0939\u093f\u0928\u094d\u0926\u0940|\u0939\u093f\u0902\u0926\u0940/i.test(pageResult.html) ? 'hindi' : '', servers: directPageServers });
  }

  if (embedUrls.length) {
    await Promise.all(embedUrls.map(async (url) => {
      try {
        const { response, html, finalUrl } = await fetchHtmlText(url, fetchImpl);
        const effectiveUrl = preferResolvedPlayerUrl(url, finalUrl);
        const sid = extractHelperSid(html);
        const dls = uniqueStrings([...createDownloadUrlCandidates(effectiveUrl, sid), ...extractDownloadUrls(html, effectiveUrl)]);
        recoveredDownloads.push(...dls);

        if (!response.ok) {
          const inferred = inferServerItemFromUrl(effectiveUrl);
          if (inferred) playerResults.push({ playerUrl: effectiveUrl, playerTitle: extractPlayerTitle(html), years: extractPlayerYears(html), languageHint: /hindi|\u0939\u093f\u0928\u094d\u0926\u0940|\u0939\u093f\u0902\u0926\u0940/i.test(html) ? 'hindi' : '', servers: normalizeServerItems([inferred]), downloads: dls });
          return;
        }

        const servers = await resolveServersFromPlayerPage(effectiveUrl, html, fetchImpl, logger, 0, new Set(), { onSource: options.onSource });
        if (servers.some((s) => s.available)) playerResults.push({ playerUrl: effectiveUrl, playerTitle: extractPlayerTitle(html), years: extractPlayerYears(html), languageHint: /hindi|\u0939\u093f\u0928\u094d\u0926\u0940|\u0939\u093f\u0902\u0926\u0940/i.test(html) ? 'hindi' : '', servers, downloads: dls });
      } catch {}
    }));
  }

  const mergedPlayers = normalizeServerItems(playerResults.flatMap((p) => p.servers || []).filter((s) => s?.available && s?.url));
  const latestPlayer = playerResults.find((p) => p.servers.some((s) => s.available));
  const enrichedMetadata = buildEnrichedMetadata(pageResult.metadata, playerResults);
  const finalMatch = fullyMatchesTarget(enrichedMetadata, target);

  const uniqueDownloads = uniqueStrings([...recoveredDownloads, ...playerResults.flatMap((p) => p.downloads || [])]);
  const hasPlayable = mergedPlayers.some((i) => i.available);
  const hasDownloads = uniqueDownloads.length > 0;

  return {
    ok: finalMatch.ok && (hasPlayable || hasDownloads),
    status: finalMatch.ok && (hasPlayable || hasDownloads) ? 'success' : 'failure',
    reason: !finalMatch.ok ? finalMatch.reason : hasPlayable ? 'matched-and-scraped' : hasDownloads ? 'matched-download-only' : 'no-player-links-found',
    searchKey: buildSearchKey(target),
    pageUrl: pageResult.pageUrl,
    pagePath: pageResult.pagePath,
    metadata: enrichedMetadata,
    players: mergedPlayers,
    downloads: uniqueDownloads,
    playerPages: playerResults.map((p) => ({ playerUrl: p.playerUrl, playerTitle: p.playerTitle, years: p.years, languageHint: p.languageHint })),
    matchStats: finalMatch.stats || { synopsisOverlap: 0, synopsisOverlapCount: 0, synopsisPhraseMatched: false, titleScore: 0 }
  };
}

function mergeSourceHistory(previousUrls = [], latestUrl = '') {
  const next = uniqueStrings([latestUrl, ...previousUrls]);
  return latestUrl ? next : uniqueStrings(previousUrls);
}

function buildSourceHistoryRecord(result, identity = {}) {
  const providerMap = Object.fromEntries(PREFERRED_SERVER_ORDER.map((key) => [key, []]));
  for (const player of result.players || []) {
    if (!player.available || !player.url || !providerMap[player.sourceKey]) continue;
    providerMap[player.sourceKey] = mergeSourceHistory(providerMap[player.sourceKey], player.url);
  }
  return { searchKey: result.searchKey || '', mediaType: identity.mediaType || 'movie', tmdbId: Number(identity.tmdbId || 0) || null, imdbId: String(identity.imdbId || '').trim(), title: String(identity.title || '').trim(), year: Number(identity.year || 0) || null, seasonNumber: Number(identity.seasonNumber || 0) || null, episodeNumber: Number(identity.episodeNumber || 0) || null, sources: providerMap, downloads: uniqueStrings(result.downloads || []), updatedAt: new Date() };
}

function mergeSourceHistoryRecord(existingRecord = {}, incomingRecord = {}) {
  const mergedSources = {};
  for (const sourceKey of PREFERRED_SERVER_ORDER) mergedSources[sourceKey] = mergeSourceHistory(existingRecord?.sources?.[sourceKey] || [], incomingRecord?.sources?.[sourceKey]?.[0] || '');
  return { ...Object.fromEntries(Object.entries(existingRecord).filter(([key]) => !['metadata', 'pageUrl', 'pagePath'].includes(key))), ...incomingRecord, createdAt: existingRecord?.createdAt || incomingRecord?.createdAt, sources: mergedSources, downloads: uniqueStrings([...(incomingRecord?.downloads || []), ...(existingRecord?.downloads || [])]), updatedAt: new Date() };
}

module.exports = {
  DEFAULT_BASE_URL,
  PREFERRED_SERVER_ORDER,
  fetchHtmlText,
  normalizeMultimoviesSlug,
  normalizeLooseText,
  buildSearchKey,
  buildCandidatePaths,
  extractPageMetadata,
  extractServerItems,
  extractPlayerResultsFromSnapshotDir,
  fullyMatchesTarget,
  synopsisStats,
  resolveMatchedPage,
  scrapeMultimoviesTitle,
  buildSourceHistoryRecord,
  mergeSourceHistoryRecord
};
