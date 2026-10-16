// Guided tour through saved runs of the real agent: how it works, step by step.
// Drives the app through the DOM only (hash navigation), so it shows exactly what a user would see.
// The numbers on the cards are read from the saved runs, not typed in.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const isPhone = () => window.innerWidth < 760;
const num = (n, d = 1) => Number(n).toLocaleString('hr-HR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n) => `${num(n, 2)} $`;

async function waitFor(fn, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(100);
  }
}

async function go(hash, ready) {
  if (location.hash !== hash) location.hash = hash;
  await waitFor(() => $(ready));
  await sleep(150);
}

// ---------- facts from the saved runs ----------

let F = null;

async function loadFacts() {
  const list = await fetch('/api/runs').then((r) => r.json());
  const runs = await Promise.all(list.map((r) => fetch(`/api/runs/${r.id}`).then((x) => x.json())));
  const find = (pred) => {
    for (const run of runs) {
      const index = run.concepts.findIndex(pred);
      if (index >= 0) return { run, index, concept: run.concepts[index] };
    }
    return null;
  };
  // Showcase: a concept that failed first and passed after a retry, and one that never passed.
  const isFixed = (c) => c.attempts.length > 1 && !c.attempts[0].verdict.pass && c.attempts.some((a) => a.verdict.pass);
  const fixed = find((c) => isFixed(c));
  const flagged = find((c) => c.attempts.length && !c.attempts.some((a) => a.verdict.pass));
  const main = fixed?.run ?? runs[0];
  const firstPass = main.concepts.findIndex((c) => c.attempts[0]?.verdict.pass);
  // A run with a real product photo: prefer a concept where the product check caught an error.
  const productRun = runs.find((r) => r.product);
  const productIndex = productRun ? Math.max(0, productRun.concepts.findIndex(isFixed)) : -1;
  const lead = main.brand.palette[0];
  const concepts = runs.flatMap((r) => r.concepts);
  return {
    runs,
    main,
    fixed,
    flagged,
    product: productRun ? { run: productRun, index: productIndex, concept: productRun.concepts[productIndex] } : null,
    firstPass: Math.max(0, firstPass),
    lead,
    leadCount: main.siteColors.find((c) => c.hex.toLowerCase() === lead?.hex.toLowerCase())?.count,
    total: concepts.length,
    passed: concepts.filter((c) => c.attempts.some((a) => a.verdict.pass)).length,
    avgCost: runs.reduce((s, r) => s + r.costs.totalUsd, 0) / runs.length,
  };
}

const runHash = (run) => `#/run/${run.id}`;
const concept = (i) => `[data-concept="${i}"]`;

