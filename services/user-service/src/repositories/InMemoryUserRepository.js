"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryUserRepository = void 0;
const Logger_1 = require("../../../shared/src/utils/Logger");
/**
 * LLD Mock: InMemoryUserRepository
 * Temporarily stores users in memory so the service can boot and function
 * without a connected database cluster.
 */
class InMemoryUserRepository {
    constructor() {
        this.users = new Map();
        this.usernames = new Map();
    }
    async save(user) {
        Logger_1.logger.info(`InMemoryUserRepository: Saving user ${user.username}`);
        this.users.set(user.id, user);
        this.usernames.set(user.username, user.id);
        return user;
    }
    async findById(id) {
        return this.users.get(id) || null;
    }
    async findByUsername(username) {
        const id = this.usernames.get(username);
        if (!id)
            return null;
        return this.users.get(id) || null;
    }
}
exports.InMemoryUserRepository = InMemoryUserRepository;
//# sourceMappingURL=InMemoryUserRepository.js.map