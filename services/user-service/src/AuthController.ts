import { Request, Response } from 'express';
import { UserService } from './UserService';
import { logger } from '../../shared/src/utils/Logger';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/src/utils/ConfigManager';

const otpStore = new Map<string, { otp: string, expiresAt: number }>();

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

  public async sendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { email, username, fullName } = req.body;
      if (!email || !username || !fullName) {
        res.status(400).json({ error: 'Name, email and username are required' });
        return;
      }
      
      const coll = await (this.userService as any).userRepository.connect();
      const existingUser = await coll.findOne({ $or: [{ username }, { email }] });
      if (existingUser) {
        if (existingUser.username === username) {
          res.status(409).json({ error: 'Username already exists' });
        } else {
          res.status(409).json({ error: 'Email already registered' });
        }
        return;
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });
      
      try {
        const BREVO_API_KEY = process.env.BREVO_API_KEY;
        if (BREVO_API_KEY) {
          const fetch = global.fetch || require('node-fetch');
          const html = `<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2>Welcome to Soulstash, ${fullName}!</h2>
            <p>Your registration OTP:</p>
            <div style="background:#f4f4f4;padding:20px;text-align:center;margin:20px 0;border-radius:5px">
              <h1 style="font-size:32px;letter-spacing:5px;color:#007bff;margin:0">${otp}</h1>
            </div>
            <p>Expires in 10 minutes. Do not share.</p>
          </body></html>`;
          
          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': BREVO_API_KEY,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              sender: { name: 'Soulstash', email: process.env.SENDER_EMAIL || 'soulstash.onrender@gmail.com' },
              to: [{ email, name: fullName }],
              subject: 'Verify Your Email - Soulstash',
              htmlContent: html
            })
          });
        } else {
          logger.warn('BREVO_API_KEY not found, skipping email send');
        }
      } catch (emailErr) {
        logger.error('OTP email failed:', emailErr);
      }

      res.json({ message: 'OTP sent to email', otp: process.env.NODE_ENV === 'development' ? otp : undefined });
    } catch (err) {
      logger.error('Send OTP error:', err);
      res.status(500).json({ error: 'Failed to send OTP' });
    }
  }

  public async verifyOtpAndRegister(req: Request, res: Response): Promise<void> {
    try {
      const { username, fullName, password, email, otp } = req.body;
      const record = otpStore.get(email);
      if (!record || record.otp !== otp) {
        res.status(400).json({ error: 'Invalid or expired OTP' });
        return;
      }
      if (Date.now() > record.expiresAt) {
        otpStore.delete(email);
        res.status(400).json({ error: 'OTP has expired' });
        return;
      }

      const user = await this.userService.registerUser({
        username,
        email,
        passwordHash: password
      });
      
      const coll = await (this.userService as any).userRepository.connect();
      const parts = fullName.split(' ');
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';
      await coll.updateOne({ username }, { $set: { 
        fullName, 
        firstName, 
        lastName, 
        bio: fullName 
      } });

      otpStore.delete(email);
      const secret = config.get('jwtSecret') || 'fallback_secret';
      const token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });

      res.status(201).json({ 
        message: 'Account created successfully!',
        token,
        user: { id: user.id, username, fullName, admin: false }
      });
    } catch (error: any) {
      logger.error('OTP Registration failed', error);
      res.status(400).json({ error: error.message || 'Failed to register' });
    }
  }
}