// Each step: a big headline (kpi), a short title and one or two plain sentences.
const STEPS = [
  {
    center: true,
    kpi: () => 'Od web adrese do slika',
    title: () => 'AI agent koji radi vizuale u stilu brenda',
    text: () => `Upišete web stranicu brenda. Agent prouči brend, smisli ideje, generira slike i svaku sliku sam provjeri. Obilazak prolazi kroz stvarno pokretanje agenta na stranici brenda ${F.main.brand.brand_name}.`,
    before: () => go(runHash(F.main), '.run-form'),
  },
  {
    target: '.hero',
    kpi: () => '5 koraka, oko 1 minuta',
    title: () => 'Sve kreće od jedne adrese',
    text: () => 'U punoj verziji upišete adresu bilo kojeg brenda. U demo verziji gledamo spremljena stvarna pokretanja, s istim rezultatima i troškovima.',
    before: () => go(runHash(F.main), '.hero'),
  },
  {
    target: '.brand-grid > div:first-child',
    kpi: () => 'Brand profil',
    title: () => 'Prvo prouči brend',
    text: () => 'Claude pročita stranicu i izvede publiku, ton, vrijednosti i vizualni stil. Navodi i dokaze sa stranice na kojima temelji zaključak, da se vidi da ne izmišlja.',
    before: () => go(runHash(F.main), '.brand-grid'),
  },
  {
    target: '.palette',
    kpi: () => F.lead?.hex ?? 'Boje brenda',
    title: () => 'Boje izvučene iz koda stranice',
    text: () => (F.leadCount
      ? `Program prebroji boje u dizajnu stranice: ${F.lead.name} (${F.lead.hex}) pojavljuje se ${F.leadCount} puta. Claude zatim odvaja boje brenda od neutralnih boja sučelja.`
      : 'Program prebroji boje u dizajnu stranice, a Claude odvaja boje brenda od neutralnih boja sučelja.'),
    before: () => go(runHash(F.main), '.palette'),
  },
  {
    target: () => `${concept(F.firstPass)} .concept-head`,
    kpi: () => `${F.main.concepts.length} ideje za različite kanale`,
    title: () => 'Iz profila nastaju koncepti',
    text: () => 'Instagram objava, naslovna slika, oglas. Svaki koncept ima upute koje model za slike može pouzdano izvesti: jedan glavni motiv, bez teksta i logotipa.',
    before: () => go(runHash(F.main), concept(F.firstPass)),
  },
  {
    target: () => `${concept(F.firstPass)} [data-attempt="1"]`,
    kpi: () => `Ocjena ${num(F.main.concepts[F.firstPass].attempts[0].verdict.average)} od 10`,
    title: () => 'Svaku sliku provjerava AI',
    text: () => 'Claude pogleda sliku i ocijeni tri stvari: odgovara li brendu, je li kvalitetna i pogađa li ideju. Uz ocjene navede konkretno što je dobro, a što ne.',
    before: () => go(runHash(F.main), concept(F.firstPass)),
  },
  {
    target: '#rule-note',
    kpi: () => 'Prosjek barem 7,5',
    title: () => 'Odluku donosi kod, ne AI',
    text: () => 'Slika prolazi samo ako je prosjek ocjena barem 7,5, nijedna ocjena nije ispod 6 i nema kritične greške. Isto pravilo vrijedi za svaku sliku i provjereno je testovima.',
    before: () => go(runHash(F.main), '#rule-note'),
  },
  {
    target: () => `${concept(F.fixed.index)} [data-attempt]`,
    kpi: () => {
      const a = F.fixed.concept.attempts;
      return `${num(a[0].verdict.average)} → ${num(a.find((x) => x.verdict.pass).verdict.average)}`;
    },
    title: () => 'Što ne prođe, agent sam popravi',
    text: () => `"${F.fixed.concept.title}": prva slika nije prošla provjeru. Agent je promijenio kadar i napravio novu sliku, koja je prošla. Nitko nije morao intervenirati.`,
    when: () => F.fixed,
    before: () => go(runHash(F.fixed.run), concept(F.fixed.index)),
  },
  {
    target: () => `${concept(F.product.index)} [data-attempt]`,
    kpi: () => F.product.run.product.name,
    title: () => 'Pravi proizvod, a ne izmišljeni',
    text: () => {
      const first = F.product.concept.attempts[0];
      const caught = !first.verdict.pass && first.review.critical_issue;
      return `Model za slike ne zna kako izgleda ${F.product.run.product.name}, pa agent šalje fotografiju pravog proizvoda kao predložak. Claude zatim provjerava je li proizvod ostao isti.${caught ? ` Ovdje je prvi pokušaj pao: "${first.review.summary}"` : ''}`;
    },
    when: () => F.product,
    before: () => go(runHash(F.product.run), concept(F.product.index)),
  },
  {
    target: () => `${concept(F.flagged.index)} [data-attempt]`,
    kpi: () => 'Ljudski pregled',
    title: () => 'Kad ni popravak ne uspije, javlja čovjeku',
    text: () => `${F.flagged.run.brand.brand_name}, "${F.flagged.concept.title}": nije prošlo ni nakon ${F.flagged.concept.attempts.length} pokušaja. Agent takvu sliku ne proglašava dobrom, nego je označi za pregled.`,
    when: () => F.flagged,
    before: () => go(runHash(F.flagged.run), concept(F.flagged.index)),
  },
  {
    target: '.stats',
    kpi: () => `≈ ${usd(F.avgCost)} po brendu`,
    title: () => 'Za svaki poziv zna se cijena',
    text: () => 'Agent bilježi trošak svakog poziva Claude-a i svake slike. Rezultati se spremaju, pa ponovno pokretanje istog brenda ne košta ništa.',
    before: () => go(runHash(F.main), '.stats'),
  },
  { summary: true },
];

