export interface ICacheRecord {
    _id: string;
    data: any;
    updatedAt: Date;
}
export declare class ContentCacheRepository {
    private collectionName;
    private get collection();
    getCache(key: string): Promise<ICacheRecord | null>;
    setCache(key: string, data: any): Promise<void>;
}
//# sourceMappingURL=ContentCacheRepository.d.ts.map