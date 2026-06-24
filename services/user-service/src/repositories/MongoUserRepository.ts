import { MongoClient, Collection as MongoCollection } from 'mongodb';
import { IUserRepository } from '../../../shared/src/interfaces/IUserRepository';
import { User } from '../../../shared/src/entities/User';
import { logger } from '../../../shared/src/utils/Logger';
import { config } from '../../../shared/src/utils/ConfigManager';

/**
 * Adapter Pattern: MongoUserRepository
 * Connects the abstract IUserRepository interface to real MongoDB logic.
 */
export class MongoUserRepository implements IUserRepository {
  private client: MongoClient;
  private collection: MongoCollection | null = null;

  constructor() {
    const uri = config.get('mongoUri');
    if (!uri) {
      throw new Error('Mongo URI is not defined in environment variables');
    }
    this.client = new MongoClient(uri);
  }

  public async connect(): Promise<MongoCollection> {
    if (!this.collection) {
      await this.client.connect();
      const dbName = config.get('mongoDbName') || 'test';
      this.collection = this.client.db(dbName).collection('users');
      logger.info(`MongoUserRepository: Connected to database '${dbName}'`);
    }
    return this.collection;
  }

  public async save(user: User): Promise<User> {
    const coll = await this.connect();
    const defaultBanner = 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg';
    
    // Add default collections to mimic legacy
    const defaultCollections = () => [
      { name: 'Watched',   isDeletable: true, isPublic: false, isPublished: false, banner: defaultBanner, movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() },
      { name: 'Watchlist', isDeletable: true, isPublic: false, isPublished: false, banner: defaultBanner, movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() }
    ];

    const result = await coll.insertOne({
      username: user.username,
      password: user.passwordHash,
      fullName: user.username, // Can be improved
      email: user.email,
      collections: defaultCollections(),
      favoritePeople: [],
      followers: [],
      following: [],
      admin: false,
      showAdult: false,
      collectionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const props: any = {
      id: result.insertedId.toString(),
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    };
    if (user.passwordHash) {
      props.passwordHash = user.passwordHash;
    }
    return User.create(props);
  }

  public async findByUsername(username: string): Promise<User | null> {
    const coll = await this.connect();
    const doc = await coll.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      username: doc.username,
      email: doc.email || '',
      passwordHash: doc.password
    } as unknown as User;
  }

  public async findById(id: string): Promise<User | null> {
    const coll = await this.connect();
    let objectId;
    try {
      const { ObjectId } = require('mongodb');
      objectId = new ObjectId(id);
    } catch (e) {
      return null;
    }
    const doc = await coll.findOne({ _id: objectId });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      username: doc.username,
      email: doc.email || '',
      passwordHash: doc.password
    } as unknown as User;
  }
}
