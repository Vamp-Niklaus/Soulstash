"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const GatewayFacade_1 = require("./GatewayFacade");
const PORT = Number(process.env.PORT) || 3000;
const gateway = new GatewayFacade_1.GatewayFacade();
gateway.start(PORT);
//# sourceMappingURL=index.js.map