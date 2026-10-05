import { Request, Response } from 'express';
export declare class AdminController {
    private userRepository;
    constructor(userRepository: any);
    private checkAdmin;
    getMe(req: Request, res: Response): Promise<void>;
    getUsers(req: Request, res: Response): Promise<void>;
    getUserProfile(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updatePreferences(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateMultimovies(req: Request, res: Response): Promise<void>;
    postTrafficLogs(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getTrafficStats(req: Request, res: Response): Promise<void>;
    updateAvatar(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
//# sourceMappingURL=AdminController.d.ts.map