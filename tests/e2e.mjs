// Klickt die Seite mit echten Mausklicks durch – auf Desktop-, Tablet- und Handy-Breite.
// Aufruf: node tests/e2e.mjs                 (lokale Kopie)
//         node tests/e2e.mjs --url <Adresse> (veröffentlichte Seite)

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, sleep } from '../scripts/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg > 0 ? process.argv[urlArg + 1].replace(/\/?$/, '/') : null;
const url = (file, hash = '') => (BASE ? new URL(file, BASE).href : pathToFileURL(path.join(ROOT, file)).href) + hash;

// Jede Breite läuft in einer anderen Zeitzone: Ein Raid-Termin, der irgendwo über Weltzeit umgerechnet
// wird, verrutscht dann um Stunden – und fällt hier auf. "every" = jeder wievielte Boss geöffnet wird.
const VIEWPORTS = [
  { label: 'Desktop', width: 1280, height: 900, timezone: 'Europe/Zurich', every: 1 },
  { label: 'Tablet', width: 820, height: 1180, mobile: true, timezone: 'America/Los_Angeles', every: 4 },
  { label: 'Handy', width: 390, height: 844, mobile: true, timezone: 'Pacific/Auckland', every: 4 },
];

let passed = 0;
const failures = [];
function check(condition, message) {
  if (condition) passed++;
  else failures.push(message);
}

// Dieselben Daten und dieselbe Rechnung wie die getestete Seite, unabhängig vom Browser geladen (für erwartete
// Werte): lokal aus dem Arbeitsordner, mit --url von der veröffentlichten Seite.
async function loadSource(file) {
  if (!BASE) return readFile(path.join(ROOT, file), 'utf8');
  const res = await fetch(new URL(file, BASE));
  if (!res.ok) throw new Error(`${file} von ${BASE} nicht geladen (HTTP ${res.status})`);
  return res.text();
}
async function loadData() {
  const text = await loadSource('data/raid-data.js');
  const data = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, ''));
  data.pokemonByKey = Object.fromEntries(data.pokemon.map((p) => [p.key, p]));
  return data;
}
async function loadCalc() {
  const module = { exports: {} };
  new Function('module', await loadSource('js/calc.js'))(module);
  return module.exports;
}
const DATA = await loadData();
const RaidCalc = await loadCalc();

