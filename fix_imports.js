const fs = require('fs');
const path = require('path');

// All available symbols and where they come from (relative to spa/src/)
const symbolSources = {
  // api/client.js
  'cachedApiFetch': 'api/client.js',
  'apiFetch': 'api/client.js',
  'streamApiFetch': 'api/client.js',
  'getToken': 'api/client.js',
  'getCurrentUsername': 'api/client.js',
  'emitAuthChange': 'api/client.js',
  
  // utils/formatters.js
  'formatRuntime': 'utils/formatters.js',
  'getLanguageName': 'utils/formatters.js',
  'imageUrl': 'utils/formatters.js',
  'normalizeStoredCollectionItem': 'utils/formatters.js',
  'yearFrom': 'utils/formatters.js',
  'getPreferredRating': 'utils/formatters.js',
  'creditItemKey': 'utils/formatters.js',
  'creditMatchesCollectionItem': 'utils/formatters.js',
  'filterCreditsByCollectionItems': 'utils/formatters.js',
  'isContentInCollection': 'utils/formatters.js',
  'mediaRoute': 'utils/formatters.js',
  'getDirectorLabel': 'utils/formatters.js',
  'getDirectorPeople': 'utils/formatters.js',
  
  // utils/helpers.js
  'broadcastCollections': 'utils/helpers.js',
  'lastKnownCollectionVersion': 'utils/helpers.js',
  'useLiveCollections': 'utils/helpers.js',
  'enrichCollectionRatingsInBackground': 'utils/helpers.js',
  'homeTrendingCache': 'utils/helpers.js',
  'loadUserCollections': 'utils/helpers.js',
  'normalizeCollections': 'utils/helpers.js',
  'getOverlayColumnCount': 'utils/helpers.js',
  'mergeSearchResults': 'utils/helpers.js',
  'getSearchHistory': 'utils/helpers.js',
  'useAuthSession': 'utils/helpers.js',
  'clearAuthSession': 'utils/helpers.js',
  
  // utils/constants.js
  'HOME_GRID_CLASS': 'utils/constants.js',
  'HOME_TRENDING_TTL': 'utils/constants.js',
  'FALLBACK_POSTER': 'utils/constants.js',
  'FALLBACK_AVATAR': 'utils/constants.js',
  'CREDIT_PAGE_SIZE': 'utils/constants.js',
  'COLLECTION_NAME_MAX_LENGTH': 'utils/constants.js',
  'RATINGS_TABLE_TTL': 'utils/constants.js',
  'MAX_TRUSTED_RATING': 'utils/constants.js',
  'COLLECTIONS_CACHE_KEY': 'utils/constants.js',
  'COLLECTIONS_TRASH_CACHE_KEY': 'utils/constants.js',
  'API_CACHE_TTL': 'utils/constants.js',
  'PUBLISH_MIN_COLLECTION_TITLES': 'utils/constants.js',
};

// Component imports: symbol -> file relative to spa/src/
const componentSources = {
  'CollectionDetailPane': 'components/ui/Misc/CollectionDetailPane.jsx',
  'SectionHeader': 'components/ui/Misc/Typography.jsx',
  'MarqueeText': 'components/ui/Misc/Typography.jsx',
  'HoverMarqueeTitle': 'components/ui/Misc/Typography.jsx',
  'CollectionVisibilityBadge': 'components/ui/Misc/Typography.jsx',
  'GridSkeleton': 'components/ui/Skeletons/index.js',
  'HomePageSkeleton': 'components/ui/Skeletons/index.js',
  'PersonPageSkeleton': 'components/ui/Skeletons/index.js',
  'NavbarSkeleton': 'components/ui/Skeletons/index.js',
  'SearchResultSkeletonGrid': 'components/ui/Skeletons/index.js',
  'ContentCardSkeleton': 'components/ui/Skeletons/index.js',
  'DetailPageSkeleton': 'components/ui/Skeletons/index.js',
  'UserProfileSkeleton': 'components/ui/Skeletons/index.js',
  'EditProfileSkeleton': 'components/ui/Skeletons/index.js',
  'AuthPageSkeleton': 'components/ui/Skeletons/index.js',
  'CastRowSkeleton': 'components/ui/Skeletons/index.js',
  'ContentCard': 'components/ui/Cards/ContentCard.jsx',
  'AnimeFilterIcon': 'components/ui/Misc/AnimeFilter.jsx',
  'AnimeDropdownContent': 'components/ui/Misc/CollectionFilterControls.jsx',
  'AnimeDropdownMenu': 'components/ui/Misc/CollectionFilterControls.jsx',
  'SortDropdownContent': 'components/ui/Misc/CollectionFilterControls.jsx',
  'CollectionFilterControls': 'components/ui/Misc/CollectionFilterControls.jsx',
  'PersonCreditsFilterControls': 'components/ui/Misc/PersonCreditsFilterControls.jsx',
  'AuthPageLayout': 'components/ui/Auth/AuthPageLayout.jsx',
  'HomeShelfHeader': 'pages/Explore/HomeShelfHeader.jsx',
  'LazyCategoryShelf': 'pages/Explore/LazyCategoryShelf.jsx',
  'CollectionPosterCard': 'components/ui/Cards/CollectionPosterCard.jsx',
  'CollectionSearchDrawer': 'components/ui/Misc/CollectionSearchDrawer.jsx',
  'ConfirmModal': 'components/ui/Modals/ConfirmModal.jsx',
  'CollectionFormModal': 'components/ui/Modals/CollectionFormModal.jsx',
  'CreateCollectionModal': 'components/ui/Modals/CollectionFormModal.jsx',
  'EditCollectionModal': 'components/ui/Modals/CollectionFormModal.jsx',
  'SaveToCollectionModal': 'components/ui/Modals/SaveToCollectionModal.jsx',
  'VideoJsPlayer': 'components/ui/Misc/VideoJsPlayer.jsx',
};

