import { ICommand } from './ICommand';
import { Collection, CollectionProps } from '../../../shared/src/entities/Collection';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Command Pattern: CreateCollectionCommand
 * Encapsulates the specific action of creating a collection.
 */
export class CreateCollectionCommand implements ICommand {
  private collectionProps: CollectionProps;
  private createdCollectionId: string | null = null;

  constructor(props: CollectionProps) {
    this.collectionProps = props;
  }

  public async execute(): Promise<void> {
    logger.info(`Executing CreateCollectionCommand for user ${this.collectionProps.userId}`);
    
    // LLD Mock: In reality we'd save this to the DB via a repository
    const collection = Collection.create(this.collectionProps);
    this.createdCollectionId = collection.id;
    
    logger.info(`Collection ${collection.name} created with ID ${this.createdCollectionId}`);
  }

  public async undo(): Promise<void> {
    if (this.createdCollectionId) {
      logger.warn(`Undoing CreateCollectionCommand: Deleting ${this.createdCollectionId}`);
      // LLD Mock: Remove from DB
      this.createdCollectionId = null;
    }
  }
}
