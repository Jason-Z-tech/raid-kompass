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

// ---------- Zustand der Seite auslesen ----------

const overviewState = (page) => page.eval(`(() => ({
  visible: !document.getElementById('view-overview').hidden,
  tiles: [...document.querySelectorAll('#boss-grid > li')].filter((li) => !li.hidden).map((li) => li.dataset.boss),
  count: document.getElementById('bosses-count').textContent,
  filter: document.querySelector('input[name=category]:checked')?.value,
  chipCounts: Object.fromEntries([...document.querySelectorAll('#category-options label')].map((l) => [l.querySelector('input').value, Number(l.querySelector('small').textContent)])),
  now: [...document.querySelectorAll('#schedule-now .boss-tile')].map((a) => a.dataset.boss),
  soon: [...document.querySelectorAll('#schedule-soon .boss-tile')].map((a) => ({ key: a.dataset.boss, badge: a.querySelector('.badge--soon')?.textContent })),
  empty: !document.getElementById('boss-empty').hidden,
  clearVisible: !document.getElementById('search-clear').hidden,
  meta: document.getElementById('data-meta').textContent,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
}))()`);

const detailState = (page) => page.eval(`(() => {
  const facts = Object.fromEntries([...document.querySelectorAll('.facts--boss div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
  const cpRows = [...document.querySelectorAll('.cp-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  return {
    visible: !document.getElementById('view-detail').hidden,
    title: document.getElementById('detail-title')?.textContent,
    label: document.querySelector('.boss__label')?.textContent,
    facts,
    cpRows,
    team: [...document.querySelectorAll('#team-members .member')].map((m) => ({
      name: m.querySelector('.member__name span').textContent,
      mega: !!m.querySelector('.badge--mega, .badge--primal'),
    })),
    verdict: document.getElementById('team-verdict')?.textContent ?? '',
    verdictStrong: document.querySelector('#team-verdict strong')?.textContent ?? '',
    randomMoves: document.querySelectorAll('#counter-list .type-random, #team-members .type-random').length,
    rows: [...document.querySelectorAll('#counter-list > li')].map((li) => ({
      name: li.querySelector('.row__name span').textContent,
      score: parseFloat(li.querySelector('.meter strong').textContent.replace(/[’'\\s%]/g, '').replace(',', '.')),
      dps: parseFloat(li.querySelector('.row__numbers span:first-child strong').textContent.replace(/[’']/g, '')),
      shadow: !!li.querySelector('.row__name .badge--shadow'),
      mega: !!li.querySelector('.row__name .badge--mega, .row__name .badge--primal'),
      elite: !!li.querySelector('.badge--elite'),
    })),
    countText: document.getElementById('counters-count')?.textContent,
    byType: document.querySelectorAll('.type-card').length,
    more: !!document.getElementById('more'),
    reset: !!document.getElementById('reset'),
    level: document.querySelector('input[name=level]:checked')?.value,
    weather: document.getElementById('weather')?.value,
    toggles: Object.fromEntries([...document.querySelectorAll('.counter-controls__toggles input')].map((i) => [i.id, i.checked])),
    pressed: [...document.querySelectorAll('.move-btn[aria-pressed="true"]')].map((b) => b.dataset.kind + ':' + b.dataset.move),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    title2: document.title,
  };
})()`);

// ---------- Übersicht ----------

