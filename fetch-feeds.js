/**
 * fetch-feeds.js
 *
 * Raccoglie aggiornamenti reali da fonti giuridiche italiane ed europee
 * e genera feed.json nel formato atteso da rassegna.html.
 *
 * Fonti implementate (selettori verificati manualmente sui siti reali):
 *   - Corte di Cassazione  (cortedicassazione.it)   -> tag "civile" / "fiscale"
 *   - TAR + Consiglio di Stato (giustizia-amministrativa.it) -> tag "amministrativo"
 *   - Gazzetta Ufficiale   (gazzettaufficiale.it)    -> tag "fiscale"
 *   - EUR-Lex, Gazzetta UE serie L (eur-lex.europa.eu) -> tag "ue"
 *
 * Uso:
 *   npm install
 *   node fetch-feeds.js
 *
 * Poi schedulare con cron, es. ogni 3 ore:
 *   0 (ogni 3 ore) * * *  node /percorso/fetch-feeds.js
 */

const fs = require('fs');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'it-IT,it;q=0.9'
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

function normalizza({ fonte, tag, titolo, sintesi, data, speech }) {
  return {
    id: null,
    tag,
    fonte,
    data,
    titolo: titolo.trim(),
    sintesi: sintesi.trim(),
    speech: (speech || `${fonte}. ${titolo}. ${sintesi}`).trim()
  };
}

// Converte "11/09/2026" o "9 settembre 2026" in formato breve "11 set"
const MESI_IT = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
const MESI_NOMI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

function formattaDataSlash(d) {
  // "11/09/2026" -> "11 set"
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return d;
  const giorno = parseInt(m[1], 10);
  const mese = MESI_IT[parseInt(m[2], 10) - 1];
  return `${giorno} ${mese}`;
}

function troncaParola(testo, max) {
  if (testo.length <= max) return testo;
  const tagliato = testo.slice(0, max);
  const ultimoSpazio = tagliato.lastIndexOf(' ');
  return (ultimoSpazio > max * 0.6 ? tagliato.slice(0, ultimoSpazio) : tagliato).trim() + '…';
}

function formattaDataEstesa(d) {
  // "9 settembre 2026" -> "9 set"
  const m = d.match(/(\d{1,2})\s+([a-zàèéìòù]+)\s+\d{4}/i);
  if (!m) return d;
  const idx = MESI_NOMI.indexOf(m[2].toLowerCase());
  if (idx === -1) return d;
  return `${parseInt(m[1], 10)} ${MESI_IT[idx]}`;
}

// --- 1. Corte di Cassazione (Civile) ---
// Pagina: https://www.cortedicassazione.it/it/giurisprudenza_civile.page
// Selettore card: .card-news { .pill (materia), .card-category (sezione), h3 a (titolo+link), p.mb-3 (massima) }
async function scrapeCassazione() {
  const url = 'https://www.cortedicassazione.it/it/giurisprudenza_civile.page';
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const risultati = [];

  $('.card-news').slice(0, 12).each((_, el) => {
    const card = $(el);
    const sezione = card.find('.card-category').first().text().trim();
    const titoloLink = card.find('h3 a').first();
    const titoloCompleto = titoloLink.text().replace(/\s+/g, ' ').trim(); // "Sentenza n. 25224 del 11/09/2026"
    const dataMatch = titoloCompleto.match(/(\d{2}\/\d{2}\/\d{4})/);
    const data = dataMatch ? formattaDataSlash(dataMatch[1]) : '';

    const massimaRaw = card.find('p.mb-3').first().text().replace(/\s+/g, ' ').trim();
    // "MATERIA: descrizione..." -> separa materia da sintesi
    const materiaMatch = massimaRaw.match(/^([^:]{3,60}):\s*(.+)$/);
    const materia = materiaMatch ? materiaMatch[1].trim() : '';
    const materiaCap = materia ? materia.charAt(0) + materia.slice(1).toLowerCase() : '';
    const sintesi = troncaParola((materiaMatch ? materiaMatch[2] : massimaRaw).trim(), 220);

    const isTributaria = /tributaria/i.test(sezione);
    const tag = isTributaria ? 'fiscale' : 'civile';
    const fonte = 'Corte di Cassazione';
    const sezioneCap = sezione ? sezione.charAt(0).toUpperCase() + sezione.slice(1).toLowerCase() : '';
    const titoloBreve = [sezioneCap, materiaCap].filter(Boolean).join(' — ');

    const sintesiFinale = sintesi || titoloCompleto;
    risultati.push(normalizza({
      fonte, tag, data,
      titolo: titoloBreve || titoloCompleto,
      sintesi: sintesiFinale,
      speech: `${fonte}. ${sezione}. ${sintesiFinale.replace(/[.…]+$/, '')}.`
    }));
  });

  return risultati;
}