const steps = () => STEPS.filter((s) => !s.when || s.when());

// ---------- overlay ----------

let i = 0;
let root = null;
let timer = null;

export async function startTour() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'tour centered';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"><p class="tour-wait">Učitavam…</p></div>';
  document.body.appendChild(root);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  timer = setInterval(place, 300); // follows late layout changes (images, fonts)
  try {
    F = await loadFacts();
  } catch {
    stop();
    return;
  }
  i = 0;
  show();
}

function stop() {
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place);
  clearInterval(timer);
  root?.remove();
  root = null;
  if (location.hash === '#/obilazak') history.replaceState(null, '', location.pathname + (F ? runHash(F.main) : ''));
}

function onKey(e) {
  if (e.key === 'Escape') stop();
  if (e.key === 'ArrowRight' && !root.classList.contains('busy')) next();
  if (e.key === 'ArrowLeft' && !root.classList.contains('busy')) back();
}

const next = () => { if (i < steps().length - 1) { i++; show(); } };
const back = () => { if (i > 0) { i--; show(); } };

const progress = () =>
  `<div class="tour-progress">${steps().map((_, n) => `<span class="${n === i ? 'on' : n < i ? 'done' : ''}"></span>`).join('')}</div>`;

// A selector may match several elements (e.g. all attempts of a concept): the highlight covers them all.
const targetOf = (step) => {
  const sel = typeof step.target === 'function' ? step.target() : step.target;
  const els = sel ? [...document.querySelectorAll(sel)] : [];
  if (els.length < 2) return els[0] ?? null;
  return {
    getBoundingClientRect() {
      const rs = els.map((e) => e.getBoundingClientRect());
      const top = Math.min(...rs.map((r) => r.top));
      const left = Math.min(...rs.map((r) => r.left));
      const bottom = Math.max(...rs.map((r) => r.bottom));
      const right = Math.max(...rs.map((r) => r.right));
      return { top, left, bottom, right, width: right - left, height: bottom - top };
    },
  };
};

async function show() {
  const step = steps()[i];
  const card = root.querySelector('.tour-card');
  const last = steps().length - 1;
  root.classList.add('busy');
  card.innerHTML = '<p class="tour-wait">Učitavam…</p>';
  try { await step.before?.(); } catch { /* keep going: the card still explains the step */ }
  if (!root) return;
  root.classList.remove('busy');

  if (step.summary) return showSummary();

  const el = targetOf(step);
  root.classList.toggle('centered', !el);
  if (el) scrollToTarget(el);
  card.innerHTML = `
    ${progress()}
    <div class="tour-step">Korak ${i} od ${last}</div>
    <div class="tour-kpi">${esc(step.kpi())}</div>
    <h3>${esc(step.title())}</h3>
    <p>${esc(step.text())}</p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-skip">Zatvori</button>
      <div class="btn-group">
        ${i > 0 ? '<button class="btn btn-sm tour-back">Natrag</button>' : ''}
        <button class="btn btn-primary tour-next">${i === 0 ? 'Kreni →' : 'Dalje →'}</button>
      </div>
    </div>`;
  if (i === 0) card.querySelector('.tour-step').remove();
  card.querySelector('.tour-next').onclick = next;
  card.querySelector('.tour-back')?.addEventListener('click', back);
  card.querySelector('.tour-skip').onclick = stop;
  place();
}

