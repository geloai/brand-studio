// The three Claude tasks: analyse the brand, plan image concepts, review a generated image.
// User-facing text is Croatian; image prompts are English, which FLUX follows best.
import { askJson, imageBlock } from './claude.js';

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// ---------- 1. Brand analysis ----------

const BRAND_SCHEMA = obj({
  brand_name: str('Naziv brenda.'),
  one_liner: str('Jedna rečenica: što brend radi i za koga (hrvatski).'),
  audience: str('Ciljna publika (hrvatski).'),
  tone: strList('3-5 pridjeva koji opisuju ton komunikacije (hrvatski).'),
  values: strList('2-4 vrijednosti koje brend ističe (hrvatski).'),
  visual_style: str('Vizualni stil u 1-2 rečenice: fotografija ili ilustracija, svjetlo, kompozicija, atmosfera (hrvatski).'),
  palette: {
    type: 'array',
    description: '3-6 boja brenda, poredano po važnosti.',
    items: obj({
      hex: str('Boja u obliku #rrggbb.'),
      name: str('Kratki naziv boje (hrvatski).'),
      role: str('Uloga: primarna, sekundarna, naglasak, pozadina... (hrvatski).'),
    }),
  },
  imagery_do: strList('3-5 stvari koje slike ovog brenda trebaju imati: motivi, atmosfera, svjetlo, boje. Bez logotipa, ambalaže i imena konkretnih proizvoda (hrvatski).'),
  imagery_dont: strList('3-5 stvari koje slike ovog brenda ne smiju imati (hrvatski).'),
  evidence: strList('2-4 kratka konkretna dokaza sa stranice na kojima se analiza temelji (hrvatski).'),
  confidence: { type: 'string', enum: ['niska', 'srednja', 'visoka'], description: 'Koliko je stranica dala dovoljno podataka za analizu.' },
});

export async function analyzeBrand(site) {
  const evidence = [
    `URL: ${site.url}`,
    `Naslov: ${site.title}`,
    site.siteName && `Naziv (og:site_name): ${site.siteName}`,
    site.description && `Opis: ${site.description}`,
    site.themeColor && `theme-color: ${site.themeColor}`,
    `Naslovi na stranici: ${site.headings.join(' | ') || '(nema)'}`,
    `Najčešće boje u CSS-u (boja: broj pojavljivanja): ${site.colors.map((c) => `${c.hex}: ${c.count}`).join(', ') || '(nisu pronađene)'}`,
    `Tekst stranice:\n${site.text}`,
  ].filter(Boolean).join('\n');

  return askJson({
    task: 'brand',
    system: 'Ti si iskusni brand strateg. Iz sadržaja web stranice izvodiš identitet brenda koji će dizajneru poslužiti kao brief za vizuale. Oslanjaš se samo na ono što stranica stvarno pokazuje. Kod boja razlikuješ boje brenda od neutralnih boja sučelja (čista bijela, crna i sive obično nisu boje brenda, osim ako ih brend izričito koristi kao identitet). Kad podataka nema dovoljno, to iskreno kažeš u polju confidence.',
    content: [{ type: 'text', text: evidence }],
    schema: BRAND_SCHEMA,
  });
}

// ---------- 2. Concept planning ----------

export const SIZE_OPTIONS = ['square_hd', 'portrait_4_3', 'landscape_4_3'];

const CONCEPTS_SCHEMA = obj({
  concepts: {
    type: 'array',
    items: obj({
      title: str('Kratki naziv koncepta (hrvatski).'),
      channel: str('Gdje bi se slika koristila, npr. Instagram objava, naslovna slika weba, oglas (hrvatski).'),
      idea: str('Ideja u 1-2 rečenice i zašto odgovara brendu (hrvatski).'),
      prompt: str('Prompt za FLUX na engleskom, 40-80 riječi: jedan glavni motiv, okruženje, kompozicija, svjetlo, boje brenda opisane riječima, stil fotografije. Bez teksta, slova, logotipa, ambalaže i stvarnih osoba.'),
      size: { type: 'string', enum: SIZE_OPTIONS, description: 'Format slike prema kanalu.' },
    }),
  },
});

// With a product photo the image model keeps the real product, so concepts show it and the
// prompt describes only the new scene around it.
const PRODUCT_CONCEPTS = (product) => [
  `Brend ima stvarni proizvod: ${product.name}. Model za slike dobiva njegovu fotografiju kao predložak i zadržava ga.`,
  '- Svaki koncept prikazuje taj proizvod, cijeli i jasno vidljiv, u novoj sceni, kadru ili svjetlu.',
  '- Prompt počni s "Keep the exact car from the reference photo unchanged" (ili odgovarajućom imenicom za proizvod), pa opiši samo novu scenu: okruženje, kut, svjetlo i atmosferu u bojama brenda.',
  '- Ne mijenjaj oblik, boje ni detalje proizvoda i ne izmišljaj dijelove kojih na fotografiji nema.',
  '- Ukloni ljude, natpise i brojeve koji nisu dio proizvoda.',
  'Za taj proizvod ne vrijedi pravilo o općenitom opisu proizvoda: on se prikazuje točno onakav kakav je na fotografiji.',
].join('\n');

