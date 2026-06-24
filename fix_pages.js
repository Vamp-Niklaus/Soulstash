const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractFuncStrict(funcName) {
  const startPattern = 'function ' + funcName + '(';
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

// Extract between two named functions (exclusive of next)
function extractBetween(funcName, nextFuncName) {
  const s1 = mainSource.indexOf('function ' + funcName + '(');
  if (s1 === -1) return null;
  let s2;
  if (nextFuncName) {
    s2 = mainSource.indexOf('\nfunction ' + nextFuncName, s1);
    if (s2 === -1) s2 = mainSource.indexOf('\nconst ' + nextFuncName, s1);
    if (s2 === -1) s2 = mainSource.length;
  } else {
    s2 = mainSource.length;
  }
  return mainSource.substring(s1, s2).trim();
}

// ===== Fix PersonPage.jsx =====
// Only get PersonCreditsFilterControls + PersonPage (the actual page component)
const pcfc = extractBetween('PersonCreditsFilterControls', 'PersonPage');
const pp = extractBetween('PersonPage', 'AdminPage');

if (pcfc && pp) {
  const imports = [
    "import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';",
    "import { createPortal } from 'react-dom';",
    "import { useNavigate, useParams, useLocation, NavLink, Link } from 'react-router-dom';",
    "import { cachedApiFetch, apiFetch, getToken, getCurrentUsername } from '../../api/client.js';",
    "import { formatRuntime, getLanguageName, imageUrl, normalizeStoredCollectionItem, yearFrom, getPreferredRating, creditItemKey, creditMatchesCollectionItem, filterCreditsByCollectionItems, isContentInCollection, mediaRoute, getDirectorLabel, getDirectorPeople } from '../../utils/formatters.js';",
    "import { broadcastCollections, useLiveCollections, loadUserCollections, normalizeCollections, useAuthSession, getCollectionStatus, getCachedUserCollections, refreshCollectionsView, useSessionState, useDropdownKeyNav, clearAuthSession } from '../../utils/helpers.js';",
    "import { FALLBACK_AVATAR, FALLBACK_POSTER, CREDIT_PAGE_SIZE } from '../../utils/constants.js';",
    "import { toast } from '../../utils/toast.js';",
    "import { SectionHeader } from '../../components/ui/Misc/Typography.jsx';",
    "import { PersonPageSkeleton, CastRowSkeleton, DetailPageSkeleton } from '../../components/ui/Skeletons/index.js';",
    "import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';",
    "import { AnimeFilterIcon } from '../../components/ui/Misc/AnimeFilter.jsx';",
    "import { CollectionFilterControls, AnimeDropdownContent, SortDropdownContent } from '../../components/ui/Misc/CollectionFilterControls.jsx';",
    "import { SaveToCollectionModal } from '../../components/ui/Modals/SaveToCollectionModal.jsx';",
    "import { CreateCollectionModal } from '../../components/ui/Modals/CollectionFormModal.jsx';",
  ].join('\n');

  const content = imports + '\n\nexport ' + pcfc + '\n\nexport ' + pp + '\n';
  fs.writeFileSync('spa/src/pages/Content/PersonPage.jsx', content);
  console.log('Fixed PersonPage.jsx (' + content.length + ' chars)');
} else {
  console.log('FAILED to extract PersonPage components');
}

// ===== Fix CollectionPosterCard.jsx =====
// Only needs CollectionPosterCard function
const cpc = extractFuncStrict('CollectionPosterCard');
if (cpc) {
  // It's actually a const with React.forwardRef, let me get it differently
  const cpcStart = mainSource.indexOf('const CollectionPosterCard = React.forwardRef(');
  if (cpcStart !== -1) {
    // Find the next function/const
    const cpcEnd = mainSource.indexOf('\nfunction CollectionSearchDrawer', cpcStart);
    const code = mainSource.substring(cpcStart, cpcEnd !== -1 ? cpcEnd : cpcStart + 1000).trim();
    const imports = [
      "import React from 'react';",
      "import { useNavigate } from 'react-router-dom';",
      "import { normalizeStoredCollectionItem } from '../../../utils/formatters.js';",
      "import { ContentCard } from './ContentCard.jsx';",
    ].join('\n');
    fs.writeFileSync('spa/src/components/ui/Cards/CollectionPosterCard.jsx', imports + '\n\nexport ' + code + '\n');
    console.log('Fixed CollectionPosterCard.jsx');
  }
}

console.log('Done');
