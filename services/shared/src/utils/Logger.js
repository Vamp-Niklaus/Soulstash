"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
/**
 * Singleton Logger using the GoF Singleton Pattern.
 * Ensures all parts of the application use the same logging instance.
 */
class Logger {
    constructor() {
        this.startTime = process.hrtime.bigint();
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    formatTime() {
        const diffMs = Number(process.hrtime.bigint() - this.startTime) / 1e6;
        const ms = Math.floor(diffMs % 1000);
        const secs = Math.floor(diffMs / 1000) % 60;
        const mins = Math.floor(diffMs / 60000) % 60;
        const hrs = Math.floor(diffMs / 3600000);
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(ms).padStart(3, '0')}`;
    }
    getCallerLocation() {
        const err = new Error();
        const stackLines = err.stack?.split('\n') || [];
        // stackLines[0] is Error
        // stackLines[1] is getCallerLocation
        // stackLines[2] is info/error/warn
        // stackLines[3] is the caller function
        const targetLine = stackLines[3];
        if (!targetLine)
            return 'unknown:0';
        // Try extracting function name, file name, and line number
        const matchWithFn = targetLine.match(/at\s+([^\s]+)\s+\((.*):(\d+):(\d+)\)/);
        if (matchWithFn) {
            const fnName = matchWithFn[1] || 'unknown';
            const filePath = (matchWithFn[2] || '').split(/[\\/]/).pop() || '';
            return `${filePath}:${matchWithFn[3] || '0'} ${fnName}()`;
        }
        // Try extracting just file name and line number if anonymous
        const matchWithoutFn = targetLine.match(/at\s+(.*):(\d+):(\d+)/);
        if (matchWithoutFn) {
            const filePath = (matchWithoutFn[1] || '').split(/[\\/]/).pop() || '';
            return `${filePath}:${matchWithoutFn[2] || '0'}`;
        }
        return 'unknown:0';
    }
    info(message, ...args) {
        const location = this.getCallerLocation();
        console.log(`[INFO] ${this.formatTime()} [${location}] - ${message}`, ...args);
    }
    error(message, error) {
        const location = this.getCallerLocation();
        if (error !== undefined) {
            console.error(`[ERROR] ${this.formatTime()} [${location}] - ${message}`, error);
        }
        else {
            console.error(`[ERROR] ${this.formatTime()} [${location}] - ${message}`);
        }
    }
    warn(message, ...args) {
        const location = this.getCallerLocation();
        console.warn(`[WARN] ${this.formatTime()} [${location}] - ${message}`, ...args);
    }
}
exports.Logger = Logger;
exports.logger = Logger.getInstance();
//# sourceMappingURL=Logger.js.map