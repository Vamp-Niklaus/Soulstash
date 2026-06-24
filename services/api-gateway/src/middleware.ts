import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/src/utils/Logger';

/**
 * Chain of Responsibility Pattern: Middleware Chain
 * Abstract base class for middleware handlers.
 */
export abstract class BaseMiddleware {
  private nextHandler: BaseMiddleware | null = null;

  public setNext(handler: BaseMiddleware): BaseMiddleware {
    this.nextHandler = handler;
    return handler;
  }

  public async execute(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (this.nextHandler) {
      await this.nextHandler.handle(req, res, next);
    } else {
      next();
    }
  }

  public abstract handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}

/**
 * Concrete Handler: Rate Limiting
 */
export class RateLimitMiddleware extends BaseMiddleware {
  public async handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    logger.info(`RateLimitMiddleware: Checking IP ${req.ip}`);
    // Basic LLD implementation logic for rate limiting
    const isRateLimited = false; 
    
    if (isRateLimited) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    await super.execute(req, res, next);
  }
}

/**
 * Concrete Handler: Authentication Validation
 */
export class AuthMiddleware extends BaseMiddleware {
  public async handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    
    logger.info(`AuthMiddleware: Validating token`);
    
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // LLD: JWT validation logic would go here
    // req.user = decodedToken;

    await super.execute(req, res, next);
  }
}
