import { Request, Response } from 'express';
import { logger } from '../../shared/src/utils/Logger';
import { config } from '../../shared/src/utils/ConfigManager';

export class AdminController {
  private userRepository: any;

  constructor(userRepository: any) {
    this.userRepository = userRepository;
  }

  private async checkAdmin(req: Request, res: Response): Promise<any> {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const coll = await this.userRepository.connect();
    const dbName = config.get('mongoDbName') || 'test';
    const db = (this.userRepository as any).client.db(dbName);
    const dbUser = await coll.findOne({ username: user.username });
    if (!dbUser || dbUser.admin !== true) {
      res.status(403).json({ error: 'Forbidden: Admin access only' });
      return null;
    }
    return { coll, dbUser, db };
  }

  public async getMe(req: Request, res: Response) {
    try {
      const auth = await this.checkAdmin(req, res);
      if (!auth) return;
      const { db, dbUser } = auth;

      const sourceConfigsColl = db.collection('SourceConfigs');
      const multimoviesConfig = await sourceConfigsColl.findOne({ _id: 'multimovies' });

      res.json({
        admin: true,
        showAdult: dbUser.showAdult === true,
        multimovies: {
          available: multimoviesConfig?.available !== false,
          baseUrl: multimoviesConfig?.baseUrls?.[0] || 'https://multimovies.wtf/',
          rootUrl: multimoviesConfig?.rootUrls?.[0] || 'https://multimovies.wtf/'
        }
      });
    } catch (err: any) {
      logger.error(`[AdminController] getMe error: ${err.message}`);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  public async getUsers(req: Request, res: Response) {
    try {
      const auth = await this.checkAdmin(req, res);
      if (!auth) return;
      const { coll } = auth;

      const users = await coll.find({}, { projection: { password: 0 } }).toArray();
      const formattedUsers = users.map(u => ({
        id: u._id.toString(),
        username: u.username,
        email: u.email,
        admin: !!u.admin,
        createdAt: u.createdAt
      }));

      res.json({
        totalUsers: formattedUsers.length,
        users: formattedUsers
      });
    } catch (err: any) {
      logger.error(`[AdminController] getUsers error: ${err.message}`);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  public async updatePreferences(req: Request, res: Response) {
    try {
      const auth = await this.checkAdmin(req, res);
      if (!auth) return;
      const { coll, dbUser } = auth;

      const { showAdult } = req.body;
      await coll.updateOne(
        { username: dbUser.username },
        { $set: { showAdult: !!showAdult, updatedAt: new Date() } }
      );

      res.json({ success: true, showAdult: !!showAdult });
    } catch (err: any) {
      logger.error(`[AdminController] updatePreferences error: ${err.message}`);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  public async updateMultimovies(req: Request, res: Response) {
    try {
      const auth = await this.checkAdmin(req, res);
      if (!auth) return;
      const { db } = auth;

      const { rootUrl, baseUrl, available } = req.body;
      const sourceConfigsColl = db.collection('SourceConfigs');

      await sourceConfigsColl.updateOne(
        { _id: 'multimovies' },
        { 
          $set: { 
            className: 'multimovies',
            rootUrls: [rootUrl], 
            baseUrls: [baseUrl], 
            available: available !== false,
            updatedAt: new Date() 
          } 
        },
        { upsert: true }
      );

      res.json({ 
        success: true,
        multimovies: {
          available: available !== false,
          rootUrl: rootUrl,
          baseUrl: baseUrl
        }
      });
    } catch (err: any) {
      logger.error(`[AdminController] updateMultimovies error: ${err.message}`);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
