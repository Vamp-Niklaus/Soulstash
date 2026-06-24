export const PLAYER_SOURCE_SLOTS = [
  { id: 'h1', key: 'smwh', label: 'H1' },
  { id: 'h2', key: 'rpmshre', label: 'H2' },
  { id: 'h3', key: 'upnshr', label: 'H3' },
  { id: 'h4', key: 'strmp2', label: 'H4' },
  { id: 'h5', key: 'flls', label: 'H5' },
  { id: 'vidnest', match: (source) => sourceKeyText(source).includes('vidnest'), label: 'VidNest' },
  { id: 'cinesu', match: (source) => sourceKeyText(source).includes('cinesu') || sourceKeyText(source).includes('cine.su'), label: 'Cine.su' },
  { id: 'videasy', match: (source) => sourceKeyText(source).includes('videasy') || sourceKeyText(source).includes('vid-easy'), label: 'VIDEASY' },
  { id: 'vidsrc-pm', match: (source) => sourceKeyText(source).includes('vidsrc-pm'), label: 'VidSrc PM' },
  { id: 'vidfast', match: (source) => sourceKeyText(source).includes('vidfast'), label: 'vidfast' },
  { id: 'vidsrc-pro', match: (source) => sourceKeyText(source).includes('vidsrc-pro'), label: 'VidSrc PRO' },
  { id: 'vidsrc-in', match: (source) => sourceKeyText(source).includes('vidsrc-in'), label: 'VidSrc IN' },
  { id: 'vidsrc-net', match: (source) => sourceKeyText(source).includes('vidsrc-net'), label: 'VidSrc NET' },
  { id: 'vidsrc-xyz', match: (source) => sourceKeyText(source).includes('vidsrc-xyz'), label: 'VidSrc XYZ' },
  { id: 'superembed', match: (source) => sourceKeyText(source).includes('superembed'), label: 'SuperEmbed' },
  { id: 'autoembed', match: (source) => sourceKeyText(source).includes('autoembed'), label: 'AutoEmbed' },
  { id: 'vidbinge', match: (source) => sourceKeyText(source).includes('vidbinge'), label: 'VidBinge' },
  { id: 'multiembed', match: (source) => sourceKeyText(source).includes('multiembed'), label: 'MultiEmbed' },
  { id: '2embed', match: (source) => sourceKeyText(source).includes('2embed'), label: '2Embed' },
  { id: 'youtube', match: (source) => sourceKeyText(source).includes('youtube'), label: 'YouTube' }
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

export function buildPlayerSourceSlots(incomingSources = [], fallbackSources = [], isLoading = false) {
  const pool = [...incomingSources, ...fallbackSources].filter(Boolean);
  const used = new Set();

  return PLAYER_SOURCE_SLOTS.map((slot) => {
    const foundIndex = pool.findIndex((source, index) => {
      if (used.has(index)) return false;
      if (slot.key && (source.key === slot.key || source.id === slot.key)) return true;
      return slot.match ? slot.match(source) : false;
    });
    const found = foundIndex >= 0 ? pool[foundIndex] : null;
    if (foundIndex >= 0) used.add(foundIndex);

    const url = firstPlayableUrl(found);
    const isMissing = !url;
    // If we're loading, any slot that hasn't found a URL yet is considered 'pending' (loading)
    const isPending = Boolean(found?.pending) || (isLoading && isMissing);

    return {
      ...(found || {}),
      id: found?.id || slot.id,
      key: found?.key || slot.key || slot.id,
      label: slot.label,
      url,
      urls: found?.urls || (url ? [url] : []),
      embeddable: found?.embeddable !== false,
      pending: isPending,
      disabled: isPending || isMissing
    };
  });
}