// Zahlen wie auf der Seite (de-CH: 45’899) zurück in Zahlen.
const num = (text) => Number(String(text).replace(/[’'\s]/g, '').replace(',', '.'));
const isSortedDesc = (values) => values.every((v, i) => i === 0 || values[i - 1] >= v - 1e-9);

// Boss-WP und Fang-WP unabhängig von js/calc.js ausrechnen.
function expectedBossCp(boss) {
  const p = DATA.pokemonByKey[boss.pokemon];
  const hp = DATA.tiers[boss.tier].hp;
  return Math.floor(((p.base.atk + 15) * Math.sqrt(p.base.def + 15) * Math.sqrt(hp)) / 10);
}
function expectedCatch(boss, boosted) {
  const tier = DATA.tiers[boss.tier];
  const p = DATA.pokemonByKey[boss.catchPokemon];
  const level = tier.catchLevel + (boosted ? DATA.rules.weatherCatchLevelBonus : 0);
  const cpm = DATA.rules.cpm[level - 1];
  const cp = (iv) => Math.max(10, Math.floor(((p.base.atk + iv) * Math.sqrt(p.base.def + iv) * Math.sqrt(p.base.sta + iv) * cpm * cpm) / 10));
  return { min: cp(tier.catchIvFloor), max: cp(15) };
}

// Raid-Art (Kachel auf der Startseite) zu jeder Kategorie aus den Daten. Mega umfasst Mega-Legendär.
const GROUP_OF = { legendary: 'legendary', mega: 'mega', megaLegendary: 'mega', shadow: 'shadow', ultrabeast: 'ultrabeast', mythical: 'mythical', primal: 'primal' };
const GROUP_HEADINGS = {
  legendary: 'Legendäre Raid-Bosse', mega: 'Mega-Raid-Bosse', shadow: 'Crypto-Raid-Bosse',
  ultrabeast: 'Ultrabestien', mythical: 'Mysteriöse Raid-Bosse', primal: 'Proto-Raid-Bosse',
};
const bossesOf = (group) => DATA.bosses.filter((b) => GROUP_OF[b.category] === group).map((b) => b.key);
const isMegaAttacker = (a) => a.variant === 'mega' || a.variant === 'primal';
const RANK_ALL = { level: 40, elite: true, weather: null, shadow: true, mega: true, legendary: true };
const nameOf = (a) => (a.shadow ? `Crypto-${a.name}` : a.name);

// ---------- Zustand der Seite auslesen ----------

const startState = (page) => page.eval(`(() => ({
  visible: !document.getElementById('view-start').hidden,
  cards: [...document.querySelectorAll('#category-grid .category-card')].map((a) => ({
    id: a.dataset.category,
    count: Number(/(\\d+) Bosse/.exec(a.querySelector('.category-card__text').textContent)?.[1]),
    now: Number(/(\\d+)/.exec(a.querySelector('.badge--now')?.textContent ?? '0')[1]),
    images: a.querySelectorAll('img').length,
  })),
  cardsVisible: !document.getElementById('category-grid').hidden,
  searchVisible: !document.getElementById('search-results').hidden,
  hits: [...document.querySelectorAll('#search-grid .boss-tile')].map((a) => a.dataset.boss),
  searchCount: document.getElementById('search-count').textContent,
  scheduleVisible: !document.getElementById('schedule').hidden,
  now: [...document.querySelectorAll('#schedule-now .boss-tile')].map((a) => a.dataset.boss),
  soon: [...document.querySelectorAll('#schedule-soon .boss-tile')].map((a) => ({ key: a.dataset.boss, badge: a.querySelector('.badge--soon')?.textContent })),
  soonCount: document.getElementById('schedule-soon-count').textContent,
  soonOpen: document.getElementById('schedule-soon-wrap').open,
  clearVisible: !document.getElementById('search-clear').hidden,
  meta: document.getElementById('data-meta').textContent,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}))()`);

const categoryState = (page) => page.eval(`(() => ({
  visible: !document.getElementById('view-category').hidden,
  title: document.getElementById('category-title')?.textContent,
  count: document.getElementById('category-count')?.textContent,
  tiles: [...document.querySelectorAll('#category-grid-list > li')].map((li) => li.dataset.boss),
  focused: document.activeElement?.id,
  docTitle: document.title,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}))()`);

const detailState = (page) => page.eval(`(() => {
  const facts = Object.fromEntries([...document.querySelectorAll('.facts--boss div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
  const cpRows = [...document.querySelectorAll('.cp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  const row = (li) => ({
    name: li.querySelector('.row__name span').textContent,
    score: parseFloat(li.querySelector('.meter strong').textContent.replace(/[’'\\s%]/g, '').replace(',', '.')),
    dps: parseFloat(li.querySelector('.row__numbers span:first-child strong').textContent.replace(/[’']/g, '')),
    shadow: !!li.querySelector('.row__name .badge--shadow'),
    mega: !!li.querySelector('.row__name .badge--mega, .row__name .badge--primal'),
    elite: !!li.querySelector('.badge--elite'),
  });
  return {
    visible: !document.getElementById('view-detail').hidden,
    title: document.getElementById('detail-title')?.textContent,
    back: document.getElementById('back')?.textContent,
    label: document.querySelector('.boss__label')?.textContent,
    facts,
    cpRows,
    bossHp: (/Als Raid-Boss: ([\\d’']+) KP/.exec(document.querySelector('#tab-panel')?.textContent ?? '') ?? [])[1],
    tab: document.querySelector('.tabs__btn[aria-selected="true"]')?.id,
    team: [...document.querySelectorAll('#team-members .member')].map((m) => ({
      name: m.querySelector('.member__name span').textContent,
      mega: !!m.querySelector('.badge--mega, .badge--primal'),
    })),
    verdict: document.getElementById('team-verdict')?.textContent ?? '',
    verdictStrong: document.querySelector('#team-verdict strong')?.textContent ?? '',
    randomMoves: document.querySelectorAll('#counter-list .type-random, #team-members .type-random, #mega-list .type-random').length,
    rows: [...document.querySelectorAll('#counter-list > li')].map(row),
    megas: [...document.querySelectorAll('#mega-list > li')].map(row),
    countText: document.getElementById('counters-count')?.textContent,
    byType: document.querySelectorAll('.type-card').length,
    more: !!document.getElementById('more'),
    moreOpen: !!document.getElementById('more-settings')?.open,
    reset: !!document.getElementById('reset'),
    megaToggle: !!document.getElementById('toggle-mega'),
    cryptoHint: document.querySelector('.crypto-switch small')?.textContent,
    level: document.querySelector('input[name=level]:checked')?.value,
    weather: document.getElementById('weather')?.value,
    toggles: Object.fromEntries([...document.querySelectorAll('#counter-controls input[type=checkbox]')].map((i) => [i.id, i.checked])),
    pressed: [...document.querySelectorAll('.move-btn[aria-pressed="true"]')].map((b) => b.dataset.kind + ':' + b.dataset.move),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    title2: document.title,
  };
})()`);

// Alle Bilder in einem Bereich laden und kaputte melden.
const brokenImages = (page, selector) => page.eval(`(async () => {
  const imgs = [...document.querySelectorAll(${JSON.stringify(selector)})];
  for (const img of imgs) { img.loading = 'eager'; }
  await Promise.all(imgs.map((img) => img.decode().catch(() => null)));
  return imgs.filter((img) => !img.naturalWidth).map((img) => img.getAttribute('src'));
})()`);

// ---------- Startseite und Raid-Arten ----------

async function testStart(page, vp) {
  const tag = `[${vp.label} · Startseite]`;
  console.log(`${tag} läuft …`);
  const unknown = DATA.bosses.filter((b) => !GROUP_OF[b.category]);
  check(unknown.length === 0, `${tag} Bosse ohne Raid-Art (nicht erreichbar): ${unknown.map((b) => b.key).join(', ')}`);
  await page.goto(url('index.html'));
  let s = await startState(page);
  const groups = Object.keys(GROUP_HEADINGS).filter((g) => bossesOf(g).length);
  check(s.visible && JSON.stringify(s.cards.map((c) => c.id)) === JSON.stringify(groups), `${tag} Raid-Arten ${s.cards.map((c) => c.id).join(', ')} statt ${groups.join(', ')}`);
  for (const c of s.cards) {
    check(c.count === bossesOf(c.id).length, `${tag} Kachel ${c.id} zählt ${c.count} statt ${bossesOf(c.id).length} Bosse`);
    check(c.images === Math.min(3, c.count), `${tag} Kachel ${c.id} zeigt ${c.images} Vorschaubilder`);
  }
  check(s.cards.reduce((n, c) => n + c.count, 0) === DATA.bosses.length, `${tag} Kacheln zählen nicht alle ${DATA.bosses.length} Bosse`);
  check(s.cardsVisible && !s.searchVisible, `${tag} Startseite zeigt Suchergebnisse statt Raid-Arten`);
  check(s.meta.startsWith(`${DATA.bosses.length} Raid-Bosse`), `${tag} Kopfzeile "${s.meta}"`);
  check(!s.soonOpen, `${tag} "Demnächst im Raid" ist schon aufgeklappt`);
  check(!s.overflow, `${tag} Seite ist breiter als der Bildschirm`);
  check(await page.eval(`document.querySelectorAll('#sources a').length === Object.values(window.RAID_DATA.sources).filter((x) => x && x.url).length`),
    `${tag} Fußzeile verlinkt nicht jede Quelle aus den Daten`);
  const broken = await brokenImages(page, '#view-start img');
  check(broken.length === 0, `${tag} Bilder laden nicht: ${broken.slice(0, 5).join(', ')}`);

  // Jede Raid-Art öffnen: genau ihre Bosse, und zurück mit Fokus auf ihrer Kachel.
  for (const g of groups) {
    const ctag = `${tag} Raid-Art ${g}:`;
    await page.click(`#category-grid .category-card[data-category="${g}"]`);
    const c = await categoryState(page);
    const expected = bossesOf(g);
    check(c.visible && c.title === GROUP_HEADINGS[g], `${ctag} Überschrift "${c.title}"`);
    check(c.tiles.length === expected.length && c.tiles.every((k) => expected.includes(k)), `${ctag} ${c.tiles.length} Kacheln statt ${expected.length} (fremd: ${c.tiles.filter((k) => !expected.includes(k)).join(', ')})`);
    check(c.count.startsWith(`${expected.length} Bosse`), `${ctag} Text "${c.count}"`);
    check(c.focused === 'category-title' && c.docTitle.startsWith(GROUP_HEADINGS[g]), `${ctag} Fokus ${c.focused}, Fenstertitel "${c.docTitle}"`);
    check(!c.overflow, `${ctag} Seite ist breiter als der Bildschirm`);
    if (vp.every === 1) {
      const b = await brokenImages(page, '#view-category img');
      check(b.length === 0, `${ctag} Bilder laden nicht: ${b.slice(0, 5).join(', ')}`);
    }
    await page.click('#category-back');
    await sleep(150);
    s = await startState(page);
    const focused = await page.eval(`document.activeElement?.dataset?.category`);
    check(s.visible && focused === g, `${ctag} Zurück: Startseite ${s.visible ? 'sichtbar' : 'fehlt'}, Fokus auf ${focused}`);
  }

  // Suche über alle Raid-Arten: deutsch, ohne Akzente, und leeren.
  await page.type('#search', 'xerneas');
  s = await startState(page);
  check(JSON.stringify(s.hits) === '["xerneas"]' && s.clearVisible && !s.cardsVisible && s.searchVisible, `${tag} Suche "xerneas" zeigt ${s.hits.join(', ')}`);
  await page.type('#search', 'mewtu');
  s = await startState(page);
  check(s.hits.length >= 3 && s.hits.every((k) => k.includes('mewtwo')), `${tag} Suche "mewtu" zeigt ${s.hits.join(', ')}`);
  await page.type('#search', 'ho-oh');
  s = await startState(page);
  check(s.hits.includes('ho-oh') && s.hits.includes('crypto-ho-oh'), `${tag} Suche "ho-oh" zeigt ${s.hits.join(', ')}`);
  await page.type('#search', 'qqqq');
  s = await startState(page);
  check(s.hits.length === 0 && s.searchCount.startsWith('Kein Raid-Boss'), `${tag} Suche ohne Treffer: "${s.searchCount}"`);
  await page.click('#search-clear');
  s = await startState(page);
  check(s.cardsVisible && !s.searchVisible && !s.clearVisible, `${tag} Suche leeren zeigt nicht wieder die Raid-Arten`);

  // Aus der Suche zum Boss und zurück: Suche bleibt, Fokus auf dem Treffer.
  await page.type('#search', 'kyogre');
  await page.click('#search-grid a[data-boss="kyogre-primal"]');
  let d = await detailState(page);
  check(d.title === 'Proto-Kyogre' && d.back === '← Startseite', `${tag} Treffer Proto-Kyogre: "${d.title}", Zurück-Link "${d.back}"`);
  await page.click('#back');
  await sleep(150);
  s = await startState(page);
  const focused = await page.eval(`document.activeElement?.closest('ul')?.id + ':' + document.activeElement?.dataset?.boss`);
  check(s.visible && s.searchVisible && s.hits.includes('kyogre-primal') && focused === 'search-grid:kyogre-primal',
    `${tag} Zurück aus der Suche: Suche ${s.searchVisible ? 'da' : 'weg'}, Fokus ${focused}`);
  await page.click('#search-clear');
}

// ---------- Raid-Kalender mit fest eingestelltem Datum ----------

const pad2 = (n) => String(n).padStart(2, '0');
function slotsAt(when) {
  const now = [];
  const soon = [];
  const t = (text) => {
    const [d, time] = text.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return Date.UTC(y, m - 1, day, h, min); // Vergleich als Ortszeit: beide Seiten ohne Zeitzone
  };
  const [d, time] = when.split('T');
  const nowT = t(`${d}T${time}`);
  for (const boss of DATA.bosses) {
    let active = false;
    let next = null;
    for (const s of boss.schedule) {
      if (t(s.start) <= nowT && (!s.end || nowT <= t(s.end))) active = true;
      else if (t(s.start) > nowT && (!next || t(s.start) < t(next.start))) next = s;
    }
    if (active) now.push(boss.key);
    else if (next) soon.push({ key: boss.key, start: next.start });
  }
  return { now, soon };
}

async function testSchedule(page, vp) {
  const tag = `[${vp.label} · Raid-Kalender]`;
  console.log(`${tag} läuft …`);
  const starts = [...new Set(DATA.bosses.flatMap((b) => b.schedule.map((s) => s.start)))].sort();
  check(starts.length > 0, `${tag} Raid-Kalender in den Daten ist leer`);
  if (!starts.length) return;
  // Eine Minute vor und eine Minute nach dem ersten und dem letzten Wechsel.
  const minuteShift = (text, delta) => {
    const [d, time] = text.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    const x = new Date(Date.UTC(y, m - 1, day, h, min + delta));
    return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}T${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}`;
  };
  for (const when of [minuteShift(starts[0], -1), minuteShift(starts[0], 1), minuteShift(starts.at(-1), -1), minuteShift(starts.at(-1), 1)]) {
    const [day, time] = when.split('T');
    await page.setToday(day, time);
    await page.goto(url('index.html'));
    const s = await startState(page);
    const expected = slotsAt(when);
    check(JSON.stringify([...s.now].sort()) === JSON.stringify([...expected.now].sort()),
      `${tag} ${when}: "Jetzt im Raid" zeigt ${s.now.join(', ')}, erwartet ${expected.now.join(', ')}`);
    check(JSON.stringify(s.soon.map((x) => x.key).sort()) === JSON.stringify(expected.soon.map((x) => x.key).sort()),
      `${tag} ${when}: "Demnächst" zeigt ${s.soon.map((x) => x.key).join(', ')}, erwartet ${expected.soon.map((x) => x.key).join(', ')}`);
    check(!expected.soon.length || s.soonCount === `(${expected.soon.length})`, `${tag} ${when}: "Demnächst" zählt ${s.soonCount}`);
    check(s.scheduleVisible === Boolean(expected.now.length || expected.soon.length), `${tag} ${when}: Kalender-Bereich falsch ein-/ausgeblendet`);
    // Die Kacheln der Raid-Arten zählen, wie viele ihrer Bosse gerade im Raid sind.
    for (const c of s.cards) {
      const n = expected.now.filter((k) => GROUP_OF[DATA.bosses.find((b) => b.key === k).category] === c.id).length;
      check(c.now === n, `${tag} ${when}: Kachel ${c.id} zeigt ${c.now} statt ${n} "jetzt im Raid"`);
    }
    // Die Marke nennt genau den Starttag: "Ab 7. Oktober" (mit Jahr nur in einem anderen Jahr).
    const badBadge = s.soon.filter((x) => {
      const start = expected.soon.find((e) => e.key === x.key)?.start;
      if (!start) return true;
      const year = start.slice(0, 4) === day.slice(0, 4) ? '' : ` ${start.slice(0, 4)}`;
      return !new RegExp(`^Ab ${Number(start.slice(8, 10))}\\. \\p{L}+${year}$`, 'u').test(x.badge ?? '');
    });
    check(badBadge.length === 0, `${tag} ${when}: falsche Datums-Marke bei ${badBadge.map((x) => `${x.key} "${x.badge}"`).join(', ')}`);
  }
  // "Demnächst" klappt auf, und ein Boss daraus führt mit "← Startseite" zurück.
  const soonDay = minuteShift(starts.at(-1), -1).split('T');
  await page.setToday(...soonDay);
  await page.goto(url('index.html'));
  const first = (await startState(page)).soon[0]?.key;
  if (first) {
    await page.click('#schedule-soon-wrap > summary');
    check((await startState(page)).soonOpen, `${tag} "Demnächst im Raid" klappt nicht auf`);
    await page.click(`#schedule-soon a[data-boss="${first}"]`);
    const d = await detailState(page);
    check(d.visible && d.back === '← Startseite', `${tag} Boss aus "Demnächst": Zurück-Link "${d.back}"`);
    await page.click('#back');
    await sleep(150);
    const focused = await page.eval(`document.activeElement?.closest('ul')?.id + ':' + document.activeElement?.dataset?.boss`);
    check(focused === `schedule-soon:${first}`, `${tag} Zurück aus "Demnächst": Fokus ${focused}`);
  }
  await page.setToday(null);
}

// ---------- Boss-Seiten ----------

async function checkDetail(page, s, boss, tag, { infos }) {
  check(s.visible && s.title === boss.name, `${tag} Überschrift "${s.title}"`);
  check(s.title2.startsWith(boss.name), `${tag} Fenstertitel "${s.title2}"`);
  check(s.tab === 'tab-konter', `${tag} startet nicht mit dem Reiter Konter (${s.tab})`);
  check(num(s.facts['Boss-WP']) === expectedBossCp(boss), `${tag} Boss-WP ${s.facts['Boss-WP']} statt ${expectedBossCp(boss)}`);
  const normal = expectedCatch(boss, false);
  const boosted = expectedCatch(boss, true);
  check(num(s.facts['Fang-WP 100 %']) === normal.max, `${tag} Fang-WP 100 % ${s.facts['Fang-WP 100 %']} statt ${normal.max}`);
  check(num(s.facts['Mit Wetter 100 %']) === boosted.max, `${tag} Mit Wetter 100 % ${s.facts['Mit Wetter 100 %']} statt ${boosted.max}`);
  check(s.rows.length === 10, `${tag} ${s.rows.length} statt 10 Konter`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} Konter nicht nach Wertung sortiert`);
  // Grundeinstellung: ohne Crypto-Pokémon, Mega-Entwicklungen nur in ihrer eigenen Liste.
  check(s.rows.every((r) => !r.shadow && !r.mega), `${tag} Liste enthält Crypto- oder Mega-Pokémon`);
  check(s.megas.length > 0 && s.megas.length <= 3 && s.megas.every((r) => r.mega), `${tag} ${s.megas.length} Einträge in "Beste Mega-Entwicklung"`);
  check(s.team.length > 0 && s.team.length <= 6, `${tag} Team mit ${s.team.length} Pokémon`);
  check(s.team.filter((m) => m.mega).length <= 1, `${tag} Team mit mehr als einer Mega-Entwicklung`);
  check(s.team.every((m) => !m.name.startsWith('Crypto-')), `${tag} Team mit Crypto-Pokémon, obwohl Crypto aus ist`);
  check(new Set(s.team.map((m) => m.name)).size === s.team.length, `${tag} Team mit doppelter Art: ${s.team.map((m) => m.name).join(', ')}`);
  // Spielerzahl wie auf der Seite, aber unabhängig gerechnet: bestes Team (Level 40, alles an) bis
  // Level 30 ohne Mega und Crypto; Crypto-Raids nie unter 2 Personen.
  const full = RaidCalc.rank(DATA, boss, RANK_ALL);
  const best = RaidCalc.estimateTrainers(DATA, boss, full);
  const casual = RaidCalc.estimateTrainers(DATA, boss, RaidCalc.rank(DATA, boss, { ...RANK_ALL, level: 30 })
    .filter((e) => !e.attacker.shadow && e.attacker.variant === 'normal'));
  const lo = Math.ceil(best.trainers);
  const hi = Math.ceil(casual.trainers);
  const crowd = lo === hi ? (lo <= 1 ? 'allein' : `${lo} Personen`) : `${lo}–${hi} Personen`;
  check(s.facts['Spieler*innen'] === crowd, `${tag} Spieler*innen "${s.facts['Spieler*innen']}" statt "${crowd}"`);
  // Das Urteil unter dem Team gilt für die aktuelle Einstellung (ohne Crypto).
  const current = RaidCalc.estimateTrainers(DATA, boss, full.filter((e) => !e.attacker.shadow));
  if (boss.shadow) check(lo >= 2 && !/allein/.test(s.verdict), `${tag} Crypto-Raid mit weniger als 2 Personen: "${s.verdict}"`);
  else if (current.raw > 1) check(s.verdictStrong.includes(`mindestens ${Math.ceil(current.raw - 1e-9)} Personen`), `${tag} Urteil "${s.verdictStrong}" passt nicht zu ${current.raw.toFixed(2)}`);
  else check(/allein/.test(s.verdictStrong), `${tag} Urteil "${s.verdictStrong}" sollte "allein" nennen (${current.raw.toFixed(2)})`);
  check(s.randomMoves === 0, `${tag} Konter mit Kraftreserve (Zufallstyp) vorgeschlagen`);
  check(!s.overflow, `${tag} Seite ist breiter als der Bildschirm`);

  if (!infos) return;
  // Reiter "Boss-Infos": Fang-WP-Tabelle und KP.
  await page.click('#tab-infos');
  const i = await detailState(page);
  check(i.tab === 'tab-infos' && i.rows.length === 0, `${tag} Reiter Boss-Infos öffnet nicht`);
  check(num(i.bossHp) === DATA.tiers[boss.tier].hp, `${tag} Boss-KP ${i.bossHp} statt ${DATA.tiers[boss.tier].hp}`);
  for (const [n, e] of [normal, boosted].entries()) {
    const row = i.cpRows[n] ?? [];
    check(row[0] === `${e.min.toLocaleString('de-CH')} – ${e.max.toLocaleString('de-CH')}` && num(row[1]) === e.max,
      `${tag} Fang-WP ${n ? 'mit Wetter' : 'normal'}: "${row.join(' | ')}" statt ${e.min}–${e.max}`);
  }
  check(!i.overflow, `${tag} Boss-Infos breiter als der Bildschirm`);
}

async function testDetails(page, vp) {
  const tag = `[${vp.label} · Bosse]`;
  console.log(`${tag} läuft (jeder ${vp.every}. Boss) …`);
  await page.goto(url('index.html'));
  const groups = await page.eval(`[...document.querySelectorAll('#category-grid .category-card')].map((a) => a.dataset.category)`);
  let n = 0;
  for (const g of groups) {
    await page.click(`#category-grid .category-card[data-category="${g}"]`);
    const keys = (await categoryState(page)).tiles;
    for (const key of keys) {
      if (n++ % vp.every !== 0) continue;
      const boss = DATA.bosses.find((b) => b.key === key);
      await page.click(`#category-grid-list a[data-boss="${key}"]`);
      const s = await detailState(page);
      check(s.back === `← ${GROUP_HEADINGS[g]}`, `${tag} ${key}: Zurück-Link "${s.back}"`);
      // Auf dem Desktop jeden Boss auch im Reiter Boss-Infos prüfen, sonst jeden dritten.
      await checkDetail(page, s, boss, `${tag} ${key}:`, { infos: vp.every === 1 || n % 3 === 1 });
      // Die angezeigten Konter stimmen mit einer unabhängigen Rechnung in Node überein.
      if (n % (vp.every * 10) === 1) {
        const full = RaidCalc.rank(DATA, boss, RANK_ALL);
        const expected = full.filter((e) => !e.attacker.shadow && !isMegaAttacker(e.attacker)).slice(0, 5).map((e) => nameOf(e.attacker));
        check(JSON.stringify(s.rows.slice(0, 5).map((r) => r.name)) === JSON.stringify(expected),
          `${tag} ${key}: Top 5 auf der Seite (${s.rows.slice(0, 5).map((r) => r.name).join(', ')}) ≠ Rechnung (${expected.join(', ')})`);
        const megas = full.filter((e) => isMegaAttacker(e.attacker)).slice(0, 3).map((e) => nameOf(e.attacker));
        check(JSON.stringify(s.megas.map((r) => r.name)) === JSON.stringify(megas),
          `${tag} ${key}: Megas auf der Seite (${s.megas.map((r) => r.name).join(', ')}) ≠ Rechnung (${megas.join(', ')})`);
      }
      await page.click('#back');
      await sleep(150);
      const c = await categoryState(page);
      check(c.visible && c.title === GROUP_HEADINGS[g], `${tag} ${key}: Zurück führt nicht zur Raid-Art ${g}`);
      const focused = await page.eval(`document.activeElement?.dataset?.boss`);
      check(focused === key, `${tag} ${key}: nach Zurück hat ${focused} den Fokus statt der Kachel`);
    }
    await page.click('#category-back');
    await sleep(150);
  }
  check(n === DATA.bosses.length, `${tag} über die Raid-Arten erreichbar: ${n} von ${DATA.bosses.length} Bossen`);
}

// ---------- Einstellungen der Konter ----------

async function testFilters(page, vp) {
  const tag = `[${vp.label} · Einstellungen]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html', '#boss=xerneas'));
  let s = await detailState(page);
  check(s.visible && s.title === 'Xerneas', `${tag} Direktlink #boss=xerneas öffnet "${s.title}"`);
  check(s.level === '40' && s.weather === '' && !s.reset && !s.moreOpen && s.tab === 'tab-konter', `${tag} Grundeinstellung falsch`);
  check(s.toggles['toggle-shadow'] === false && s.toggles['toggle-legendary'] && s.toggles['toggle-elite'], `${tag} Schalter-Grundeinstellung ${JSON.stringify(s.toggles)}`);
  check(!s.megaToggle && s.countText.includes('ohne Crypto'), `${tag} Mega-Schalter vorhanden oder Zeile "${s.countText}"`);
  check(s.cryptoHint?.startsWith('aus'), `${tag} Crypto-Hinweis "${s.cryptoHint}"`);
  const top40 = s.rows[0];

  // Crypto an: Crypto-Pokémon erscheinen, der Hinweis wechselt, der Fokus bleibt auf dem Schalter.
  await page.click('label.toggle:has(#toggle-shadow)');
  s = await detailState(page);
  check(s.toggles['toggle-shadow'] && s.rows.some((r) => r.shadow) && s.reset && s.countText.includes('mit Crypto') && s.cryptoHint?.startsWith('an'),
    `${tag} Crypto an: keine Crypto-Pokémon oder Anzeige falsch ("${s.countText}", "${s.cryptoHint}")`);
  check(isSortedDesc(s.rows.map((r) => r.score)) && s.rows.every((r) => !r.mega), `${tag} Crypto an: Liste unsortiert oder mit Mega`);
  check(await page.eval(`document.activeElement?.id === 'toggle-shadow'`), `${tag} Fokus bleibt nicht auf dem Crypto-Schalter`);
  const expectedShadow = RaidCalc.rank(DATA, DATA.bosses.find((b) => b.key === 'xerneas'), RANK_ALL)
    .filter((e) => !isMegaAttacker(e.attacker)).slice(0, 5).map((e) => nameOf(e.attacker));
  check(JSON.stringify(s.rows.slice(0, 5).map((r) => r.name)) === JSON.stringify(expectedShadow), `${tag} Crypto an: Top 5 ${s.rows.slice(0, 5).map((r) => r.name).join(', ')} ≠ ${expectedShadow.join(', ')}`);
  await page.click('label.toggle:has(#toggle-shadow)');
  s = await detailState(page);
  check(!s.toggles['toggle-shadow'] && s.rows.every((r) => !r.shadow) && s.team.every((m) => !m.name.startsWith('Crypto-')) && !s.reset,
    `${tag} Crypto wieder aus: trotzdem Crypto-Pokémon`);

  // Mehr Einstellungen: Legendäre und Elite aus.
  await page.click('#more-settings > summary');
  s = await detailState(page);
  check(s.moreOpen, `${tag} "Mehr Einstellungen" klappt nicht auf`);
  await page.click('label.toggle:has(#toggle-legendary)');
  s = await detailState(page);
  const legendNames = new Set(DATA.pokemon.filter((p) => p.class).map((p) => p.name));
  check(s.moreOpen && s.rows.every((r) => !legendNames.has(r.name)), `${tag} Legendäre aus: trotzdem ${s.rows.filter((r) => legendNames.has(r.name)).map((r) => r.name).join(', ')}`);
  await page.click('label.toggle:has(#toggle-elite)');
  s = await detailState(page);
  check(s.rows.every((r) => !r.elite), `${tag} Elite aus: trotzdem Elite-TM-Attacken`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} mit allen Filtern aus nicht sortiert`);

  // Zurücksetzen
  await page.click('#reset');
  s = await detailState(page);
  check(!s.toggles['toggle-shadow'] && s.toggles['toggle-legendary'] && s.toggles['toggle-elite'] && !s.reset && s.rows[0].name === top40.name,
    `${tag} Zurücksetzen stellt nicht alles her`);

  // Level 50: mehr DPS für denselben Spitzenreiter; Level 30: weniger.
  await page.click('input[name=level][value="50"]');
  s = await detailState(page);
  const at50 = s.rows.find((r) => r.name === top40.name);
  check(s.level === '50' && at50 && at50.dps > top40.dps, `${tag} Level 50: DPS von ${top40.name} steigt nicht (${top40.dps} → ${at50?.dps})`);
  check(s.countText.includes('Level 50'), `${tag} Level 50 nicht in der Zeile "${s.countText}"`);
  await page.click('input[name=level][value="30"]');
  s = await detailState(page);
  const at30 = s.rows.find((r) => r.name === top40.name);
  check(!at30 || at30.dps < top40.dps, `${tag} Level 30: DPS sinkt nicht`);
  await page.click('input[name=level][value="40"]');

  // Wetter: Bedeckt stärkt Gift (sehr effektiv gegen Xerneas).
  await page.eval(`(() => { const s = document.getElementById('weather'); s.value = 'OVERCAST'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  s = await detailState(page);
  check(s.weather === 'OVERCAST' && s.countText.includes('Bedeckt'), `${tag} Wetter Bedeckt nicht übernommen ("${s.countText}")`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} mit Wetter nicht sortiert`);
  await page.click('#reset');

  // Boss-Attacken wählen und wieder auf "Alle".
  const fastId = await page.eval(`document.querySelector('.move-btn[data-kind="bossFast"]:not([data-move=""])').dataset.move`);
  await page.click(`.move-btn[data-kind="bossFast"][data-move="${fastId}"]`);
  s = await detailState(page);
  check(s.pressed.includes(`bossFast:${fastId}`) && s.pressed.includes('bossCharged:') && s.reset, `${tag} Boss-Sofort-Attacke nicht gewählt (${s.pressed.join(', ')})`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} mit Boss-Attacke nicht sortiert`);
  check(await page.eval(`document.activeElement?.dataset?.move === ${JSON.stringify(fastId)}`), `${tag} Fokus bleibt nicht auf der gewählten Attacke`);
  await page.click('.move-btn[data-kind="bossFast"][data-move=""]');
  s = await detailState(page);
  check(s.pressed.includes('bossFast:'), `${tag} "Alle" lässt sich nicht wieder wählen`);

  // Weitere anzeigen: je 10 mehr, höchstens 50.
  check(s.more, `${tag} Knopf "Weitere anzeigen" fehlt`);
  await page.click('#more');
  s = await detailState(page);
  check(s.rows.length === 20 && isSortedDesc(s.rows.map((r) => r.score)), `${tag} nach "Weitere" ${s.rows.length} statt 20 Zeilen`);
  check(await page.eval(`document.activeElement === document.querySelector('#counter-list > li:nth-child(11)')`),
    `${tag} nach "Weitere" steht der Fokus nicht auf der ersten neuen Zeile`);
  for (let i = 0; i < 10 && s.more; i++) {
    await page.click('#more');
    s = await detailState(page);
  }
  check(s.rows.length === 50 && !s.more, `${tag} Liste endet bei ${s.rows.length} statt 50 Zeilen`);

  // Die Besten je Typ: aufklappbar.
  check(s.byType > 0, `${tag} "Die Besten je Typ" fehlt`);
  await page.click('#by-type > summary');
  check(await page.eval(`document.getElementById('by-type').open && document.querySelector('.type-card').getClientRects().length > 0`), `${tag} "Die Besten je Typ" klappt nicht auf`);

  // Reiter per Tastatur: Pfeiltasten wechseln, der Fokus folgt.
  await page.click('#tab-infos');
  s = await detailState(page);
  check(s.tab === 'tab-infos' && s.cpRows.length === 2 && !s.rows.length, `${tag} Reiter Boss-Infos zeigt ${s.cpRows.length} Fang-Zeilen`);
  await page.key('ArrowLeft');
  s = await detailState(page);
  check(s.tab === 'tab-konter' && s.rows.length > 0 && (await page.eval(`document.activeElement?.id`)) === 'tab-konter', `${tag} Pfeil links wechselt nicht zu Konter`);
  await page.key('End');
  s = await detailState(page);
  check(s.tab === 'tab-infos', `${tag} Ende wechselt nicht zu Boss-Infos`);
  await page.click('#tab-konter');

  // Boss wechseln per Adresse: Einstellungen bleiben, Boss-Attacken nicht, Reiter Konter.
  await page.click('label.toggle:has(#toggle-shadow)');
  await page.click('#tab-infos');
  await page.eval(`location.hash = 'boss=mewtwo'`);
  await sleep(300);
  s = await detailState(page);
  check(s.title === 'Mewtu' && s.toggles['toggle-shadow'] === true && s.pressed.every((p) => p.endsWith(':')) && s.tab === 'tab-konter',
    `${tag} Wechsel zu Mewtu: Titel "${s.title}", Einstellungen oder Reiter falsch`);

  // Ungültige Adressen: Startseite.
  for (const hash of ['#boss=gibtsnicht', '#kategorie=gibtsnicht']) {
    await page.goto(url('index.html', hash));
    check((await startState(page)).visible, `${tag} ${hash} zeigt nicht die Startseite`);
  }
  // Direktlink zu einer Raid-Art.
  await page.goto(url('index.html', '#kategorie=mega'));
  const c = await categoryState(page);
  check(c.visible && c.title === 'Mega-Raid-Bosse' && c.tiles.length === bossesOf('mega').length, `${tag} #kategorie=mega öffnet "${c.title}"`);

  // Direktlink zum Boss, dann die Zurück-Links: Boss -> Raid-Art -> Startseite.
  await page.goto(url('index.html', '#boss=xerneas'));
  await page.click('#back');
  await sleep(150);
  check((await categoryState(page)).title === 'Legendäre Raid-Bosse', `${tag} Zurück vom Direktlink führt nicht zu Legendär`);
  await page.click('#category-back');
  await sleep(150);
  check((await startState(page)).visible, `${tag} "Alle Raid-Arten" führt nicht zur Startseite`);

  // Browser-Zurück: Boss -> Raid-Art -> Startseite.
  await page.goto(url('index.html'));
  await page.click('#category-grid .category-card[data-category="primal"]');
  await page.click('#category-grid-list a[data-boss="kyogre-primal"]');
  s = await detailState(page);
  check(s.title === 'Proto-Kyogre' && s.back === '← Proto-Raid-Bosse', `${tag} Kachel Proto-Kyogre öffnet "${s.title}" (Zurück-Link "${s.back}")`);
  await page.eval('history.back()');
  await sleep(400);
  check((await categoryState(page)).title === 'Proto-Raid-Bosse', `${tag} Browser-Zurück führt nicht zur Raid-Art`);
  await page.eval('history.back()');
  await sleep(400);
  check((await startState(page)).visible, `${tag} zweites Browser-Zurück führt nicht zur Startseite`);
  await page.eval('history.forward()');
  await sleep(400);
  check((await categoryState(page)).title === 'Proto-Raid-Bosse', `${tag} Browser-Vor führt nicht zur Raid-Art`);
}

async function testLegal(page, vp) {
  const tag = `[${vp.label} · Datenschutz]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html'));
  await page.click('.footer a[href="datenschutz.html"]');
  await sleep(600);
  check((await page.eval(`document.querySelector('h1')?.textContent`)) === 'Datenschutz', `${tag} Link öffnet nicht die Datenschutz-Seite`);
  await page.click('.page-nav__link[href="index.html"]');
  await sleep(600);
  check((await page.eval('location.pathname')).endsWith('index.html'), `${tag} Link zurück klappt nicht`);
}

// ---------- Rechnung ohne Browser ----------

function testCalc() {
  const tag = '[Rechnung]';
  console.log(`${tag} läuft …`);
  for (const boss of DATA.bosses) {
    // Je mehr Schaden der Boss einsteckt, desto mehr Energie hat er: Sein Anteil an Lade-Attacken darf
    // nie sinken und nie über der 50-%-Regel liegen.
    const bossStat = RaidCalc.bossStats(DATA, boss);
    const movesets = RaidCalc.bossMovesets(DATA, boss, {});
    const hits = RaidCalc.bossHits(DATA, boss, bossStat, movesets, { types: ['NORMAL'], def: 150 }, {});
    for (const h of hits) {
      let previous = -1;
      for (let taken = 0; taken <= 300; taken += 5) {
        const p = RaidCalc.chargedShare(DATA, h, taken);
        if (p < previous - 1e-12 || p < 0 || p > DATA.rules.bossChargedChance) {
          check(false, `${tag} ${boss.key}: Lade-Anteil ${p} bei ${taken} Schaden/s (vorher ${previous})`);
          break;
        }
        previous = p;
      }
    }
    // Jede Rangliste liefert nur endliche, sortierte Werte – und nie Kraftreserve (Zufallstyp) für Angreifer.
    const ranking = RaidCalc.rank(DATA, boss, { level: 40, elite: true, weather: null, shadow: true, mega: true, legendary: true });
    check(ranking.length > 100 && ranking.every((e) => [e.dps, e.tdo, e.score].every(Number.isFinite)), `${tag} ${boss.key}: ungültige Werte in der Rangliste`);
    check(isSortedDesc(ranking.map((e) => e.score)), `${tag} ${boss.key}: Rangliste nicht sortiert`);
    check(ranking.every((e) => e.fast.type && e.charged.type), `${tag} ${boss.key}: Angreifer mit Zufallstyp-Attacke`);
  }
}

if (BASE) console.log(`Teste veröffentlichte Seite: ${BASE}`);
testCalc();
for (const vp of VIEWPORTS) {
  const page = await launchBrowser(vp);
  try {
    await testStart(page, vp);
    await testSchedule(page, vp);
    await testDetails(page, vp);
    await testFilters(page, vp);
    await testLegal(page, vp);
  } catch (err) {
    failures.push(`[${vp.label}] Abbruch: ${err.stack ?? err.message}`);
  }
  for (const e of page.errors) failures.push(`[${vp.label}] JavaScript-Fehler: ${e}`);
  await page.close();
}

console.log(`\n${passed} Prüfungen bestanden, ${failures.length} fehlgeschlagen.`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
