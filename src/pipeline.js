// One run: website -> brand profile -> concepts -> for each concept generate, review, and retry
// with an improved prompt while the image does not pass. Claude judges each image; this code decides
// what "passes", tracks the cost of every call and saves the whole run for the dashboard.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR } from './paths.js';
import { fetchSite } from './brand/site.js';
import { analyzeBrand, planConcepts, reviewImage, SIZE_OPTIONS } from './ai/tasks.js';
import { generateImage, fetchReference, FAL_MODEL, FAL_EDIT_MODEL } from './ai/fal.js';
import { MODEL } from './ai/claude.js';

export const PASS_AVERAGE = 7.5;
export const PASS_MINIMUM = 6;

const clampScore = (n) => Math.max(1, Math.min(10, Math.round(Number(n) || 1)));

/** The pass rule lives in code, not in the prompt, so it is the same for every image and testable. */
export function decide(review) {
  const s = review.scores;
  const values = [s.brand_fit, s.visual_quality, s.prompt_adherence].map(clampScore);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const reasons = [];
  if (review.critical_issue) reasons.push('kritična greška');
  if (average < PASS_AVERAGE) reasons.push(`prosjek ${average.toFixed(1)} < ${PASS_AVERAGE}`);
  if (Math.min(...values) < PASS_MINIMUM) reasons.push(`najniža ocjena ${Math.min(...values)} < ${PASS_MINIMUM}`);
  return { pass: reasons.length === 0, average: Math.round(average * 10) / 10, reasons };
}

export const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s);

function newCosts() {
  // liveUsd is what this run actually spent; cached calls report their original cost but are free now.
  return { claudeUsd: 0, imagesUsd: 0, claudeCalls: 0, images: 0, liveUsd: 0 };
}

function addClaude(costs, result) {
  costs.claudeUsd += result.costUsd ?? 0;
  costs.claudeCalls += 1;
  if (!result.cached) costs.liveUsd += result.costUsd ?? 0;
}

function addImage(costs, image) {
  costs.imagesUsd += image.costUsd;
  costs.images += 1;
  if (!image.cached) costs.liveUsd += image.costUsd;
}

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {number} [opts.conceptCount]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.maxUsd]  no retries once this much has been spent
 * @param {{name: string, imageUrl: string, credit?: object}} [opts.product]  photo of a real product to show
 * @param {(event: object) => void} [emit]  progress events for the live dashboard
 */
export async function runPipeline({ url, conceptCount = 3, maxAttempts = 3, maxUsd = null, product = null }, emit = () => {}) {
  const started = Date.now();
  const costs = newCosts();
  const status = (text) => emit({ type: 'status', text });

  status('Čitam web stranicu…');
  const site = await fetchSite(url);
  emit({ type: 'site', site: { url: site.url, title: site.title, colors: site.colors } });

  let reference = null;
  if (product) {
    status('Preuzimam fotografiju proizvoda…');
    reference = await fetchReference(product.imageUrl);
  }

  status('Analiziram brend…');
  const brandResult = await analyzeBrand(site);
  addClaude(costs, brandResult);
  const brand = brandResult.data;
  brand.palette = brand.palette.filter((c) => isHex(c.hex));
  emit({ type: 'brand', brand });

  status('Smišljam koncepte za slike…');
  const planResult = await planConcepts(brand, conceptCount, product);
  addClaude(costs, planResult);
  const concepts = planResult.data.concepts.slice(0, conceptCount).map((c) => ({
    ...c,
    size: SIZE_OPTIONS.includes(c.size) ? c.size : 'square_hd',
    attempts: [],
  }));
  emit({ type: 'concepts', concepts });

  const referenceBuffer = reference ? readFileSync(reference.path) : null;
  const imageRef = reference ? { url: product.imageUrl, path: reference.path } : null;

  // Concepts are independent, so they run in parallel; attempts within a concept are sequential.
  await Promise.all(concepts.map(async (concept, index) => {
    let prompt = concept.prompt;
    for (let n = 1; n <= maxAttempts; n++) {
      status(`Koncept ${index + 1}: generiram sliku${n > 1 ? ' (popravljeni prompt)' : ''}…`);
      // A new seed per attempt gives the model a fresh composition, not just a reworded prompt.
      const seed = 7 + index + 100 * (n - 1);
      let image;
      try {
        image = await generateImage({ prompt, size: concept.size, seed, reference: imageRef });
      } catch {
        // Image models occasionally reject a request: one retry with another seed, then give up on this concept only.
        try {
          image = await generateImage({ prompt, size: concept.size, seed: seed + 1, reference: imageRef });
        } catch (err) {
          concept.error = err.message.slice(0, 200);
          emit({ type: 'concept-error', index, error: concept.error });
          break;
        }
      }
      addImage(costs, image);

      status(`Koncept ${index + 1}: AI provjerava sliku…`);
      const reviewResult = await reviewImage({
        brand, concept, prompt, imageBuffer: readFileSync(image.path), product, referenceBuffer,
      });
      addClaude(costs, reviewResult);
      const review = reviewResult.data;
      review.scores = Object.fromEntries(Object.entries(review.scores).map(([k, v]) => [k, clampScore(v)]));
      const verdict = decide(review);

      const attempt = {
        n,
        prompt,
        image: { file: image.file, model: image.model, width: image.width, height: image.height, costUsd: image.costUsd },
        review,
        verdict,
      };
      concept.attempts.push(attempt);
      emit({ type: 'attempt', index, attempt });
      if (verdict.pass || n === maxAttempts) break;
      if (maxUsd != null && costs.liveUsd >= maxUsd) {
        concept.stoppedByBudget = true;
        break;
      }
      prompt = review.revised_prompt?.trim() || prompt;
    }
    const best = [...concept.attempts].sort((a, b) => b.verdict.average - a.verdict.average)[0];
    concept.best = best?.n ?? null;
  }));

  const { liveUsd, ...reported } = costs;
  const run = {
    id: `${new Date(started).toISOString().slice(0, 10)}-${slug(brand.brand_name || site.title)}`,
    createdAt: new Date(started).toISOString(),
    url: site.url,
    models: { claude: MODEL, images: product ? FAL_EDIT_MODEL : FAL_MODEL },
    rules: { passAverage: PASS_AVERAGE, passMinimum: PASS_MINIMUM, maxAttempts, maxUsd },
    product: product ? { name: product.name, source: product.imageUrl, file: reference.file, credit: product.credit ?? null } : null,
    brand,
    siteColors: site.colors,
    concepts,
    costs: { ...reported, totalUsd: costs.claudeUsd + costs.imagesUsd },
    spentThisRunUsd: liveUsd,
    durationSec: Math.round((Date.now() - started) / 1000),
  };
  saveRun(run);
  emit({ type: 'done', run });
  return run;
}

function slug(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brend';
}

export function saveRun(run) {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf8');
}

export function listRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8')))
    .sort((a, b) => a.brand.brand_name.localeCompare(b.brand.brand_name, 'hr'));
}

export function loadRun(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const file = join(RUNS_DIR, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
