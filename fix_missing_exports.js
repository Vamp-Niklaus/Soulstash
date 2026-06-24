const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractFuncStrict(funcName) {
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

// Extract useLiveCollections into helpers.js
let helpers = fs.readFileSync('spa/src/utils/helpers.js', 'utf8');
const ulc = extractFuncStrict('useLiveCollections');
if (ulc && !helpers.includes('function useLiveCollections(')) {
  helpers += '\n\nexport ' + ulc;
  fs.writeFileSync('spa/src/utils/helpers.js', helpers);
  console.log('Added useLiveCollections to helpers.js');
} else {
  console.log('useLiveCollections already present or not found');
}

// Also check for loadUserCollections, normalizeCollections, getCachedUserCollections, refreshCollectionsView
const helperFuncs = ['loadUserCollections', 'normalizeCollections', 'getCachedUserCollections', 'refreshCollectionsView'];
for (const fn of helperFuncs) {
  if (!helpers.includes('function ' + fn + '(')) {
    const code = extractFuncStrict(fn);
    if (code) {
      helpers += '\n\nexport ' + code;
      console.log('Added ' + fn + ' to helpers.js');
    }
  }
}
fs.writeFileSync('spa/src/utils/helpers.js', helpers);


// Extract SectionHeader and other missing Typography components
let typography = fs.readFileSync('spa/src/components/ui/Misc/Typography.jsx', 'utf8');
const typoFuncs = ['SectionHeader', 'MarqueeText', 'HoverMarqueeTitle', 'CollectionVisibilityBadge'];
for (const fn of typoFuncs) {
  if (!typography.includes('function ' + fn + '(')) {
    const code = extractFuncStrict(fn);
    if (code) {
      typography += '\n\nexport ' + code;
      console.log('Added ' + fn + ' to Typography.jsx');
    } else {
      console.log('Could not find ' + fn);
    }
  }
}
fs.writeFileSync('spa/src/components/ui/Misc/Typography.jsx', typography);

// Extract missing DropdownContents into CollectionFilterControls.jsx if they aren't there
let controls = fs.readFileSync('spa/src/components/ui/Misc/CollectionFilterControls.jsx', 'utf8');
const controlFuncs = ['AnimeDropdownContent', 'SortDropdownContent'];
// AnimeDropdownContent is usually a const, not a function, or maybe a function. Let's try function.
for (const fn of controlFuncs) {
  if (!controls.includes('function ' + fn + '(')) {
    const code = extractFuncStrict(fn);
    if (code) {
      controls += '\n\nexport ' + code;
      console.log('Added ' + fn + ' to CollectionFilterControls.jsx');
    }
  }
}
fs.writeFileSync('spa/src/components/ui/Misc/CollectionFilterControls.jsx', controls);

console.log('Done');
