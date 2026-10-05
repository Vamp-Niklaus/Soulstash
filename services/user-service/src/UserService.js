"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const User_1 = require("../../shared/src/entities/User");
const ConfigManager_1 = require("../../shared/src/utils/ConfigManager");
const Logger_1 = require("../../shared/src/utils/Logger");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
class UserService {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async registerUser(userData) {
        const existingUser = await this.userRepository.findByUsername(userData.username);
        if (existingUser) {
            throw new Error('Username already exists');
        }
        const hashedPassword = await bcryptjs_1.default.hash(userData.passwordHash, 10);
        const newUser = User_1.User.create({
            id: userData.id || (0, crypto_1.randomUUID)(),
            username: userData.username,
            email: userData.email,
            passwordHash: hashedPassword
        });
        Logger_1.logger.info(`UserService: Registering new user ${newUser.username}`);
        return this.userRepository.save(newUser);
    }
    async login(username, passwordHash) {
        const user = await this.userRepository.findByUsername(username);
        if (!user) {
            throw new Error('Invalid credentials');
        }
        if (!user.passwordHash) {
            throw new Error('Invalid credentials');
        }
        const isMatch = await bcryptjs_1.default.compare(passwordHash, user.passwordHash);
        if (!isMatch) {
            throw new Error('Invalid credentials');
        }
        Logger_1.logger.info(`UserService: User ${username} logged in successfully`);
        const secret = ConfigManager_1.config.get('jwtSecret') || 'fallback_secret';
        return jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '7d' });
    }
    async getUser(id) {
        return this.userRepository.findById(id);
    }
}
exports.UserService = UserService;
//# sourceMappingURL=UserService.js.map