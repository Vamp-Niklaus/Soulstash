import { ICommand } from './ICommand';

/**
 * Command Pattern: CommandInvoker
 * Asks the command to carry out the request.
 * Can be used for queueing or logging commands.
 */
export class CommandInvoker {
  private history: ICommand[] = [];

  public async executeCommand(command: ICommand): Promise<void> {
    await command.execute();
    this.history.push(command);
  }

  public async undoLastCommand(): Promise<void> {
    const command = this.history.pop();
    if (command && command.undo) {
      await command.undo();
    }
  }
}
