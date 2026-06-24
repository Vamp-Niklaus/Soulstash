import { IScrapingStrategy } from '../strategies/IScrapingStrategy';
import { FetchStrategy } from '../strategies/FetchStrategy';
import { PlaywrightStrategy } from '../strategies/PlaywrightStrategy';

export enum ScraperType {
  SIMPLE_FETCH = 'SIMPLE_FETCH',
  PLAYWRIGHT_HEAVY = 'PLAYWRIGHT_HEAVY'
}

/**
 * Factory Method Pattern: ScraperFactory
 * Centralizes the creation logic of scraper strategies.
 */
export class ScraperFactory {
  public static create(type: ScraperType): IScrapingStrategy {
    switch (type) {
      case ScraperType.SIMPLE_FETCH:
        return new FetchStrategy();
      case ScraperType.PLAYWRIGHT_HEAVY:
        return new PlaywrightStrategy();
      default:
        throw new Error(`Unknown ScraperType: ${type}`);
    }
  }
}
