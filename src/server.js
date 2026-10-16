import './env.js';
import express from 'express';
import { join } from 'node:path';
import { ROOT, IMAGES_DIR } from './paths.js';
import { runPipeline, listRuns, loadRun } from './pipeline.js';
import { hasClaudeKey } from './ai/claude.js';
import { hasFalKey } from './ai/fal.js';

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(join(ROOT, 'src', 'web', 'public')));

const live = () => hasClaudeKey() && hasFalKey();
let running = false;

app.get('/api/status', (_req, res) => res.json({ live: live() }));

app.get('/api/runs', (_req, res) => {
  res.json(listRuns().map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    url: r.url,
    brand: r.brand.brand_name,
    palette: r.brand.palette.map((c) => c.hex),
    cover: r.concepts.flatMap((c) => c.attempts).sort((a, b) => b.verdict.average - a.verdict.average)[0]?.image.file,
    totalUsd: r.costs.totalUsd,
  })));
});

app.get('/api/runs/:id', (req, res) => {
  const run = loadRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Pokretanje nije pronađeno.' });
  res.json(run);
});

// Streams progress as newline-delimited JSON so the dashboard can show each step as it happens.
app.post('/api/runs', async (req, res) => {
  if (!live()) {
    return res.status(403).json({ error: 'Ovo je demo verzija, pa prikazuje spremljene primjere. U punoj verziji upišete bilo koju web stranicu.' });
  }
  if (running) return res.status(429).json({ error: 'Jedno pokretanje je već u tijeku. Pričekajte da završi.' });
  const url = String(req.body?.url ?? '').trim();
  if (!url) return res.status(400).json({ error: 'Upišite adresu web stranice.' });

  running = true;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (event) => res.write(JSON.stringify(event) + '\n');
  try {
    await runPipeline({ url }, send);
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally {
    running = false;
    res.end();
  }
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Brand Studio: http://localhost:${port}${live() ? '' : ' (demo: nema API ključeva)'}`));
