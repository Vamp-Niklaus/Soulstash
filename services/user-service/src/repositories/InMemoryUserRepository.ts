import { IUserRepository } from '../../../shared/src/interfaces/IUserRepository';
import { User } from '../../../shared/src/entities/User';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * LLD Mock: InMemoryUserRepository
 * Temporarily stores users in memory so the service can boot and function
 * without a connected database cluster.
 */
export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, User> = new Map();
  private usernames: Map<string, string> = new Map();

  public async save(user: User): Promise<User> {
    logger.info(`InMemoryUserRepository: Saving user ${user.username}`);
    this.users.set(user.id, user);
    this.usernames.set(user.username, user.id);
    return user;
  }

  public async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  public async findByUsername(username: string): Promise<User | null> {
    const id = this.usernames.get(username);
    if (!id) return null;
    return this.users.get(id) || null;
  }
}
