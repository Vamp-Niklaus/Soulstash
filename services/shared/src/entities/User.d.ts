export interface UserProps {
    id: string;
    username: string;
    email: string;
    passwordHash?: string;
    role?: string;
    createdAt?: Date;
}
export declare class User {
    readonly id: string;
    readonly username: string;
    email: string;
    readonly passwordHash: string | null;
    readonly role: string;
    readonly createdAt: Date;
    private constructor();
    /**
     * Factory method (Creational Pattern) to create a User.
     */
    static create(props: UserProps): User;
    isAdmin(): boolean;
    updateEmail(newEmail: string): void;
}
//# sourceMappingURL=User.d.ts.map