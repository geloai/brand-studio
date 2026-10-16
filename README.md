# Brand Studio: on-brand images with automated AI quality review

An AI agent that turns a brand's website into on-brand marketing images and checks every image before a person sees it.

1. **Reads the website**: title, meta tags, headings, visible text and the colours used in its CSS.
2. **Builds a brand profile with Claude**: audience, tone, values, visual style, palette, what images should and should not show, and the evidence on the site it relied on.
3. **Plans image concepts** for different channels (Instagram post, website hero, ad), written as prompts an image model can reliably execute.
4. **Generates the images** with FLUX through fal.ai. When the brand has a real product to show, a photo of it is passed to an image-editing model (Nano Banana) as a template: the product stays exactly as it is, and only the scene, framing and light change.
5. **Reviews each image with Claude's vision**: scores for brand fit, visual quality and concept, critical issues (deformed hands, garbled text, foreign logos, a product that differs from its photo), strengths and problems.
6. **Retries what fails**: an improved prompt and a new seed, up to three attempts. An image that still fails is flagged for human review instead of being passed off as good.

The interface is in Croatian. A **10-step guided tour** (`#/obilazak`) walks through real runs: brand profile, concepts, AI review, the pass rule, a retry that fixed an image, and the real product check.

> The examples run the agent on public websites of well-known Croatian brands. This is an independent demo, not affiliated with or commissioned by those brands. Generated images contain no invented logos or packaging; the Rimac run shows the real car from a public-domain photo (see Credits).

## Results on three brands

| Brand | Industry | Concepts | Passed first try | Passed after retry | Flagged for review | Images | Cost |
|---|---|---|---|---|---|---|---|
| Kraš | confectionery | 3 | 2 | 1 | 0 | 4 | $0.31 |
| Rimac Automobili (with product photo) | hypercars | 3 | 2 | 1 | 0 | 4 | $0.39 |
| Valamar | tourism | 3 | 3 | 0 | 0 | 3 | $0.25 |

**9 of 9 concepts passed review**, 2 of them after an automatic retry. About **$0.30 and about a minute per brand**, from a URL to reviewed images. Claude's share is ~65 % of the cost; images cost $0.025 (FLUX) or $0.04 (with a product photo) each.

## Design: Claude judges, code decides

- **Every Claude answer is a JSON schema** (structured outputs), so the brand profile, the concepts and each review are machine-checkable.
- **The pass rule lives in code, not in the prompt**: an image passes only if its average score is at least 7.5, no score is below 6 and there is no critical issue. Same rule for every image, covered by tests.
- **Cost is tracked per call** from the token usage Claude returns and fal's prices, and shown for every run. A spending limit (`--budget`) stops new retries once a run has spent that much.
- **Disk cache** for Claude responses and generated images: re-running a brand costs nothing, and the public demo needs no API keys.

## What I learned while calibrating it

On its first run the agent passed **0 of 3** concepts. The images were actually good, so I fixed the system around the model, not the threshold:

- **Concepts were too detailed.** Cross-sections with exact layers, hands holding things, named products: image models miss these. Concept prompts now ask for one clear subject and 3–4 key elements.
- **The reviewer punished details no viewer would notice**, and generic products that are intentional (no packaging or logos). It now judges whether the image is usable as a marketing visual.
- **Retries rephrased the same shot.** When the model can't draw a material (carbon fibre up close, a chocolate break), different words don't help. The retry now changes the framing or subject and uses a new seed. After that change, retries started fixing images (Kraš: 6.3 → 7.7).
- **An image model can't draw a specific product.** Asked for a "Rimac Nevera", FLUX draws an invented sports car. With the real car's photo as a template, the product is right; the reviewer compares every image with the photo. In one run the model invented the rear of the car (the photo only shows the front) and wrote garbled letters: the reviewer flagged it as critical and the retry showed the real car.

## Run it locally

Requires Node.js 24.

```bash
npm install
npm start        # dashboard at http://localhost:3001
```

Without API keys the dashboard shows the saved example runs. To run the agent on any website, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY` and `FAL_KEY`, then use the dashboard or:

```bash
npm run agent -- www.example.com
npm run agent -- www.example.com --budget 0.30 --product "Product name" --product-image <photo URL>
npm test         # pass rule, cost maths, URL safety, HTML and colour extraction
```

## Project structure

```
src/brand/site.js     reads a website: meta, headings, text, CSS colours; blocks private addresses
src/ai/claude.js      Claude client: structured outputs, refusal fallback, cache, cost per call
src/ai/fal.js         images through fal.ai: FLUX, or an edit model with a product photo; local copies, cost
src/ai/tasks.js       the three Claude tasks: brand profile, concepts, image review
src/pipeline.js       the run: concepts in parallel, generate → review → retry, pass rule
src/server.js         Express API with a live progress stream
src/web/public/       dashboard (vanilla JS, no build step)
test/                 unit tests
```

## Next steps

- LoRA fine-tuning on a brand's own photos, for full freedom of angle (a template photo limits the views the model can show truthfully).
- Video: the same profile → concept → review loop for short clips.
- A reviewer eval set: images rated by a designer, to measure how often the AI reviewer agrees.

## Credits

Rimac Nevera reference photo: ["2023 Rimac Nevera 1"](https://commons.wikimedia.org/wiki/File:2023_Rimac_Nevera_1.jpg) by Calreyn88, Wikimedia Commons, CC0 (public domain).

Built with Node.js, the Anthropic Claude API, FLUX and Nano Banana on fal.ai.
