/**
 * Singleton ConfigManager using the GoF Singleton Pattern.
 * Centralized configuration handling.
 */
export declare class ConfigManager {
    private static instance;
    private config;
    private constructor();
    static getInstance(): ConfigManager;
    get(key: string): string | undefined;
}
export declare const config: ConfigManager;
//# sourceMappingURL=ConfigManager.d.ts.map