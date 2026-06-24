const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractComponentStrict(funcName) {
  let startPattern = 'function ' + funcName + '(';
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) {
    startPattern = 'function ' + funcName + ' ';
    startIdx = mainSource.indexOf(startPattern);
  }
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

// Extract HomeShelfHeader
const hsh = extractComponentStrict('HomeShelfHeader');
if (hsh) {
  const content = "import React from 'react';\nimport { NavLink } from 'react-router-dom';\nexport " + hsh + "\n";
  fs.writeFileSync('spa/src/pages/Explore/HomeShelfHeader.jsx', content);
  console.log('Extracted HomeShelfHeader');
} else {
  console.log('HomeShelfHeader NOT FOUND');
}

// Extract VideoJsPlayer  
const vjp = extractComponentStrict('VideoJsPlayer');
if (vjp) {
  const content = "import React, { useEffect, useRef } from 'react';\nexport " + vjp + "\n";
  fs.writeFileSync('spa/src/components/ui/Misc/VideoJsPlayer.jsx', content);
  console.log('Extracted VideoJsPlayer');
} else {
  console.log('VideoJsPlayer NOT FOUND');
}

// Check useAuthSession is in helpers
const helpersContent = fs.readFileSync('spa/src/utils/helpers.js', 'utf8');
console.log('useAuthSession in helpers:', helpersContent.includes('useAuthSession'));
console.log('clearAuthSession in helpers:', helpersContent.includes('clearAuthSession'));

// Check formatters exports
const formattersContent = fs.readFileSync('spa/src/utils/formatters.js', 'utf8');
console.log('getPreferredRating in formatters:', formattersContent.includes('getPreferredRating'));
