"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.ConfigManager = void 0;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
/**
 * Singleton ConfigManager using the GoF Singleton Pattern.
 * Centralized configuration handling.
 */
class ConfigManager {
    constructor() {
        this.config = {
            port: process.env.PORT || '3000',
            mongoUri: process.env.MONGODB_URI,
            mongoDbName: process.env.MONGODB_DB_NAME,
            jwtSecret: process.env.JWT_SECRET || 'fallback_secret',
            env: process.env.NODE_ENV || 'development',
            tmdbApiKey: process.env.TMDB_API_KEY,
            tmdbBearerToken: process.env.TMDB_BEARER_TOKEN
        };
    }
    static getInstance() {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }
    get(key) {
        return this.config[key];
    }
}
exports.ConfigManager = ConfigManager;
exports.config = ConfigManager.getInstance();
//# sourceMappingURL=ConfigManager.js.map