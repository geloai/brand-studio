import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');
export const RUNS_DIR = join(DATA, 'runs');
export const IMAGES_DIR = join(DATA, 'images');
export const CACHE_DIR = join(DATA, 'cache');
