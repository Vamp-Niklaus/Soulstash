import { Request, Response } from 'express';
import { MongoUserRepository } from './repositories/MongoUserRepository';
import { logger } from '../../shared/src/utils/Logger';
import { ObjectId } from 'mongodb';

const DEFAULT_COLLECTION_NAMES = ['Watched', 'Watchlist'];
const DEFAULT_COLLECTION_BANNER = 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg';

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
      
      res.json(doc.collections || []);
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
      if (!payload.name) {
        res.status(400).json({ error: 'Collection name is required' });
        return;
      }
      
      const newCollection = {
        _id: new ObjectId().toString(),
        name: payload.name,
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
      
      const coll = await this.repository.connect();
      await coll.updateOne(
        { username: user.username },
        { $push: { collections: newCollection } } as any
      );
      
      res.json(newCollection);
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

  public async addItem(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as any).user;
      const collectionId = req.params.id;
      
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const item = req.body || {};
      const contentId = Number(item.id || item.movieId || item.seriesId || 0);
      if (!item || !contentId) {
        res.status(400).json({ error: 'Valid item data required' });
        return;
      }
      const mediaType = String(item.media_type || (item.seriesId ? 'Series' : 'Movie'));
      
      // Map to old schema format if needed
      const normalizedItem = {
        ...item,
        id: contentId,
        movieId: mediaType === 'Movie' ? contentId : undefined,
        seriesId: mediaType === 'Series' ? contentId : undefined,
        media_type: mediaType === 'Series' ? 'Series' : 'Movie',
      };

      const coll = await this.repository.connect();
      
      // Update by _id
      await coll.updateOne(
        { username: user.username, 'collections._id': collectionId },
        { 
          $push: { 'collections.$.movies': normalizedItem },
          $inc: { 'collections.$.movieCount': 1 },
          $set: { 'collections.$.updatedAt': new Date() }
        }
      );
      
      // Update by name (fallback for defaults)
      await coll.updateOne(
        { username: user.username, 'collections.name': collectionId, 'collections._id': { $exists: false } },
        { 
          $push: { 'collections.$.movies': normalizedItem },
          $inc: { 'collections.$.movieCount': 1 },
          $set: { 'collections.$.updatedAt': new Date() }
        }
      );
      
      res.json({ success: true });
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
      const pullQuery = {
        $or: [
          { id: contentId },
          { movieId: contentId },
          { seriesId: contentId }
        ]
      };
      
      await coll.updateOne(
        { username: user.username, 'collections._id': collectionId },
        { 
          $pull: { 'collections.$.movies': pullQuery },
          $set: { 'collections.$.updatedAt': new Date() }
        } as any
      );
      
      await coll.updateOne(
        { username: user.username, 'collections.name': collectionId, 'collections._id': { $exists: false } },
        { 
          $pull: { 'collections.$.movies': pullQuery },
          $set: { 'collections.$.updatedAt': new Date() }
        } as any
      );
      
      res.json({ success: true });
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
