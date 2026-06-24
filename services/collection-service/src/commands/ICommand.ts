/**
 * Command Pattern: ICommand interface
 * Encapsulates a request as an object.
 */
export interface ICommand {
  execute(): Promise<void>;
  undo?(): Promise<void>;
}
