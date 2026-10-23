import { useEffect } from 'react';

/** Shared, presentation-only artwork tint with a readable dark fallback. */
export function useArtworkAtmosphere(artworkUrl, sampleUrl = artworkUrl) {
  useEffect(() => {
    if (!artworkUrl) return undefined;
    const body = document.body;
    body.style.setProperty('--detail-artwork-image', `url(${JSON.stringify(artworkUrl)})`);
    body.classList.add('detail-artwork-theme');
    let cancelled = false;
    const artwork = new Image();
    artwork.onload = () => {
      if (cancelled || !artwork.naturalHeight) return;
      body.style.setProperty('--detail-artwork-ratio', String(artwork.naturalWidth / artwork.naturalHeight));
    };
    artwork.src = artworkUrl;
    const sample = new Image();
    sample.crossOrigin = 'anonymous';
    sample.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 36;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(sample, 0, 0, 24, 36);
        const pixels = context.getImageData(0, 0, 24, 36).data;
        const channels = [0, 0, 0];
        let total = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const weight = (pixels[i + 3] / 255) * (1 + (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2])) / 32);
          channels.forEach((_, channel) => { channels[channel] += pixels[i + channel] * weight; });
          total += weight;
        }
        if (!total) return;
        const average = channels.map(value => value / total);
        const scale = Math.min(110 / Math.max(...average, 1), 1.6);
        body.style.setProperty('--detail-tint', average.map(value => Math.round(Math.min(value * scale, 130))).join(' '));
      } catch { /* Cross-origin artwork retains the dark fallback and visible image. */ }
    };
    sample.src = sampleUrl;
    return () => {
      cancelled = true;
      body.classList.remove('detail-artwork-theme');
      ['--detail-artwork-image', '--detail-artwork-ratio', '--detail-tint'].forEach(property => body.style.removeProperty(property));
    };
  }, [artworkUrl, sampleUrl]);
}