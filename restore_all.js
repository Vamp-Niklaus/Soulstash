const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractBetween(funcName, nextFuncName) {
  const s1 = mainSource.indexOf('function ' + funcName);
  let s2 = -1;
  if (nextFuncName) {
    s2 = mainSource.indexOf('function ' + nextFuncName, s1);
    if (s2 === -1) {
      s2 = mainSource.indexOf('const ' + nextFuncName, s1);
    }
  }
  if (s2 === -1) s2 = mainSource.length;
  return mainSource.substring(s1, s2);
}

const map = {
  'spa/src/pages/Auth/ForgotPasswordPage.jsx': { n: 'ForgotPasswordPage', next: 'RegisterPage' },
  'spa/src/pages/Collections/UserCollectionDetailPage.jsx': { n: 'UserCollectionDetailPage', next: 'UserProfilePage' },
  'spa/src/pages/Content/PersonPage.jsx': { n: 'PersonPage', next: 'AdminPage' },
  'spa/src/pages/Explore/HomePage.jsx': { n: 'HomePage', next: 'TrendingPage' },
  'spa/src/pages/Explore/LazyCategoryShelf.jsx': { n: 'LazyCategoryShelf', next: 'HomePageSkeleton' },
  'spa/src/components/ui/Cards/CollectionPosterCard.jsx': { n: 'CollectionPosterCard', next: 'CollectionSearchDrawer' },
  'spa/src/components/ui/Misc/AnimeFilter.jsx': { n: 'AnimeFilterIcon', next: 'AnimeDropdownMenu' },
  'spa/src/components/ui/Misc/CollectionFilterControls.jsx': { n: 'CollectionFilterControls', next: 'CollectionDetailPane' }
};

for (const [file, info] of Object.entries(map)) {
  const code = extractBetween(info.n, info.next);
  let content = 'import React, { useState, useEffect, useRef, useMemo, useCallback } from \'react\';\nimport { useNavigate, NavLink, useParams, useLocation } from \'react-router-dom\';\nimport { cachedApiFetch, apiFetch, getToken, getCurrentUsername } from \'../../api/client.js\';\nimport { formatRuntime, getLanguageName, imageUrl, normalizeStoredCollectionItem, yearFrom, getPreferredRating, creditItemKey, creditMatchesCollectionItem, filterCreditsByCollectionItems, isContentInCollection, mediaRoute, getDirectorLabel, getDirectorPeople } from \'../../utils/formatters.js\';\nimport { broadcastCollections, lastKnownCollectionVersion, useLiveCollections, enrichCollectionRatingsInBackground, homeTrendingCache, loadUserCollections, normalizeCollections } from \'../../utils/helpers.js\';\nimport { HOME_GRID_CLASS, HOME_TRENDING_TTL, FALLBACK_POSTER, FALLBACK_AVATAR } from \'../../utils/constants.js\';\nimport { CollectionDetailPane } from \'../../components/ui/Misc/CollectionDetailPane.jsx\';\nimport { SectionHeader, MarqueeText } from \'../../components/ui/Misc/Typography.jsx\';\nimport { GridSkeleton, HomePageSkeleton, PersonPageSkeleton } from \'../../components/ui/Skeletons/index.js\';\nimport { ContentCard } from \'../../components/ui/Cards/ContentCard.jsx\';\nimport { AnimeFilterIcon } from \'../../components/ui/Misc/AnimeFilter.jsx\';\nimport { AnimeDropdownContent, SortDropdownContent } from \'../../components/ui/Misc/CollectionFilterControls.jsx\';\nimport { HomeShelfHeader } from \'../../components/ui/HomeShelfHeader.jsx\';\nimport { PersonCreditsFilterControls } from \'../../components/ui/Misc/PersonCreditsFilterControls.jsx\';\nimport { AuthPageLayout } from \'../../components/ui/Auth/AuthPageLayout.jsx\';\nimport { LazyCategoryShelf } from \'./LazyCategoryShelf.jsx\';\nexport ' + code;
  fs.writeFileSync(file, content);
  console.log('Restored ' + info.n);
}
