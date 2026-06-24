import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Singleton ConfigManager using the GoF Singleton Pattern.
 * Centralized configuration handling.
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: Record<string, string | undefined>;

  private constructor() {
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

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public get(key: string): string | undefined {
    return this.config[key];
  }
}

export const config = ConfigManager.getInstance();
