import { IUserRepository } from '../../shared/src/interfaces/IUserRepository';
import { User } from '../../shared/src/entities/User';
export declare class UserService {
    private userRepository;
    constructor(userRepository: IUserRepository);
    registerUser(userData: Partial<User>): Promise<User>;
    login(username: string, passwordHash: string): Promise<string>;
    getUser(id: string): Promise<User | null>;
}
//# sourceMappingURL=UserService.d.ts.map