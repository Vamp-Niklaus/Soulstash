import { GatewayFacade } from './GatewayFacade';

const PORT = Number(process.env.PORT) || 3000;

const gateway = new GatewayFacade();
gateway.start(PORT);