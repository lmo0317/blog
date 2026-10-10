import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The installed app lives in a read-only folder, so main.js points NEIGHBORMATE_DATA_DIR at the
// user's AppData. During development everything stays next to the source as before.
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = process.env.NEIGHBORMATE_DATA_DIR || APP_ROOT;
export const INSTALLED = Boolean(process.env.NEIGHBORMATE_DATA_DIR);

export const dataPath = (...parts) => path.join(DATA_ROOT, '.data', ...parts);
export const playwrightPath = (...parts) => path.join(DATA_ROOT, '.playwright', ...parts);
export const imagesDir = path.join(DATA_ROOT, '.images');
// Models (GBs) and the llama runtime are downloaded on first use; dev reuses the shared windows/ copies.
export const modelsDir = INSTALLED ? path.join(DATA_ROOT, 'models') : path.join(APP_ROOT, '..', '..', 'windows', '.models');
export const llamaBinDir = INSTALLED ? path.join(DATA_ROOT, 'bin') : path.join(APP_ROOT, '..', '..', 'windows', 'bin');
