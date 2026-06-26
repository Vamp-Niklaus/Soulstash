import { IPlayerIdentity, IPlayerSource } from '../../shared/src/interfaces/IVideoScraper';
import { PlayerSourcesRepository } from './repositories/PlayerSourcesRepository';

import { buildSearchKey } from './utils/playerSourcesHelpers';
// Remove local scrapeWithMultimoviesConfig import
import fetch from 'node-fetch';

const DIRECT_SOURCES = [
  {
    id: 'videasy', label: 'VIDEASY',
    template: (m: string, t: number, s: number, e: number) =>
      (m === 'tv' || m === 'series')
        ? `https://player.videasy.to/tv/${t}/${s || 1}/${e || 1}?color=F97316&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true`
        : `https://player.videasy.to/movie/${t}?color=F97316&overlay=true`
  },
  {
    id: 'vidfast', label: 'vidfast',
    template: (m: string, t: number, s: number, e: number) =>
      (m === 'tv' || m === 'series')
        ? `https://vidfast.pro/tv/${t}/${s || 1}/${e || 1}?autoPlay=true&title=true&poster=true&theme=F97316&nextButton=true&autoNext=true`
        : `https://vidfast.pro/movie/${t}?autoPlay=true&title=true&poster=true&theme=F97316`
  }
];

/** In-process lock set — prevents concurrent duplicate scrapes */
export const refreshLocks = new Set<string>();

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
export class PlayerSourcesService {
  constructor(private readonly repo: PlayerSourcesRepository) {}

  // ─── Lock helpers ─────────────────────────────────────────────────────────

  isLocked(identity: IPlayerIdentity): boolean {
    const searchKey = buildSearchKey({ ...identity });
    const masterKey = identity.mediaType === 'series' ? `series-master-${identity.tmdbId}` : '';
    const epKey = identity.mediaType === 'series'
      ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : '';
    return (
      refreshLocks.has(searchKey) ||
      refreshLocks.has(masterKey) ||
      (!!epKey && refreshLocks.has(epKey))
    );
  }

  // ─── Direct sources (no scraping needed) ──────────────────────────────────

  buildDirectSources(identity: IPlayerIdentity): IPlayerSource[] {
    if (!identity.tmdbId) return [];
    return DIRECT_SOURCES.map(s => ({
      sourceKey: s.id,
      serverName: s.label,
      url: s.template(
        identity.mediaType,
        identity.tmdbId,
        identity.seasonNumber ?? 1,
        identity.episodeNumber ?? 1
      ),
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
  async startBackgroundRefresh(identity: IPlayerIdentity): Promise<void> {
    const searchKey = buildSearchKey({ ...identity });
    if (refreshLocks.has(searchKey)) return;
    if (!identity.title) {
      console.warn('[PlayerSourcesService] startBackgroundRefresh skipped — identity has no title');
      return;
    }

    refreshLocks.add(searchKey);
    const epLockKey = identity.mediaType === 'series'
      ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : null;
    if (epLockKey) refreshLocks.add(epLockKey);

    try {
      const reqId = Math.random().toString(36).substr(2, 4).toUpperCase();

      console.log('[Player Sources] refresh START', {
        mediaType: identity.mediaType,
        tmdbId: identity.tmdbId,
        title: identity.title
      });

      // Send to scraper-service and await completion so the local lock is held
      const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3004';
      await fetch(`${SCRAPER_SERVICE_URL}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity })
      }).catch(err => {
         console.error('[Player Sources] Failed to call scraper-service:', err.message);
      });

      console.log('[Player Sources] Background scrape in scraper-service completed for tmdbId:', identity.tmdbId);
    } catch (err: any) {
      console.error('[PlayerSourcesService] refresh failed:', err.message);
      await this.repo.stampFailure(identity, false);
    } finally {
      refreshLocks.delete(searchKey);
      if (epLockKey) refreshLocks.delete(epLockKey);
    }
  }

  /**
   * Waits up to maxWaitMs for at least one source to appear in DB.
   * Used by the initial request when there is no cached record.
   */
  async waitForFirstSource(
    identity: IPlayerIdentity,
    maxWaitMs = 60000
  ): Promise<any | null> {
    const intervalMs = 500;
    const maxAttempts = maxWaitMs / intervalMs;
    const searchKey = buildSearchKey({ ...identity });
    const epLockKey = identity.mediaType === 'series'
      ? `series-${identity.tmdbId}-s${identity.seasonNumber}e${identity.episodeNumber}` : null;

    for (let i = 0; i < maxAttempts; i++) {
      const doc = await this.repo.findByTmdbId(identity.tmdbId, identity.mediaType);
      if (this.repo.countSources(doc, identity) > 0) {
        console.log(`[Player Sources] First source found after ${(i * intervalMs / 1000).toFixed(1)}s!`);
        return doc;
      }
      const stillRunning = refreshLocks.has(searchKey) || (!!epLockKey && refreshLocks.has(epLockKey));
      if (!stillRunning) break;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
  }
}
