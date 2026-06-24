export interface IMetadataProvider {
  /**
   * Fetches media details by ID.
   * @param id The unique identifier for the media.
   * @param mediaType 'movie' or 'tv'
   */
  getDetails(id: string, mediaType: string): Promise<any>;

  /**
   * Searches for media.
   * @param query The search query string.
   * @param page The page number for pagination.
   */
  search(query: string, page?: number): Promise<any>;
}