// Puts the highlighted element in the lower part of the screen, so the explanation card
// can sit above it and be the first thing the eye lands on.
function scrollToTarget(el) {
  const r = el.getBoundingClientRect();
  const tall = r.height > window.innerHeight * 0.4;
  const y = isPhone() || tall ? r.top + window.scrollY - 76 : r.top + window.scrollY - window.innerHeight * 0.5;
  window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
}

function place() {
  if (!root) return;
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  const step = steps()[i];
  const el = step && !step.summary && targetOf(step);
  if (!el) {
    spot.style.display = 'none';
    root.classList.add('centered');
    card.style.cssText = '';
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign(spot.style, {
    display: 'block', top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });
  if (isPhone()) { card.style.cssText = ''; return; } // docked to the bottom on phones (CSS)
  const cw = Math.min(440, window.innerWidth - 32);
  const ch = card.offsetHeight;
  // A tall, narrow target (one image with its review): the card goes beside it, not over it.
  const room = window.innerWidth - r.right - 40;
  if (r.height > window.innerHeight * 0.4 && room >= 320) {
    const besideTop = Math.min(Math.max(80, r.top), window.innerHeight - ch - 16);
    card.style.cssText = `top:${besideTop}px;left:${r.right + 24}px;width:${Math.min(cw, room)}px`;
    return;
  }
  let top;
  if (r.top - ch - 16 >= 64) top = r.top - ch - 16; // above the target (preferred)
  else if (r.bottom + ch + 16 <= window.innerHeight) top = r.bottom + 16; // below
  else top = window.innerHeight - ch - 16; // tall target: bottom of the screen
  const left = Math.min(Math.max(16, r.left + Math.min(24, r.width / 4)), window.innerWidth - cw - 16);
  card.style.cssText = `top:${Math.max(64, top)}px;left:${left}px;width:${cw}px`;
}

// ---------- final step: results across all saved runs ----------

function showSummary() {
  root.classList.add('centered');
  root.querySelector('.tour-spot').style.display = 'none';
  const card = root.querySelector('.tour-card');
  const last = steps().length - 1;
  card.style.cssText = '';
  const rows = F.runs.map((r) => {
    const first = r.concepts.filter((c) => c.attempts[0].verdict.pass).length;
    const after = r.concepts.filter((c) => c.attempts.some((a) => a.verdict.pass)).length - first;
    const review = r.concepts.length - first - after;
    return `<tr><td>${esc(r.brand.brand_name)}</td><td>${first}</td><td>${after}</td><td>${review}</td><td>${usd(r.costs.totalUsd)}</td></tr>`;
  }).join('');
  card.innerHTML = `
    ${progress()}
    <div class="tour-step">Korak ${last} od ${last}</div>
    <div class="tour-kpi">${F.passed} od ${F.total} ideja prošlo provjeru</div>
    <h3>Rezultati na ${F.runs.length} brenda iz različitih industrija</h3>
    <table class="tour-table">
      <thead><tr><th>Brend</th><th>Prošlo odmah</th><th>Nakon popravka</th><th>Za pregled</th><th>Trošak</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="tour-note">Sljedeći koraci: LoRA prilagodba na vlastitim fotografijama brenda i isti tok za kratke video isječke.</p>
    <p class="tour-note">Franko Gelo · <a href="mailto:franko.gelo1@gmail.com">franko.gelo1@gmail.com</a> · <a href="https://www.linkedin.com/in/franko-gelo-70ab3a404/" target="_blank" rel="noopener">LinkedIn</a> · <a href="https://github.com/geloai" target="_blank" rel="noopener">GitHub</a></p>
    <div class="tour-actions">
      <button class="btn btn-sm tour-back">Natrag</button>
      <button class="btn btn-primary tour-done">Istražite sami</button>
    </div>`;
  card.querySelector('.tour-back').onclick = back;
  card.querySelector('.tour-done').onclick = stop;
}
