const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractFunc(funcName) {
  const startPattern = 'function ' + funcName + '(';
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) {
    const startPattern2 = 'function ' + funcName + ' ';
    startIdx = mainSource.indexOf(startPattern2);
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

// Extract auth functions that need to go into helpers.js
const funcs = ['clearClientDataCaches', 'clearAuthSession', 'saveAuthSession', 'useAuthSession'];
const helpersPath = 'spa/src/utils/helpers.js';
let helpers = fs.readFileSync(helpersPath, 'utf8');

for (const fn of funcs) {
  if (helpers.includes('function ' + fn)) {
    console.log(fn, '- already in helpers.js');
    continue;
  }
  const code = extractFunc(fn);
  if (code) {
    helpers += '\n\nexport ' + code;
    console.log('Added', fn, 'to helpers.js');
  } else {
    console.log(fn, '- NOT FOUND in monolith');
  }
}

fs.writeFileSync(helpersPath, helpers);
console.log('Updated helpers.js');

// Check what VideoJsPlayer actually is
const vpIdx = mainSource.indexOf('const VideoJsPlayer');
if (vpIdx !== -1) {
  console.log('\nVideoJsPlayer definition:', mainSource.substring(vpIdx, vpIdx + 200));
}

// Check if createPlayer exists 
const cpIdx = mainSource.indexOf('function createPlayer');
if (cpIdx !== -1) {
  console.log('\ncreatePlayer found at', cpIdx);
}
