// Reads a brand's website: title, meta tags, headings, visible text and the colours used in its CSS.
// Plain HTML parsing is enough here - the goal is evidence for the brand analysis, not a full crawler.
import { isIP } from 'node:net';

const UA = 'Mozilla/5.0 (compatible; BrandStudio/0.1; +https://github.com/geloai)';
const MAX_TEXT = 12_000;

/** Only public http(s) addresses: the server must not be pointed at itself or a private network. */
export function checkUrl(input) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error('Neispravna adresa web stranice.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Podržane su samo http i https adrese.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateIp = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && privateIp.test(host)) || !host.includes('.')) {
    throw new Error('Adresa mora biti javna web stranica.');
  }
  return url.toString();
}

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out;
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Most frequent colours in HTML/CSS, as #rrggbb with how often each appears. */
export function topColors(text, limit = 12) {
  const counts = new Map();
  const add = (hex) => counts.set(hex, (counts.get(hex) ?? 0) + 1);
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    add(`#${h}`);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) {
    add(toHex(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex, count]) => ({ hex, count }));
}

/** Pulls the useful parts out of an HTML page. */
export function extractPage(html, baseUrl) {
  const metas = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.name ?? a.property ?? '').toLowerCase();
    if (key && a.content && !metas[key]) metas[key] = a.content;
  }
  const stylesheets = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (/\bstylesheet\b/i.test(a.rel ?? '') && a.href) {
      try { stylesheets.push(new URL(a.href, baseUrl).toString()); } catch { /* ignore broken links */ }
    }
  }
  const body = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => clean(m[2]))
    .filter(Boolean)
    .slice(0, 25);

  return {
    url: baseUrl,
    title: clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    description: metas.description ?? metas['og:description'] ?? '',
    siteName: metas['og:site_name'] ?? '',
    themeColor: metas['theme-color'] ?? '',
    headings,
    text: clean(body).slice(0, MAX_TEXT),
    stylesheets,
  };
}

async function get(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,text/css,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Stranica je vratila ${res.status}.`);
  return { body: await res.text(), finalUrl: res.url };
}

/** Fetches a page and up to three of its stylesheets. */
export async function fetchSite(input) {
  const url = checkUrl(input);
  const { body, finalUrl } = await get(url, 15_000);
  checkUrl(finalUrl);
  const page = extractPage(body, finalUrl);
  const css = await Promise.all(
    page.stylesheets.slice(0, 3).map((href) => get(href, 10_000).then((r) => r.body).catch(() => '')),
  );
  const inlineCss = [...body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const styleAttrs = [...body.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join('\n');
  return { ...page, colors: topColors([inlineCss, styleAttrs, ...css].join('\n')) };
}
