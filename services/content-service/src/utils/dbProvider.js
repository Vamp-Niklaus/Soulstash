const { config } = require('../../../shared/src/utils/ConfigManager');
const { MongoClient } = require('mongodb');

let dbInstance = null;

async function initDb() {
  if (!dbInstance) {
    const uri = config.get('mongoUri');
    if (!uri) {
      console.warn('[dbProvider] Warning: MONGODB_URI is not set in environment.');
      return null;
    }
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      dbInstance = client.db(config.get('mongoDbName') || 'tmdb');
      console.log('[dbProvider] Connected successfully to MongoDB');
    } catch (err) {
      console.error('[dbProvider] Warning: Could not connect to MongoDB:', err.message);
      return null;
    }
  }
  return dbInstance;
}

function getDb() {
  return dbInstance;
}

module.exports = { initDb, getDb };
