import express from 'express';
import { logger } from '../../shared/src/utils/Logger';
const app = express();
app.listen(3000, () => logger.info('listening'));
