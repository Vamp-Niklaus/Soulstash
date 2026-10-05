"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Collection = void 0;
class Collection {
    constructor(props) {
        if (!props.id || !props.userId || !props.name) {
            throw new Error("Invalid Collection properties. id, userId, and name are required.");
        }
        this.id = props.id;
        this.userId = props.userId;
        this.name = props.name;
        this.isPublic = props.isPublic || false;
        this.mediaIds = props.mediaIds || [];
    }
    static create(props) {
        return new Collection(props);
    }
    addMedia(mediaId) {
        if (!this.mediaIds.includes(mediaId)) {
            this.mediaIds.push(mediaId);
        }
    }
    removeMedia(mediaId) {
        this.mediaIds = this.mediaIds.filter(id => id !== mediaId);
    }
}
exports.Collection = Collection;
//# sourceMappingURL=Collection.js.map