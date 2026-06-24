export interface CollectionProps {
  id: string;
  userId: string;
  name: string;
  isPublic?: boolean;
  mediaIds?: string[];
}

export class Collection {
  public readonly id: string;
  public readonly userId: string;
  public name: string;
  public isPublic: boolean;
  public mediaIds: string[];

  private constructor(props: CollectionProps) {
    if (!props.id || !props.userId || !props.name) {
      throw new Error("Invalid Collection properties. id, userId, and name are required.");
    }

    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name;
    this.isPublic = props.isPublic || false;
    this.mediaIds = props.mediaIds || [];
  }

  public static create(props: CollectionProps): Collection {
    return new Collection(props);
  }

  public addMedia(mediaId: string): void {
    if (!this.mediaIds.includes(mediaId)) {
      this.mediaIds.push(mediaId);
    }
  }

  public removeMedia(mediaId: string): void {
    this.mediaIds = this.mediaIds.filter(id => id !== mediaId);
  }
}