export async function planConcepts(brand, count, product = null) {
  return askJson({
    task: 'concepts',
    system: [
      'Ti si art director. Od brand profila radiš koncepte za slike koje će generirati model FLUX. Svaki koncept mora biti drugačiji (drugi kanal, subjekt ili kompozicija), a svi moraju biti prepoznatljivo u stilu brenda.',
      'Pišeš promptove koje model za slike može pouzdano izvesti:',
      '- jedan jasan glavni motiv i najviše 3-4 ključna elementa;',
      '- ništa što ovisi o preciznim detaljima: presjeci s točnim slojevima, brojanje predmeta, ruke koje nešto drže ili složene radnje više osoba;',
      '- proizvode opisuješ općenito (npr. "milk chocolate pralines"), nikad konkretnim imenom proizvoda, jer model ne zna kako izgledaju i ne smije crtati ambalažu;',
      '- bez teksta, slova i logotipa, jer ih modeli za slike ne znaju ispravno nacrtati;',
      '- identitet brenda prenosiš bojama, svjetlom, atmosferom i stilom fotografije.',
      ...(product ? [PRODUCT_CONCEPTS(product)] : []),
    ].join('\n'),
    content: [{ type: 'text', text: `Brand profil:\n${JSON.stringify(brand, null, 2)}\n\nNapravi točno ${count} koncepta.` }],
    schema: CONCEPTS_SCHEMA,
  });
}

// ---------- 3. Image review ----------

const score = (what) => ({ type: 'integer', description: `${what} Ocjena 1-10.` });

const REVIEW_SCHEMA = obj({
  scores: obj({
    brand_fit: score('Koliko slika odgovara brendu: boje, ton, stil, publika.'),
    visual_quality: score('Tehnička i estetska kvaliteta: kompozicija, svjetlo, oštrina, bez artefakata.'),
    prompt_adherence: score('Koliko slika prikazuje traženi koncept.'),
  }),
  critical_issue: { type: 'boolean', description: 'true ako slika ima grešku zbog koje se ne smije koristiti: deformirani ljudi ili ruke, besmislen tekst ili slova, tuđi logo, neprimjeren sadržaj.' },
  strengths: strList('1-3 stvari koje su dobre (hrvatski, kratko).'),
  issues: strList('0-4 konkretna problema (hrvatski, kratko). Prazno ako ih nema.'),
  summary: str('Jedna rečenica zaključka (hrvatski).'),
  revised_prompt: str('Poboljšani FLUX prompt na engleskom, 40-80 riječi, koji ispravlja uzrok glavnog problema. Ako problema nema, vrati izvorni prompt.'),
});

const REVIEW_SYSTEM = [
  'Ti si art director i kontrola kvalitete. Ocjenjuješ generiranu sliku prema brand profilu i konceptu: je li upotrebljiva kao marketinški vizual ovog brenda.',
  'Mjerilo: 9-10 slika bi bez izmjena prošla kod klijenta; 7-8 dobra je, uz sitne zamjerke; 5-6 upotrebljiva je tek uz doradu; ispod 5 promašaj je.',
  'Slike namjerno nemaju logotipe, ambalažu ni tekst, pa generički proizvod nije greška. Brend se prepoznaje po bojama, svjetlu, atmosferi i stilu.',
  'prompt_adherence ocjenjuje je li pogođena glavna ideja koncepta, ne svaki sporedni detalj iz prompta.',
  'Sitne nedosljednosti koje prosječan gledatelj ne bi primijetio ne obaraju ocjenu. Ono što bi primijetio (deformirane ruke ili lica, besmislena slova, nelogični predmeti u prvom planu) obara.',
  'Poboljšani prompt ispravlja uzrok glavnog problema. Kad je model promašio jer je prompt tražio previše detalja, pojednostavi prompt umjesto da dodaješ nove detalje.',
  'Kad model ne zna uvjerljivo nacrtati sam predmet ili materijal (tekstura izbliza, presjek, prijelom, precizan mehanički detalj), isti kadar drugim riječima neće pomoći. Promijeni pristup: širi kadar, drugi motiv ili kut, tako da glavna ideja koncepta ostane, a problematičan detalj više nije u fokusu.',
].join('\n');

const PRODUCT_REVIEW = (product) => [
  `Na slici mora biti stvarni proizvod (${product.name}) s priložene fotografije-predloška: prva slika je ta fotografija, druga je generirana slika koju ocjenjuješ.`,
  'Proizvod mora biti isti kao na fotografiji: oblik, proporcije, boje i prepoznatljivi detalji. Izmijenjen, deformiran ili izmišljen proizvod je kritična greška.',
  'Natpisi i oznake koji su dio samog proizvoda na fotografiji (npr. logo ili tablica) nisu greška.',
  'Poboljšani prompt i dalje počinje uputom da proizvod s fotografije ostane nepromijenjen.',
].join('\n');

export async function reviewImage({ brand, concept, prompt, imageBuffer, product = null, referenceBuffer = null }) {
  return askJson({
    task: 'review',
    system: product ? `${REVIEW_SYSTEM}\n${PRODUCT_REVIEW(product)}` : REVIEW_SYSTEM,
    content: [
      ...(product && referenceBuffer ? [imageBlock(referenceBuffer)] : []),
      imageBlock(imageBuffer),
      { type: 'text', text: `Brand profil:\n${JSON.stringify(brand, null, 2)}\n\nKoncept: ${concept.title} (${concept.channel})\n${concept.idea}\n\nPrompt korišten za ovu sliku:\n${prompt}` },
    ],
    schema: REVIEW_SCHEMA,
  });
}
