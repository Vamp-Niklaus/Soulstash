import { GatewayFacade } from './GatewayFacade';

// Entry point for the API Gateway
const PORT = 3000;
const gateway = new GatewayFacade();

gateway.start(PORT);
