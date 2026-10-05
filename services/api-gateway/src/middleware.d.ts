import { Request, Response, NextFunction } from 'express';
/**
 * Chain of Responsibility Pattern: Middleware Chain
 * Abstract base class for middleware handlers.
 */
export declare abstract class BaseMiddleware {
    private nextHandler;
    setNext(handler: BaseMiddleware): BaseMiddleware;
    execute(req: Request, res: Response, next: NextFunction): Promise<void>;
    abstract handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}
/**
 * Concrete Handler: Rate Limiting
 */
export declare class RateLimitMiddleware extends BaseMiddleware {
    handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}
/**
 * Concrete Handler: Authentication Validation
 */
export declare class AuthMiddleware extends BaseMiddleware {
    handle(req: Request, res: Response, next: NextFunction): Promise<void>;
}
//# sourceMappingURL=middleware.d.ts.map