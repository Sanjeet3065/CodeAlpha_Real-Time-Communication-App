import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { envSchema } from './envSchema.js';

export { envSchema };

dotenv.config();

const serverRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(serverRootEnv)) {
  dotenv.config({ path: serverRootEnv });
}

export const env = envSchema.parse(process.env);
