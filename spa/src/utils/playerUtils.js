export const SOURCE_GROUPS = [
  { id: 'hindi', label: 'Hindi' },
  { id: 'dubbed', label: 'Dubbed' },
  { id: 'subbed', label: 'Subbed / Original' }
];

export const HINDI_ORDER = [
  'Kartoon',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'VidBolt',
  'VIDOUT',
  'VidNest Anime (Hindi)',
  'VidNest AnimePahe (Hindi)'
];

export const DUBBED_ORDER = [
  'VidNest Anime (Dub)',
  'VidNest AnimePahe (Dub)',
  'VidHawk (Dub)',
  'Gogo Server (Dub)',
  'TryEmbed (Dub)'
];

export const SUBBED_ORDER = [
  'VidNest Anime (Sub)',
  'VidNest AnimePahe (Sub)',
  'VidHawk (Sub)',
  'Gogo Server (Sub)',
  'TryEmbed (Sub)',
  'Vidstreaming',
  'VidRift',
  'VidLink',
  'Vidly',
  'FrameXTV',
  'Cineverse',
  'Filmu',
  'vidfast',
  'VidSrc PM',
  'AutoEmbed',
  '2Embed',
  'YouTube'
];

export function sourceKeyText(source = {}) {
  return `${source.id || ''} ${source.key || ''} ${source.label || ''} ${source.serverName || ''}`.toLowerCase();
}

/**
 * Checks if a source belongs to the forbidden/deleted sources list:
 * VIDEASY, MegaPlay (Sub), MegaPlay (Dub), Nexus, VidSrc PRO, SuperEmbed.
 */
export function isForbiddenSource(source = {}) {
  const label = String(source.label || '').trim().toLowerCase();
  const id = String(source.id || '').trim().toLowerCase();
  const key = String(source.key || '').trim().toLowerCase();
  const raw = `${id} ${key} ${label}`;

  if (
    raw.includes('videasy') ||
    raw.includes('vid-easy') ||
    raw.includes('megaplay') ||
    raw.includes('nexus') ||
    raw.includes('moviesnexus') ||
    raw.includes('vidsrc-pro') ||
    raw.includes('vidsrc pro') ||
    raw.includes('superembed') ||
    raw.includes('multiembed.mov')
  ) {
    return true;
  }
  return false;
}

/**
 * Categorize source into exactly one of three groups:
 * - 'hindi'
 * - 'dubbed' (every source whose label contains "(Dub)")
 * - 'subbed' (everything else)
 */
export function getSourceGroup(source = {}) {
  const label = String(source.label || '').trim();
  const lowerLabel = label.toLowerCase();
  const id = String(source.id || '').trim().toLowerCase();
  const key = String(source.key || '').trim().toLowerCase();

  // YouTube always belongs to Subbed / Original
  if (id === 'youtube' || key === 'youtube' || lowerLabel === 'youtube' || lowerLabel.includes('youtube')) {
    return 'subbed';
  }

  // 1. Hindi group
  if (
    /^(h[1-5])$/i.test(id) ||
    /^(h[1-5])$/i.test(label) ||
    /^(smwh|rpmshre|upnshr|strmp2|flls)$/i.test(key) ||
    lowerLabel.includes('kartoon') ||
    id.includes('kartoon') ||
    key.includes('kartoon') ||
    lowerLabel === 'vidbolt' ||
    lowerLabel === 'vidout' ||
    lowerLabel.includes('hindi')
  ) {
    return 'hindi';
  }

  // 2. Dubbed group: every source whose label contains "(Dub)"
  if (label.includes('(Dub)') || lowerLabel.includes('(dub)')) {
    return 'dubbed';
  }

  // 3. Subbed / Original: everything else
  return 'subbed';
}

function getGroupItemRank(label = '', orderList = []) {
  const trimmed = label.trim().toLowerCase();
  if (trimmed.includes('kartoon')) return -1;
  const idx = orderList.findIndex((item) => item.toLowerCase() === trimmed);
  return idx >= 0 ? idx : 999;
}

