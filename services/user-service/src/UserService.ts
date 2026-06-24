import { IUserRepository } from '../../shared/src/interfaces/IUserRepository';
import { User } from '../../shared/src/entities/User';
import { config } from '../../shared/src/utils/ConfigManager';
import { logger } from '../../shared/src/utils/Logger';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export class UserService {
  constructor(private userRepository: IUserRepository) {}

  public async registerUser(userData: Partial<User>): Promise<User> {
    const existingUser = await this.userRepository.findByUsername(userData.username!);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(userData.passwordHash!, 10);
    
    const newUser = User.create({
      id: userData.id || randomUUID(),
      username: userData.username!,
      email: userData.email!,
      passwordHash: hashedPassword
    });

    logger.info(`UserService: Registering new user ${newUser.username}`);
    return this.userRepository.save(newUser);
  }

  public async login(username: string, passwordHash: string): Promise<string> {
    const user = await this.userRepository.findByUsername(username);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    if (!user.passwordHash) {
      throw new Error('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(passwordHash, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    logger.info(`UserService: User ${username} logged in successfully`);

    const secret = config.get('jwtSecret') || 'fallback_secret';
    return jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });
  }

  public async getUser(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }
}