async function testOverview(page, vp) {
  const tag = `[${vp.label} · Übersicht]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html'));
  let s = await overviewState(page);
  check(s.visible && s.tiles.length === DATA.bosses.length, `${tag} ${s.tiles.length} Kacheln statt ${DATA.bosses.length}`);
  check(s.meta.startsWith(`${DATA.bosses.length} Raid-Bosse`), `${tag} Kopfzeile "${s.meta}"`);
  check(!s.overflow, `${tag} Seite ist breiter als der Bildschirm`);
  check(await page.eval(`document.querySelectorAll('#sources a').length === Object.values(window.RAID_DATA.sources).filter((x) => x && x.url).length`),
    `${tag} Fußzeile verlinkt nicht jede Quelle aus den Daten`);

  // Jede Raid-Art einmal: Zähler am Chip = Zahl der Kacheln = Text über der Liste.
  for (const filter of Object.keys(s.chipCounts)) {
    await page.click(`#category-options input[value="${filter}"]`);
    s = await overviewState(page);
    check(s.filter === filter && s.tiles.length === s.chipCounts[filter] && s.count === `${s.tiles.length} von ${DATA.bosses.length} Bossen`,
      `${tag} Raid-Art ${filter}: ${s.tiles.length} Kacheln, Chip zeigt ${s.chipCounts[filter]}, Text "${s.count}"`);
    const wrong = s.tiles.filter((key) => {
      const cat = DATA.bosses.find((b) => b.key === key).category;
      return filter !== 'all' && cat !== filter && !(filter === 'mega' && cat === 'megaLegendary');
    });
    check(wrong.length === 0, `${tag} Raid-Art ${filter} zeigt fremde Bosse: ${wrong.join(', ')}`);
  }
  check(s.chipCounts.all === DATA.bosses.length, `${tag} Chip "Alle" zählt ${s.chipCounts.all}`);
  await page.click('#category-options input[value="all"]');

  // Suche: deutsch, ohne Akzente, und leeren.
  await page.type('#search', 'xerneas');
  s = await overviewState(page);
  check(s.tiles.length === 1 && s.tiles[0] === 'xerneas' && s.clearVisible, `${tag} Suche "xerneas" zeigt ${s.tiles.join(', ')}`);
  await page.type('#search', 'mewtu');
  s = await overviewState(page);
  check(s.tiles.length >= 3 && s.tiles.every((k) => k.includes('mewtwo')), `${tag} Suche "mewtu" zeigt ${s.tiles.join(', ')}`);
  await page.type('#search', 'qqqq');
  s = await overviewState(page);
  check(s.tiles.length === 0 && s.empty, `${tag} Suche ohne Treffer zeigt keinen Hinweis`);
  await page.click('#search-clear');
  s = await overviewState(page);
  check(s.tiles.length === DATA.bosses.length && !s.clearVisible && !s.empty, `${tag} Suche leeren stellt nicht alle Kacheln her`);

  // Suche + Raid-Art kombiniert
  await page.click('#category-options input[value="shadow"]');
  await page.type('#search', 'ho-oh');
  s = await overviewState(page);
  check(s.tiles.length === 1 && s.tiles[0] === 'crypto-ho-oh', `${tag} Crypto + "ho-oh" zeigt ${s.tiles.join(', ')}`);
  await page.click('#search-clear');
  await page.click('#category-options input[value="all"]');

  // Bilder: alle sichtbaren Kachelbilder sind geladen (keine kaputten Bilder).
  const broken = await page.eval(`(async () => {
    const imgs = [...document.querySelectorAll('#view-overview img')];
    for (const img of imgs) { img.loading = 'eager'; }
    await Promise.all(imgs.map((img) => img.decode().catch(() => null)));
    return imgs.filter((img) => !img.naturalWidth).map((img) => img.getAttribute('src'));
  })()`);
  check(broken.length === 0, `${tag} Bilder laden nicht: ${broken.slice(0, 5).join(', ')}`);
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
    const s = await overviewState(page);
    const expected = slotsAt(when);
    check(JSON.stringify([...s.now].sort()) === JSON.stringify([...expected.now].sort()),
      `${tag} ${when}: "Jetzt im Raid" zeigt ${s.now.join(', ')}, erwartet ${expected.now.join(', ')}`);
    check(JSON.stringify(s.soon.map((x) => x.key).sort()) === JSON.stringify(expected.soon.map((x) => x.key).sort()),
      `${tag} ${when}: "Demnächst" zeigt ${s.soon.map((x) => x.key).join(', ')}, erwartet ${expected.soon.map((x) => x.key).join(', ')}`);
    // Die Marke nennt genau den Starttag: "Ab 7. Oktober" (mit Jahr nur in einem anderen Jahr).
    const badBadge = s.soon.filter((x) => {
      const start = expected.soon.find((e) => e.key === x.key)?.start;
      if (!start) return true;
      const year = start.slice(0, 4) === day.slice(0, 4) ? '' : ` ${start.slice(0, 4)}`;
      return !new RegExp(`^Ab ${Number(start.slice(8, 10))}\\. \\p{L}+${year}$`, 'u').test(x.badge ?? '');
    });
    check(badBadge.length === 0, `${tag} ${when}: falsche Datums-Marke bei ${badBadge.map((x) => `${x.key} "${x.badge}"`).join(', ')}`);
  }
  await page.setToday(null);
}

// ---------- Detailansicht ----------

