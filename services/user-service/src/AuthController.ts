import { Request, Response } from 'express';
import { UserService } from './UserService';
import { logger } from '../../shared/src/utils/Logger';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/src/utils/ConfigManager';

export class AuthController {
  constructor(private userService: UserService) {}

  public async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, fullName, password } = req.body;
      
      if (!username || !password || !fullName) {
        res.status(400).json({ error: 'Name, username and password are required' });
        return;
      }

      const user = await this.userService.registerUser({
        username,
        email: '',
        passwordHash: password
      });

      // Generate initial token directly so they login upon register
      const secret = config.get('jwtSecret') || 'fallback_secret';
      const token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });

      res.status(201).json({ 
        message: 'Account created successfully!',
        token,
        user: { id: user.id, username, fullName, admin: false, showAdult: false }
      });
    } catch (error: any) {
      logger.error('Registration failed', error);
      res.status(400).json({ error: error.message });
    }
  }

  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;
      const token = await this.userService.login(username, password);
      
      const user = await this.userService.getUser(username); // Wait, this uses findById usually, let's fix login return to include user
      
      // To mimic monolith response exactly:
      const fullUser = await (this.userService as any).userRepository.findByUsername(username);

      res.status(200).json({ 
        message: 'Login successful',
        token,
        user: { id: fullUser.id, username: fullUser.username, admin: false }
      });
    } catch (error: any) {
      logger.error('Login failed', error);
      res.status(401).json({ error: error.message });
    }
  }

  public async checkUsername(req: Request, res: Response): Promise<void> {
    try {
      const { username } = req.query;
      if (!username || typeof username !== 'string' || username.length < 3) {
        res.json({ available: false, message: 'Username must be at least 3 characters' });
        return;
      }
      
      const existingUser = await (this.userService as any).userRepository.findByUsername(username);
      res.json({ available: !existingUser, message: existingUser ? 'Username is already taken' : 'Username is available' });
    } catch (error: any) {
      res.status(500).json({ available: false, message: 'Server error' });
    }
  }

  public async me(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const secret = config.get('jwtSecret') || 'fallback_secret';
      const decoded: any = jwt.verify(token, secret);
      
      const user = await this.userService.getUser(decoded.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: { id: user.id, username: user.username, admin: false } });
    } catch (err) {
      res.status(403).json({ error: 'Invalid token' });
    }
  }
}
