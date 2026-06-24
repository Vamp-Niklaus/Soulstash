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

let helpers = fs.readFileSync('spa/src/utils/helpers.js', 'utf8');

const funcsToAdd = [
  'clearClientDataCaches',
  'clearAuthSession',
  'saveAuthSession',
  'useAuthSession',
  'useSessionState',
  'useHomeTwoRowLimit',
  'useGridKeyNav',
  'useDropdownKeyNav',
  'getHomeGridColumns',
];

for (const fn of funcsToAdd) {
  if (helpers.includes('function ' + fn + '(')) {
    console.log(fn, '- already exists, skipping');
    continue;
  }
  const code = extractFuncStrict(fn);
  if (code) {
    helpers += '\n\nexport ' + code;
    console.log('Added', fn);
  } else {
    console.log(fn, '- NOT FOUND');
  }
}

fs.writeFileSync('spa/src/utils/helpers.js', helpers);
console.log('Done. Total lines:', helpers.split('\n').length);

// Verify no duplicates
const dupeCheck = ['clearClientDataCaches', 'clearAuthSession', 'useAuthSession', 'useDropdownKeyNav'];
for (const fn of dupeCheck) {
  const matches = helpers.match(new RegExp('export function ' + fn, 'g'));
  console.log(fn, 'count:', matches ? matches.length : 0);
}