function checkDetail(s, boss, tag) {
  check(s.visible && s.title === boss.name, `${tag} Überschrift "${s.title}"`);
  check(s.title2.startsWith(boss.name), `${tag} Fenstertitel "${s.title2}"`);
  check(num(s.facts['Boss-WP']) === expectedBossCp(boss), `${tag} Boss-WP ${s.facts['Boss-WP']} statt ${expectedBossCp(boss)}`);
  check(num(s.facts['Boss-KP']) === DATA.tiers[boss.tier].hp, `${tag} Boss-KP ${s.facts['Boss-KP']}`);
  for (const [i, boosted] of [[0, false], [1, true]]) {
    const e = expectedCatch(boss, boosted);
    const row = s.cpRows[i] ?? [];
    check(row[0] === `${e.min.toLocaleString('de-CH')} – ${e.max.toLocaleString('de-CH')}` && num(row[1]) === e.max,
      `${tag} Fang-WP ${boosted ? 'mit Wetter' : 'normal'}: "${row.join(' | ')}" statt ${e.min}–${e.max}`);
  }
  check(s.rows.length === Math.min(20, s.rows.length) && s.rows.length > 0, `${tag} ${s.rows.length} Konter`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} Konter nicht nach Wertung sortiert`);
  check(s.team.length > 0 && s.team.length <= 6, `${tag} Team mit ${s.team.length} Pokémon`);
  check(s.team.filter((m) => m.mega).length <= 1, `${tag} Team mit mehr als einer Mega-Entwicklung`);
  check(new Set(s.team.map((m) => m.name.replace(/^Crypto-/, ''))).size === s.team.length, `${tag} Team mit doppelter Art: ${s.team.map((m) => m.name).join(', ')}`);
  // Spielerzahl wie auf der Seite, aber unabhängig gerechnet: bestes Team (Level 40, alles an) bis
  // Level 30 ohne Mega und Crypto; Crypto-Raids nie unter 2 Personen.
  const opts = { level: 40, elite: true, weather: null, shadow: true, mega: true, legendary: true };
  const best = RaidCalc.estimateTrainers(DATA, boss, RaidCalc.rank(DATA, boss, opts));
  const casual = RaidCalc.estimateTrainers(DATA, boss, RaidCalc.rank(DATA, boss, { ...opts, level: 30 })
    .filter((e) => !e.attacker.shadow && e.attacker.variant === 'normal'));
  const lo = Math.ceil(best.trainers);
  const hi = Math.ceil(casual.trainers);
  const crowd = lo === hi ? (lo <= 1 ? 'allein' : `${lo} Personen`) : `${lo}–${hi} Personen`;
  check(s.facts['Spieler*innen'] === crowd, `${tag} Spieler*innen "${s.facts['Spieler*innen']}" statt "${crowd}"`);
  if (boss.shadow) check(lo >= 2 && !/allein/.test(s.verdict), `${tag} Crypto-Raid mit weniger als 2 Personen: "${s.verdict}"`);
  else if (best.raw > 1) check(s.verdictStrong.includes(`mindestens ${Math.ceil(best.raw - 1e-9)} Personen`), `${tag} Urteil "${s.verdictStrong}" passt nicht zu ${best.raw.toFixed(2)}`);
  else check(/allein/.test(s.verdictStrong), `${tag} Urteil "${s.verdictStrong}" sollte "allein" nennen (${best.raw.toFixed(2)})`);
  check(s.randomMoves === 0, `${tag} Konter mit Kraftreserve (Zufallstyp) vorgeschlagen`);
  check(!s.overflow, `${tag} Seite ist breiter als der Bildschirm`);
}

async function testDetails(page, vp) {
  const tag = `[${vp.label} · Bosse]`;
  console.log(`${tag} läuft (jeder ${vp.every}. Boss) …`);
  await page.goto(url('index.html'));
  const keys = await page.eval(`[...document.querySelectorAll('#boss-grid > li')].map((li) => li.dataset.boss)`);
  for (const [i, key] of keys.entries()) {
    if (i % vp.every !== 0) continue;
    const boss = DATA.bosses.find((b) => b.key === key);
    await page.click(`#boss-grid a[data-boss="${key}"]`);
    const s = await detailState(page);
    checkDetail(s, boss, `${tag} ${key}:`);
    // Die angezeigten Konter stimmen mit einer unabhängigen Rechnung in Node überein.
    if (i % (vp.every * 10) === 0) {
      const expected = RaidCalc.rank(DATA, boss, { level: 40, elite: true, weather: null, shadow: true, mega: true, legendary: true })
        .slice(0, 5).map((e) => (e.attacker.shadow ? `Crypto-${e.attacker.name}` : e.attacker.name));
      check(JSON.stringify(s.rows.slice(0, 5).map((r) => r.name)) === JSON.stringify(expected),
        `${tag} ${key}: Top 5 auf der Seite (${s.rows.slice(0, 5).map((r) => r.name).join(', ')}) ≠ Rechnung (${expected.join(', ')})`);
    }
    await page.click('#back');
    await sleep(150);
    const o = await overviewState(page);
    check(o.visible, `${tag} ${key}: Zurück führt nicht zur Übersicht`);
    const focused = await page.eval(`document.activeElement?.dataset?.boss`);
    check(focused === key, `${tag} ${key}: nach Zurück hat ${focused} den Fokus statt der Kachel`);
  }
}