// --- 2. TAR + Consiglio di Stato (Ufficio Massimario) ---
// Pagina: homepage giustizia-amministrativa.it, box ".box-ufficio-massimario li"
// { a.title = massima, a.sentenza = "Consiglio di Stato/T.a.r. ..., <data>, n. <numero> - Pres. ..." }
async function scrapeTarConsiglioDiStato() {
  const url = 'https://www.giustizia-amministrativa.it/';
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const risultati = [];

  $('.box-ufficio-massimario li').each((_, el) => {
    const li = $(el);
    const titolo = li.find('a.title').first().text().replace(/\s+/g, ' ').trim();
    const rifCompleto = li.find('a.sentenza').first().attr('title') || li.find('a.sentenza').first().text();
    const rif = rifCompleto.replace(/\s+/g, ' ').trim();
    if (!titolo || !rif) return;

    const dataMatch = rif.match(/(\d{1,2}\s+[a-zàèéìòù]+\s+\d{4})/i);
    const data = dataMatch ? formattaDataEstesa(dataMatch[1]) : '';

    const isConsiglioStato = /consiglio di stato/i.test(rif);
    const fonte = isConsiglioStato ? 'Consiglio di Stato' : (rif.match(/^(T\.a\.r\.[^,]*)/i) || [null, 'TAR'])[1];

    risultati.push(normalizza({
      fonte, tag: 'amministrativo', data,
      titolo,
      sintesi: rif,
      speech: `${fonte}. ${titolo}. ${rif}.`
    }));
  });

  return risultati.slice(0, 12);
}

// --- 3. Gazzetta Ufficiale (sezione "Notizie" homepage) ---
// #cn_list .home_notizia { .datanews_grid_h = data, .news_titolo = titolo, a dentro grid_corpo_novita = riferimento normativo }
async function scrapeGazzettaUfficiale() {
  const url = 'https://www.gazzettaufficiale.it/';
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const risultati = [];

  $('#cn_list .home_notizia').each((_, el) => {
    const item = $(el);
    const data = item.find('.datanews_grid_h').first().text().trim();
    const titolo = item.find('.news_titolo').first().text().replace(/\s+/g, ' ').trim();
    const riferimento = item.find('.grid_corpo_novita a').first().text().trim();

    if (!titolo) return;
    // Esclude bandi di concorso: non sono aggiornamenti normativi
    if (/^concorso$/i.test(riferimento)) return;
    if (/\d+\s+post[oi]\b/i.test(titolo)) return;

    risultati.push(normalizza({
      fonte: 'Gazzetta Ufficiale',
      tag: 'fiscale',
      data: formattaDataSlash(data),
      titolo: titolo.charAt(0).toUpperCase() + titolo.slice(1).toLowerCase(),
      sintesi: riferimento || titolo,
      speech: `Gazzetta Ufficiale. ${titolo}. ${riferimento}.`
    }));
  });

  return risultati.slice(0, 10);
}

// --- 4. EUR-Lex, Gazzetta ufficiale UE, serie L (visualizzazione giornaliera) ---
// .row.daily-view-row-spacing { .section-level-3 = numero atto, .defaultUnderlined a = titolo+link }
async function scrapeEurLex() {
  const url = 'https://eur-lex.europa.eu/oj/daily-view/L-series/default.html?locale=it';
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const risultati = [];

  $('.row.daily-view-row-spacing').each((_, el) => {
    const row = $(el);
    const numero = row.find('.section-level-3').first().text().trim();
    const titolo = row.find('.defaultUnderlined a').first().text().replace(/\s+/g, ' ').trim();
    if (!titolo) return;

    const dataMatch = titolo.match(/del\s+(\d{1,2}\s+[a-zàèéìòù]+\s+\d{4})/i);
    const data = dataMatch ? formattaDataEstesa(dataMatch[1]) : '';

    risultati.push(normalizza({
      fonte: 'EUR-Lex',
      tag: 'ue',
      data,
      titolo: numero ? `${numero} — ${titolo}` : titolo,
      sintesi: titolo.slice(0, 260),
      speech: `EUR-Lex. ${titolo}.`
    }));
  });

  return risultati.slice(0, 8);
}

// --- Riscrittura discorsiva (due modalità: LLM oppure template gratuito) ---

