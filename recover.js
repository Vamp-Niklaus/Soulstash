const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');
function extractComponent(funcName) {
  const startPattern = 'function ' + funcName + '(';
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) {
    const constPattern = 'const ' + funcName + ' = ';
    startIdx = mainSource.indexOf(constPattern);
    if (startIdx === -1) return null;
  }
  let bracketCount = 0; let endIdx = -1; let inString = false; let inStringChar = ''; let inEscape = false;
  for (let i = startIdx; i < mainSource.length; i++) {
    const char = mainSource[i];
    if (inString) {
      if (inEscape) { inEscape = false; } else if (char === '\\\\') { inEscape = true; } else if (char === inStringChar) { inString = false; }
      continue;
    }
    if (char === '"' || char === "'" || char === '') { inString = true; inStringChar = char; continue; }
    if (char === '{') { bracketCount++; } else if (char === '}') { bracketCount--; if (bracketCount === 0) { endIdx = i + 1; break; } }
  }
  if (endIdx === -1) return null;
  return mainSource.slice(startIdx, endIdx);
}
const components = {
  'spa/src/pages/Auth/ForgotPasswordPage.jsx': 'ForgotPasswordPage',
  'spa/src/pages/Collections/UserCollectionDetailPage.jsx': 'UserCollectionDetailPage',
  'spa/src/pages/Content/PersonPage.jsx': 'PersonPage',
  'spa/src/pages/Explore/HomePage.jsx': 'HomePage',
  'spa/src/pages/Explore/LazyCategoryShelf.jsx': 'LazyCategoryShelf',
  'spa/src/components/ui/Cards/CollectionPosterCard.jsx': 'CollectionPosterCard',
  'spa/src/components/ui/Misc/AnimeFilter.jsx': 'AnimeFilter',
  'spa/src/components/ui/Misc/CollectionFilterControls.jsx': 'CollectionFilterControls',
  'spa/src/components/ui/Misc/PersonCreditsFilterControls.jsx': 'PersonCreditsFilterControls'
};
for (const [file, name] of Object.entries(components)) {
  const comp = extractComponent(name);
  if (comp) {
    fs.writeFileSync(file, 'import React, { useState, useEffect, useRef, useMemo, useCallback } from \'react\';\nimport { useNavigate, NavLink, useParams } from \'react-router-dom\';\nexport ' + comp);
    console.log('Extracted ' + name);
  } else {
    console.log('NOT FOUND: ' + name);
  }
}
