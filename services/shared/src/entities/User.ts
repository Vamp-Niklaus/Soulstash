export interface UserProps {
  id: string;
  username: string;
  email: string;
  passwordHash?: string;
  role?: string;
  createdAt?: Date;
}

export class User {
  public readonly id: string;
  public readonly username: string;
  public email: string;
  public readonly passwordHash: string | null;
  public readonly role: string;
  public readonly createdAt: Date;

  private constructor(props: UserProps) {
    if (!props.id || !props.username || !props.email) {
      throw new Error("Invalid User properties. id, username, and email are required.");
    }

    this.id = props.id;
    this.username = props.username;
    this.email = props.email;
    this.passwordHash = props.passwordHash || null;
    this.role = props.role || 'user';
    this.createdAt = props.createdAt || new Date();
  }

  /**
   * Factory method (Creational Pattern) to create a User.
   */
  public static create(props: UserProps): User {
    return new User(props);
  }

  public isAdmin(): boolean {
    return this.role === 'admin';
  }

  public updateEmail(newEmail: string): void {
    this.email = newEmail;
  }
}
