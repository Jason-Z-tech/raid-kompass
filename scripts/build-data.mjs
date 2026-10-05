// Baut data/raid-data.js aus den Spieldaten (Game Master), den offiziellen deutschen Spieltexten,
// den Release-Angaben von PvPoke, dem Raid-Kalender von Leek Duck (über ScrapedDuck) und den
// Artworks von PokeAPI. Nur Node-Bordmittel (ab Node 18) und Chrome/Edge für die Bilder.
// Aufruf: node scripts/build-data.mjs [--refresh] [--no-images]
//   --refresh    alle Quellen neu herunterladen (sonst Zwischenspeicher in scripts/.cache/)
//   --no-images  Plan B: ohne offizielle Artworks bauen und assets/img/ entfernen

import { mkdir, readFile, writeFile, access, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertToWebp } from './images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
const IMG_RAW_DIR = path.join(CACHE_DIR, 'img');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const OUT_FILE = path.join(ROOT, 'data', 'raid-data.js');
const REFRESH = process.argv.includes('--refresh');
const NO_IMAGES = process.argv.includes('--no-images');

const RAW = 'https://raw.githubusercontent.com';
const SOURCES = {
  gameMaster: `${RAW}/PokeMiners/game_masters/master/latest/latest.json`,
  gameMasterTime: `${RAW}/PokeMiners/game_masters/master/latest/timestamp.txt`,
  pvpoke: `${RAW}/pvpoke/pvpoke/master/src/data/gamemaster.json`,
  textsDe: `${RAW}/sora10pls/holoholo-text/main/Release/German/de-de_raw.json`,
  textsEn: `${RAW}/sora10pls/holoholo-text/main/Release/English/en-us_raw.json`,
  events: `${RAW}/bigfoott/ScrapedDuck/data/events.json`,
  raids: `${RAW}/bigfoott/ScrapedDuck/data/raids.json`,
  pokeapiPokemon: `${RAW}/PokeAPI/pokeapi/master/data/v2/csv/pokemon.csv`,
  artwork: (id) => `${RAW}/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
};

const RaidCalc = createRequire(import.meta.url)(path.join(ROOT, 'js', 'calc.js'));

// ---------- Raid-Regeln ----------
// Quellen: Spieldaten (BATTLE_SETTINGS, WEATHER_BONUS_SETTINGS) und die Raid-Seiten von Pokémon GO Wiki,
// Bulbapedia und GamePress (siehe README, "So wird gerechnet").

// Raid-Stufen. hp = Boss-KP, cpm = CP-Multiplikator des Bosses, timerS = Kampfzeit,
// catchLevel/catchIvFloor = Level und Mindest-IVs des gefangenen Pokémon.
const TIERS = {
  tier5: { label: '5-Sterne-Raid', hp: 15000, cpm: 0.79030001, timerS: 300, catchLevel: 20, catchIvFloor: 10 },
  mega: { label: 'Mega-Raid', hp: 9000, cpm: 0.79030001, timerS: 300, catchLevel: 20, catchIvFloor: 10 },
  megaLegendary: { label: 'Mega-Legendär-Raid', hp: 22500, cpm: 0.79030001, timerS: 300, catchLevel: 20, catchIvFloor: 10 },
  primal: { label: 'Proto-Raid', hp: 22500, cpm: 0.79030001, timerS: 300, catchLevel: 20, catchIvFloor: 10 },
  // Crypto-Bosse machen und nehmen von Anfang an 20 % mehr Schaden; Fang mit Mindest-IVs 6/6/6.
  shadow5: {
    label: '5-Sterne-Crypto-Raid', hp: 15000, cpm: 0.79030001, timerS: 300, catchLevel: 20, catchIvFloor: 6,
    damageDealtMultiplier: 1.2, damageTakenMultiplier: 1.2,
    // 8 Erlöste Edelsteine, höchstens 5 pro Person: allein ist ein Crypto-Raid nicht zu schaffen.
    minTrainers: 2,
  },
};

const RULES = {
  stab: 1.2,
  weatherBoost: 1.2,
  shadowAttack: 1.2,
  shadowDefense: 0.8333333,
  // Boss wartet zwischen zwei Attacken im Schnitt so lange zusätzlich zur Dauer der Attacke.
  bossFastDelayS: 2,
  bossChargedDelayS: 2,
  // Hat der Boss genug Energie, setzt er seine Lade-Attacke mit dieser Wahrscheinlichkeit ein.
  bossChargedChance: 0.5,
  switchS: 1,
  relobbyS: 10,
  weatherCatchLevelBonus: 5,
  levels: [30, 40, 50],
  defaultLevel: 40,
};

// Legendäre, Mysteriöse und Ultrabestien, die es im Spiel gibt, die aber nie Raid-Boss waren
// (Fundorte: Forschung, Max-Kämpfe, Rauch, Fusion, Entwicklung …). Sie zählen trotzdem als Konter.
// Spiel-ID der Art oder der Form. Stand Oktober 2026 – kommt eines davon in Raids, Eintrag löschen
// (das Daten-Skript meldet es, sobald es im Raid-Kalender von Leek Duck auftaucht).
const NOT_RAID_BOSSES = new Set([
  // Mysteriöse aus Forschungen und Events
  'MEW', 'CELEBI', 'JIRACHI', 'SHAYMIN', 'VICTINI', 'KELDEO', 'MELOETTA', 'DIANCIE', 'HOOPA_CONFINED',
  'VOLCANION', 'MARSHADOW', 'ZERAORA', 'MELTAN', 'MELMETAL', 'ZARUDE', 'MAGEARNA', 'PECHARUNT',
  // Galar-Vögel (nur in der Wildnis mit Tagesabenteuer-Rauch), Zygarde (Routen), Max-Kampf-Pokémon
  'ARTICUNO_GALARIAN', 'ZAPDOS_GALARIAN', 'MOLTRES_GALARIAN', 'ZYGARDE', 'ETERNATUS', 'KUBFU', 'URSHIFU',
  // Vorstufen und Entwicklungen ohne Raid: Cosmog-Linie, Typ:Null, Ultrabestie Venicro/Agoyon
  'COSMOG', 'COSMOEM', 'TYPE_NULL', 'SILVALLY', 'POIPOLE', 'NAGANADEL',
]);

// Fusionen und Kronen-Formen: Nach dem Raid fängt man die Grundform (z. B. Necrozma nach Abendmähne-Necrozma).
const CATCH_AS = {
  ZACIAN_CROWNED_SWORD: 'ZACIAN_HERO', ZAMAZENTA_CROWNED_SHIELD: 'ZAMAZENTA_HERO',
  KYUREM_BLACK: null, KYUREM_WHITE: null, NECROZMA_DUSK_MANE: 'NECROZMA_NORMAL', NECROZMA_DAWN_WINGS: 'NECROZMA_NORMAL',
};

// Mega-Entwicklungen, die (auch) als Super-Mega-Raid kamen: Schilde, die nur Mega-Pokémon brechen.
// Quelle: Raid-Guides von Pokémon GO Hub und Leek Duck, 2026.
const SUPER_MEGA = new Set([
  'MEWTWO|TEMP_EVOLUTION_MEGA_X', 'MEWTWO|TEMP_EVOLUTION_MEGA_Y', 'RAICHU|TEMP_EVOLUTION_MEGA_X',
  'RAICHU|TEMP_EVOLUTION_MEGA_Y', 'VICTREEBEL|TEMP_EVOLUTION_MEGA', 'MALAMAR|TEMP_EVOLUTION_MEGA',
  'DRAGONITE|TEMP_EVOLUTION_MEGA', 'FALINKS|TEMP_EVOLUTION_MEGA', 'STARMIE|TEMP_EVOLUTION_MEGA',
  'SKARMORY|TEMP_EVOLUTION_MEGA', 'STARAPTOR|TEMP_EVOLUTION_MEGA',
]);

const TYPES = {
  NORMAL: 'Normal', FIRE: 'Feuer', WATER: 'Wasser', GRASS: 'Pflanze', ELECTRIC: 'Elektro',
  ICE: 'Eis', FIGHTING: 'Kampf', POISON: 'Gift', GROUND: 'Boden', FLYING: 'Flug',
  PSYCHIC: 'Psycho', BUG: 'Käfer', ROCK: 'Gestein', GHOST: 'Geist', DRAGON: 'Drache',
  DARK: 'Unlicht', STEEL: 'Stahl', FAIRY: 'Fee',
};

// Reihenfolge der Verteidiger-Typen in "attackScalar" (interne Typ-Nummerierung des Spiels).
const SCALAR_ORDER = ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL',
  'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY'];

// Wetter mit deutschem Namen aus den Spieltexten (Schlüssel) und Spiel-ID.
const WEATHER = [
  { id: 'CLEAR', text: 'weather_sunny' },
  { id: 'RAINY', text: 'weather_rainy' },
  { id: 'PARTLY_CLOUDY', text: 'weather_partly_cloudy' },
  { id: 'OVERCAST', text: 'weather_overcast' },
  { id: 'WINDY', text: 'weather_windy' },
  { id: 'SNOW', text: 'weather_snow' },
  { id: 'FOG', text: 'weather_fog' },
];

// Attacken, die im Raid nichts bringen oder nur Platzhalter sind.
const SKIPPED_MOVES = new Set(['FRUSTRATION', 'RETURN', 'STRUGGLE', 'TRANSFORM_FAST', 'SPLASH_FAST', 'STRUGGLE_BUG_FAST']);

// Attacken mit zufälligem Typ: Für Angreifer nicht planbar, beim Boss neutral gerechnet.
const RANDOM_TYPE_MOVES = new Set(['HIDDEN_POWER_FAST']);

// Deutsche Namen, die sich nicht aus den Spieltexten ableiten lassen.
const NAME_FIXES = { MEWTWO_A: 'Mewtu (Rüstung)' };

// Formen, deren PokeAPI-Bild anders heißt als die Spiel-ID.
const POKEAPI_FORM_SLUGS = {
  NECROZMA_DUSK_MANE: 'necrozma-dusk', NECROZMA_DAWN_WINGS: 'necrozma-dawn',
  ZACIAN_HERO: 'zacian', ZAMAZENTA_HERO: 'zamazenta',
  ZACIAN_CROWNED_SWORD: 'zacian-crowned', ZAMAZENTA_CROWNED_SHIELD: 'zamazenta-crowned',
  KYUREM_NORMAL: 'kyurem', DIALGA_NORMAL: 'dialga', PALKIA_NORMAL: 'palkia',
};

// ---------- Hilfsfunktionen ----------

const typeKey = (gmType) => gmType?.replace('POKEMON_TYPE_', '');
const pad = (n, width) => String(n).padStart(width, '0');

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function fetchWithRetry(url, kind, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'raid-kompass-builder' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (kind === 'json') return await res.json();
      if (kind === 'text') return await res.text();
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= tries) throw new Error(`Download fehlgeschlagen: ${url} (${err.message})`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Lädt eine Quelle und legt sie im Zwischenspeicher ab, damit wiederholte Builds schnell sind.
async function cached(name, url, kind = 'json') {
  const file = path.join(CACHE_DIR, name);
  if (await exists(file) && !REFRESH) {
    const text = await readFile(file, 'utf8');
    return kind === 'json' ? JSON.parse(text) : text;
  }
  const data = await fetchWithRetry(url, kind);
  if (data === null) throw new Error(`Quelle nicht gefunden: ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, kind === 'json' ? JSON.stringify(data) : data);
  return data;
}

