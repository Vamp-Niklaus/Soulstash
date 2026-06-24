export interface IVideoSource {
  url: string;
  quality: string;
  isM3u8: boolean;
  provider: string;
}

export interface IVideoScraper {
  /**
   * Returns the unique name of this provider.
   */
  getProviderName(): string;

  /**
   * Scrapes and resolves the streaming URL for a given media.
   * @param tmdbId 
   * @param imdbId 
   * @param mediaType 'movie' or 'tv'
   * @param season 
   * @param episode 
   */
  extractSources(
    tmdbId: string, 
    imdbId: string, 
    mediaType: string, 
    season?: number, 
    episode?: number
  ): Promise<IVideoSource[]>;
}
