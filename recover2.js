const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractBetween(funcName, nextFuncName) {
  const s1 = mainSource.indexOf('function ' + funcName);
  const s2 = nextFuncName ? mainSource.indexOf('function ' + nextFuncName, s1) : mainSource.length;
  return mainSource.substring(s1, s2);
}

fs.writeFileSync('spa/src/pages/Collections/UserCollectionDetailPage.jsx', 'import React, { useState, useEffect, useRef, useMemo, useCallback } from \'react\';\nimport { useNavigate, NavLink, useParams, useLocation } from \'react-router-dom\';\nimport { CollectionDetailPane } from \'../../components/ui/Misc/CollectionDetailPane.jsx\';\nimport { SectionHeader } from \'../../components/ui/Misc/Typography.jsx\';\nimport { GridSkeleton } from \'../../components/ui/Skeletons/index.js\';\nimport { ContentCard } from \'../../components/ui/Cards/ContentCard.jsx\';\nimport { formatRuntime, getLanguageName } from \'../../utils/formatters.js\';\nimport { cachedApiFetch, getToken, getCurrentUsername } from \'../../api/client.js\';\nimport { broadcastCollections, lastKnownCollectionVersion, useLiveCollections } from \'../../utils/helpers.js\';\nexport ' + extractBetween('UserCollectionDetailPage', 'AdminPage'));
console.log('Extracted UserCollectionDetailPage');

fs.writeFileSync('spa/src/components/ui/Misc/AnimeFilter.jsx', 'import React from \'react\';\nexport ' + extractBetween('AnimeFilterIcon', 'ContentCard'));
console.log('Extracted AnimeFilter');