export function sortSourcesInGroup(sources = [], groupKey = 'hindi') {
  let orderList = [];
  if (groupKey === 'hindi') orderList = HINDI_ORDER;
  else if (groupKey === 'dubbed') orderList = DUBBED_ORDER;
  else orderList = SUBBED_ORDER;

  return [...sources].sort((a, b) => {
    const rankA = getGroupItemRank(a.label || '', orderList);
    const rankB = getGroupItemRank(b.label || '', orderList);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return 0; // preserve relative order for unlisted items
  });
}

export const HINDI_SOURCE_SLOTS = [
  { id: 'h1', key: 'smwh', match: (s) => sourceKeyText(s).includes('filesforever') || sourceKeyText(s).includes('smwh') || s.key === 'smwh' || s.id === 'h1' || sourceKeyText(s) === 'h1', label: 'H1' },
  { id: 'h2', key: 'rpmshre', match: (s) => sourceKeyText(s).includes('rpmshre') || s.key === 'rpmshre' || s.id === 'h2' || sourceKeyText(s) === 'h2', label: 'H2' },
  { id: 'h3', key: 'upnshr', match: (s) => sourceKeyText(s).includes('upnshr') || s.key === 'upnshr' || s.id === 'h3' || sourceKeyText(s) === 'h3', label: 'H3' },
  { id: 'h4', key: 'strmp2', match: (s) => sourceKeyText(s).includes('strmp2') || s.key === 'strmp2' || s.id === 'h4' || sourceKeyText(s) === 'h4', label: 'H4' },
  { id: 'h5', key: 'flls', match: (s) => sourceKeyText(s).includes('flls') || s.key === 'flls' || s.id === 'h5' || sourceKeyText(s) === 'h5', label: 'H5' },
  { id: 'vidbolt', match: (s) => sourceKeyText(s).includes('vidbolt'), label: 'VidBolt' },
  { id: 'vidout', match: (s) => sourceKeyText(s).includes('vidout'), label: 'VIDOUT' },
  { id: 'vidnest-ani-hindi', match: (s) => sourceKeyText(s).includes('vidnest') && /ani.*hindi|hindi.*ani/i.test(sourceKeyText(s)), label: 'VidNest Anime (Hindi)' },
  { id: 'vidnest-pahe-hindi', match: (s) => (sourceKeyText(s).includes('pahe') || sourceKeyText(s).includes('animepahe')) && sourceKeyText(s).includes('hindi'), label: 'VidNest AnimePahe (Hindi)' }
];

export const DUBBED_SOURCE_SLOTS = [
  { id: 'vidnest-ani-dub', match: (s) => sourceKeyText(s).includes('vidnest') && /ani.*dub|dub.*ani/i.test(sourceKeyText(s)), label: 'VidNest Anime (Dub)' },
  { id: 'vidnest-pahe-dub', match: (s) => (sourceKeyText(s).includes('pahe') || sourceKeyText(s).includes('animepahe')) && sourceKeyText(s).includes('dub'), label: 'VidNest AnimePahe (Dub)' },
  { id: 'vidhawk-dub', match: (s) => sourceKeyText(s).includes('vidhawk') && sourceKeyText(s).includes('dub'), label: 'VidHawk (Dub)' },
  { id: 'gogo-server-dub', match: (s) => (sourceKeyText(s).includes('gogo') || sourceKeyText(s).includes('gogoanime')) && sourceKeyText(s).includes('dub'), label: 'Gogo Server (Dub)' },
  { id: 'tryembed-dub', match: (s) => sourceKeyText(s).includes('tryembed') && sourceKeyText(s).includes('dub'), label: 'TryEmbed (Dub)' }
];

