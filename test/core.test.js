import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isHex } from '../src/pipeline.js';
import { claudeCost } from '../src/ai/claude.js';
import { imageCost } from '../src/ai/fal.js';
import { checkUrl, extractPage, topColors } from '../src/brand/site.js';

const review = (brand_fit, visual_quality, prompt_adherence, critical_issue = false) => ({
  scores: { brand_fit, visual_quality, prompt_adherence }, critical_issue,
});

test('an image passes only with a good average, no weak score and no critical issue', () => {
  assert.equal(decide(review(8, 8, 8)).pass, true);
  assert.equal(decide(review(9, 9, 5)).pass, false, 'one score below the minimum fails');
  assert.equal(decide(review(7, 7, 7)).pass, false, 'average below 7.5 fails');
  assert.equal(decide(review(10, 10, 10, true)).pass, false, 'a critical issue always fails');
  assert.deepEqual(decide(review(7, 8, 8)), { pass: true, average: 7.7, reasons: [] });
});

test('scores outside 1-10 are clamped before deciding', () => {
  assert.equal(decide(review(15, 9, 9)).average, 9.3);
  assert.equal(decide(review(0, 9, 9)).pass, false);
});

test('Claude cost follows Opus 5.5 token prices', () => {
  const usd = claudeCost({ input_tokens: 1_000_000, output_tokens: 100_000 }, 'claude-opus-5-5');
  assert.equal(usd.toFixed(2), '6.00'); // $4 input + $2 output
  assert.equal(claudeCost(null), 0);
});

test('image cost rounds up to whole megapixels', () => {
  assert.equal(imageCost(1024, 1024), 0.025);
  assert.equal(imageCost(768, 1024), 0.025);
  assert.equal(imageCost(1536, 1024), 0.05);
});

test('only public web addresses are accepted', () => {
  assert.equal(checkUrl('primjer.hr'), 'https://primjer.hr/');
  for (const bad of ['http://localhost:3000', 'http://127.0.0.1', 'http://192.168.1.10', 'ftp://primjer.hr', 'http://intranet']) {
    assert.throws(() => checkUrl(bad), bad);
  }
});

test('page extraction finds title, meta, headings, stylesheets and text, and skips scripts', () => {
  const html = `<html><head><title>Kava &amp; Co</title>
    <meta content="Pržionica kave iz Zagreba" name="description">
    <meta name="theme-color" content="#7A3E1D">
    <link rel="stylesheet" href="/css/site.css"><script>var hidden = "ne";</script></head>
    <body><h1>Svježe pržena kava</h1><p>Dostava&nbsp;u cijeloj Hrvatskoj.</p><style>.x{color:#fff}</style></body></html>`;
  const page = extractPage(html, 'https://kava.hr/');
  assert.equal(page.title, 'Kava & Co');
  assert.equal(page.description, 'Pržionica kave iz Zagreba');
  assert.equal(page.themeColor, '#7A3E1D');
  assert.deepEqual(page.headings, ['Svježe pržena kava']);
  assert.deepEqual(page.stylesheets, ['https://kava.hr/css/site.css']);
  assert.match(page.text, /Dostava u cijeloj Hrvatskoj/);
  assert.doesNotMatch(page.text, /hidden/);
});

test('colours are normalised and ranked by frequency', () => {
  const colors = topColors('a{color:#FFF} b{color:#ffffff} c{background:rgb(122, 62, 29)} d{color:#7a3e1d} e{color:#7A3E1D}');
  assert.deepEqual(colors, [{ hex: '#7a3e1d', count: 3 }, { hex: '#ffffff', count: 2 }]);
  assert.equal(isHex('#7a3e1d'), true);
  assert.equal(isHex('7a3e1d'), false);
});

test('image size is read from PNG and JPEG headers', async () => {
  const { imageSize } = await import('../src/ai/fal.js');
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png, 0);
  png.writeUInt32BE(1184, 16);
  png.writeUInt32BE(864, 20);
  assert.deepEqual(imageSize(png), { width: 1184, height: 864 });
  // SOI, then an SOF0 segment: length 17, precision 8, height 768, width 1024
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { width: 1024, height: 768 });
});
