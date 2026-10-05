"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const pingTemplate_1 = require("../../shared/src/utils/pingTemplate");
const CollectionController_1 = require("./CollectionController");
const MongoCollectionRepository_1 = require("./repositories/MongoCollectionRepository");
const Logger_1 = require("../../shared/src/utils/Logger");
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '10mb' }));
// Bootstrapping dependencies
const collectionRepository = new MongoCollectionRepository_1.MongoCollectionRepository();
const collectionController = new CollectionController_1.CollectionController(collectionRepository);
app.get('/published', collectionController.getPublishedCollections.bind(collectionController));
app.get('/ping', (req, res) => {
    res.send((0, pingTemplate_1.generatePingHtml)({
        serviceName: 'Collection Service',
        role: 'Handles public-facing published collections.',
        parents: ['API Gateway'],
        children: ['MongoDB'],
        endpoints: ['/published']
    }));
});
app.listen(PORT, '0.0.0.0', () => {
    Logger_1.logger.info(`Collection Service listening on port ${PORT}`);
});
//# sourceMappingURL=index.js.map