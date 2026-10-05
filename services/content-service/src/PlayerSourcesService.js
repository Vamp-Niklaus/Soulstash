"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerSourcesService = exports.refreshLocks = void 0;
const playerSourcesHelpers_1 = require("./utils/playerSourcesHelpers");
// Remove local scrapeWithMultimoviesConfig import
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
/** In-process lock set — prevents concurrent duplicate scrapes */
exports.refreshLocks = new Set();
/**
 * PlayerSourcesService
 * Orchestrates the three-method source resolution pipeline:
 *   Method 1 — PlayerSources DB cache
 *   Method 2 — Movie_Sources / TVShowURLs synopsis match (inside legacyPlayerSources)
 *   Method 3 — Multimovies Playwright scrape (inside legacyPlayerSources)
 *
 * This class holds zero scraping logic itself.
 * It delegates to legacyPlayerSources.js for Methods 2 & 3 and
 * to PlayerSourcesRepository for all DB reads/writes.
 */
class PlayerSourcesService {
    constructor(repo) {
        this.repo = repo;
    }
    // ─── Lock helpers ─────────────────────────────────────────────────────────
    isLocked(identity) {
        const searchKey = (0, playerSourcesHelpers_1.buildSearchKey)({ ...identity });
        const masterKey = identity.mediaType === 'series' ? `series-master-${identity.tmdbId}` : '';
        const epKey = identity.mediaType === 'series'
            ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : '';
        return (exports.refreshLocks.has(searchKey) ||
            exports.refreshLocks.has(masterKey) ||
            (!!epKey && exports.refreshLocks.has(epKey)));
    }
    // ─── Direct sources (no scraping needed) ──────────────────────────────────
    buildDirectSources(identity) {
        if (!identity.tmdbId)
            return [];
        return DIRECT_SOURCES.map(s => ({
            sourceKey: s.id,
            serverName: s.label,
            url: s.template(identity.mediaType, identity.tmdbId, identity.seasonNumber ?? 1, identity.episodeNumber ?? 1),
            available: true,
            preferred: false,
            isDirect: true
        }));
    }
    // ─── Main pipeline ────────────────────────────────────────────────────────
    /**
     * Kicks off the full scrape pipeline (Methods 2 + 3) in the background.
     * Returns immediately — callers poll via getPlayerSources.
     */
    async startBackgroundRefresh(identity) {
        const searchKey = (0, playerSourcesHelpers_1.buildSearchKey)({ ...identity });
        if (exports.refreshLocks.has(searchKey))
            return;
        if (!identity.title) {
            console.warn('[PlayerSourcesService] startBackgroundRefresh skipped — identity has no title');
            return;
        }
        exports.refreshLocks.add(searchKey);
        const epLockKey = identity.mediaType === 'series'
            ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : null;
        if (epLockKey)
            exports.refreshLocks.add(epLockKey);
        try {
            const reqId = Math.random().toString(36).substr(2, 4).toUpperCase();
            console.log('[Player Sources] refresh START', {
                mediaType: identity.mediaType,
                tmdbId: identity.tmdbId,
                title: identity.title
            });
            // Send to scraper-service and await completion so the local lock is held
            const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3004';
            await (0, node_fetch_1.default)(`${SCRAPER_SERVICE_URL}/api/scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identity })
            }).catch(err => {
                console.error('[Player Sources] Failed to call scraper-service:', err.message);
            });
            console.log('[Player Sources] Background scrape in scraper-service completed for tmdbId:', identity.tmdbId);
        }
        catch (err) {
            console.error('[PlayerSourcesService] refresh failed:', err.message);
            await this.repo.stampFailure(identity, false);
        }
        finally {
            exports.refreshLocks.delete(searchKey);
            if (epLockKey)
                exports.refreshLocks.delete(epLockKey);
        }
    }
    /**
     * Waits up to maxWaitMs for at least one source to appear in DB.
     * Used by the initial request when there is no cached record.
     */
    async waitForFirstSource(identity, maxWaitMs = 60000) {
        const intervalMs = 500;
        const maxAttempts = maxWaitMs / intervalMs;
        const searchKey = (0, playerSourcesHelpers_1.buildSearchKey)({ ...identity });
        const epLockKey = identity.mediaType === 'series'
            ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : null;
        for (let i = 0; i < maxAttempts; i++) {
            const doc = await this.repo.findByTmdbId(identity.tmdbId, identity.mediaType);
            if (this.repo.countSources(doc, identity) > 0) {
                console.log(`[Player Sources] First source found after ${(i * intervalMs / 1000).toFixed(1)}s!`);
                return doc;
            }
            const stillRunning = exports.refreshLocks.has(searchKey) || (!!epLockKey && exports.refreshLocks.has(epLockKey));
            if (!stillRunning)
                break;
            await new Promise(r => setTimeout(r, intervalMs));
        }
        return null;
    }
}
exports.PlayerSourcesService = PlayerSourcesService;
//# sourceMappingURL=PlayerSourcesService.js.map