// React imports
const reactSymbols = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect', 'forwardRef', 'memo', 'createContext', 'Fragment', 'Suspense', 'lazy'];
const reactRouterSymbols = ['useNavigate', 'useLocation', 'useParams', 'NavLink', 'Link', 'Navigate', 'useSearchParams', 'Outlet'];
const reactDomSymbols = ['createPortal'];

const srcDir = path.resolve('spa/src');

// Files to fix
const filesToFix = [
  'spa/src/components/ui/Misc/AnimeFilter.jsx',
  'spa/src/components/ui/Misc/CollectionFilterControls.jsx',
  'spa/src/components/ui/Cards/CollectionPosterCard.jsx',
  'spa/src/pages/Explore/HomePage.jsx',
  'spa/src/pages/Explore/LazyCategoryShelf.jsx',
  'spa/src/pages/Collections/UserCollectionDetailPage.jsx',
  'spa/src/pages/Content/PersonPage.jsx',
  'spa/src/pages/Auth/ForgotPasswordPage.jsx',
];

function getRelativePath(fromFile, toFileRelToSrc) {
  const fromDir = path.dirname(path.resolve(fromFile));
  const toFile = path.join(srcDir, toFileRelToSrc);
  let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function scanSymbols(code, symbolList) {
  const found = [];
  for (const sym of symbolList) {
    // Use word boundary check
    const regex = new RegExp('\\b' + sym + '\\b');
    if (regex.test(code)) {
      found.push(sym);
    }
  }
  return found;
}

for (const file of filesToFix) {
  console.log('\n--- Processing:', file, '---');
  let content = fs.readFileSync(file, 'utf8');
  
  // Find where the export/function body starts (after the import block)
  const exportIdx = content.indexOf('export ');
  if (exportIdx === -1) {
    console.log('  SKIP: No export found');
    continue;
  }
  
  const body = content.substring(exportIdx);
  
  // Build imports
  const imports = [];
  
  // React
  const usedReact = scanSymbols(body, reactSymbols);
  if (usedReact.length > 0) {
    imports.push(`import React, { ${usedReact.join(', ')} } from 'react';`);
  } else {
    imports.push(`import React from 'react';`);
  }
  
  // React DOM
  const usedReactDom = scanSymbols(body, reactDomSymbols);
  if (usedReactDom.length > 0) {
    imports.push(`import { ${usedReactDom.join(', ')} } from 'react-dom';`);
  }
  
  // React Router
  const usedRouter = scanSymbols(body, reactRouterSymbols);
  if (usedRouter.length > 0) {
    imports.push(`import { ${usedRouter.join(', ')} } from 'react-router-dom';`);
  }
  
  // Utility imports grouped by source file
  const utilGroups = {};
  for (const [sym, src] of Object.entries(symbolSources)) {
    if (body.includes(sym)) {
      if (!utilGroups[src]) utilGroups[src] = [];
      utilGroups[src].push(sym);
    }
  }
  for (const [src, syms] of Object.entries(utilGroups)) {
    const rel = getRelativePath(file, src);
    imports.push(`import { ${syms.join(', ')} } from '${rel}';`);
  }
  
  // Component imports grouped by source file (avoid self-imports)
  const compGroups = {};
  const selfPath = path.resolve(file);
  for (const [sym, src] of Object.entries(componentSources)) {
    const srcFullPath = path.join(srcDir, src);
    if (path.resolve(srcFullPath) === selfPath) continue; // skip self-import
    if (body.includes(sym)) {
      if (!compGroups[src]) compGroups[src] = [];
      if (!compGroups[src].includes(sym)) compGroups[src].push(sym);
    }
  }
  for (const [src, syms] of Object.entries(compGroups)) {
    const rel = getRelativePath(file, src);
    imports.push(`import { ${syms.join(', ')} } from '${rel}';`);
  }
  
  const newContent = imports.join('\n') + '\n' + body;
  fs.writeFileSync(file, newContent);
  console.log('  Wrote', imports.length, 'import lines');
  imports.forEach(i => console.log('  ', i));
}

console.log('\nDone!');
