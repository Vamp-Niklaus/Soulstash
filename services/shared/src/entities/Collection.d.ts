export interface CollectionProps {
    id: string;
    userId: string;
    name: string;
    isPublic?: boolean;
    mediaIds?: string[];
}
export declare class Collection {
    readonly id: string;
    readonly userId: string;
    name: string;
    isPublic: boolean;
    mediaIds: string[];
    private constructor();
    static create(props: CollectionProps): Collection;
    addMedia(mediaId: string): void;
    removeMedia(mediaId: string): void;
}
//# sourceMappingURL=Collection.d.ts.map