// Führt async-Aufgaben mit begrenzter Parallelität aus.
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const titleCase = (id) => id.toLowerCase().split(/[_\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// Spieltexte liegen als flache Liste [Schlüssel, Text, Schlüssel, Text, …] vor.
function textMap(raw) {
  const map = new Map();
  for (let i = 0; i < raw.data.length; i += 2) map.set(raw.data[i], raw.data[i + 1]);
  return map;
}

// ---------- Game Master ----------

function indexGameMaster(gm) {
  const templates = [];      // { dex, settings }
  const moves = new Map();   // Attacken-Name -> { num, settings }
  const moveNamesById = new Map();
  const formSettings = new Map(); // pokemonId -> [{ form, isCostume }]
  const typeScalars = new Map();
  const weather = new Map();
  // Signatur-Attacken, die eine Form erst durch Fusion oder Krone bekommt (z. B. Behemoth-Klinge):
  // Zielform -> [{ moves, elite }]. Sie stehen nicht bei der Form selbst, sondern im formChange der Grundform.
  const signatureMoves = new Map();
  let cpm = null;
  let battle = null;
  for (const { templateId, data } of gm) {
    if (data?.pokemonSettings) {
      const dex = Number(/^V(\d{4})_POKEMON_/.exec(templateId)?.[1]);
      if (dex) templates.push({ dex, settings: data.pokemonSettings });
      const s = data.pokemonSettings;
      for (const fc of s.formChange ?? []) {
        for (const r of fc.moveReassignment?.cinematicMoves ?? []) {
          // Wird eine Elite-Attacke ersetzt (Kyurems Eiszeit), ist auch der Ersatz nur per Elite-TM zu haben.
          const elite = (r.existingMoves ?? []).length > 0 && r.existingMoves.every((m) => (s.eliteCinematicMove ?? []).includes(m));
          for (const target of fc.availableForm ?? []) {
            if (!signatureMoves.has(target)) signatureMoves.set(target, []);
            const list = signatureMoves.get(target);
            const key = JSON.stringify([r.replacementMoves, elite]);
            if (!list.some((x) => JSON.stringify([x.moves, x.elite]) === key)) list.push({ moves: r.replacementMoves ?? [], elite });
          }
        }
      }
    } else if (data?.moveSettings && /^V\d{4}_MOVE_/.test(templateId)) {
      const num = Number(templateId.slice(1, 5));
      const name = templateId.replace(/^V\d{4}_MOVE_/, '');
      moves.set(name, { num, settings: data.moveSettings });
      if (typeof data.moveSettings.movementId === 'number') moveNamesById.set(data.moveSettings.movementId, name);
    } else if (data?.formSettings) {
      formSettings.set(data.formSettings.pokemon, data.formSettings.forms ?? []);
    } else if (data?.typeEffective) {
      typeScalars.set(typeKey(data.typeEffective.attackType), data.typeEffective.attackScalar);
    } else if (data?.weatherAffinities) {
      weather.set(data.weatherAffinities.weatherCondition, data.weatherAffinities.pokemonType.map(typeKey));
    } else if (templateId === 'PLAYER_LEVEL_SETTINGS') {
      cpm = data.playerLevel.cpMultiplier;
    } else if (templateId === 'BATTLE_SETTINGS') {
      battle = data.battleSettings;
    }
  }
  if (!cpm || !battle) throw new Error('Spieldaten unvollständig: Level-Tabelle oder Kampf-Einstellungen fehlen.');
  return { templates, moves, moveNamesById, formSettings, typeScalars, weather, cpm, battle, signatureMoves };
}

// Typ-Tabelle: effectiveness[Angriffstyp][Verteidigertyp] = Faktor (1.6 / 1 / 0.625 / 0.390625).
function buildTypeEffectiveness(index) {
  if (index.typeScalars.size !== SCALAR_ORDER.length) {
    throw new Error(`Typ-Tabelle unvollständig: ${index.typeScalars.size} statt 18 Typen in den Spieldaten.`);
  }
  const table = {};
  for (const [attackType, scalars] of index.typeScalars) {
    table[attackType] = Object.fromEntries(SCALAR_ORDER.map((defType, i) => [defType, scalars[i]]));
  }
  return table;
}

const moveName = (index, id) => (typeof id === 'number' ? index.moveNamesById.get(id) : id);

// Eine Form pro Spielwert-Kombination. Kostüme fallen weg, ebenso die alte Vorlage ohne Form, wenn es
// dieselbe Art auch mit Form gibt (deren Attacken sind aktuell, z. B. Deoxys mit Donnerblitz).
function canonicalForms(index) {
  const bySpecies = new Map();
  for (const t of index.templates) {
    const s = t.settings;
    if (!s.stats?.baseAttack) continue;
    if (!bySpecies.has(s.pokemonId)) bySpecies.set(s.pokemonId, []);
    bySpecies.get(s.pokemonId).push(t);
  }
  const statSignature = (s) => JSON.stringify([s.stats, s.type, s.type2]);
  const result = [];
  for (const [speciesId, list] of bySpecies) {
    const costumes = new Set((index.formSettings.get(speciesId) ?? []).filter((f) => f.isCostume).map((f) => f.form));
    const withForm = list.filter((t) => t.settings.form);
    const regular = withForm.filter((t) => !costumes.has(t.settings.form));
    const regularStats = new Set(regular.map((t) => statSignature(t.settings)));
    // Kostüm-Formen nur, wenn sie andere Werte haben als alle normalen Formen (z. B. Mewtu mit Rüstung).
    const special = withForm.filter((t) => costumes.has(t.settings.form) && !regularStats.has(statSignature(t.settings)));
    const formStats = new Set([...regular, ...special].map((t) => statSignature(t.settings)));
    const legacy = list.filter((t) => !t.settings.form && !formStats.has(statSignature(t.settings)));
    // Hat eine Art Formen mit eigenen Werten (Giratina Wandel-/Urform), behalten alle ihren Formnamen –
    // sonst stünde "Giratina" neben "Giratina (Urform)".
    const multiStat = new Set([...regular, ...special, ...legacy].map((t) => statSignature(t.settings))).size > 1;
    // Zuerst die normale Form, dann echte Formen, zuletzt Event-Varianten wie PIKACHU_COPY_2019.
    const order = (t) => (!t.settings.form || t.settings.form.endsWith('_NORMAL') ? 0 : /\d|COPY/.test(t.settings.form) ? 2 : 1);
    const kept = [];
    const seen = new Set();
    const seenStats = new Set();
    for (const t of [...legacy, ...regular, ...special].sort((a, b) => order(a) - order(b))) {
      const s = t.settings;
      const signature = JSON.stringify([s.stats, s.type, s.type2, [...(s.quickMoves ?? [])].sort(), [...(s.cinematicMoves ?? [])].sort()]);
      // Event-Varianten nur, wenn sie eigene Werte haben – sonst sind sie bloß ein anderes Aussehen.
      if (seen.has(signature) || (order(t) === 2 && seenStats.has(statSignature(s)))) continue;
      seen.add(signature);
      seenStats.add(statSignature(s));
      kept.push(t);
    }
    for (const t of kept) {
      const form = t.settings.form;
      // Formname nur, wo er etwas unterscheidet (Giratina-Formen, Genesect-Module) – nicht bei Pandir 00.
      const showForm = form && !(form.endsWith('_NORMAL') && !multiStat) && kept.length > 1;
      result.push({ ...t, formId: showForm ? form : null });
    }
  }
  return result;
}

// ---------- PvPoke: was ist im Spiel erschienen? ----------

const statKey = (dex, stats, types) => `${dex}|${stats.atk}|${stats.def}|${stats.hp}|${[...types].sort().join(',')}`;

function releaseIndex(pvpoke) {
  const released = new Set();
  const shadow = new Set();
  const known = new Set();
  const pvpokeMegas = pvpoke.pokemon.filter((p) => p.released !== false && (p.tags ?? []).includes('mega'));
  for (const p of pvpoke.pokemon) {
    const types = p.types.filter((t) => t !== 'none').map((t) => t.toUpperCase());
    const key = statKey(p.dex, p.baseStats, types);
    known.add(key);
    const isShadow = (p.tags ?? []).includes('shadow');
    if (p.released === false) continue;
    if (isShadow) shadow.add(key); else released.add(key);
  }
  return { released, shadow, known, pvpokeMegas };
}

// Formen, die es nur außerhalb von Raids gibt: Morpeko wechselt nur in Trainerkämpfen ins Kohldampfmuster.
const NOT_IN_RAIDS = new Set(['MORPEKO_HANGRY']);

// Von Hand gepflegte Korrekturen zu PvPoke (dort teils noch als "nicht erschienen" geführt).
// Riffex ist seit dem 16.11.2024 als Dynamax-Pokémon im Spiel.
const RELEASE_FIXES = new Set(['TOXTRICITY_AMPED', 'TOXTRICITY_LOW_KEY']);

// ---------- Namen ----------

const REGIONAL = { ALOLA: 'Alola', GALARIAN: 'Galar', HISUIAN: 'Hisui', PALDEA: 'Paldea' };
const TEMP_EVO_NUMBER = { TEMP_EVOLUTION_MEGA: 1, TEMP_EVOLUTION_MEGA_X: 2, TEMP_EVOLUTION_MEGA_Y: 3, TEMP_EVOLUTION_PRIMAL: 4 };

function germanName(texts, dex, speciesId, formId) {
  const base = texts.get(`pokemon_name_${pad(dex, 4)}`) ?? titleCase(speciesId);
  if (!formId || formId === `${speciesId}_NORMAL`) return base;
  if (NAME_FIXES[formId]) return NAME_FIXES[formId];
  const suffix = formId.slice(speciesId.length + 1);
  const region = Object.keys(REGIONAL).find((r) => suffix === r || suffix.startsWith(`${r}_`));
  if (region) {
    const rest = suffix.slice(region.length + 1);
    // "Galar-Flampivian" statt "Galar-Flampivian (Standard)": die Standardform braucht keinen Zusatz.
    const label = rest && rest !== 'STANDARD' ? texts.get(`form_${formId.toLowerCase()}`) ?? texts.get(`form_${rest.toLowerCase()}`)
      ?? texts.get(`form_paldea_${rest.toLowerCase()}`) ?? titleCase(rest) : null;
    return `${REGIONAL[region]}-${base}${label ? ` (${label})` : ''}`;
  }
  const label = (texts.get(`form_${formId.toLowerCase()}`) ?? texts.get(`form_${suffix.toLowerCase()}`)
    ?? texts.get(`form_${suffix.toLowerCase()}_cloak`) ?? titleCase(suffix)).replace(/-?\n/g, '');
  if (!label.trim()) return base;
  return label.includes(base) ? label : `${base} (${label})`;
}

function germanMegaName(texts, dex, base, tempEvoId) {
  const fromTexts = texts.get(`pokemon_name_${pad(dex, 4)}_${pad(TEMP_EVO_NUMBER[tempEvoId], 4)}`);
  if (fromTexts) return fromTexts;
  if (tempEvoId === 'TEMP_EVOLUTION_PRIMAL') return `Proto-${base}`;
  const letter = /_(X|Y)$/.exec(tempEvoId)?.[1];
  return `Mega-${base}${letter ? ` ${letter}` : ''}`;
}

// ---------- Einträge bauen ----------

const slugOf = (text) => text.toLowerCase().replace(/_/g, '-');

function classOf(settings) {
  return {
    POKEMON_CLASS_LEGENDARY: 'legendary',
    POKEMON_CLASS_MYTHIC: 'mythical',
    POKEMON_CLASS_ULTRA_BEAST: 'ultrabeast',
  }[settings.pokemonClass] ?? null;
}

function buildPokemon(index, texts, releases) {
  const pokemon = [];
  const moveIds = new Set();
  const useMoves = (ids) => ids.map((id) => moveName(index, id))
    .filter((id) => id && index.moves.has(id) && !SKIPPED_MOVES.has(id))
    .map((id) => { moveIds.add(id); return id; });

  for (const { dex, settings: s, formId } of canonicalForms(index)) {
    const speciesId = s.pokemonId;
    const types = [typeKey(s.type), typeKey(s.type2)].filter(Boolean);
    const base = { atk: s.stats.baseAttack, def: s.stats.baseDefense, sta: s.stats.baseStamina };
    const key = statKey(dex, { atk: base.atk, def: base.def, hp: base.sta }, types);
    const released = releases.released.has(key) || RELEASE_FIXES.has(formId ?? speciesId);
    if (!released || NOT_IN_RAIDS.has(s.form)) continue;
    const fast = useMoves(s.quickMoves ?? []);
    const charged = useMoves(s.cinematicMoves ?? []);
    const eliteFast = useMoves(s.eliteQuickMove ?? []).filter((m) => !fast.includes(m));
    const eliteCharged = useMoves(s.eliteCinematicMove ?? []).filter((m) => !charged.includes(m));
    // Als Raid-Boss hat die Form nur ihre eigenen Attacken – die Signatur-Attacke bekommt erst,
    // wer fusioniert bzw. die Krone nutzt. Deshalb den Boss-Pool vorher festhalten.
    const bossCharged = [...charged];
    for (const sig of index.signatureMoves.get(s.form) ?? []) {
      for (const m of useMoves(sig.moves)) {
        const target = sig.elite ? eliteCharged : charged;
        if (!charged.includes(m) && !eliteCharged.includes(m)) target.push(m);
      }
    }
    const name = germanName(texts, dex, speciesId, formId);
    const entry = {
      key: slugOf(formId && !formId.endsWith('_NORMAL') ? formId : speciesId),
      speciesId,
      formId,
      dex,
      name,
      types,
      base,
      class: classOf(s),
      variant: 'normal',
      shadow: releases.shadow.has(key),
      fast, charged, eliteFast, eliteCharged, bossCharged,
      attacker: (fast.length + eliteFast.length) > 0 && (charged.length + eliteCharged.length) > 0,
    };
    pokemon.push(entry);

    // Mega-Entwicklungen und Protomorphosen: eigene Werte und Typen, Attacken der normalen Form.
    for (const evo of s.tempEvoOverrides ?? []) {
      if (!evo.tempEvoId || !evo.stats) continue;
      const evoTypes = [typeKey(evo.typeOverride1), typeKey(evo.typeOverride2)].filter(Boolean);
      const evoBase = { atk: evo.stats.baseAttack, def: evo.stats.baseDefense, sta: evo.stats.baseStamina };
      const evoKey = statKey(dex, { atk: evoBase.atk, def: evoBase.def, hp: evoBase.sta }, evoTypes);
      if (!releases.released.has(evoKey)) continue;
      const primal = evo.tempEvoId === 'TEMP_EVOLUTION_PRIMAL';
      const suffix = evo.tempEvoId.replace('TEMP_EVOLUTION_', '').toLowerCase().replace(/_/g, '-');
      pokemon.push({
        ...entry,
        key: `${entry.key}-${suffix}`,
        name: germanMegaName(texts, dex, name, evo.tempEvoId),
        types: evoTypes,
        base: evoBase,
        variant: primal ? 'primal' : 'mega',
        tempEvoId: evo.tempEvoId,
        parent: entry.key,
        shadow: false,
      });
    }
  }
  addMissingMegas(pokemon, texts, releases.pvpokeMegas);
  return { pokemon, moveIds };
}

// Mega-Entwicklungen, die schon erschienen sind, aber im (älteren) Game Master noch fehlen – etwa
// Mega-Staraptor, kurz nach dem Start. Werte und Typen dann von PvPoke, Attacken von der normalen Form.
function addMissingMegas(pokemon, texts, pvpokeMegas) {
  for (const m of pvpokeMegas) {
    const suffix = /_(mega_x|mega_y|mega|primal)$/.exec(m.speciesId)?.[1];
    if (!suffix) continue;
    const tempEvoId = `TEMP_EVOLUTION_${suffix.toUpperCase()}`;
    const root = pokemon.find((p) => p.dex === m.dex && p.variant === 'normal' && !p.formId);
    if (!root || pokemon.some((p) => p.parent === root.key && p.tempEvoId === tempEvoId)) continue;
    pokemon.push({
      ...root,
      key: `${root.key}-${suffix.replace(/_/g, '-')}`,
      name: germanMegaName(texts, root.dex, root.name, tempEvoId),
      types: m.types.filter((t) => t !== 'none').map((t) => t.toUpperCase()),
      base: { atk: m.baseStats.atk, def: m.baseStats.def, sta: m.baseStats.hp },
      variant: suffix === 'primal' ? 'primal' : 'mega',
      tempEvoId,
      parent: root.key,
      shadow: false,
    });
  }
}

function buildMoves(index, texts, moveIds) {
  const moves = {};
  for (const id of [...moveIds].sort()) {
    const { num, settings: m } = index.moves.get(id);
    moves[id] = {
      name: texts.get(`move_name_${pad(num, 4)}`) ?? titleCase(id.replace(/_FAST$/, '')),
      // Kraftreserve hat im Spiel einen zufälligen Typ (die Spieldaten nennen nur Normal als Platzhalter).
      type: RANDOM_TYPE_MOVES.has(id) ? null : typeKey(m.pokemonType),
      power: m.power ?? 0,
      durationS: m.durationMs / 1000,
      energy: m.energyDelta ?? 0,
      fast: id.endsWith('_FAST'),
    };
  }
  return moves;
}

// ---------- Raid-Bosse ----------

function tierFor(entry, shadow) {
  if (shadow) return 'shadow5';
  if (entry.variant === 'primal') return 'primal';
  if (entry.variant === 'mega') return entry.class ? 'megaLegendary' : 'mega';
  return 'tier5';
}

function categoryFor(entry, shadow) {
  if (shadow) return 'shadow';
  if (entry.variant === 'primal') return 'primal';
  if (entry.variant === 'mega') return entry.class ? 'megaLegendary' : 'mega';
  return entry.class;
}

// Englischer Name für die Suche ("Shadow Ho-Oh", "Mega Gengar", "Primal Kyogre").
function englishName(textsEn, p, shadow) {
  const species = textsEn.get(`pokemon_name_${pad(p.dex, 4)}`) ?? titleCase(p.speciesId);
  // Formen wie im Deutschen aus den Spieltexten: "Giratina Origin Forme", "Black Kyurem", "Armored Mewtwo".
  let base = species;
  if (p.formId === 'MEWTWO_A') base = `Armored ${species}`;
  else if (p.formId && !p.formId.endsWith('_NORMAL')) {
    const suffix = p.formId.slice(p.speciesId.length + 1);
    const regional = { ALOLA: 'Alolan', GALARIAN: 'Galarian', HISUIAN: 'Hisuian', PALDEA: 'Paldean' }[suffix.split('_')[0]];
    const label = regional ?? (textsEn.get(`form_${p.formId.toLowerCase()}`) ?? textsEn.get(`form_${suffix.toLowerCase()}`) ?? titleCase(suffix)).replace(/-?\n/g, '');
    base = regional ? `${regional} ${species}` : label.includes(species) ? label : `${species} ${label}`;
  }
  const prefix = p.variant === 'primal' ? 'Primal ' : p.variant === 'mega' ? 'Mega ' : '';
  const letter = /_(X|Y)$/.exec(p.tempEvoId ?? '')?.[1];
  return `${shadow ? 'Shadow ' : ''}${prefix}${base}${letter ? ` ${letter}` : ''}`;
}

function buildBosses(pokemon, textsEn) {
  const bosses = [];
  const byKey = new Map(pokemon.map((p) => [p.key, p]));
  for (const p of pokemon) {
    const isMega = p.variant === 'mega' || p.variant === 'primal';
    if (!isMega && !p.class) continue;
    let root = isMega ? byKey.get(p.parent) : p;
    if (!isMega && p.formId in CATCH_AS) {
      const target = CATCH_AS[p.formId];
      root = pokemon.find((q) => q.variant === 'normal' && q.speciesId === p.speciesId && (target ? q.formId === target : !q.formId || q.formId.endsWith('_NORMAL'))) ?? p;
    }
    if (!isMega && (NOT_RAID_BOSSES.has(p.speciesId) || NOT_RAID_BOSSES.has(p.formId))) continue;
    const variants = [false];
    if (!isMega && p.shadow) variants.push(true);
    for (const shadow of variants) {
      bosses.push({
        key: shadow ? `crypto-${p.key}` : p.key,
        pokemon: p.key,
        catchPokemon: root.key,
        shadow,
        tier: tierFor(p, shadow),
        category: categoryFor(p, shadow),
        name: shadow ? `Crypto-${p.name}` : p.name,
        nameEn: englishName(textsEn, p, shadow),
        // Ein Raid-Boss setzt nur Attacken aus dem normalen Pool ein (keine Elite-Attacken);
        // Mega-Entwicklungen die ihrer normalen Form.
        fast: isMega ? root.fast : p.fast,
        charged: isMega ? root.bossCharged : p.bossCharged,
        superMega: SUPER_MEGA.has(`${p.speciesId}|${p.tempEvoId}`),
        schedule: [],
      });
    }
  }
  return bosses;
}

// ---------- Raid-Kalender (Leek Duck über ScrapedDuck) ----------

// Ordnet einen englischen Boss-Namen von Leek Duck einem Eintrag zu, z. B. "Giratina (Origin)",
// "Mega Charizard X", "Primal Kyogre", "Thundurus (Incarnate)".
function makeNameResolver(pokemon, textsEn) {
  const dexByEnglish = new Map();
  for (const [k, v] of textsEn) {
    const m = /^pokemon_name_(\d{4})$/.exec(k);
    if (m) dexByEnglish.set(v.toLowerCase(), Number(m[1]));
  }
  return (rawName) => {
    let name = rawName.trim();
    let variant = 'normal';
    let letter = '';
    if (/^Mega /.test(name)) { variant = 'mega'; name = name.slice(5); }
    if (/^Primal /.test(name)) { variant = 'primal'; name = name.slice(7); }
    const xy = / (X|Y)$/.exec(name);
    if (xy && variant === 'mega') { letter = xy[1]; name = name.slice(0, -2); }
    let form = null;
    const paren = /^(.*) \((.*)\)$/.exec(name);
    if (paren) { name = paren[1]; form = paren[2]; }
    const regional = /^(Alolan|Galarian|Hisuian|Paldean) (.*)$/.exec(name);
    if (regional) { name = regional[2]; form = { Alolan: 'ALOLA', Galarian: 'GALARIAN', Hisuian: 'HISUIAN', Paldean: 'PALDEA' }[regional[1]] + (form ? `_${form}` : ''); }
    if (/^Armored /.test(name)) { name = name.slice(8); form = 'A'; }
    const dex = dexByEnglish.get(name.toLowerCase());
    if (!dex) return null;
    const candidates = pokemon.filter((p) => p.dex === dex);
    const token = form ? form.toUpperCase().replace(/ FORME?$/, '').replace(/[^A-Z0-9]+/g, '_') : null;
    let entry = token
      ? candidates.find((p) => p.variant === 'normal' && p.formId && (p.formId.endsWith(`_${token}`) || p.formId.includes(`_${token}_`)))
      : candidates.find((p) => p.variant === 'normal' && (!p.formId || p.formId.endsWith('_NORMAL')))
        // "Zacian" ist der Heldenhafte Krieger, nicht König des Schwertes; "Hoopa" im Raid ist entfesselt.
        ?? candidates.find((p) => p.variant === 'normal' && !(p.formId in CATCH_AS) && !NOT_RAID_BOSSES.has(p.formId))
        ?? candidates.find((p) => p.variant === 'normal');
    if (!entry) return null;
    if (variant !== 'normal') {
      const evoId = variant === 'primal' ? 'TEMP_EVOLUTION_PRIMAL' : `TEMP_EVOLUTION_MEGA${letter ? `_${letter}` : ''}`;
      entry = candidates.find((p) => p.parent === entry.key && p.tempEvoId === evoId);
    }
    return entry ?? null;
  };
}

// Tagesgenaue Zeitpunkte als Ortszeit ("2026-09-30T06:00"): Raids wechseln überall zur selben Ortszeit.
const localTime = (iso) => (iso ? iso.slice(0, 16) : null);

function applySchedule(bosses, events, currentRaids, resolve, hints) {
  const byKey = new Map(bosses.map((b) => [b.key, b]));
  const scheduled = new Set();
  for (const ev of events) {
    if (ev.eventType !== 'raid-battles' || !ev.extraData?.raidbattles?.bosses?.length) continue;
    const shadowEvent = /shadow raid/i.test(ev.name);
    for (const b of ev.extraData.raidbattles.bosses) {
      const entry = resolve(b.name);
      if (!entry) { hints.push(`Raid-Kalender: "${b.name}" (${ev.name}) keinem Pokémon zugeordnet.`); continue; }
      const key = shadowEvent ? `crypto-${entry.key}` : entry.key;
      const boss = byKey.get(key);
      if (!boss) {
        // Nur 5-Sterne-, Mega- und Crypto-5-Sterne-Raids gehören auf die Seite.
        if (entry.class || entry.variant !== 'normal') hints.push(`Raid-Kalender: ${b.name} (${ev.name}) ist kein Boss auf der Seite – NOT_RAID_BOSSES prüfen.`);
        continue;
      }
      boss.schedule.push({ start: localTime(ev.start), end: localTime(ev.end), shiny: Boolean(b.canBeShiny) });
      scheduled.add(key);
    }
  }
  for (const r of currentRaids) {
    if (!/^(5-Star|Mega)/i.test(r.tier)) continue;
    const shadow = /^Shadow /.test(r.name);
    const entry = resolve(r.name.replace(/^Shadow /, ''));
    const key = entry && (shadow ? `crypto-${entry.key}` : entry.key);
    if (!key || !byKey.has(key)) hints.push(`Aktuelle Raids: "${r.name}" (${r.tier}) ist kein Boss auf der Seite.`);
    else if (!scheduled.has(key)) hints.push(`Aktuelle Raids: ${r.name} ist laut Leek Duck jetzt im Raid, steht aber nicht im Raid-Kalender.`);
  }
  for (const boss of bosses) boss.schedule.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

// ---------- Bilder ----------

function pokeApiIndex(csv) {
  const byIdentifier = new Map();
  const defaultBySpecies = new Map();
  for (const line of csv.trim().split('\n').slice(1)) {
    const [id, identifier, speciesId, , , , , isDefault] = line.split(',');
    byIdentifier.set(identifier, Number(id));
    if (isDefault === '1') defaultBySpecies.set(Number(speciesId), Number(id));
  }
  return { byIdentifier, defaultBySpecies };
}

// Formen ohne eigenes PokeAPI-Artwork (Mewtu mit Rüstung gibt es nur in Pokémon GO): lieber das Ersatzbild
// der Seite als das Bild des normalen Mewtu. Die Genesect-Module teilen sich bewusst ein Bild (wie im Spiel).
const NO_POKEAPI_ART = new Set(['MEWTWO_A']);

function pokeApiId(api, p) {
  if (p.formId && NO_POKEAPI_ART.has(p.formId)) return null;
  const species = p.speciesId.toLowerCase().replace(/_/g, '-');
  const form = p.formId
    ? POKEAPI_FORM_SLUGS[p.formId] ?? p.formId.toLowerCase().replace(/_/g, '-')
      .replace(/-galarian\b/, '-galar').replace(/-hisuian\b/, '-hisui').replace(/-paldea-(\w+)$/, '-paldea-$1-breed')
    : null;
  const candidates = [];
  if (p.variant === 'mega' || p.variant === 'primal') {
    const suffix = p.tempEvoId.replace('TEMP_EVOLUTION_', '').toLowerCase().replace(/_/g, '-');
    candidates.push(`${form ?? species}-${suffix}`, `${species}-${suffix}`);
  }
  if (form) candidates.push(form);
  candidates.push(species);
  for (const c of candidates) if (api.byIdentifier.has(c)) return api.byIdentifier.get(c);
  // Mega-Bilder nie durch das normale Bild ersetzen – dann lieber das Ersatzbild der Seite.
  if (p.variant !== 'normal') return null;
  return api.defaultBySpecies.get(p.dex) ?? null;
}

// Welche Pokémon brauchen ein Bild? Alle Bosse und alle, die in einer Konter-Liste weit oben stehen
// (für jede Kombination der Filter auf der Seite). Alle anderen zeigen das Ersatzbild mit Typfarben.
function pokemonNeedingImages(data, listSize) {
  const needed = new Set();
  for (const boss of data.bosses) {
    needed.add(boss.pokemon);
    needed.add(boss.catchPokemon);
  }
  const filters = [];
  for (const shadow of [true, false]) for (const mega of [true, false]) for (const legendary of [true, false]) filters.push({ shadow, mega, legendary });
  const keep = (entry, f) => (f.shadow || !entry.attacker.shadow)
    && (f.mega || entry.attacker.variant === 'normal') && (f.legendary || !entry.attacker.class);
  const scenarios = [];
  for (const level of RULES.levels) for (const elite of [true, false]) scenarios.push({ level, elite, weather: null });
  for (const w of data.weather) scenarios.push({ level: RULES.defaultLevel, elite: true, weather: w.id });
  for (const boss of data.bosses) {
    for (const sc of scenarios) {
      const ranking = RaidCalc.rank(data, boss, { ...sc, shadow: true, mega: true, legendary: true });
      for (const f of filters) for (const entry of ranking.filter((e) => keep(e, f)).slice(0, listSize)) needed.add(entry.attacker.key);
      // Beste je Angriffstyp (eigene Übersicht auf der Seite).
      const byType = new Set();
      for (const entry of ranking) {
        if (byType.has(entry.charged.type)) continue;
        byType.add(entry.charged.type);
        needed.add(entry.attacker.key);
      }
    }
  }
  return needed;
}

async function loadImages(data, api, missing) {
  const needed = pokemonNeedingImages(data, 25);
  const jobs = [];
  await mapLimited(data.pokemon.filter((p) => needed.has(p.key)), 8, async (p) => {
    const id = pokeApiId(api, p);
    if (!id) { missing.push(p.name); return; }
    const raw = path.join(IMG_RAW_DIR, `${id}.png`);
    if (!await exists(raw)) {
      const buf = await fetchWithRetry(SOURCES.artwork(id), 'buffer');
      if (!buf) { missing.push(p.name); return; }
      await mkdir(IMG_RAW_DIR, { recursive: true });
      await writeFile(raw, buf);
    }
    p.image = `assets/img/${id}.webp`;
    jobs.push({ src: raw, dest: path.join(IMG_DIR, `${id}.webp`) });
  });
  const unique = [...new Map(jobs.map((j) => [j.dest, j])).values()];
  const converted = await convertToWebp(unique, {
    onProgress: (done, total) => { if (done % 50 === 0 || done === total) console.log(`   ${done}/${total} Bilder umgewandelt`); },
  });
  // Alte Bilder, die keine Seite mehr braucht, entfernen.
  const keep = new Set(unique.map((j) => path.basename(j.dest)));
  for (const file of await readdir(IMG_DIR).catch(() => [])) if (!keep.has(file)) await rm(path.join(IMG_DIR, file));
  return { total: unique.length, converted };
}

// ---------- Ablauf ----------

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  console.log('1/5 Spieldaten und Texte laden …');
  const gm = await cached('game-master.json', SOURCES.gameMaster);
  const gmTime = await cached('game-master-timestamp.txt', SOURCES.gameMasterTime, 'text').catch(() => null);
  const pvpoke = await cached('pvpoke.json', SOURCES.pvpoke);
  const textsDe = textMap(await cached('texts-de.json', SOURCES.textsDe));
  const textsEn = textMap(await cached('texts-en.json', SOURCES.textsEn));
  const index = indexGameMaster(gm);

  console.log('2/5 Pokémon, Attacken und Bosse zusammenstellen …');
  const releases = releaseIndex(pvpoke);
  const { pokemon, moveIds } = buildPokemon(index, textsDe, releases);
  const moves = buildMoves(index, textsDe, moveIds);
  const bosses = buildBosses(pokemon, textsEn);

  console.log('3/5 Raid-Kalender laden …');
  const hints = [];
  const events = await cached('events.json', SOURCES.events);
  const currentRaids = await cached('raids.json', SOURCES.raids);
  applySchedule(bosses, events, currentRaids, makeNameResolver(pokemon, textsEn), hints);

  const data = {
    generatedAt: new Date().toISOString(),
    sources: {
      gameMasterDate: gmTime ? new Date(Number(gmTime.trim())).toISOString() : null,
      gameMaster: { name: 'PokeMiners/game_masters', url: 'https://github.com/PokeMiners/game_masters' },
      texts: { name: 'holoholo-text', url: 'https://github.com/sora10pls/holoholo-text' },
      releases: { name: 'PvPoke', url: 'https://github.com/pvpoke/pvpoke' },
      schedule: { name: 'Leek Duck', url: 'https://leekduck.com/raid-bosses/' },
      scheduleApi: { name: 'ScrapedDuck', url: 'https://github.com/bigfoott/ScrapedDuck' },
      images: { name: 'PokeAPI', url: 'https://pokeapi.co/' },
    },
    rules: { ...RULES, cpm: index.cpm, bossEnergyPerHpLost: index.battle.bossEnergyRegenerationPerHealthLost },
    tiers: TIERS,
    types: TYPES,
    typeEffectiveness: buildTypeEffectiveness(index),
    weather: WEATHER.map((w) => ({ id: w.id, name: textsDe.get(w.text) ?? titleCase(w.id), types: index.weather.get(w.id) ?? [] })),
    moves,
    pokemon,
    bosses,
  };
  // Für die Rechnung im Build dieselben Nachschlage-Tabellen wie im Browser.
  Object.defineProperty(data, 'pokemonByKey', { value: Object.fromEntries(pokemon.map((p) => [p.key, p])), enumerable: false });

  const missingImages = [];
  if (NO_IMAGES) {
    // Plan B: Die Seite zeigt statt Artworks Pokédex-Nummer und Typfarben.
    console.log('4/5 Ohne Bilder (--no-images): assets/img/ wird entfernt …');
    for (const p of pokemon) p.image = null;
    delete data.sources.images; // Die Fußzeile nennt PokeAPI nur, wenn es Bilder gibt.
    await rm(IMG_DIR, { recursive: true, force: true });
  } else {
    console.log('4/5 Bilder auswählen, laden und in WebP umwandeln …');
    const api = pokeApiIndex(await cached('pokeapi-pokemon.csv', SOURCES.pokeapiPokemon, 'text'));
    const { total, converted } = await loadImages(data, api, missingImages);
    console.log(`   ${total} Bilder, davon ${converted} neu umgewandelt`);
  }

  console.log('5/5 Daten schreiben …');
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `// Automatisch erzeugt von scripts/build-data.mjs – nicht von Hand bearbeiten.\nwindow.RAID_DATA = ${JSON.stringify(data)};\n`);

  const attackers = pokemon.filter((p) => p.attacker).length;
  console.log(`\nFertig: ${bosses.length} Raid-Bosse, ${attackers} mögliche Konter, ${Object.keys(moves).length} Attacken → ${path.relative(ROOT, OUT_FILE)}`);
  if (hints.length) console.warn(`\nHinweis – bitte prüfen (${hints.length}):\n  ${hints.join('\n  ')}`);
  if (missingImages.length) console.warn(`\nWarnung – ohne Bild (${missingImages.length}):\n  ${missingImages.join('\n  ')}`);
}

main().catch((err) => {
  console.error(`\nFehler: ${err.stack ?? err.message}`);
  process.exit(1);
});
