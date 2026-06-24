const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractComponentStrict(funcName) {
  const startPattern = 'function ' + funcName + '(';
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) return null;
  
  let bracketCount = 0;
  let inString = false;
  let stringChar = '';
  let escapeNext = false;
  let endIdx = -1;
  let started = false;
  
  for (let i = startIdx; i < mainSource.length; i++) {
    const char = mainSource[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (inString) {
      if (char === stringChar) {
        inString = false;
      }
      continue;
    }
    
    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      continue;
    }
    
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

fs.writeFileSync('spa/src/pages/Collections/UserCollectionDetailPage.jsx', "import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';\nimport { useNavigate, NavLink, useParams, useLocation } from 'react-router-dom';\nimport { CollectionDetailPane } from '../../components/ui/Misc/CollectionDetailPane.jsx';\nimport { SectionHeader } from '../../components/ui/Misc/Typography.jsx';\nimport { GridSkeleton } from '../../components/ui/Skeletons/index.js';\nimport { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';\nimport { formatRuntime, getLanguageName, imageUrl, normalizeStoredCollectionItem } from '../../utils/formatters.js';\nimport { cachedApiFetch, getToken, getCurrentUsername } from '../../api/client.js';\nimport { broadcastCollections, lastKnownCollectionVersion, useLiveCollections } from '../../utils/helpers.js';\nexport " + extractComponentStrict('UserCollectionDetailPage'));
console.log('Extracted strict UserCollectionDetailPage');

fs.writeFileSync('spa/src/components/ui/Misc/AnimeFilter.jsx', "import React from 'react';\nexport " + extractComponentStrict('AnimeFilterIcon'));
console.log('Extracted strict AnimeFilterIcon');
