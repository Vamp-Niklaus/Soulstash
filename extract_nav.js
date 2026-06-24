const fs = require('fs'); 
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8'); 
function extractComponent(funcName) { 
  const startPattern = 'function ' + funcName + '('; 
  let startIdx = mainSource.indexOf(startPattern); 
  if (startIdx === -1) return null; 
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
const navbar = extractComponent('ReactNavbar'); 
if (navbar) { 
  let c = 'import { NavbarSkeleton, SearchResultSkeletonGrid } from \'../ui/Skeletons/index.js\';\nimport { HoverMarqueeTitle } from \'../ui/Misc/Typography.jsx\';\nimport { getOverlayColumnCount, mergeSearchResults, getSearchHistory } from \'../../utils/helpers.js\';\nimport React, { useState, useEffect, useRef, useCallback } from \'react\';\nimport { NavLink, useNavigate, useLocation } from \'react-router-dom\';\nimport { FALLBACK_AVATAR } from \'../../utils/constants.js\';\nimport { getToken, getCurrentUsername, emitAuthChange, cachedApiFetch, apiFetch, streamApiFetch } from \'../../api/client.js\';\nexport ' + navbar; 
  fs.writeFileSync('spa/src/components/layout/Navbar.jsx', c); 
  console.log('Extracted ReactNavbar'); 
}
