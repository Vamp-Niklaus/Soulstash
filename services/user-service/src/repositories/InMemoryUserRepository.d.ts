import { IUserRepository } from '../../../shared/src/interfaces/IUserRepository';
import { User } from '../../../shared/src/entities/User';
/**
 * LLD Mock: InMemoryUserRepository
 * Temporarily stores users in memory so the service can boot and function
 * without a connected database cluster.
 */
export declare class InMemoryUserRepository implements IUserRepository {
    private users;
    private usernames;
    save(user: User): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByUsername(username: string): Promise<User | null>;
}
//# sourceMappingURL=InMemoryUserRepository.d.ts.map