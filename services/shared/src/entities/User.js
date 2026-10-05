"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
class User {
    constructor(props) {
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
    static create(props) {
        return new User(props);
    }
    isAdmin() {
        return this.role === 'admin';
    }
    updateEmail(newEmail) {
        this.email = newEmail;
    }
}
exports.User = User;
//# sourceMappingURL=User.js.map