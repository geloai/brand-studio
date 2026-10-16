// Image generation through fal.ai, with a disk cache and a cost figure.
// - Without a product photo: FLUX [dev] text-to-image, billed per megapixel.
// - With a product photo: an image-editing model that keeps the real product from the photo
//   and builds a new scene around it, billed per image.
// Generated images are downloaded and kept locally: fal's URLs are temporary, and the reviewer
// and the dashboard both read the local copy.
import '../env.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, IMAGES_DIR } from '../paths.js';

export const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/dev';
export const FAL_EDIT_MODEL = process.env.FAL_EDIT_MODEL || 'fal-ai/nano-banana/edit';
const PRICE_PER_MP = Number(process.env.FAL_PRICE_PER_MP || 0.025); // FLUX [dev], rounded up to whole MP
const EDIT_PRICE = Number(process.env.FAL_EDIT_PRICE || 0.0398); // per image
const DIR = join(CACHE_DIR, 'fal');

export const SIZES = {
  square_hd: { width: 1024, height: 1024, aspect: '1:1' },
  portrait_4_3: { width: 768, height: 1024, aspect: '3:4' },
  landscape_4_3: { width: 1024, height: 768, aspect: '4:3' },
};

export const hasFalKey = () => Boolean(process.env.FAL_KEY);

export function imageCost(width, height) {
  return Math.ceil((width * height) / (1024 * 1024)) * PRICE_PER_MP;
}

/** Width and height from a JPEG or PNG header, so the dashboard can reserve space for the image. */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function falRun(model, input) {
  if (!hasFalKey()) throw new Error('Nema fal.ai ključa. Upiši FAL_KEY u datoteku .env.');
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`fal.ai je vratio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * @param {object} p
 * @param {string} p.prompt
 * @param {keyof SIZES} [p.size]
 * @param {number} [p.seed]  fixed seeds keep runs reproducible
 * @param {{url: string, path: string}} [p.reference]  photo of the real product to keep in the image
 * @returns {Promise<{id: string, file: string, path: string, model: string, width: number, height: number, costUsd: number, cached: boolean}>}
 */
export async function generateImage({ prompt, size = 'square_hd', seed = 7, reference = null }) {
  const format = SIZES[size] ?? SIZES.square_hd;
  const model = reference ? FAL_EDIT_MODEL : FAL_MODEL;
  const input = reference
    ? { prompt, image_urls: [reference.url], num_images: 1, aspect_ratio: format.aspect, output_format: 'jpeg', seed }
    : { prompt, image_size: size, num_images: 1, seed, enable_safety_checker: true, output_format: 'jpeg' };
  const id = createHash('sha256').update(model + JSON.stringify(input)).digest('hex').slice(0, 16);
  const meta = join(DIR, `${id}.json`);
  const path = join(IMAGES_DIR, `${id}.jpg`);
  if (existsSync(meta) && existsSync(path)) return { ...JSON.parse(readFileSync(meta, 'utf8')), path, cached: true };

  // The product photo is sent inline: many image hosts (Wikimedia included) refuse fal's downloader.
  if (reference) input.image_urls = [`data:image/jpeg;base64,${readFileSync(reference.path).toString('base64')}`];
  const out = await falRun(model, input);
  const image = out.images?.[0];
  if (!image?.url) throw new Error('fal.ai nije vratio sliku.');
  if (out.has_nsfw_concepts?.[0]) throw new Error('Sigurnosni filtar fal.ai-ja odbio je sliku.');

  const download = await fetch(image.url, { signal: AbortSignal.timeout(60_000) });
  if (!download.ok) throw new Error(`Preuzimanje slike nije uspjelo (${download.status}).`);
  const buf = Buffer.from(await download.arrayBuffer());
  mkdirSync(IMAGES_DIR, { recursive: true });
  writeFileSync(path, buf);

  const dims = imageSize(buf) ?? { width: image.width ?? format.width, height: image.height ?? format.height };
  const costUsd = reference ? EDIT_PRICE : imageCost(dims.width, dims.height);
  const result = { id, file: `/images/${id}.jpg`, model, width: dims.width, height: dims.height, seed: out.seed ?? seed, costUsd };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(meta, JSON.stringify(result, null, 2), 'utf8');
  return { ...result, path, cached: false };
}

/** Downloads a product photo once and keeps a local copy for the reviewer and the dashboard. */
export async function fetchReference(url) {
  const id = `ref-${createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
  const path = join(IMAGES_DIR, `${id}.jpg`);
  if (!existsSync(path)) {
    const res = await fetch(url, { headers: { 'User-Agent': 'BrandStudio/0.1 (+https://github.com/geloai)' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Fotografija proizvoda nije dostupna (${res.status}).`);
    mkdirSync(IMAGES_DIR, { recursive: true });
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(path);
  return { file: `/images/${id}.jpg`, path, ...(imageSize(buf) ?? {}) };
}
