"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionController = void 0;
const Logger_1 = require("../../shared/src/utils/Logger");
class CollectionController {
    constructor(repository) {
        this.repository = repository;
    }
    async getPublishedCollections(req, res) {
        try {
            Logger_1.logger.info('[CollectionController] Fetching published collections');
            const payload = await this.repository.getPublishedCollections();
            res.json({ collections: payload });
        }
        catch (error) {
            Logger_1.logger.error(`[CollectionController] Published collections fetch error: ${error.message}`);
            res.status(500).json({ error: 'Failed to fetch published collections' });
        }
    }
}
exports.CollectionController = CollectionController;
//# sourceMappingURL=CollectionController.js.map