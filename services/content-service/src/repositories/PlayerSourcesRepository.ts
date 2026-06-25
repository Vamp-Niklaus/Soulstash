import { IPlayerIdentity, IPlayerSource, IPlayerSourceResult } from '../../../shared/src/interfaces/IVideoScraper';

import {
  buildSearchKey,
  buildSourceHistoryRecord,
  mergeSourceHistoryRecord,
  PREFERRED_SERVER_ORDER
} from '../utils/playerSourcesHelpers';

/**
 * PlayerSourcesRepository
 * Single place for all PlayerSources MongoDB reads and writes.
 * Content-service's ContentController and the scraping pipeline
 * both go through here — never talk to the collection directly.
 */
export class PlayerSourcesRepository {
  private readonly collection: any;

  constructor(db: any) {
    this.collection = db.collection('PlayerSources');
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async findByTmdbId(tmdbId: number, mediaType: string): Promise<any | null> {
    return this.collection.findOne({ tmdbId, mediaType });
  }

  async findBySearchKey(searchKey: string): Promise<any | null> {
    return this.collection.findOne({ searchKey });
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  /**
   * Incremental upsert — merges incoming sources with whatever is already in DB.
   * Called by onSource callbacks as the scraper finds sources one-by-one.
   */
  async mergeSources(identity: IPlayerIdentity, incomingSources: IPlayerSource[]): Promise<void> {
    if (!incomingSources.length) return;
    const searchKey = buildSearchKey({ ...identity });
    const updateFilter = { tmdbId: identity.tmdbId, mediaType: identity.mediaType };
    const epKey = identity.mediaType === 'series'
      ? `s${identity.seasonNumber}e${identity.episodeNumber}` : null;

    const existingDoc = await this.collection.findOne(updateFilter);
    const existingSources = epKey
      ? (existingDoc?.episodes?.[epKey]?.sources || {})
      : (existingDoc?.sources || {});
    const existingDownloads = epKey
      ? (existingDoc?.episodes?.[epKey]?.downloads || [])
      : (existingDoc?.downloads || []);

    const incoming = buildSourceHistoryRecord(
      { players: incomingSources, searchKey: searchKey || '' },
      identity
    );
    const merged = mergeSourceHistoryRecord(
      { sources: existingSources, downloads: existingDownloads },
      incoming
    );

    const updateSet: Record<string, any> = {
      tmdbId: identity.tmdbId,
      imdbId: identity.imdbId || '',
      mediaType: identity.mediaType,
      title: identity.title || '',
      year: identity.year || null,
      overview: identity.overview || '',
      searchKey: identity.mediaType === 'series'
        ? `series-master-${identity.tmdbId}`
        : (searchKey || ''),
      updatedAt: new Date()
    };

    if (epKey) {
      updateSet[`episodes.${epKey}.sources`] = merged.sources;
      updateSet[`episodes.${epKey}.downloads`] = merged.downloads;
    } else {
      updateSet.sources = merged.sources;
      updateSet.downloads = merged.downloads;
    }

    await this.collection.updateOne(
      updateFilter,
      { $set: updateSet, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  /**
   * Final upsert after scrape completes — writes merged sources + all identity fields.
   */
  async saveFinalResult(identity: IPlayerIdentity, result: IPlayerSourceResult): Promise<void> {
    const updateFilter = { tmdbId: identity.tmdbId, mediaType: identity.mediaType };
    const epKey = identity.mediaType === 'series'
      ? `s${identity.seasonNumber}e${identity.episodeNumber}` : null;

    const existingDoc = await this.collection.findOne(updateFilter);
    const existingRecord = epKey && existingDoc?.episodes
      ? { sources: existingDoc.episodes[epKey]?.sources || {}, downloads: existingDoc.episodes[epKey]?.downloads || [] }
      : (existingDoc || {});

    const incomingRecord = buildSourceHistoryRecord(result, identity);
    const mergedRecord = mergeSourceHistoryRecord(existingRecord, incomingRecord);

    const updateSet: Record<string, any> = {
      tmdbId: identity.tmdbId,
      imdbId: identity.imdbId || '',
      mediaType: identity.mediaType,
      title: identity.title || '',
      year: identity.year || null,
      overview: identity.overview || '',
      searchKey: identity.mediaType === 'series'
        ? `series-master-${identity.tmdbId}`
        : (incomingRecord.searchKey || ''),
      lastScrapeAttempt: Date.now(),
      updatedAt: new Date()
    };

    if (epKey) {
      updateSet[`episodes.${epKey}.sources`] = mergedRecord.sources;
      updateSet[`episodes.${epKey}.downloads`] = mergedRecord.downloads;
      if (result.pageUrl) updateSet[`episodes.${epKey}.pageUrl`] = result.pageUrl;
      updateSet.isWholeSeries = true;
    } else {
      updateSet.sources = mergedRecord.sources;
      updateSet.downloads = mergedRecord.downloads;
    }

    await this.collection.updateOne(
      updateFilter,
      { $set: updateSet, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  /**
   * Stamps lastScrapeAttempt (and optionally notAvailable) after a failed scrape.
   */
  async stampFailure(identity: IPlayerIdentity, notAvailable = false): Promise<void> {
    const updateFilter = { tmdbId: identity.tmdbId, mediaType: identity.mediaType };
    const epKey = identity.mediaType === 'series'
      ? `s${identity.seasonNumber}e${identity.episodeNumber}` : null;

    const stamp: Record<string, any> = {
      lastScrapeAttempt: Date.now(),
      updatedAt: new Date()
    };
    if (epKey) stamp[`episodes.${epKey}.lastScrapeAttempt`] = Date.now();

    if (notAvailable) {
      stamp.mediaType = identity.mediaType;
      stamp.tmdbId = identity.tmdbId;
      stamp.imdbId = identity.imdbId || '';
      stamp.title = identity.title || '';
      stamp.year = identity.year || null;
      stamp.notAvailable = true;
      if (epKey) {
        stamp[`episodes.${epKey}.sources`] = Object.fromEntries(PREFERRED_SERVER_ORDER.map((k: string) => [k, []]));
        stamp[`episodes.${epKey}.downloads`] = [];
      } else {
        stamp.sources = Object.fromEntries(PREFERRED_SERVER_ORDER.map((k: string) => [k, []]));
        stamp.downloads = [];
      }
    }

    await this.collection.updateOne(
      updateFilter,
      { $set: stamp, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }

  hasSources(doc: any, identity: IPlayerIdentity): boolean {
    if (!doc) return false;
    if (identity.mediaType === 'series') {
      const epKey = `s${identity.seasonNumber}e${identity.episodeNumber}`;
      const epData = doc.episodes?.[epKey];
      return epData?.sources
        ? PREFERRED_SERVER_ORDER.some((k: string) => (epData.sources[k] || []).length > 0)
        : false;
    }
    return doc.sources
      ? PREFERRED_SERVER_ORDER.some((k: string) => (doc.sources[k] || []).length > 0)
      : false;
  }

  countSources(doc: any, identity: IPlayerIdentity): number {
    if (!doc) return 0;
    if (identity.mediaType === 'series') {
      const epKey = `s${identity.seasonNumber}e${identity.episodeNumber}`;
      const epData = doc.episodes?.[epKey];
      return epData?.sources
        ? Object.values(epData.sources).flat().filter(Boolean).length
        : 0;
    }
    return doc.sources
      ? Object.values(doc.sources).flat().filter(Boolean).length
      : 0;
  }
}
