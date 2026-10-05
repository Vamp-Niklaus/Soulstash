"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFERRED_SERVER_ORDER = void 0;
exports.normalizeMultimoviesSlug = normalizeMultimoviesSlug;
exports.buildSearchKey = buildSearchKey;
exports.uniqueStrings = uniqueStrings;
exports.mergeSourceHistory = mergeSourceHistory;
exports.buildSourceHistoryRecord = buildSourceHistoryRecord;
exports.mergeSourceHistoryRecord = mergeSourceHistoryRecord;
exports.buildPlayerSourcePayload = buildPlayerSourcePayload;
exports.fetchTmdbPlayerIdentity = fetchTmdbPlayerIdentity;
const node_fetch_1 = __importDefault(require("node-fetch"));
const DIRECT_SOURCES = [
    {
        id: 'videasy', label: 'VIDEASY',
        template: (m, t, s, e) => (m === 'tv' || m === 'series')
            ? `https://player.videasy.to/tv/${t}/${s || 1}/${e || 1}?color=F97316&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true`
            : `https://player.videasy.to/movie/${t}?color=F97316&overlay=true`
    },
    {
        id: 'vidfast', label: 'vidfast',
        template: (m, t, s, e) => (m === 'tv' || m === 'series')
            ? `https://vidfast.pro/tv/${t}/${s || 1}/${e || 1}?autoPlay=true&title=true&poster=true&theme=F97316&nextButton=true&autoNext=true`
            : `https://vidfast.pro/movie/${t}?autoPlay=true&title=true&poster=true&theme=F97316`
    }
];
exports.PREFERRED_SERVER_ORDER = [
    'smwh',
    'rpmshre',
    'upnshr',
    'strmp2',
    'flls',
    'youtube'
];
function sanitizeProviderUrls(sources) {
    if (!sources)
        return [];
    const urls = Array.isArray(sources) ? sources : [sources];
    return urls
        .map((u) => (typeof u === 'string' ? u.trim() : u?.url ? u.url.trim() : ''))
        .filter((u) => u && u.startsWith('http') && !u.includes('undefined'));
}
function normalizeMultimoviesSlug(title = '') {
    return String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, '-');
}
function buildSearchKey({ mediaType = 'movie', title = '', seasonNumber = null, episodeNumber = null }) {
    const baseSlug = normalizeMultimoviesSlug(title);
    if (!baseSlug)
        return '';
    if (String(mediaType).toLowerCase() === 'series') {
        return `${baseSlug}-${Number(seasonNumber || 1)}x${Number(episodeNumber || 1)}`;
    }
    return baseSlug;
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}
function mergeSourceHistory(previousUrls = [], latestUrl = '') {
    const next = uniqueStrings([latestUrl, ...previousUrls]);
    return latestUrl ? next : uniqueStrings(previousUrls);
}
function buildSourceHistoryRecord(result, identity = {}) {
    const providerMap = Object.fromEntries(exports.PREFERRED_SERVER_ORDER.map((key) => [key, []]));
    for (const player of result.players || []) {
        if (!player.available || !player.url || !providerMap[player.sourceKey])
            continue;
        providerMap[player.sourceKey] = mergeSourceHistory(providerMap[player.sourceKey], player.url);
    }
    return { searchKey: result.searchKey || '', mediaType: identity.mediaType || 'movie', tmdbId: Number(identity.tmdbId || 0) || null, imdbId: String(identity.imdbId || '').trim(), title: String(identity.title || '').trim(), year: Number(identity.year || 0) || null, seasonNumber: Number(identity.seasonNumber || 0) || null, episodeNumber: Number(identity.episodeNumber || 0) || null, sources: providerMap, downloads: uniqueStrings(result.downloads || []), updatedAt: new Date() };
}
function mergeSourceHistoryRecord(existingRecord = {}, incomingRecord = {}) {
    const mergedSources = {};
    for (const sourceKey of exports.PREFERRED_SERVER_ORDER)
        mergedSources[sourceKey] = mergeSourceHistory(existingRecord?.sources?.[sourceKey] || [], incomingRecord?.sources?.[sourceKey]?.[0] || '');
    return { ...Object.fromEntries(Object.entries(existingRecord).filter(([key]) => !['metadata', 'pageUrl', 'pagePath'].includes(key))), ...incomingRecord, createdAt: existingRecord?.createdAt || incomingRecord?.createdAt, sources: mergedSources, downloads: uniqueStrings([...(incomingRecord?.downloads || []), ...(existingRecord?.downloads || [])]), updatedAt: new Date() };
}
function buildPlayerSourcePayload(record = {}, identity = null, isScraping = false) {
    const mediaType = record.mediaType || identity?.mediaType || 'movie';
    const tmdbId = record.tmdbId || identity?.tmdbId || null;
    const season = record.seasonNumber || identity?.seasonNumber || 1;
    const episode = record.episodeNumber || identity?.episodeNumber || 1;
    const multimoviesSources = exports.PREFERRED_SERVER_ORDER.map((sourceKey, index) => {
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
        if (!url)
            return null;
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
function normalizePlayerMediaType(val) {
    const t = String(val || '').toLowerCase().trim();
    return (t === 'tv' || t === 'series') ? 'series' : 'movie';
}
function tmdbHeaders() {
    const token = process.env.TMDB_BEARER_TOKEN || '';
    return {
        accept: 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
    };
}
const TMDB_BASE_URL = (process.env.TMDB_BASE_URL || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');
async function tmdbFetch(url, options, context = 'TMDB API') {
    if (url.startsWith('https://api.themoviedb.org')) {
        url = url.replace('https://api.themoviedb.org', TMDB_BASE_URL);
    }
    return (0, node_fetch_1.default)(url, options);
}
async function fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
    const normalizedMediaType = normalizePlayerMediaType(mediaType);
    const numericTmdbId = Number(tmdbId || 0);
    if (!numericTmdbId) {
        throw new Error('Valid tmdbId is required.');
    }
    const detailUrl = normalizedMediaType === 'movie'
        ? `https://api.themoviedb.org/3/movie/${numericTmdbId}?language=en-US`
        : `https://api.themoviedb.org/3/tv/${numericTmdbId}?language=en-US`;
    const episodeUrl = normalizedMediaType === 'series'
        ? `https://api.themoviedb.org/3/tv/${numericTmdbId}/season/${Number(seasonNumber || 1)}/episode/${Number(episodeNumber || 1)}?language=en-US`
        : '';
    const ep1Url = normalizedMediaType === 'series' && (Number(seasonNumber || 1) !== 1 || Number(episodeNumber || 1) !== 1)
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
//# sourceMappingURL=playerSourcesHelpers.js.map