export const SUBBED_SOURCE_SLOTS = [
  { id: 'vidnest-ani-sub', match: (s) => sourceKeyText(s).includes('vidnest') && /ani.*sub|sub.*ani/i.test(sourceKeyText(s)), label: 'VidNest Anime (Sub)' },
  { id: 'vidnest-pahe-sub', match: (s) => (sourceKeyText(s).includes('pahe') || sourceKeyText(s).includes('animepahe')) && sourceKeyText(s).includes('sub'), label: 'VidNest AnimePahe (Sub)' },
  { id: 'vidhawk-sub', match: (s) => sourceKeyText(s).includes('vidhawk') && !sourceKeyText(s).includes('dub'), label: 'VidHawk (Sub)' },
  { id: 'gogo-server-sub', match: (s) => (sourceKeyText(s).includes('gogo') || sourceKeyText(s).includes('gogoanime')) && !sourceKeyText(s).includes('dub'), label: 'Gogo Server (Sub)' },
  { id: 'tryembed-sub', match: (s) => sourceKeyText(s).includes('tryembed') && !sourceKeyText(s).includes('dub'), label: 'TryEmbed (Sub)' },
  { id: 'vidstreaming', match: (s) => sourceKeyText(s).includes('vidstreaming'), label: 'Vidstreaming' },
  { id: 'vidrift', match: (s) => sourceKeyText(s).includes('vidrift'), label: 'VidRift' },
  { id: 'vidlink', match: (s) => sourceKeyText(s).includes('vidlink'), label: 'VidLink' },
  { id: 'vidly', match: (s) => sourceKeyText(s).includes('vidly'), label: 'Vidly' },
  { id: 'framextv', match: (s) => sourceKeyText(s).includes('framextv'), label: 'FrameXTV' },
  { id: 'cineverse', match: (s) => sourceKeyText(s).includes('cineverse') || sourceKeyText(s).includes('modiplay') || sourceKeyText(s).includes('rozgarlelo'), label: 'Cineverse' },
  { id: 'filmu', match: (s) => sourceKeyText(s).includes('filmu'), label: 'Filmu' },
  { id: 'vidfast', match: (s) => sourceKeyText(s).includes('vidfast'), label: 'vidfast' },
  { id: 'vidsrc-pm', match: (s) => sourceKeyText(s).includes('vidsrc-pm'), label: 'VidSrc PM' },
  { id: 'autoembed', match: (s) => sourceKeyText(s).includes('autoembed'), label: 'AutoEmbed' },
  { id: '2embed', match: (s) => sourceKeyText(s).includes('2embed'), label: '2Embed' },
  { id: 'youtube', match: (s) => sourceKeyText(s).includes('youtube') || sourceKeyText(s).includes('youtu.be') || s.id === 'youtube' || s.key === 'youtube', label: 'YouTube' }
];

// Backwards compatibility aliases
export const ANIME_SOURCE_SLOTS = [...HINDI_SOURCE_SLOTS, ...DUBBED_SOURCE_SLOTS, ...SUBBED_SOURCE_SLOTS];
export const STANDARD_SOURCE_SLOTS = ANIME_SOURCE_SLOTS;
export const PLAYER_SOURCE_SLOTS = ANIME_SOURCE_SLOTS;

export function firstPlayableUrl(source) {
  if (!source) return '';
  if (source.url) return source.url;
  if (Array.isArray(source.urls)) return source.urls.find(Boolean) || '';
  return '';
}

/**
 * Builds player source slots partitioned into the 3 groups: Hindi, Dubbed, Subbed / Original.
 * Empty sources are marked unhealthy but kept visible.
 * Forbidden sources (VIDEASY, MegaPlay, Nexus, VidSrc PRO, SuperEmbed) are permanently filtered out.
 */