// Modalità gratuita: rende le massime (elenchi di parole chiave separate da trattini)
// leggermente più scorrevoli da ascoltare. Non è una vera riscrittura discorsiva:
// il contenuto resta un elenco, solo con un'introduzione e punteggiatura più naturali.
// Serve da confronto/fallback quando non è impostata ANTHROPIC_API_KEY.
function applicaTemplateDiscorsivo(item) {
  let speech = item.speech;

  if (item.fonte === 'Corte di Cassazione') {
    const sezione = item.titolo.split('—')[0].trim().toLowerCase();
    const corpo = item.sintesi.replace(/\s-\s/g, ', ').replace(/[.…]+$/, '');
    speech = `La Corte di Cassazione, ${sezione}, si è pronunciata su questi punti: ${corpo}.`;
  } else if (/consiglio di stato|t\.a\.r\./i.test(item.fonte)) {
    speech = `${item.fonte} ha deciso: ${item.titolo}.`;
  } else if (item.fonte === 'Gazzetta Ufficiale') {
    speech = `Gazzetta Ufficiale. ${item.titolo}. Riferimento normativo: ${item.sintesi}.`;
  } else if (item.fonte === 'EUR-Lex') {
    speech = `EUR-Lex. ${item.titolo}.`;
  }

  return { ...item, speech };
}

// Modalità con LLM: chiede a Claude di riscrivere ogni voce in italiano discorsivo,
// come se lo stesse raccontando a voce ("la Cassazione ha stabilito che..."), in un'unica
// chiamata per tutti gli item (più economico di una chiamata per ciascuno).
// Richiede la variabile d'ambiente ANTHROPIC_API_KEY. Se assente o se la chiamata fallisce,
// il chiamante deve ricadere su applicaTemplateDiscorsivo.
async function riscriviConLLM(items) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const input = items.map(it => ({ id: it.id, fonte: it.fonte, titolo: it.titolo, sintesi: it.sintesi }));

  const prompt = `Sei un giornalista giuridico che prepara una rassegna da ascoltare in auto. Per ciascuna voce dell'elenco JSON, riscrivi il contenuto in italiano discorsivo e naturale, come se lo stessi raccontando a voce a un collega avvocato. Non limitarti a incollare le parole chiave separate da trattini nel testo originale: spiega davvero il principio, la decisione o la novità in una o due frasi di senso compiuto, mantenendo tutti i fatti rilevanti (numero di sentenza o norma se presente, oggetto, conclusione). Esempi di registro: "La Cassazione ha stabilito che nel pignoramento presso terzi...", "Il TAR ha annullato il diniego perché...", "È stato pubblicato un decreto che proroga...".

Rispondi SOLO con un array JSON valido, stessa lunghezza e stesso ordine dell'input, con oggetti nella forma:
{"id": <id>, "titolo": "<titolo breve naturale, max 12 parole>", "sintesi": "<1-2 frasi discorsive, max 280 caratteri, per la lettura a schermo>", "speech": "<stesso contenuto della sintesi ma ottimizzato per la sintesi vocale: niente abbreviazioni come 'art.' o 'n.', scrivile per esteso ('articolo', 'numero')>"}

Input:
${JSON.stringify(input)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error(`Anthropic API -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const testo = (data.content || []).map(b => b.text || '').join('');
  const match = testo.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Risposta del modello non in formato JSON atteso');
  const riscritti = JSON.parse(match[0]);

  const perId = new Map(riscritti.map(r => [r.id, r]));
  return items.map(it => {
    const r = perId.get(it.id);
    if (!r) return it;
    return {
      ...it,
      titolo: r.titolo || it.titolo,
      sintesi: r.sintesi || it.sintesi,
      speech: r.speech || it.speech
    };
  });
}

const FONTI = [
  { nome: 'Corte di Cassazione', fn: scrapeCassazione },
  { nome: 'TAR / Consiglio di Stato', fn: scrapeTarConsiglioDiStato },
  { nome: 'Gazzetta Ufficiale', fn: scrapeGazzettaUfficiale },
  { nome: 'EUR-Lex', fn: scrapeEurLex }
];

async function main() {
  const results = [];

  for (const fonte of FONTI) {
    try {
      const items = await fonte.fn();
      console.log(`${fonte.nome}: ${items.length} aggiornamenti`);
      results.push(...items);
    } catch (err) {
      console.error(`Errore nel recupero di ${fonte.nome}:`, err.message);
    }
  }

  results.forEach((item, i) => { item.id = i + 1; });

  let riscritti = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      riscritti = await riscriviConLLM(results);
      console.log('Testi riscritti in modo discorsivo con Claude (LLM).');
    } catch (err) {
      console.error('Riscrittura con LLM fallita, uso la versione a template:', err.message);
    }
  } else {
    console.log('ANTHROPIC_API_KEY non impostata: uso la riscrittura a template (gratuita, qualità limitata).');
  }
  const finale = riscritti || results.map(applicaTemplateDiscorsivo);

  fs.writeFileSync('feed.json', JSON.stringify(finale, null, 2), 'utf-8');
  console.log(`\nScritti ${finale.length} aggiornamenti in feed.json`);
}

main();
