export interface PingConfig {
    serviceName: string;
    role: string;
    parents: string[];
    children: string[];
    endpoints: string[];
}
export declare function generatePingHtml(config: PingConfig): string;
//# sourceMappingURL=pingTemplate.d.ts.map