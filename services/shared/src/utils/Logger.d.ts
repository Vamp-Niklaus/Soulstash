/**
 * Singleton Logger using the GoF Singleton Pattern.
 * Ensures all parts of the application use the same logging instance.
 */
export declare class Logger {
    private static instance;
    private startTime;
    private constructor();
    static getInstance(): Logger;
    private formatTime;
    private getCallerLocation;
    info(message: string, ...args: any[]): void;
    error(message: string, error?: any): void;
    warn(message: string, ...args: any[]): void;
}
export declare const logger: Logger;
//# sourceMappingURL=Logger.d.ts.map