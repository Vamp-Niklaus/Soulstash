export const PLAYER_SOURCE_SLOTS = [
  // 1, 2, 3 Fixed Top Trusted Sources
  { id: 'vidnest', match: (s) => sourceKeyText(s).includes('vidnest'), label: 'VidNest' },
  { id: 'videasy', match: (s) => sourceKeyText(s).includes('videasy') || sourceKeyText(s).includes('vid-easy'), label: 'VIDEASY' },
  { id: 'vidrift', match: (s) => sourceKeyText(s).includes('vidrift'), label: 'VidRift' },

  // Direct fast providers
  { id: 'vidlink', match: (s) => sourceKeyText(s).includes('vidlink'), label: 'VidLink' },
  { id: 'vidly', match: (s) => sourceKeyText(s).includes('vidly'), label: 'Vidly' },
  { id: 'framextv', match: (s) => sourceKeyText(s).includes('framextv'), label: 'FrameXTV' },
  { id: 'cineverse', match: (s) => sourceKeyText(s).includes('cineverse') || sourceKeyText(s).includes('modiplay') || sourceKeyText(s).includes('rozgarlelo'), label: 'Cineverse' },
  { id: 'vidbolt', match: (s) => sourceKeyText(s).includes('vidbolt'), label: 'VidBolt' },
  { id: 'filmu', match: (s) => sourceKeyText(s).includes('filmu'), label: 'Filmu' },
  { id: 'vidout', match: (s) => sourceKeyText(s).includes('vidout'), label: 'VIDOUT' },
  { id: 'nexus', match: (s) => sourceKeyText(s).includes('nexus') || sourceKeyText(s).includes('moviesnexus'), label: 'Nexus' },
  { id: 'vidfast', match: (s) => sourceKeyText(s).includes('vidfast'), label: 'vidfast' },

  // Anime Providers (MultiNime & AniList)
  { id: 'flixcloud-1', match: (s) => /flixcloud.*(?:hd-?1|1)/i.test(sourceKeyText(s)) || (sourceKeyText(s).includes('flixcloud') && !sourceKeyText(s).includes('2')), label: 'FlixCloud (HD-1)' },
  { id: 'flixcloud-2', match: (s) => /flixcloud.*(?:hd-?2|2)/i.test(sourceKeyText(s)), label: 'FlixCloud (HD-2)' },
  { id: 'megaplay', match: (s) => sourceKeyText(s).includes('megaplay'), label: 'MegaPlay' },
  { id: 'vidhawk', match: (s) => sourceKeyText(s).includes('vidhawk'), label: 'VidHawk' },
  { id: 'gogo-server', match: (s) => sourceKeyText(s).includes('gogo') || sourceKeyText(s).includes('gogoanime'), label: 'Gogo Server' },
  { id: 'tryembed', match: (s) => sourceKeyText(s).includes('tryembed'), label: 'TryEmbed' },
  { id: 'vidstreaming', match: (s) => sourceKeyText(s).includes('vidstreaming'), label: 'Vidstreaming' },

  // Scraped MultiMovies mirrors
  { id: 'h1', key: 'smwh', match: (s) => sourceKeyText(s).includes('filesforever') || sourceKeyText(s).includes('smwh') || s.key === 'smwh' || s.id === 'h1', label: 'H1' },
  { id: 'h2', key: 'rpmshre', match: (s) => sourceKeyText(s).includes('rpmshre') || s.key === 'rpmshre' || s.id === 'h2', label: 'H2' },
  { id: 'h3', key: 'upnshr', match: (s) => sourceKeyText(s).includes('upnshr') || s.key === 'upnshr' || s.id === 'h3', label: 'H3' },
  { id: 'h4', key: 'strmp2', match: (s) => sourceKeyText(s).includes('strmp2') || s.key === 'strmp2' || s.id === 'h4', label: 'H4' },
  { id: 'h5', key: 'flls', match: (s) => sourceKeyText(s).includes('flls') || s.key === 'flls' || s.id === 'h5', label: 'H5' },

  // Fallback embeds
  { id: 'vidsrc-pm', match: (s) => sourceKeyText(s).includes('vidsrc-pm'), label: 'VidSrc PM' },
  { id: 'vidsrc-pro', match: (s) => sourceKeyText(s).includes('vidsrc-pro'), label: 'VidSrc PRO' },
  { id: 'vidsrc-in', match: (s) => sourceKeyText(s).includes('vidsrc-in'), label: 'VidSrc IN' },
  { id: 'vidsrc-net', match: (s) => sourceKeyText(s).includes('vidsrc-net'), label: 'VidSrc NET' },
  { id: 'vidsrc-xyz', match: (s) => sourceKeyText(s).includes('vidsrc-xyz'), label: 'VidSrc XYZ' },
  { id: 'superembed', match: (s) => sourceKeyText(s).includes('superembed'), label: 'SuperEmbed' },
  { id: 'autoembed', match: (s) => sourceKeyText(s).includes('autoembed'), label: 'AutoEmbed' },
  { id: 'vidbinge', match: (s) => sourceKeyText(s).includes('vidbinge'), label: 'VidBinge' },
  { id: 'multiembed', match: (s) => sourceKeyText(s).includes('multiembed'), label: 'MultiEmbed' },
  { id: '2embed', match: (s) => sourceKeyText(s).includes('2embed'), label: '2Embed' },
  { id: 'youtube', match: (s) => sourceKeyText(s).includes('youtube'), label: 'YouTube' }
];

export function sourceKeyText(source = {}) {
  return `${source.id || ''} ${source.key || ''} ${source.label || ''}`.toLowerCase();
}

export function firstPlayableUrl(source) {
  if (!source) return '';
  if (source.url) return source.url;
  if (Array.isArray(source.urls)) return source.urls.find(Boolean) || '';
  return '';
}

export function buildPlayerSourceSlots(
  incomingSources = [],
  fallbackSources = [],
  isLoading = false,
  failedUrls = new Set(),
  verifiedUrls = new Set()
) {
  // Cine.su is temporarily hidden and disabled.
  const pool = [...incomingSources, ...fallbackSources]
    .filter(Boolean)
    .filter((source) => !/cine\.?su/.test(sourceKeyText(source)));
  const used = new Set();

  const slots = PLAYER_SOURCE_SLOTS.map((slot) => {
    const foundIndex = pool.findIndex((source, index) => {
      if (used.has(index)) return false;
      if (slot.key && (source.key === slot.key || source.id === slot.key)) return true;
      return slot.match ? slot.match(source) : false;
    });
    const found = foundIndex >= 0 ? pool[foundIndex] : null;
    if (foundIndex >= 0) used.add(foundIndex);

    const url = firstPlayableUrl(found);
    const isMissing = !url;
    // Only pending if it's one of the scraped slots or explicitly pending
    const isScrapedSlot = /^(h1|h2|h3|h4|h5|youtube|flixcloud.*)$/i.test(slot.id);
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
      disabled: (isPending || isMissing) && !isFailed
    };
  });

  // Filter out slots that have NO URL and are NOT pending (removes dead/empty options)
  const availableSlots = slots.filter((s) => s.url || s.pending);

  // STABLE SORT: Only move failed sources to the end so clicking never shifts array indices!
  return availableSlots.sort((a, b) => {
    if (a.failed !== b.failed) {
      return a.failed ? 1 : -1;
    }
    return 0; // Preserve exact fixed slot order!
  });
}

