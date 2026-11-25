import dotenv from 'dotenv';
import { envSchema } from './envSchema.js';

export { envSchema };

dotenv.config();

export const env = envSchema.parse(process.env);
