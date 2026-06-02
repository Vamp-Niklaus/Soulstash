const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

// Keep in sync with util/imdbRatings.js RATINGS_COLLECTION
const RATINGS_COLLECTION = 'Ratings';
const METRICS_COLLECTION = 'AppMetrics';
const RATINGS_METRICS_DOC_ID = 'ratings_api_counters';
const PLAYER_SOURCES_COLLECTION = 'PlayerSources';
const SOURCE_CONFIGS_COLLECTION = 'SourceConfigs';
const MULTIMOVIES_CONFIG_DOC_ID = 'multimovies';

let db;
let client;

async function connectToDatabase() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db(MONGODB_DB_NAME);
    console.log(`Using MongoDB database: ${db.databaseName}`);
    await db.collection('details').findOne();
    console.log('Database connection verified');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
}

async function initializeDatabase() {
  try {
    await connectToDatabase();
    const usersCollection = getDb().collection('users');
    const ratingsCollection = getDb().collection(RATINGS_COLLECTION);
    const metricsCollection = getDb().collection(METRICS_COLLECTION);
    const playerSourcesCollection = getDb().collection(PLAYER_SOURCES_COLLECTION);
    const sourceConfigsCollection = getDb().collection(SOURCE_CONFIGS_COLLECTION);

    await usersCollection.createIndex(
      { username: 1 },
      { unique: true, name: 'username_unique_index' }
    );

    // Primary lookup: tmdbID + mediaType (unique — one record per title)
    await ratingsCollection.createIndex(
      { tmdbID: 1, mediaType: 1 },
      { unique: true, name: 'ratings_tmdb_media_unique' }
    );

    // Secondary: imdbID + mediaType (for lookups by IMDB id)
    await ratingsCollection.createIndex(
      { imdbID: 1, mediaType: 1 },
      { name: 'ratings_imdb_media_index', sparse: true }
    );

    // Drop obsolete index if it exists because searchKey is null for series documents
    try {
      await playerSourcesCollection.dropIndex('player_sources_search_key_unique');
      console.log('Dropped obsolete index player_sources_search_key_unique');
    } catch (e) {
      // Index might not exist, which is fine
    }
    await playerSourcesCollection.createIndex(
      { tmdbId: 1, mediaType: 1, seasonNumber: 1, episodeNumber: 1 },
      { name: 'player_sources_tmdb_lookup' }
    );

    await playerSourcesCollection.createIndex(
      { imdbId: 1, mediaType: 1 },
      { name: 'player_sources_imdb_lookup', sparse: true }
    );

    await metricsCollection.updateOne(
      { _id: RATINGS_METRICS_DOC_ID },
      {
        $setOnInsert: {
          tmdbDetailFetchCount: 0,
          omdbFetchCount: 0,
          createdAt: new Date()
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    await sourceConfigsCollection.updateOne(
      { _id: MULTIMOVIES_CONFIG_DOC_ID },
      {
        $setOnInsert: {
          className: 'multimovies',
          available: true,
          rootUrls: ['https://multimovies.wtf/'],
          baseUrls: ['https://multimovies.fyi/'],
          createdAt: new Date()
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log('Database initialized with unique indexes');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function getClient() {
  return client;
}

module.exports = {
  initializeDatabase,
  getDb,
  getClient,
  SOURCE_CONFIGS_COLLECTION,
  MULTIMOVIES_CONFIG_DOC_ID
};
