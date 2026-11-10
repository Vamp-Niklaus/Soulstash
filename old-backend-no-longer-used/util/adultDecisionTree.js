const { getDb } = require('../db');

const SETTINGS_COLLECTION = 'admin_setting_monolith';
const DOC_ID = 'adult_criteria';
const KEYWORDS_DOC_ID = 'adult_keywords_config';

const DEFAULT_KEYWORDS = [
  { id: '190370', name: 'erotic movie' },
  { id: '207767', name: 'erotica' },
  { id: '256466', name: 'erotic romance' },
  { id: '302868', name: 'softcore' },
  { id: '281741', name: 'sensual' },
  { id: '738', name: 'sexuality' },
  { id: '155477', name: 'softcore porn' },
  { id: '170827', name: 'adult movie' },
  { id: '14794', name: 'nudity' },
  { id: '3182', name: 'sex' },
  { id: '1326', name: 'infidelity' },
  { id: '286925', name: 'taboo' },
  { id: '11034', name: 'fetish' },
  { id: '2804', name: 'passion' }
];

const DEFAULT_TREE = {
  id: 'node_root',
  type: 'decision',
  field: 'adult_flag',
  operator: 'is_true',
  value: null,
  yesNode: {
    id: 'res_adult_flag_true',
    type: 'result',
    isAdult: true
  },
  noNode: {
    id: 'node_keywords',
    type: 'decision',
    field: 'adult_keywords',
    operator: 'is_true',
    value: null,
    yesNode: {
      id: 'res_keywords_true',
      type: 'result',
      isAdult: true
    },
    noNode: {
      id: 'node_age',
      type: 'decision',
      field: 'release_age_days',
      operator: '>=',
      value: 60,
      yesNode: {
        id: 'node_votes',
        type: 'decision',
        field: 'vote_count',
        operator: '<',
        value: 30,
        yesNode: {
          id: 'res_low_votes_old',
          type: 'result',
          isAdult: true
        },
        noNode: {
          id: 'res_good_votes',
          type: 'result',
          isAdult: false
        }
      },
      noNode: {
        id: 'res_new_release_safe',
        type: 'result',
        isAdult: false
      }
    }
  }
};

let activeTreeCache = JSON.parse(JSON.stringify(DEFAULT_TREE));
let activeKeywordsCache = JSON.parse(JSON.stringify(DEFAULT_KEYWORDS));
let isLoaded = false;
let isKeywordsLoaded = false;

function cloneTree(tree) {
  return JSON.parse(JSON.stringify(tree || DEFAULT_TREE));
}

function cloneKeywords(keywords) {
  return JSON.parse(JSON.stringify(keywords || DEFAULT_KEYWORDS));
}

function evaluateCondition(node, item, options = {}) {
  const { field, operator, value } = node;

  if (field === 'adult_flag') {
    const isAdultFlag = Boolean(item?.adult === true || item?._isAdultDiscover === true);
    return operator === 'is_true' ? isAdultFlag : !isAdultFlag;
  }

  if (field === 'adult_keywords') {
    const defaultTerms = ['erotic', 'erotica', 'porn', 'porno', 'pornography', 'softcore', 'hentai', 'nsfw', 'xxx'];
    const customTerms = (activeKeywordsCache || [])
      .map(k => (k.name || '').trim())
      .filter(t => t.length >= 3)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const combinedTerms = Array.from(new Set([...defaultTerms, ...customTerms]));
    const adultRegex = new RegExp(`\\b(${combinedTerms.join('|')})\\b`, 'i');

    let hasKw = adultRegex.test(item?.title || item?.name || '') || adultRegex.test(item?.overview || '');
    if (!hasKw && Array.isArray(item?.genres)) {
      for (const g of item.genres) {
        const name = typeof g === 'string' ? g : (g?.name || '');
        if (adultRegex.test(name)) {
          hasKw = true;
          break;
        }
      }
    }
    return operator === 'is_true' ? hasKw : !hasKw;
  }

  if (field === 'has_imdb') {
    const hasImdb = Boolean(item?.imdb_id && String(item.imdb_id).trim() !== '');
    return operator === 'is_true' ? hasImdb : !hasImdb;
  }

  if (field === 'is_indian') {
    const isInd = (Array.isArray(item?.origin_country) && item.origin_country.includes('IN')) ||
      ['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa'].includes(item?.original_language);
    return operator === 'is_true' ? isInd : !isInd;
  }

  if (field === 'is_bollywood_endpoint') {
    const isBw = Boolean(item?.is_bollywood_endpoint || item?.is_bollywood_feed);
    return operator === 'is_true' ? isBw : !isBw;
  }

  if (field === 'vote_count') {
    const votes = Number(item?.vote_count || 0);
    const target = Number(value || 0);
    switch (operator) {
      case '<': return votes < target;
      case '<=': return votes <= target;
      case '>': return votes > target;
      case '>=': return votes >= target;
      case '==': return votes === target;
      default: return false;
    }
  }

  if (field === 'release_age_days') {
    const dateStr = item?.release_date || item?.first_air_date;
    if (!dateStr) return false;
    const releaseTime = new Date(dateStr).getTime();
    if (isNaN(releaseTime)) return false;
    const diffDays = Math.floor((Date.now() - releaseTime) / (1000 * 60 * 60 * 24));
    const ageDays = diffDays > 0 ? diffDays : 0;
    const target = Number(value || 0);
    switch (operator) {
      case '<': return ageDays < target;
      case '<=': return ageDays <= target;
      case '>': return ageDays > target;
      case '>=': return ageDays >= target;
      case '==': return ageDays === target;
      default: return false;
    }
  }

  return false;
}

