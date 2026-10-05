import { Request, Response } from 'express';
import { MongoUserRepository } from './repositories/MongoUserRepository';
export declare class UserCollectionController {
    private readonly repository;
    constructor(repository: MongoUserRepository);
    getCollections(req: Request, res: Response): Promise<void>;
    getPublicCollection(req: Request, res: Response): Promise<void>;
    createCollection(req: Request, res: Response): Promise<void>;
    updateCollection(req: Request, res: Response): Promise<void>;
    deleteCollection(req: Request, res: Response): Promise<void>;
    private isAnimeContent;
    private validVoteAverage;
    private validImdbRating;
    addItem(req: Request, res: Response): Promise<void>;
    removeItem(req: Request, res: Response): Promise<void>;
    reorder(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=UserCollectionController.d.ts.map