// ---------- Filter der Konter ----------

async function testFilters(page, vp) {
  const tag = `[${vp.label} · Filter]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html', '#boss=xerneas'));
  let s = await detailState(page);
  check(s.visible && s.title === 'Xerneas', `${tag} Direktlink #boss=xerneas öffnet "${s.title}"`);
  check(s.level === '40' && s.weather === '' && Object.values(s.toggles).every(Boolean) && !s.reset, `${tag} Grundeinstellung falsch`);
  const top40 = s.rows[0];

  // Crypto aus: keine Crypto-Pokémon mehr in Liste und Team.
  await page.click('label.toggle:has(#toggle-shadow)');
  s = await detailState(page);
  check(!s.toggles['toggle-shadow'] && s.rows.every((r) => !r.shadow) && s.team.every((m) => !m.name.startsWith('Crypto-')) && s.reset,
    `${tag} Crypto aus: trotzdem Crypto-Pokémon`);
  // Mega aus
  await page.click('label.toggle:has(#toggle-mega)');
  s = await detailState(page);
  check(s.rows.every((r) => !r.mega) && s.team.every((m) => !m.mega), `${tag} Mega aus: trotzdem Mega/Proto`);
  // Legendäre aus
  await page.click('label.toggle:has(#toggle-legendary)');
  s = await detailState(page);
  const legendNames = new Set(DATA.pokemon.filter((p) => p.class).map((p) => p.name));
  check(s.rows.every((r) => !legendNames.has(r.name)), `${tag} Legendäre aus: trotzdem ${s.rows.filter((r) => legendNames.has(r.name)).map((r) => r.name).join(', ')}`);
  // Elite aus
  await page.click('label.toggle:has(#toggle-elite)');
  s = await detailState(page);
  check(s.rows.every((r) => !r.elite), `${tag} Elite aus: trotzdem Elite-TM-Attacken`);
  check(isSortedDesc(s.rows.map((r) => r.score)), `${tag} mit allen Filtern aus nicht sortiert`);

  // Zurücksetzen
  await page.click('#reset');
  s = await detailState(page);
  check(Object.values(s.toggles).every(Boolean) && !s.reset && s.rows[0].name === top40.name, `${tag} Zurücksetzen stellt nicht alles her`);

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

  // Wetter: Bedeckt stärkt Gift (sehr effektiv gegen Xerneas) – Gift-Konter steigen.
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

  // Mehr anzeigen
  check(s.more, `${tag} Knopf "Weitere anzeigen" fehlt`);
  await page.click('#more');
  s = await detailState(page);
  check(s.rows.length === 40 && isSortedDesc(s.rows.map((r) => r.score)), `${tag} nach "Weitere" ${s.rows.length} statt 40 Zeilen`);
  check(await page.eval(`document.activeElement === document.querySelector('#counter-list > li:nth-child(21)')`),
    `${tag} nach "Weitere" steht der Fokus nicht auf der ersten neuen Zeile`);
  check(s.byType > 0, `${tag} "Die Besten je Typ" fehlt`);

  // Boss wechseln per Adresse: Filter bleiben, Boss-Attacken nicht.
  await page.click('label.toggle:has(#toggle-mega)');
  await page.eval(`location.hash = 'boss=mewtwo'`);
  await sleep(300);
  s = await detailState(page);
  check(s.title === 'Mewtu' && s.toggles['toggle-mega'] === false && s.pressed.every((p) => p.endsWith(':')), `${tag} Wechsel zu Mewtu: Titel "${s.title}" oder Filter falsch`);

  // Ungültiger Boss in der Adresse: Übersicht.
  await page.goto(url('index.html', '#boss=gibtsnicht'));
  const o = await overviewState(page);
  check(o.visible, `${tag} #boss=gibtsnicht zeigt nicht die Übersicht`);

  // Browser-Zurück aus der Detailansicht
  await page.goto(url('index.html'));
  await page.click('#boss-grid a[data-boss="kyogre-primal"]');
  s = await detailState(page);
  check(s.title === 'Proto-Kyogre', `${tag} Kachel Proto-Kyogre öffnet "${s.title}"`);
  await page.eval('history.back()');
  await sleep(400);
  check((await overviewState(page)).visible, `${tag} Browser-Zurück führt nicht zur Übersicht`);
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
    await testOverview(page, vp);
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
