const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractFuncStrict(funcName) {
  const startPattern = 'function ' + funcName + '(';
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) return null;
  
  let bracketCount = 0;
  let endIdx = -1;
  let started = false;
  
  for (let i = startIdx; i < mainSource.length; i++) {
    const char = mainSource[i];
    if (char === '{') {
      bracketCount++;
      started = true;
    } else if (char === '}') {
      bracketCount--;
      if (started && bracketCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  
  if (endIdx === -1) return null;
  return mainSource.slice(startIdx, endIdx);
}

// Fix HomeShelfHeader
const hsh = extractFuncStrict('HomeShelfHeader');
if (hsh) {
  const content = "import React from 'react';\nimport { NavLink } from 'react-router-dom';\nexport " + hsh + "\n";
  fs.writeFileSync('spa/src/pages/Explore/HomeShelfHeader.jsx', content);
  console.log('Fixed HomeShelfHeader:', hsh.length, 'chars');
} else {
  console.log('HomeShelfHeader NOT FOUND');
}

// Extract some important missing functions for helpers: toast, useSessionState, etc.
const funcsToAdd = ['useSessionState', 'useHomeTwoRowLimit', 'useGridKeyNav', 'useDropdownKeyNav'];
let helpers = fs.readFileSync('spa/src/utils/helpers.js', 'utf8');

for (const fn of funcsToAdd) {
  if (helpers.includes('function ' + fn)) {
    console.log(fn, '- already in helpers.js');
    continue;
  }
  const code = extractFuncStrict(fn);
  if (code) {
    helpers += '\n\nexport ' + code;
    console.log('Added', fn, 'to helpers.js');
  } else {
    console.log(fn, '- NOT FOUND in monolith');
  }
}

fs.writeFileSync('spa/src/utils/helpers.js', helpers);

// Also look for normalizeCollection (different from normalizeCollections)
const nc = extractFuncStrict('normalizeCollection');
if (nc) {
  if (!helpers.includes('function normalizeCollection(')) {
    helpers += '\n\nexport ' + nc;
    fs.writeFileSync('spa/src/utils/helpers.js', helpers);
    console.log('Added normalizeCollection to helpers.js');
  }
}

// Extract missing functions needed by UserCollectionDetailPage/PersonPage
const moreFuncs = [
  'optimisticUpdateCollectionItems',
  'contentIdFromItem', 
  'trashItemFromCollectionCache',
  'confirmTrashItem',
  'restoreTrashItem',
  'refreshCollectionsView',
  'getCachedUserCollections',
  'getCollectionStatus'
];

for (const fn of moreFuncs) {
  if (helpers.includes('function ' + fn)) {
    console.log(fn, '- already in helpers.js');
    continue;
  }
  const code = extractFuncStrict(fn);
  if (code) {
    helpers += '\n\nexport ' + code;
    console.log('Added', fn, 'to helpers.js');
  } else {
    console.log(fn, '- NOT FOUND in monolith');
  }
}

fs.writeFileSync('spa/src/utils/helpers.js', helpers);
console.log('Done');
