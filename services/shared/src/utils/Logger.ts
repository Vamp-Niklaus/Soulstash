/**
 * Singleton Logger using the GoF Singleton Pattern.
 * Ensures all parts of the application use the same logging instance.
 */
export class Logger {
  private static instance: Logger;
  private startTime: bigint;

  private constructor() {
    this.startTime = process.hrtime.bigint();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatTime(): string {
    const diffMs = Number(process.hrtime.bigint() - this.startTime) / 1e6;
    const ms = Math.floor(diffMs % 1000);
    const secs = Math.floor(diffMs / 1000) % 60;
    const mins = Math.floor(diffMs / 60000) % 60;
    const hrs = Math.floor(diffMs / 3600000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(ms).padStart(3, '0')}`;
  }

  public info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${this.formatTime()} - ${message}`, ...args);
  }

  public error(message: string, error?: any): void {
    console.error(`[ERROR] ${this.formatTime()} - ${message}`, error);
  }

  public warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${this.formatTime()} - ${message}`, ...args);
  }
}

export const logger = Logger.getInstance();
