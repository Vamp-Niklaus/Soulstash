import { IScrapingStrategy } from '../strategies/IScrapingStrategy';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Proxy Pattern: ScraperProxy
 * Defers the expensive execution of a scraping strategy until absolutely necessary.
 * Also adds access control or logging.
 */
export class ScraperProxy implements IScrapingStrategy {
  private targetStrategy: IScrapingStrategy;
  private hasBeenExecuted: boolean = false;
  private cachedResult: string | null = null;

  constructor(targetStrategy: IScrapingStrategy) {
    this.targetStrategy = targetStrategy;
  }

  public async execute(url: string): Promise<string> {
    if (this.hasBeenExecuted && this.cachedResult) {
      logger.info(`ScraperProxy: Returning cached execution for ${url}`);
      return this.cachedResult;
    }

    logger.info(`ScraperProxy: Forwarding execution request for ${url}`);
    this.cachedResult = await this.targetStrategy.execute(url);
    this.hasBeenExecuted = true;
    
    return this.cachedResult;
  }
}
