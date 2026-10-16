// Loads .env from the project folder, whatever directory the app is started from.
import dotenv from 'dotenv';
import { join } from 'node:path';
import { ROOT } from './paths.js';

dotenv.config({ path: join(ROOT, '.env'), quiet: true });