function traverseTree(node, item, trace = null, options = {}) {
  if (!node) return false;

  if (node.type === 'result') {
    const isAdultResult = Boolean(node.isAdult);
    if (trace) {
      trace.push({
        nodeId: node.id,
        type: 'result',
        isAdult: isAdultResult
      });
    }
    return isAdultResult;
  }

  const conditionMet = evaluateCondition(node, item, options);
  if (trace) {
    trace.push({
      nodeId: node.id,
      type: 'decision',
      field: node.field,
      operator: node.operator,
      value: node.value,
      conditionMet
    });
  }

  const nextNode = conditionMet ? node.yesNode : node.noNode;
  return traverseTree(nextNode, item, trace, options);
}

async function loadAdultTree() {
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeTreeCache;
    }
    if (!db) return activeTreeCache;
    const doc = await db.collection(SETTINGS_COLLECTION).findOne({ _id: DOC_ID });
    if (doc?.tree) {
      activeTreeCache = doc.tree;
    } else {
      activeTreeCache = cloneTree(DEFAULT_TREE);
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: DOC_ID },
        { $set: { tree: activeTreeCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    isLoaded = true;
    return activeTreeCache;
  } catch (err) {
    console.error('[AdultDecisionTree] loadAdultTree error:', err.message);
    return activeTreeCache;
  }
}

async function saveAdultTree(tree) {
  if (!tree || typeof tree !== 'object') {
    throw new Error('Invalid decision tree');
  }
  activeTreeCache = cloneTree(tree);
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeTreeCache;
    }
    if (db) {
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: DOC_ID },
        { $set: { tree: activeTreeCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('[AdultDecisionTree] saveAdultTree error:', err.message);
    throw err;
  }
  return activeTreeCache;
}

async function resetAdultTree() {
  activeTreeCache = cloneTree(DEFAULT_TREE);
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeTreeCache;
    }
    if (db) {
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: DOC_ID },
        { $set: { tree: activeTreeCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('[AdultDecisionTree] resetAdultTree error:', err.message);
    throw err;
  }
  return activeTreeCache;
}

async function loadAdultKeywords() {
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeKeywordsCache;
    }
    if (!db) return activeKeywordsCache;
    const doc = await db.collection(SETTINGS_COLLECTION).findOne({ _id: KEYWORDS_DOC_ID });
    if (Array.isArray(doc?.keywords) && doc.keywords.length > 0) {
      activeKeywordsCache = doc.keywords;
    } else {
      activeKeywordsCache = cloneKeywords(DEFAULT_KEYWORDS);
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: KEYWORDS_DOC_ID },
        { $set: { keywords: activeKeywordsCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    isKeywordsLoaded = true;
    return activeKeywordsCache;
  } catch (err) {
    console.error('[AdultDecisionTree] loadAdultKeywords error:', err.message);
    return activeKeywordsCache;
  }
}

async function saveAdultKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    throw new Error('Keywords must be an array');
  }
  const sanitized = keywords
    .filter(k => k && (k.id || k.name))
    .map(k => ({
      id: String(k.id || '').trim(),
      name: String(k.name || '').trim()
    }));
  activeKeywordsCache = sanitized;
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeKeywordsCache;
    }
    if (db) {
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: KEYWORDS_DOC_ID },
        { $set: { keywords: activeKeywordsCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('[AdultDecisionTree] saveAdultKeywords error:', err.message);
    throw err;
  }
  return activeKeywordsCache;
}

async function resetAdultKeywords() {
  activeKeywordsCache = cloneKeywords(DEFAULT_KEYWORDS);
  try {
    let db;
    try {
      db = getDb();
    } catch {
      return activeKeywordsCache;
    }
    if (db) {
      await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: KEYWORDS_DOC_ID },
        { $set: { keywords: activeKeywordsCache, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('[AdultDecisionTree] resetAdultKeywords error:', err.message);
    throw err;
  }
  return activeKeywordsCache;
}

function getAdultKeywordsParam() {
  if (!isKeywordsLoaded) {
    loadAdultKeywords().catch(() => {});
  }
  const ids = (activeKeywordsCache || [])
    .map(k => String(k.id || '').trim())
    .filter(id => /^\d+$/.test(id));
  return ids.length > 0 ? `&with_keywords=${ids.join('|')}` : '';
}

function evaluateAdultItem(item, trace = null, options = {}) {
  if (!isLoaded) {
    loadAdultTree().catch(() => {});
  }
  if (!isKeywordsLoaded) {
    loadAdultKeywords().catch(() => {});
  }
  return traverseTree(activeTreeCache, item, trace, options);
}

function testTreeWithItem(tree, item, options = {}) {
  const trace = [];
  const isAdult = traverseTree(tree || activeTreeCache, item, trace, options);
  return { isAdult, trace };
}

module.exports = {
  DEFAULT_TREE,
  DEFAULT_KEYWORDS,
  SETTINGS_COLLECTION,
  DOC_ID,
  KEYWORDS_DOC_ID,
  cloneTree,
  cloneKeywords,
  loadAdultTree,
  saveAdultTree,
  resetAdultTree,
  loadAdultKeywords,
  saveAdultKeywords,
  resetAdultKeywords,
  getAdultKeywordsParam,
  evaluateAdultItem,
  testTreeWithItem
};
