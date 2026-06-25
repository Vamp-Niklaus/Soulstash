const fs = require('fs');

const handlers = fs.readFileSync('c:/Users/Rakesh Kumar/3D Objects/Soulstash2/services/content-service/src/utils/playerSourcesHandler.js', 'utf8');
const funcs = fs.readFileSync('c:/Users/Rakesh Kumar/3D Objects/Soulstash2/services/content-service/src/utils/playerSourcesFunctions.js', 'utf8');

const directSourcesStr = `const DIRECT_SOURCES = [
  { id: 'videasy', label: 'VIDEASY', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? \`https://player.videasy.to/tv/\${t}/\${s || 1}/\${e || 1}?color=F97316&overlay=true&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true\` : \`https://player.videasy.to/movie/\${t}?color=F97316&overlay=true\` },
  { id: 'vidfast', label: 'vidfast', template: (m, t, s, e) => (m === 'tv' || m === 'series') ? \`https://vidfast.pro/tv/\${t}/\${s || 1}/\${e || 1}?autoPlay=true&title=true&poster=true&theme=F97316&nextButton=true&autoNext=true\` : \`https://vidfast.pro/movie/\${t}?autoPlay=true&title=true&poster=true&theme=F97316\` }
];\n`;

const combined = `const { getDb } = require('./dbProvider');
const { PREFERRED_SERVER_ORDER, buildSearchKey, scrapeMultimoviesTitle, resolveMatchedPage, buildSourceHistoryRecord, mergeSourceHistoryRecord, extractPageMetadata } = require('./multimoviesScraper');
const { playwrightFetch } = require('./playwrightFetch');
const ytSearch = require('yt-search');

const PLAYER_SOURCES_COLLECTION = 'PlayerSources';
const MOVIE_SOURCES_COLLECTION = 'Movie_Sources';
const TV_SHOW_URLS_COLLECTION = 'TVShowURLs';
const SOURCE_CONFIGS_COLLECTION = 'SourceConfigs';
const MULTIMOVIES_CONFIG_DOC_ID = 'multimovies_config';
const DEFAULT_MULTIMOVIES_BASE_URL = 'https://multimovies.fyi/';
const DEFAULT_MULTIMOVIES_ROOT_URL = 'https://multimovies.fyi/';
const refreshLocks = new Set();

const TMDB_BASE_URL = (process.env.TMDB_BASE_URL || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');

async function tmdbFetch(url, options, context = 'TMDB API') {
  if (url.startsWith('https://api.themoviedb.org')) {
    url = url.replace('https://api.themoviedb.org', TMDB_BASE_URL);
  }
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(\`[TMDB] \${context} attempt \${attempt}/\${maxRetries} -> \${url}\`);
      return await fetch(url, options);
    } catch (err) {
      console.error(\`[TMDB] \${context} network error on attempt \${attempt}: \${err.message}\`);
      if (attempt === maxRetries) throw new Error(\`\${context} failed: \${err.message}\`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

const tmdbHeaders = () => ({
  accept: 'application/json',
  Authorization: \`Bearer \${String(process.env.TMDB_BEARER_TOKEN || '').trim()}\`
});

${directSourcesStr}
${funcs}
exports.getPlayerSources = ${handlers.replace("router.get('/player/sources', ", "").replace(/\);\s*$/, ";")}
`;

fs.writeFileSync('c:/Users/Rakesh Kumar/3D Objects/Soulstash2/services/content-service/src/utils/legacyPlayerSources.js', combined);
console.log('Created legacyPlayerSources.js');

const dbProviderCode = `const { config } = require('../../../shared/src/utils/ConfigManager');
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
`;
fs.writeFileSync('c:/Users/Rakesh Kumar/3D Objects/Soulstash2/services/content-service/src/utils/dbProvider.js', dbProviderCode);
console.log('Created dbProvider.js');
