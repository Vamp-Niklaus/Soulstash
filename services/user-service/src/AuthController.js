"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const Logger_1 = require("../../shared/src/utils/Logger");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ConfigManager_1 = require("../../shared/src/utils/ConfigManager");
const otpStore = new Map();
class AuthController {
    constructor(userService) {
        this.userService = userService;
    }
    async register(req, res) {
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
            const secret = ConfigManager_1.config.get('jwtSecret') || 'fallback_secret';
            const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });
            res.status(201).json({
                message: 'Account created successfully!',
                token,
                user: { id: user.id, username, fullName, admin: false, showAdult: false }
            });
        }
        catch (error) {
            Logger_1.logger.error('Registration failed', error);
            res.status(400).json({ error: error.message });
        }
    }
    async login(req, res) {
        try {
            const { username, password } = req.body;
            const token = await this.userService.login(username, password);
            const user = await this.userService.getUser(username); // Wait, this uses findById usually, let's fix login return to include user
            // To mimic monolith response exactly:
            const fullUser = await this.userService.userRepository.findByUsername(username);
            res.status(200).json({
                message: 'Login successful',
                token,
                user: {
                    id: fullUser.id,
                    username: fullUser.username,
                    fullName: fullUser.fullName || '',
                    admin: fullUser.admin === true,
                    adminMode: Number(fullUser.adminMode ?? (fullUser.showAdult === true ? 1 : 0)),
                    showAdult: fullUser.showAdult === true,
                    avatar: fullUser.avatar || null
                }
            });
        }
        catch (error) {
            Logger_1.logger.error('Login failed', error);
            res.status(401).json({ error: error.message });
        }
    }
    async checkUsername(req, res) {
        try {
            const { username } = req.query;
            if (!username || typeof username !== 'string' || username.length < 3) {
                res.json({ available: false, message: 'Username must be at least 3 characters' });
                return;
            }
            const existingUser = await this.userService.userRepository.findByUsername(username);
            res.json({ available: !existingUser, message: existingUser ? 'Username is already taken' : 'Username is available' });
        }
        catch (error) {
            res.status(500).json({ available: false, message: 'Server error' });
        }
    }
    async me(req, res) {
        try {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (!token) {
                res.status(401).json({ error: 'No token provided' });
                return;
            }
            const secret = ConfigManager_1.config.get('jwtSecret') || 'fallback_secret';
            const decoded = jsonwebtoken_1.default.verify(token, secret);
            // Read the document directly so the session response includes profile and
            // admin fields that the domain entity intentionally does not expose.
            const user = await this.userService.userRepository.findByUsername(decoded.username);
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            res.json({ user: {
                    id: user.id,
                    username: user.username,
                    fullName: user.fullName || '',
                    admin: user.admin === true,
                    adminMode: Number(user.adminMode ?? (user.showAdult === true ? 1 : 0)),
                    showAdult: user.showAdult === true,
                    avatar: user.avatar || null
                } });
        }
        catch (err) {
            res.status(403).json({ error: 'Invalid token' });
        }
    }
    async sendOtp(req, res) {
        try {
            const { email, username, fullName } = req.body;
            if (!email || !username || !fullName) {
                res.status(400).json({ error: 'Name, email and username are required' });
                return;
            }
            const coll = await this.userService.userRepository.connect();
            const existingUser = await coll.findOne({ $or: [{ username }, { email }] });
            if (existingUser) {
                if (existingUser.username === username) {
                    res.status(409).json({ error: 'Username already exists' });
                }
                else {
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
                }
                else {
                    Logger_1.logger.warn('BREVO_API_KEY not found, skipping email send');
                }
            }
            catch (emailErr) {
                Logger_1.logger.error('OTP email failed:', emailErr);
            }
            res.json({ message: 'OTP sent to email', otp: process.env.NODE_ENV === 'development' ? otp : undefined });
        }
        catch (err) {
            Logger_1.logger.error('Send OTP error:', err);
            res.status(500).json({ error: 'Failed to send OTP' });
        }
    }
    async verifyOtpAndRegister(req, res) {
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
            const coll = await this.userService.userRepository.connect();
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
            const secret = ConfigManager_1.config.get('jwtSecret') || 'fallback_secret';
            const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });
            res.status(201).json({
                message: 'Account created successfully!',
                token,
                user: { id: user.id, username, fullName, admin: false }
            });
        }
        catch (error) {
            Logger_1.logger.error('OTP Registration failed', error);
            res.status(400).json({ error: error.message || 'Failed to register' });
        }
    }
    async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            if (!email) {
                res.status(400).json({ error: 'Email is required' });
                return;
            }
            const coll = await this.userService.userRepository.connect();
            const existingUser = await coll.findOne({ email });
            if (!existingUser) {
                res.status(404).json({ error: 'Email not registered' });
                return;
            }
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            otpStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });
            try {
                const BREVO_API_KEY = process.env.BREVO_API_KEY;
                if (BREVO_API_KEY) {
                    const fetch = global.fetch || require('node-fetch');
                    const html = `<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2>Soulstash Password Reset</h2>
            <p>Your password reset OTP:</p>
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
                            to: [{ email, name: existingUser.fullName || existingUser.username }],
                            subject: 'Password Reset - Soulstash',
                            htmlContent: html
                        })
                    });
                }
                else {
                    Logger_1.logger.warn('BREVO_API_KEY not found, skipping email send');
                }
            }
            catch (emailErr) {
                Logger_1.logger.error('Forgot password email failed:', emailErr);
            }
            res.json({ message: 'OTP sent to email', otp: process.env.NODE_ENV === 'development' ? otp : undefined });
        }
        catch (err) {
            Logger_1.logger.error('Forgot password error:', err);
            res.status(500).json({ error: 'Failed to process request' });
        }
    }
    async resetPassword(req, res) {
        try {
            const { email, otp, newPassword } = req.body;
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
            const coll = await this.userService.userRepository.connect();
            const existingUser = await coll.findOne({ email });
            if (!existingUser) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await coll.updateOne({ email }, { $set: { password: hashedPassword } });
            otpStore.delete(email);
            res.status(200).json({
                message: 'Password reset successfully!'
            });
        }
        catch (error) {
            Logger_1.logger.error('Password reset failed', error);
            res.status(400).json({ error: error.message || 'Failed to reset password' });
        }
    }
}
exports.AuthController = AuthController;
//# sourceMappingURL=AuthController.js.map