export function buildPlayerSourceSlots(
  incomingSources = [],
  fallbackSources = [],
  isLoadingOrOptions = false,
  failedUrlsArg = new Set(),
  verifiedUrlsArg = new Set()
) {
  let isLoading = false;
  let failedUrls = new Set();
  let verifiedUrls = new Set();

  if (isLoadingOrOptions && typeof isLoadingOrOptions === 'object') {
    isLoading = Boolean(isLoadingOrOptions.isLoading);
    failedUrls = isLoadingOrOptions.failedUrls || new Set();
    verifiedUrls = isLoadingOrOptions.verifiedUrls || new Set();
  } else {
    isLoading = Boolean(isLoadingOrOptions);
    failedUrls = failedUrlsArg || new Set();
    verifiedUrls = verifiedUrlsArg || new Set();
  }

  // Filter pool: exclude forbidden sources and cine.su
  const pool = [...incomingSources, ...fallbackSources]
    .filter(Boolean)
    .filter((source) => !isForbiddenSource(source) && !/cine\.?su/.test(sourceKeyText(source)));

  const used = new Set();

  const processSlot = (slot, groupKey) => {
    const foundIndex = pool.findIndex((source, index) => {
      if (used.has(index)) return false;
      if (slot.key && (source.key === slot.key || source.id === slot.key)) return true;
      return slot.match ? slot.match(source) : false;
    });

    const found = foundIndex >= 0 ? pool[foundIndex] : null;
    if (foundIndex >= 0) used.add(foundIndex);

    const url = firstPlayableUrl(found);
    const isMissing = !url;
    const isScrapedSlot = /^(h1|h2|h3|h4|h5|youtube)$/i.test(slot.id);
    const isPending = Boolean(found?.pending) || (isLoading && isMissing && isScrapedSlot);
    const isFailed = Boolean(url && failedUrls.has(url));
    const isWorking = Boolean(url && verifiedUrls.has(url));

    return {
      ...(found || {}),
      id: found?.id || slot.id,
      key: found?.key || slot.key || slot.id,
      label: slot.label,
      url,
      urls: found?.urls || (url ? [url] : []),
      embeddable: found?.embeddable !== false,
      pending: isPending,
      failed: isFailed,
      working: isWorking,
      unhealthy: isMissing && !isPending,
      disabled: (isPending || isMissing) && !isFailed,
      group: groupKey
    };
  };

  const hindiSources = HINDI_SOURCE_SLOTS.map((slot) => processSlot(slot, 'hindi'));
  const dubbedSources = DUBBED_SOURCE_SLOTS.map((slot) => processSlot(slot, 'dubbed'));
  const subbedSources = SUBBED_SOURCE_SLOTS.map((slot) => processSlot(slot, 'subbed'));

  // Remaining unused sources in pool
  const extraSources = pool
    .filter((_, index) => !used.has(index))
    .map((source) => {
      const url = firstPlayableUrl(source);
      const isMissing = !url;
      const isFailed = Boolean(url && failedUrls.has(url));
      const isWorking = Boolean(url && verifiedUrls.has(url));
      const groupKey = getSourceGroup(source);

      return {
        ...source,
        id: source.id || source.key || `extra-${Math.random()}`,
        label: source.label || source.id || 'Extra Source',
        url,
        urls: source.urls || (url ? [url] : []),
        embeddable: source.embeddable !== false,
        pending: Boolean(source.pending),
        failed: isFailed,
        working: isWorking,
        unhealthy: isMissing && !source.pending,
        disabled: (source.pending || isMissing) && !isFailed,
        group: groupKey
      };
    });

  extraSources.forEach((source) => {
    if (source.group === 'hindi') hindiSources.push(source);
    else if (source.group === 'dubbed') dubbedSources.push(source);
    else subbedSources.push(source);
  });

  const sortedHindi = sortSourcesInGroup(hindiSources, 'hindi');
  const sortedDubbed = sortSourcesInGroup(dubbedSources, 'dubbed');
  const sortedSubbed = sortSourcesInGroup(subbedSources, 'subbed');

  return [...sortedHindi, ...sortedDubbed, ...sortedSubbed];
}
