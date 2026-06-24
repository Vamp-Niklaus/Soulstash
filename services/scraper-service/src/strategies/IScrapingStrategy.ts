export interface IScrapingStrategy {
  /**
   * Executes the scraping logic to return an HTML string or extracted URLs.
   * @param url The URL to scrape
   */
  execute(url: string): Promise<string>;
}
