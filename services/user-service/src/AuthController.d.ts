import { Request, Response } from 'express';
import { UserService } from './UserService';
export declare class AuthController {
    private userService;
    constructor(userService: UserService);
    register(req: Request, res: Response): Promise<void>;
    login(req: Request, res: Response): Promise<void>;
    checkUsername(req: Request, res: Response): Promise<void>;
    me(req: Request, res: Response): Promise<void>;
    sendOtp(req: Request, res: Response): Promise<void>;
    verifyOtpAndRegister(req: Request, res: Response): Promise<void>;
    forgotPassword(req: Request, res: Response): Promise<void>;
    resetPassword(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=AuthController.d.ts.map