import { Request, Response } from 'express';
import { MongoCollectionRepository } from './repositories/MongoCollectionRepository';
export declare class CollectionController {
    private readonly repository;
    constructor(repository: MongoCollectionRepository);
    getPublishedCollections(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=CollectionController.d.ts.map