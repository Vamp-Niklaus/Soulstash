import { Collection as MongoCollection } from 'mongodb';
import { IUserRepository } from '../../../shared/src/interfaces/IUserRepository';
import { User } from '../../../shared/src/entities/User';
/**
 * Adapter Pattern: MongoUserRepository
 * Connects the abstract IUserRepository interface to real MongoDB logic.
 */
export declare class MongoUserRepository implements IUserRepository {
    private client;
    private collection;
    constructor();
    connect(): Promise<MongoCollection<any>>;
    save(user: User): Promise<User>;
    findByUsername(username: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
}
//# sourceMappingURL=MongoUserRepository.d.ts.map