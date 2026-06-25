const { config } = require('../../../shared/src/utils/ConfigManager');
const { MongoClient } = require('mongodb');

let dbInstance = null;

async function initDb() {
  if (!dbInstance) {
    const client = new MongoClient(config.get('mongoUri'));
    await client.connect();
    dbInstance = client.db(config.get('mongoDbName') || 'test');
  }
  return dbInstance;
}

function getDb() {
  if (!dbInstance) throw new Error('Database not initialized. Call initDb() first.');
  return dbInstance;
}

module.exports = { initDb, getDb };
