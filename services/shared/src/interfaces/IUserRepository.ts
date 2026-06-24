import { User } from '../entities/User';

export interface IUserRepository {
  /**
   * Saves a user to the database.
   * @param user The User entity.
   */
  save(user: User): Promise<User>;

  /**
   * Finds a user by their ID.
   * @param id 
   */
  findById(id: string): Promise<User | null>;

  /**
   * Finds a user by their username.
   * @param username 
   */
  findByUsername(username: string): Promise<User | null>;
}
