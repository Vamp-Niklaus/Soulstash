import { IScrapingStrategy } from './IScrapingStrategy';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Strategy Pattern: FetchStrategy
 * For simple HTML extraction without executing JavaScript. Very fast.
 */
export class FetchStrategy implements IScrapingStrategy {
  public async execute(url: string): Promise<string> {
    logger.info(`FetchStrategy: Fetching ${url}`);
    
    // LLD Mock implementation
    // const response = await fetch(url);
    // return response.text();

    return `<html><body>Simple Mock DOM for ${url}</body></html>`;
  }
}
