// Runs the agent from the terminal:
//   npm run agent -- www.primjer.hr
//   npm run agent -- www.primjer.hr --budget 0.30 --product "Naziv proizvoda" --product-image <url>
//       --credit-author "Autor" --credit-license "CC0" --credit-source <url stranice s licencom>
import { parseArgs } from 'node:util';
import { runPipeline } from './pipeline.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    budget: { type: 'string' },
    product: { type: 'string' },
    'product-image': { type: 'string' },
    'credit-author': { type: 'string' },
    'credit-license': { type: 'string' },
    'credit-source': { type: 'string' },
  },
});

const url = positionals[0];
if (!url) {
  console.error('Upotreba: npm run agent -- <adresa web stranice> [--budget 0.30] [--product "Naziv" --product-image <url>]');
  process.exit(1);
}

const product = values.product && values['product-image']
  ? {
    name: values.product,
    imageUrl: values['product-image'],
    credit: values['credit-author'] ? { author: values['credit-author'], license: values['credit-license'], source: values['credit-source'] } : null,
  }
  : null;

const run = await runPipeline({ url, product, maxUsd: values.budget ? Number(values.budget) : null }, (ev) => {
  if (ev.type === 'status') console.log('·', ev.text);
  if (ev.type === 'attempt') {
    const a = ev.attempt;
    console.log(`  koncept ${ev.index + 1}, pokušaj ${a.n}: ${a.verdict.pass ? 'PROŠLO' : 'nije prošlo'} (${a.verdict.average}) ${a.verdict.reasons.join(', ')}`);
  }
});

const budgetStops = run.concepts.filter((c) => c.stoppedByBudget).length;
console.log(`\n${run.brand.brand_name}: ${run.concepts.length} koncepta, ${run.costs.images} slika, ${run.costs.totalUsd.toFixed(2)} $ (Claude ${run.costs.claudeUsd.toFixed(2)} $, slike ${run.costs.imagesUsd.toFixed(2)} $), ${run.durationSec} s`);
console.log(`Stvarno potrošeno u ovom pokretanju: ${run.spentThisRunUsd.toFixed(2)} $${budgetStops ? `; ${budgetStops} ponovnih pokušaja preskočeno zbog limita` : ''}`);
console.log(`Spremljeno: data/runs/${run.id}.json`);
