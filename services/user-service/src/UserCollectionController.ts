import { Request, Response } from 'express';
import { MongoUserRepository } from './repositories/MongoUserRepository';
import { logger } from '../../shared/src/utils/Logger';
import { ObjectId } from 'mongodb';

const DEFAULT_COLLECTION_NAMES = ['Watched', 'Watchlist'];
const DEFAULT_COLLECTION_BANNER = 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class UserCollectionController {
  constructor(private readonly repository: MongoUserRepository) {}

  public async getCollections(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const coll = await this.repository.connect();
      const doc = await coll.findOne({ username: user.username });
      
      if (!doc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Deduplicate by name (keep first occurrence). Heals any duplicates
      // created before the 409 check was added.
      const raw: any[] = doc.collections || [];
      const seenNames = new Set<string>();
      const deduplicated = raw.filter((c: any) => {
        const key = String(c.name || '').trim().toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

      if (deduplicated.length !== raw.length) {
        // Write the cleaned-up list back so the DB is healed too
        await coll.updateOne(
          { username: user.username },
          { $set: { collections: deduplicated } }
        );
      }

      res.json(deduplicated);
    } catch (error: any) {
      logger.error(`[UserCollectionController] getCollections error: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch collections' });
    }
  }

  public async getPublicCollection(req: Request, res: Response): Promise<void> {
    try {
      const { username, collectionName } = req.params;
      const coll = await this.repository.connect();
      
      const doc = await coll.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
      if (!doc) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      
      const collection = (doc.collections || []).find((c: any) => 
        c.name?.toLowerCase() === (collectionName as string)?.toLowerCase()
      );
      
      if (!collection || (!collection.isPublic && !collection.isPublished)) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      
      res.json(collection);
    } catch (error: any) {
      logger.error(`[UserCollectionController] getPublicCollection error: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch collection' });
    }
  }

  public async createCollection(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const payload = req.body || {};
      const collectionName = String(payload.name || '').trim();
      if (!collectionName) {
        res.status(400).json({ error: 'Collection name is required' });
        return;
      }

      const coll = await this.repository.connect();
      const duplicateNamePattern = new RegExp(`^${escapeRegex(collectionName)}$`, 'i');
      
      const newCollection = {
        _id: new ObjectId().toString(),
        name: collectionName,
        description: payload.description || '',
        banner: payload.banner || DEFAULT_COLLECTION_BANNER,
        isDeletable: true,
        isPublic: !!payload.isPublic,
        isPublished: !!payload.isPublished,
        movieCount: 0,
        movies: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const latest = await coll.findOneAndUpdate(
        {
          username: user.username,
          collections: { $not: { $elemMatch: { name: duplicateNamePattern } } }
        },
        { $push: { collections: newCollection } as any, $inc: { collectionVersion: 1 } },
        { returnDocument: 'after' }
      );

      if (!latest) {
        const existing = await coll.findOne({ username: user.username }, { projection: { collections: 1 } });
        if (!existing) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const duplicate = (existing.collections || []).some(
          (c: any) => duplicateNamePattern.test(String(c.name || '').trim())
        );
        res.status(duplicate ? 409 : 500).json({
          error: duplicate
            ? `A collection named "${collectionName}" already exists`
            : 'Failed to create collection'
        });
        return;
      }

      res.json({
        success: true,
        collection: newCollection,
        collections: latest?.collections || [],
        collectionVersion: Number(latest?.collectionVersion || 0)
      });
    } catch (error: any) {
      logger.error(`[UserCollectionController] createCollection error: ${error.message}`);
      res.status(500).json({ error: 'Failed to create collection' });
    }
  }

  public async updateCollection(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const id = req.params.id;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const payload = req.body || {};
      const coll = await this.repository.connect();
      
      const updateDoc: any = {};
      if (payload.name !== undefined) updateDoc['collections.$.name'] = payload.name;
      if (payload.description !== undefined) updateDoc['collections.$.description'] = payload.description;
      if (payload.banner !== undefined) updateDoc['collections.$.banner'] = payload.banner;
      if (payload.isPublic !== undefined) updateDoc['collections.$.isPublic'] = payload.isPublic;
      if (payload.isPublished !== undefined) updateDoc['collections.$.isPublished'] = payload.isPublished;
      updateDoc['collections.$.updatedAt'] = new Date();

      const updateResult = await coll.updateOne(
        { username: user.username, 'collections._id': id },
        { $set: updateDoc }
      );
      
      // Also try updating by name (for legacy 'Watched'/'Watchlist' which might lack _id)
      const fallbackResult = await coll.updateOne(
        { username: user.username, 'collections.name': id, 'collections._id': { $exists: false } },
        { $set: updateDoc }
      );

      if ((updateResult.modifiedCount || 0) === 0 && (fallbackResult.modifiedCount || 0) === 0) {
        const existing = await coll.findOne({ username: user.username });
        if (!existing) {
          res.status(404).json({ error: 'Collection not found' });
          return;
        }
      }

      const latest = await coll.findOne({ username: user.username });
      res.json({
        success: true,
        collections: latest?.collections || [],
        collectionVersion: Number(latest?.collectionVersion || 0)
      });
    } catch (error: any) {
      logger.error(`[UserCollectionController] updateCollection error: ${error.message}`);
      res.status(500).json({ error: 'Failed to update collection' });
    }
  }

  public async deleteCollection(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const id = req.params.id;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const coll = await this.repository.connect();
      
      await coll.updateOne(
        { username: user.username },
        { $pull: { collections: { _id: id, isDeletable: true } } } as any
      );
      
      await coll.updateOne(
        { username: user.username },
        { $pull: { collections: { name: id, isDeletable: true } } } as any
      );
      
      res.json({ success: true });
    } catch (error: any) {
      logger.error(`[UserCollectionController] deleteCollection error: ${error.message}`);
      res.status(500).json({ error: 'Failed to delete collection' });
    }
  }


  // ── Anime detection (mirrors original routes/collections.js) ──────────────
  private isAnimeContent(item: any): boolean {
    const hasAnimation = Array.isArray(item.genres) &&
      item.genres.some((g: any) => (typeof g === 'string' ? g : g?.name) === 'Animation');
    if (!hasAnimation) return false;
    const asianLangs = ['ja', 'zh', 'ko'];
    const asianCountries = ['JP', 'CN', 'KR'];
    const originCountry = item.origin_country || item.production_countries || [];
    const isAsianCountry = Array.isArray(originCountry)
      ? originCountry.some((c: any) => asianCountries.includes(typeof c === 'string' ? c : c?.iso_3166_1))
      : asianCountries.includes(String(originCountry));
    return asianLangs.includes(item.original_language) && isAsianCountry;
  }

  private validVoteAverage(v: any): number | null {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private validImdbRating(v: any): number | null {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
  }

  public async addItem(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const collectionId = req.params.id;
      if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const { movieId, seriesId, title, poster_path, release_date, media_type } = req.body || {};
      if (!movieId && !seriesId) {
        res.status(400).json({ error: 'Movie ID or Series ID is required' }); return;
      }

      const contentId = Number(movieId || seriesId);
      const contentType: string = String(media_type || (seriesId ? 'Series' : 'Movie'));
      const TMDB_BASE = (process.env.TMDB_BASE_URL || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');
      const TMDB_TOKEN = String(process.env.TMDB_BEARER_TOKEN || '').trim();

      const coll = await this.repository.connect();
      const doc = await coll.findOne({ username: user.username });
      if (!doc) { res.status(404).json({ error: 'User not found' }); return; }

      const colIdx = (doc.collections || []).findIndex(
        (c: any) => (c._id || c.name) === collectionId || c.name === collectionId
      );
      if (colIdx === -1) { res.status(404).json({ error: 'Collection not found' }); return; }
      const col = doc.collections[colIdx];

      const alreadyIn = (col.movies || []).find(
        (m: any) => Number(m.movieId || m.seriesId) === contentId
      );
      if (alreadyIn) { res.status(409).json({ error: 'Content already in collection' }); return; }

      // Watched <-> Watchlist mutual exclusion (same as original)
      if (collectionId === 'Watchlist' || collectionId === 'Watched') {
        const opposite = collectionId === 'Watchlist' ? 'Watched' : 'Watchlist';
        const oppCol = (doc.collections || []).find((c: any) => c.name === opposite);
        if (oppCol?.movies?.find((m: any) => Number(m.movieId || m.seriesId) === contentId)) {
          const filteredOppMovies = (oppCol.movies || []).filter(
            (m: any) => Number(m.id || m.movieId || m.seriesId || 0) !== contentId
          );
          await coll.updateOne(
            { username: user.username, 'collections.name': opposite },
            {
              $set: {
                'collections.$.movies': filteredOppMovies,
                'collections.$.movieCount': filteredOppMovies.length,
                'collections.$.updatedAt': new Date()
              }
            }
          );
        }
      }

      // TMDB detail fetch — resolves isAnime, vote_average, imdb_id, poster, title
      let isAnime = false;
      let vote_average: number | null = null;
      let imdb_id = '';
      let imdb_rating: number | null = null;
      let resolvedTitle = title || `${contentType} ${contentId}`;
      let resolvedPosterPath = poster_path || '';
      let resolvedReleaseDate = release_date || new Date().toISOString().split('T')[0];

      try {
        const tmdbUrl = contentType === 'Series'
          ? `${TMDB_BASE}/3/tv/${contentId}?language=en-US`
          : `${TMDB_BASE}/3/movie/${contentId}?language=en-US`;
        logger.info(`[addItem] TMDB fetch ${tmdbUrl}`);
        const resp = await fetch(tmdbUrl, {
          headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
        });
        if (resp.ok) {
          const details: any = await resp.json();
          isAnime = this.isAnimeContent(details);
          vote_average = this.validVoteAverage(details.vote_average);
          imdb_id = String(details.imdb_id || details.external_ids?.imdb_id || '').trim();
          resolvedTitle = details.title || details.name || resolvedTitle;
          resolvedPosterPath = details.poster_path || resolvedPosterPath;
          resolvedReleaseDate = details.release_date || details.first_air_date || resolvedReleaseDate;
          logger.info(`[addItem] resolved title="${resolvedTitle}" isAnime=${isAnime} vote_average=${vote_average} imdb_id="${imdb_id}"`);

          // For series without imdb_id in main detail, fetch external_ids
          if (!imdb_id && contentType === 'Series') {
            try {
              const extResp = await fetch(`${TMDB_BASE}/3/tv/${contentId}/external_ids`, {
                headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_TOKEN}` }
              });
              if (extResp.ok) {
                const ext: any = await extResp.json();
                imdb_id = String(ext.imdb_id || '').trim();
              }
            } catch { /* skip */ }
          }
        } else {
          logger.warn(`[addItem] TMDB returned ${resp.status} for contentId=${contentId}`);
        }
      } catch (e: any) {
        logger.error(`[addItem] TMDB fetch error: ${e.message}`);
      }

      const contentData = contentType === 'Series'
        ? { seriesId: contentId, movieId: null, title: resolvedTitle, poster_path: resolvedPosterPath, release_date: resolvedReleaseDate, first_air_date: resolvedReleaseDate, media_type: 'Series', id: contentId, isAnime, vote_average, imdb_id, imdb_rating, addedAt: new Date() }
        : { movieId: contentId, seriesId: null, title: resolvedTitle, poster_path: resolvedPosterPath, release_date: resolvedReleaseDate, first_air_date: '', media_type: 'Movie', id: contentId, isAnime, vote_average, imdb_id, imdb_rating, addedAt: new Date() };

      // $position: 0 — newest item appears first (sort by recent = insertion order descending)
      const updateResult = await coll.updateOne(
        { username: user.username, 'collections.name': col.name },
        {
          $push: { 'collections.$.movies': { $each: [contentData], $position: 0 } } as any,
          $set: { updatedAt: new Date(), 'collections.$.updatedAt': new Date() },
          $inc: { collectionVersion: 1 }
        }
      );
      if (updateResult.modifiedCount === 0) {
        res.status(500).json({ error: 'Failed to update collection' }); return;
      }

      const latest = await coll.findOne({ username: user.username });
      logger.info(`[addItem] DONE title="${resolvedTitle}" isAnime=${isAnime} collection="${collectionId}"`);
      res.json({
        success: true,
        message: `Added "${resolvedTitle}" to Collection!`,
        isAnime,
        collections: latest?.collections || [],
        collectionVersion: Number(latest?.collectionVersion || 0)
      });
    } catch (error: any) {
      logger.error(`[UserCollectionController] addItem error: ${error.message}`);
      res.status(500).json({ error: 'Failed to add item' });
    }
  }



  public async removeItem(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const collectionId = req.params.id;
      const { id, movieId, seriesId } = req.body || {}; // itemId
      const contentId = Number(id || movieId || seriesId || 0);
      
      if (!user || !contentId) {
        res.status(400).json({ error: 'Missing required params' });
        return;
      }
      
      const coll = await this.repository.connect();

      // Fetch the document first so we can filter the movies array in-memory.
      // MongoDB's $pull with $or inside a positional operator ($) is not
      // supported — items can be stored under movieId, seriesId, or id so we
      // must handle all three field names ourselves.
      const doc = await coll.findOne({ username: user.username });
      if (!doc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Find the target collection by _id first, then fall back to name
      const colIdx = (doc.collections || []).findIndex(
        (c: any) => String(c._id) === String(collectionId) || c.name === collectionId
      );
      if (colIdx === -1) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      const col = doc.collections[colIdx];
      const filteredMovies = (col.movies || []).filter(
        (m: any) => Number(m.id || m.movieId || m.seriesId || 0) !== contentId
      );

      // Build the positional match query using whatever identifier the collection has
      const matchQuery: any = { username: user.username };
      if (col._id) {
        matchQuery['collections._id'] = col._id;
      } else {
        matchQuery['collections.name'] = col.name;
      }

      const actualLength = filteredMovies.length;

      const latest = await coll.findOneAndUpdate(
        matchQuery,
        { 
          $set: { 
            'collections.$.movies': filteredMovies,
            'collections.$.movieCount': actualLength,
            'collections.$.updatedAt': new Date()
          },
          $inc: { collectionVersion: 1 } 
        },
        { returnDocument: 'after' }
      );

      res.json({
        success: true,
        collections: latest?.collections || [],
        collectionVersion: Number(latest?.collectionVersion || 0)
      });
    } catch (error: any) {
      logger.error(`[UserCollectionController] removeItem error: ${error.message}`);
      res.status(500).json({ error: 'Failed to remove item' });
    }
  }

  
  public async reorder(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const collectionIds = Array.isArray(req.body?.collectionIds)
        ? req.body.collectionIds
        : Array.isArray(req.body?.order)
          ? req.body.order
          : [];
      
      if (!user || !collectionIds.length) {
        res.status(400).json({ error: 'Missing collectionIds' });
        return;
      }
      
      const coll = await this.repository.connect();
      const doc = await coll.findOne({ username: user.username });
      if (!doc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      
      const currentCollections = doc.collections || [];
      const defaults = currentCollections.filter((c: any) => DEFAULT_COLLECTION_NAMES.includes(c.name));
      const others = currentCollections.filter((c: any) => !DEFAULT_COLLECTION_NAMES.includes(c.name));
      const newCollections: any[] = [];
      
      for (const id of collectionIds) {
        const match = currentCollections.find((c: any) => c._id === id || c.name === id);
        if (match && !DEFAULT_COLLECTION_NAMES.includes(match.name)) {
          newCollections.push(match);
        }
      }
      
      // Add any missing non-default collections at the end
      for (const c of others) {
        if (!newCollections.find(nc => nc._id === c._id || nc.name === c.name)) {
          newCollections.push(c);
        }
      }

      const ordered = [
        ...defaults.filter((c: any) => c.name === 'Watched'),
        ...defaults.filter((c: any) => c.name === 'Watchlist'),
        ...newCollections
      ];
      
      await coll.updateOne(
        { username: user.username },
        { $set: { collections: ordered, updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
      );
      
      const latest = await coll.findOne({ username: user.username });
      res.json({
        success: true,
        collections: latest?.collections || ordered,
        collectionVersion: Number(latest?.collectionVersion || 0)
      });
    } catch (error: any) {
      logger.error(`[UserCollectionController] reorder error: ${error.message}`);
      res.status(500).json({ error: 'Failed to reorder' });
    }
  }
}
