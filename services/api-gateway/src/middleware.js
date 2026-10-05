"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMiddleware = exports.RateLimitMiddleware = exports.BaseMiddleware = void 0;
const Logger_1 = require("../../shared/src/utils/Logger");
/**
 * Chain of Responsibility Pattern: Middleware Chain
 * Abstract base class for middleware handlers.
 */
class BaseMiddleware {
    constructor() {
        this.nextHandler = null;
    }
    setNext(handler) {
        this.nextHandler = handler;
        return handler;
    }
    async execute(req, res, next) {
        if (this.nextHandler) {
            await this.nextHandler.handle(req, res, next);
        }
        else {
            next();
        }
    }
}
exports.BaseMiddleware = BaseMiddleware;
/**
 * Concrete Handler: Rate Limiting
 */
class RateLimitMiddleware extends BaseMiddleware {
    async handle(req, res, next) {
        Logger_1.logger.info(`RateLimitMiddleware: Checking IP ${req.ip}`);
        // Basic LLD implementation logic for rate limiting
        const isRateLimited = false;
        if (isRateLimited) {
            res.status(429).json({ error: 'Too many requests' });
            return;
        }
        await super.execute(req, res, next);
    }
}
exports.RateLimitMiddleware = RateLimitMiddleware;
/**
 * Concrete Handler: Authentication Validation
 */
class AuthMiddleware extends BaseMiddleware {
    async handle(req, res, next) {
        const authHeader = req.headers.authorization;
        Logger_1.logger.info(`AuthMiddleware: Validating token`);
        if (!authHeader) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        // LLD: JWT validation logic would go here
        // req.user = decodedToken;
        await super.execute(req, res, next);
    }
}
exports.AuthMiddleware = AuthMiddleware;
//# sourceMappingURL=middleware.js.map