// Thin wrapper around the Claude API: one structured-output call, a disk cache and a cost figure.
//
// - Structured outputs (output_config.format = JSON schema) so every answer is machine-checkable.
// - Server-side refusal fallback ("default" mode) so a classifier false positive doesn't break a run.
// - Responses are cached by request hash, so re-running the same brand costs nothing.
// - Every call reports what it cost, computed from the token usage the API returns.
import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from '../paths.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const DIR = join(CACHE_DIR, 'claude');

// USD per million tokens. Cache writes are 1.25x input, cache reads 0.1x (5-minute TTL).
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

export function claudeCost(usage, model = MODEL) {
  if (!usage) return 0;
  const p = PRICES[model] ?? PRICES[MODEL] ?? PRICES['claude-opus-5-5'];
  const usd = (usage.input_tokens ?? 0) * p.input
    + (usage.output_tokens ?? 0) * p.output
    + (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite
    + (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return usd / 1e6;
}

export const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
function getClient() {
  if (!hasClaudeKey()) throw new Error('Nema Claude API ključa. Upiši ANTHROPIC_API_KEY u datoteku .env.');
  client ??= new Anthropic();
  return client;
}

/**
 * @param {object} p
 * @param {string} p.task      short name, used for cache file names
 * @param {string} p.system    system prompt
 * @param {Array}  p.content   user message content blocks
 * @param {object} p.schema    JSON schema of the expected answer
 * @param {'low'|'medium'|'high'|'xhigh'|'max'} [p.effort]
 * @returns {Promise<{data: any, model: string, usage: object, costUsd: number, cached: boolean}>}
 */
export async function askJson({ task, system, content, schema, effort = 'medium' }) {
  const request = {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  };

  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
  const cacheFile = join(DIR, `${task}-${hash}.json`);
  if (existsSync(cacheFile)) return { ...JSON.parse(readFileSync(cacheFile, 'utf8')), cached: true };

  const response = await getClient().beta.messages.create(request);
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model je odbio zahtjev (${response.stop_details?.category ?? 'nepoznato'}).`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Odgovor je prekinut (max_tokens).');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Model nije vratio tekstualni odgovor.');

  const result = {
    data: JSON.parse(text),
    model: response.model,
    usage: response.usage,
    costUsd: claudeCost(response.usage, response.model),
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf8');
  return { ...result, cached: false };
}

export const imageBlock = (buffer, mediaType = 'image/jpeg') => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
});
