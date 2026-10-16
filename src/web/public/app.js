import { startTour } from './tour.js';

const app = document.getElementById('app');
const state = { live: false, runs: [], run: null, running: false, log: [], error: '' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => `${(n ?? 0).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const list = (items, cls = '') => (items?.length ? `<ul class="points ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');

const SCORE_LABELS = { brand_fit: 'Brend', visual_quality: 'Kvaliteta', prompt_adherence: 'Koncept' };

async function init() {
  const [status, runs] = await Promise.all([
    fetch('/api/status').then((r) => r.json()),
    fetch('/api/runs').then((r) => r.json()),
  ]);
  state.live = status.live;
  state.runs = runs;
  document.getElementById('mode-note').textContent = state.live ? 'Puna verzija' : 'Demo verzija';
  document.getElementById('tour-btn').addEventListener('click', () => { location.hash = '#/obilazak'; });
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  if (location.hash === '#/obilazak') {
    if (!state.run && state.runs[0]) state.run = await fetch(`/api/runs/${state.runs[0].id}`).then((r) => r.json());
    render();
    startTour();
    return;
  }
  const id = location.hash.match(/^#\/run\/([\w-]+)/)?.[1] ?? state.runs[0]?.id;
  if (id && state.run?.id !== id && !state.running) {
    state.run = await fetch(`/api/runs/${id}`).then((r) => (r.ok ? r.json() : null));
  }
  render();
}

function render() {
  app.innerHTML = `
    ${heroHtml()}
    ${state.runs.length ? examplesHtml() : ''}
    ${state.run ? runHtml(state.run) : ''}
  `;
  bind();
}

function heroHtml() {
  const disabled = !state.live || state.running;
  return `
    <section class="card hero">
      <p class="eyebrow">AI agent za vizuale brenda</p>
      <h1>Od web stranice do slika u stilu brenda</h1>
      <p class="lede">Agent pročita web stranicu brenda i izvede njegov identitet: publiku, ton i boje. Zatim smisli koncepte, generira slike i svaku sliku provjeri. Slike koje ne prođu provjeru sam popravi i generira ponovno.</p>
      <ol class="steps">
        <li><b>1</b>Web stranica</li><li><b>2</b>Brand profil</li><li><b>3</b>Koncepti</li><li><b>4</b>Generiranje slika</li><li><b>5</b>AI provjera i popravak</li>
      </ol>
      <form class="run-form" id="run-form">
        <input id="url" type="text" inputmode="url" placeholder="npr. www.primjer.hr" ${disabled ? 'disabled' : ''} autocomplete="off">
        <button class="btn btn-primary" ${disabled ? 'disabled' : ''}>${state.running ? '<span class="spinner"></span>Radim…' : 'Pokreni agenta'}</button>
      </form>
      ${state.live ? '' : '<p class="form-note">Ovo je demo verzija, pa prikazuje spremljene primjere ispod. U punoj verziji upišete adresu bilo kojeg brenda.</p>'}
      ${state.error ? `<p class="form-error">${esc(state.error)}</p>` : ''}
      ${state.running || state.log.length ? `<div class="card log"><ol>${state.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></div>` : ''}
    </section>`;
}

function examplesHtml() {
  return `
    <section class="section">
      <div class="section-head"><h2>Primjeri</h2><span class="muted small">Svaki primjer je stvarno pokretanje agenta na javnoj web stranici, s rezultatima i troškom. Neovisan demo, nije povezan s brendovima.</span></div>
      <div class="examples">
        ${state.runs.map((r) => `
          <a class="card example ${state.run?.id === r.id ? 'active' : ''}" href="#/run/${esc(r.id)}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : ''}
            <div class="meta">
              <span class="name">${esc(r.brand)}</span>
              <span class="dots">${r.palette.slice(0, 5).map((h) => `<span class="dot" style="background:${esc(h)}"></span>`).join('')}</span>
            </div>
          </a>`).join('')}
      </div>
    </section>`;
}

function runHtml(run) {
  const done = Boolean(run.costs);
  const attempts = run.concepts?.flatMap((c) => c.attempts) ?? [];
  const firstTry = run.concepts?.filter((c) => c.attempts[0]?.verdict.pass).length ?? 0;
  const finalPass = run.concepts?.filter((c) => c.attempts.some((a) => a.verdict.pass)).length ?? 0;
  return `
    ${done ? `
    <section class="section stats">
      <div class="card stat"><div class="label">Ukupni trošak</div><div class="value">${usd(run.costs.totalUsd)}</div><div class="sub">Claude ${usd(run.costs.claudeUsd)} · slike ${usd(run.costs.imagesUsd)}</div></div>
      <div class="card stat"><div class="label">Trajanje</div><div class="value">${Math.floor(run.durationSec / 60)} min ${run.durationSec % 60} s</div><div class="sub">od adrese do gotovih slika</div></div>
      <div class="card stat"><div class="label">Slike</div><div class="value">${run.costs.images}</div><div class="sub">${run.costs.claudeCalls} poziva Claude-a</div></div>
      <div class="card stat"><div class="label">Prošlo provjeru</div><div class="value">${finalPass} / ${run.concepts.length}</div><div class="sub">${firstTry} iz prvog pokušaja</div></div>
    </section>` : ''}
    ${run.brand ? brandHtml(run) : ''}
    ${run.product ? productHtml(run.product) : ''}
    ${run.concepts ? `
      <section class="section">
        <div class="section-head">
          <h2>Koncepti i slike</h2>
          <span class="muted small" id="rule-note">Slika prolazi ako je prosjek ocjena barem ${run.rules?.passAverage ?? 7.5}, nijedna ocjena nije ispod ${run.rules?.passMinimum ?? 6} i nema kritične greške. To pravilo provodi kod, ne AI.</span>
        </div>
        ${run.concepts.map((c, i) => conceptHtml(c, i)).join('')}
      </section>` : ''}
    ${done ? `<p class="muted small">Modeli: ${esc(run.models.claude)} (analiza i provjera) · ${esc(run.models.images)} (slike). Pokrenuto ${new Date(run.createdAt).toLocaleString('hr-HR')} za <a href="${esc(run.url)}" target="_blank" rel="noopener">${esc(run.url)}</a>.</p>` : ''}
    ${attempts.length === 0 && !run.brand ? '<div class="card empty">Agent radi…</div>' : ''}`;
}

function brandHtml(run) {
  const b = run.brand;
  return `
    <section class="section">
      <div class="section-head"><h2>Brand profil</h2><span class="muted small">Izveden samo iz sadržaja web stranice. Pouzdanost analize: ${esc(b.confidence)}</span></div>
      <div class="card brand-grid">
        <div>
          <h2>${esc(b.brand_name)}</h2>
          <p class="one-liner">${esc(b.one_liner)}</p>
          <dl>
            <div class="kv"><dt>Publika</dt><dd>${esc(b.audience)}</dd></div>
            <div class="kv"><dt>Ton</dt><dd class="chips">${b.tone.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</dd></div>
            <div class="kv"><dt>Vrijednosti</dt><dd>${esc(b.values.join(', '))}</dd></div>
            <div class="kv"><dt>Vizualni stil</dt><dd>${esc(b.visual_style)}</dd></div>
          </dl>
          <div class="evidence">Na čemu se analiza temelji:${list(b.evidence)}</div>
        </div>
        <div>
          <h3>Boje brenda</h3>
          <div class="palette">
            ${b.palette.map((c) => `<div class="swatch"><div class="color" style="background:${esc(c.hex)}"></div><div class="info">${esc(c.name)}<br><code>${esc(c.hex)}</code> · ${esc(c.role)}</div></div>`).join('')}
          </div>
          <div class="dodont">
            <div class="do"><h3>Slike trebaju</h3>${list(b.imagery_do)}</div>
            <div class="dont"><h3>Slike ne smiju</h3>${list(b.imagery_dont)}</div>
          </div>
        </div>
      </div>
    </section>`;
}

function productHtml(p) {
  const c = p.credit;
  return `
    <section class="section">
      <div class="section-head"><h2>Stvarni proizvod</h2><span class="muted small">Fotografija-predložak koju agent dobiva uz web stranicu.</span></div>
      <div class="card product">
        <img src="${esc(p.file)}" alt="${esc(p.name)}" loading="lazy" data-zoom>
        <div>
          <h3>${esc(p.name)}</h3>
          <p>Model za slike ne zna kako izgleda ovaj proizvod, pa bi sam nacrtao izmišljeni. Zato agent šalje ovu fotografiju kao predložak: proizvod ostaje isti, a mijenjaju se scena, kadar i svjetlo. Claude zatim provjerava je li proizvod na slici isti kao na fotografiji.</p>
          ${c ? `<p class="muted small">Fotografija: ${esc(c.author)}, licenca ${esc(c.license)}${c.source ? `, <a href="${esc(c.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>` : ''}.</p>` : ''}
        </div>
      </div>
    </section>`;
}

function conceptHtml(c, i) {
  return `
    <article class="card concept" data-concept="${i}">
      <div class="concept-head">
        <div>
          <h3>${esc(c.title)}<span class="tag">${esc(c.channel)}</span></h3>
          <p>${esc(c.idea)}</p>
        </div>
      </div>
      <div class="attempts">
        ${c.attempts.map((a, i) => attemptHtml(a, i === c.attempts.length - 1, c)).join('')}
        ${!c.attempts.length && !c.error ? '<div class="attempt muted"><span class="spinner"></span>Generiram…</div>' : ''}
        ${c.error ? `<div class="attempt muted">Model za slike nije uspio napraviti sliku za ovaj koncept (${esc(c.error)}).</div>` : ''}
      </div>
    </article>`;
}

function attemptHtml(a, last, c) {
  const r = a.review;
  return `
    <div class="attempt" data-attempt="${a.n}">
      <div class="attempt-label">
        <span class="n">${a.n === 1 ? '1. pokušaj' : `${a.n}. pokušaj · popravljeni prompt`}</span>
        <span class="verdict ${a.verdict.pass ? 'pass' : 'fail'}">${a.verdict.pass ? 'Prošlo' : 'Nije prošlo'} · ${a.verdict.average.toLocaleString('hr-HR')}</span>
      </div>
      <img src="${esc(a.image.file)}" alt="${esc(r.summary)}" width="${a.image.width}" height="${a.image.height}" loading="lazy" data-zoom>
      <div class="review">
        <div class="scores">
          ${Object.entries(r.scores).map(([k, v]) => `<div class="score"><span>${SCORE_LABELS[k] ?? k}</span><span class="bar"><span style="width:${v * 10}%"></span></span><b>${v}</b></div>`).join('')}
        </div>
        <p class="review-summary">${esc(r.summary)}</p>
        ${list(r.strengths, 'good')}
        ${list(r.issues, 'bad')}
      </div>
      ${!a.verdict.pass && !last ? `<p class="arrow-note">Ne prolazi (${esc(a.verdict.reasons.join(', '))}), pa agent popravlja prompt i generira ponovno →</p>` : ''}
      ${!a.verdict.pass && last ? `<p class="arrow-note">Ne prolazi${a.n > 1 ? ' ni nakon popravka' : ''} (${esc(a.verdict.reasons.join(', '))}).${c.stoppedByBudget ? ' Novi pokušaj nije pokrenut jer je dosegnut limit troška.' : ''} Ovakvu sliku agent označava za ljudski pregled.</p>` : ''}
      <details class="prompt"><summary>Prompt za ovu sliku</summary><p>${esc(a.prompt)}</p></details>
    </div>`;
}

function bind() {
  document.getElementById('run-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('url').value.trim();
    if (url) startRun(url);
  });
  app.querySelectorAll('[data-zoom]').forEach((img) => img.addEventListener('click', () => {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${img.getAttribute('src')}" alt="">`;
    box.addEventListener('click', () => box.remove());
    document.body.append(box);
  }));
}

async function startRun(url) {
  Object.assign(state, { running: true, log: [], error: '', run: { concepts: null } });
  render();
  try {
    const res = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    if (!res.ok) throw new Error((await res.json()).error);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) handle(JSON.parse(line));
    }
  } catch (err) {
    state.error = err.message;
  }
  state.running = false;
  state.runs = await fetch('/api/runs').then((r) => r.json());
  if (state.run?.id) location.hash = `#/run/${state.run.id}`;
  render();
}

function handle(ev) {
  if (ev.type === 'status') state.log.push(ev.text);
  if (ev.type === 'brand') state.run.brand = ev.brand;
  if (ev.type === 'concepts') state.run.concepts = ev.concepts;
  if (ev.type === 'attempt') state.run.concepts[ev.index].attempts.push(ev.attempt);
  if (ev.type === 'done') { state.run = ev.run; state.log.push('Gotovo.'); }
  if (ev.type === 'error') state.error = ev.error;
  render();
}

init();
