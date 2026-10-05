'use strict';

// Kampf-Rechnung für Raids: Schaden, DPS, TDO, Rangliste der Konter und geschätzte Spielerzahl.
// Klassisches Skript (läuft per Doppelklick über file://) – und dasselbe Skript nutzt das Daten-Skript
// in Node, damit Seite und Build garantiert gleich rechnen.

const RaidCalc = (() => {
  // ---------- Grundwerte ----------

  // CP-Multiplikator für ganze und halbe Level (Spieldaten liefern nur ganze Level).
  function cpmAt(data, level) {
    const table = data.rules.cpm;
    const lower = Math.floor(level);
    if (lower === level) return table[lower - 1];
    const a = table[lower - 1];
    const b = table[lower];
    // Halbe Level liegen auf der Wurzel-Mitte zwischen den ganzen (so rechnet das Spiel).
    return Math.sqrt((a * a + b * b) / 2);
  }

  // Werte eines Pokémon auf einem Level mit festen IVs.
  function statsAt(pokemon, cpm, iv = { atk: 15, def: 15, sta: 15 }) {
    return {
      atk: (pokemon.base.atk + iv.atk) * cpm,
      def: (pokemon.base.def + iv.def) * cpm,
      hp: Math.max(10, Math.floor((pokemon.base.sta + iv.sta) * cpm)),
    };
  }

  function combatPower(pokemon, cpm, iv = { atk: 15, def: 15, sta: 15 }) {
    const a = pokemon.base.atk + iv.atk;
    const d = pokemon.base.def + iv.def;
    const s = pokemon.base.sta + iv.sta;
    return Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(s) * cpm * cpm) / 10));
  }

  // Faktor eines Angriffstyps gegen einen oder zwei Verteidigertypen (z. B. 2.56, 1.6, 0.625).
  // Attacken ohne festen Typ (Kraftreserve hat im Raid einen zufälligen Typ) zählen neutral.
  function effectiveness(data, attackType, defenderTypes) {
    if (!attackType) return 1;
    const row = data.typeEffectiveness[attackType];
    return defenderTypes.length === 1 ? row[defenderTypes[0]] : row[defenderTypes[0]] * row[defenderTypes[1]];
  }

  // Raid-Boss: KP und CP-Multiplikator hängen von der Raid-Stufe ab, die IVs sind immer 15/15/15.
  function bossStats(data, boss) {
    const tier = data.tiers[boss.tier];
    const pokemon = data.pokemonByKey[boss.pokemon];
    return {
      atk: (pokemon.base.atk + 15) * tier.cpm,
      def: (pokemon.base.def + 15) * tier.cpm,
      hp: tier.hp,
      // Angezeigte Boss-WP: Raid-KP statt Ausdauer, ohne CP-Multiplikator.
      cp: Math.floor(((pokemon.base.atk + 15) * Math.sqrt(pokemon.base.def + 15) * Math.sqrt(tier.hp)) / 10),
    };
  }

  // WP-Spanne eines gefangenen Raid-Pokémon: Mindest-IVs bis 15/15/15 auf dem Fang-Level.
  function catchRange(data, boss) {
    const tier = data.tiers[boss.tier];
    const caught = data.pokemonByKey[boss.catchPokemon];
    const range = (level) => {
      const cpm = cpmAt(data, level);
      const floor = tier.catchIvFloor;
      return {
        level,
        min: combatPower(caught, cpm, { atk: floor, def: floor, sta: floor }),
        max: combatPower(caught, cpm),
      };
    };
    return { normal: range(tier.catchLevel), boosted: range(tier.catchLevel + data.rules.weatherCatchLevelBonus) };
  }

  // ---------- Schaden ----------

  // Schaden eines Treffers: floor(0,5 × Stärke × Angriff/Verteidigung × Faktoren) + 1.
  const hit = (power, atk, def, multiplier) => Math.floor((0.5 * power * atk * multiplier) / def) + 1;

  function weatherBoosts(data, weatherId, type) {
    if (!weatherId) return false;
    return data.weather.find((w) => w.id === weatherId)?.types.includes(type) ?? false;
  }

  // Faktoren einer Attacke gegen den Boss ohne STAB: Typ-Effektivität, Wetter und (bei Crypto-Bossen)
  // 20 % mehr erlittener Schaden – je Angriffstyp einmal pro Rangliste gerechnet.
  function typeFactors(data, boss, opts) {
    const bossTypes = data.pokemonByKey[boss.pokemon].types;
    const taken = data.tiers[boss.tier].damageTakenMultiplier ?? 1;
    return Object.fromEntries(Object.keys(data.typeEffectiveness).map((type) => [type,
      effectiveness(data, type, bossTypes) * (weatherBoosts(data, opts.weather, type) ? data.rules.weatherBoost : 1) * taken]));
  }

  // Faktoren eines Angreifers gegen den Boss. Eine Mega-Entwicklung verstärkt nur die Attacken der
  // anderen im Raid, nie ihre eigenen – deshalb gibt es hier keinen Mega-Bonus.
  const attackerMultiplier = (data, attacker, move, factors) => (attacker.types.includes(move.type) ? data.rules.stab : 1) * factors[move.type];

  // Anteil der Boss-Aktionen, die Lade-Attacken sind. Energie-Bilanz: p·cost = (1−p)·E_fast + gain·Zeit.
  // Ist der Nenner ≤ 0, reicht schon die Energie aus erlittenem Schaden für jede Aktion – dann gilt die
  // 50-%-Regel. So steigt p nie, wenn der Angreifer mehr Schaden macht.
  function chargedShare(data, h, damageTaken) {
    const gain = data.rules.bossEnergyPerHpLost * damageTaken;
    const denom = h.cost + h.fastEnergy + gain * (h.tf - h.tc);
    if (denom <= 0) return data.rules.bossChargedChance;
    return Math.max(0, Math.min(data.rules.bossChargedChance, (h.fastEnergy + gain * h.tf) / denom));
  }

  // Treffer des Bosses gegen einen Verteidiger: Schaden seiner Sofort- und Lade-Attacke je Attacken-Paar.
  // Hängt nur von Typen und Verteidigung des Angreifers ab, nicht von dessen Attacken.
  function bossHits(data, boss, bossStat, movesets, defender, opts) {
    const rules = data.rules;
    const bossTypes = data.pokemonByKey[boss.pokemon].types;
    const dealt = data.tiers[boss.tier].damageDealtMultiplier ?? 1;
    const mult = (move) => (move.type && bossTypes.includes(move.type) ? rules.stab : 1)
      * effectiveness(data, move.type, defender.types)
      * (weatherBoosts(data, opts.weather, move.type) ? rules.weatherBoost : 1) * dealt;
    return movesets.map(({ fast, charged }) => ({
      fastDamage: hit(fast.power, bossStat.atk, defender.def, mult(fast)),
      chargedDamage: hit(charged.power, bossStat.atk, defender.def, mult(charged)),
      tf: fast.durationS + rules.bossFastDelayS,
      tc: charged.durationS + rules.bossChargedDelayS,
      fastEnergy: fast.energy,
      cost: -charged.energy,
    }));
  }

  // Schaden pro Sekunde, den der Boss gegen dieses Pokémon macht. Der Boss lädt Energie mit
  // Sofort-Attacken und mit erlittenem Schaden (0,5 pro KP, also aus dem Schaden des Angreifers:
  // damageTaken = dessen DPS). Hat er genug für die Lade-Attacke, setzt er sie mit 50 % Wahrscheinlichkeit
  // ein. Zwischen zwei Attacken wartet er im Schnitt eine feste Zeit.
  function bossDps(data, h, damageTaken) {
    const p = chargedShare(data, h, damageTaken);
    return ((1 - p) * h.fastDamage + p * h.chargedDamage) / ((1 - p) * h.tf + p * h.tc);
  }

  // DPS und TDO eines Angreifers mit einem Attacken-Paar (Formel nach GamePress, "Comprehensive DPS"):
  // Energie kommt aus Sofort-Attacken und aus erlittenem Schaden (0,5 pro KP).
  function attackerPerformance(data, attacker, fast, charged, bossStat, hits, factors) {
    const fastDamage = hit(fast.power, attacker.atk, bossStat.def, attackerMultiplier(data, attacker, fast, factors));
    const chargedDamage = hit(charged.power, attacker.atk, bossStat.def, attackerMultiplier(data, attacker, charged, factors));
    const fdps = fastDamage / fast.durationS;
    const feps = fast.energy / fast.durationS;
    const cdps = chargedDamage / charged.durationS;
    const cost = -charged.energy;
    const ceps = cost / charged.durationS;
    const x = 0.5 * cost + 0.5 * fast.energy;
    const cycle = (fdps * ceps + cdps * feps) / (ceps + feps);
    const dps0 = Math.max(fdps, cycle);

    // Über alle möglichen Boss-Attacken gemittelt (der Boss hat zufällig eines der Paare).
    let dpsSum = 0;
    let tdoSum = 0;
    let scoreSum = 0;
    for (const h of hits) {
      const y = bossDps(data, h, dps0);
      let dps = cycle + ((cdps - fdps) / (ceps + feps)) * (0.5 - x / attacker.hp) * y;
      dps = Math.max(dps, fdps); // Lade-Attacke lohnt sich nicht: nur Sofort-Attacken
      const tdo = dps * (attacker.hp / y);
      dpsSum += dps;
      tdoSum += tdo;
      scoreSum += Math.pow(dps * dps * dps * tdo, 0.25);
    }
    const n = hits.length;
    return { dps: dpsSum / n, tdo: tdoSum / n, score: scoreSum / n, fastDamage, chargedDamage };
  }

  // ---------- Angreifer ----------

  // Alle Varianten, die gegen den Boss antreten können: normal, Crypto, Mega/Proto.
  function attackerVariants(data, opts) {
    const cpm = cpmAt(data, opts.level);
    const list = [];
    for (const p of data.pokemon) {
      if (!p.attacker) continue;
      if (!opts.legendary && p.class) continue;
      const stats = statsAt(p, cpm);
      if (p.variant === 'mega' || p.variant === 'primal') {
        if (opts.mega) list.push({ ...p, ...stats, shadow: false });
        continue;
      }
      list.push({ ...p, ...stats, shadow: false });
      if (p.shadow && opts.shadow) {
        list.push({ ...p, shadow: true, atk: stats.atk * data.rules.shadowAttack, def: stats.def * data.rules.shadowDefense, hp: stats.hp });
      }
    }
    return list;
  }

  function movesFor(data, ids) {
    return ids.map((id) => ({ id, ...data.moves[id] })).filter((m) => m.name);
  }

  // Boss-Attacken: alle Paare aus seinem Raid-Pool oder genau das gewählte Paar.
  function bossMovesets(data, boss, opts) {
    const fast = movesFor(data, boss.fast);
    const charged = movesFor(data, boss.charged);
    if (opts.bossFast || opts.bossCharged) {
      const f = fast.filter((m) => !opts.bossFast || m.id === opts.bossFast);
      const c = charged.filter((m) => !opts.bossCharged || m.id === opts.bossCharged);
      if (f.length && c.length) return f.flatMap((a) => c.map((b) => ({ fast: a, charged: b })));
    }
    return fast.flatMap((a) => charged.map((b) => ({ fast: a, charged: b })));
  }

  // Rangliste: Für jedes Pokémon das beste Attacken-Paar gegen diesen Boss.
  // opts: { level, shadow, mega, legendary, elite, weather, bossFast, bossCharged }
  function rank(data, boss, opts) {
    const bossStat = bossStats(data, boss);
    const movesets = bossMovesets(data, boss, opts);
    const factors = typeFactors(data, boss, opts);
    const results = [];
    for (const attacker of attackerVariants(data, opts)) {
      // Kraftreserve fällt weg: Ihr Typ ist Zufall, man kann sie nicht gezielt einsetzen.
      const fastMoves = movesFor(data, opts.elite ? [...attacker.fast, ...attacker.eliteFast] : attacker.fast).filter((m) => m.type);
      const chargedMoves = movesFor(data, opts.elite ? [...attacker.charged, ...attacker.eliteCharged] : attacker.charged).filter((m) => m.type);
      const hits = bossHits(data, boss, bossStat, movesets, attacker, opts);
      let best = null;
      for (const fast of fastMoves) {
        for (const charged of chargedMoves) {
          const perf = attackerPerformance(data, attacker, fast, charged, bossStat, hits, factors);
          if (!best || perf.score > best.score) best = { ...perf, fast, charged };
        }
      }
      if (best) results.push({ attacker, ...best });
    }
    results.sort((x, y) => y.score - x.score);
    return results;
  }

  // ---------- Spielerzahl ----------

  // Team für eine Person: die besten Pokémon verschiedener Arten, höchstens eine Mega-Entwicklung
  // (im Raid kann pro Person nur eine aktiv sein).
  function bestTeam(ranking, size = 6) {
    const team = [];
    const species = new Set();
    let megaUsed = false;
    for (const entry of ranking) {
      if (team.length === size) break;
      const a = entry.attacker;
      const isMega = a.variant === 'mega' || a.variant === 'primal';
      if (species.has(a.speciesId) || (isMega && megaUsed)) continue;
      species.add(a.speciesId);
      if (isMega) megaUsed = true;
      team.push(entry);
    }
    return team;
  }

  // Schaden, den eine Person mit ihrem Team in der Raid-Zeit schafft: Pokémon kämpfen nacheinander,
  // jedes bis es besiegt ist (TDO); sind alle sechs besiegt, kostet das Neu-Beitreten Zeit.
  function damagePerTrainer(data, team, timerS) {
    if (!team.length) return 0;
    let time = 0;
    let damage = 0;
    for (;;) {
      for (const entry of team) {
        // Ungültige Werte (keine Attacken o. ä.) würden die Schleife nie enden lassen.
        if (!(entry.dps > 0) || !(entry.tdo > 0)) return damage;
        const duration = entry.tdo / entry.dps;
        if (time + duration >= timerS) return damage + entry.dps * (timerS - time);
        time += duration + data.rules.switchS;
        damage += entry.tdo;
      }
      time += data.rules.relobbyS;
      if (time >= timerS) return damage;
    }
  }

  // raw = KP des Bosses ÷ Schaden einer Person; trainers berücksichtigt zusätzlich die Mindestzahl der
  // Raid-Art (Crypto-Raids: 8 Erlöste Edelsteine, höchstens 5 pro Person → mindestens 2 Personen).
  function estimateTrainers(data, boss, ranking) {
    const tier = data.tiers[boss.tier];
    const team = bestTeam(ranking);
    const perTrainer = damagePerTrainer(data, team, tier.timerS);
    const raw = perTrainer > 0 ? tier.hp / perTrainer : Infinity;
    const minTrainers = tier.minTrainers ?? 1;
    return { team, perTrainer, raw, minTrainers, trainers: Math.max(minTrainers, raw) };
  }

  return {
    cpmAt, statsAt, combatPower, effectiveness, bossStats, catchRange, bossMovesets, rank,
    bestTeam, estimateTrainers, damagePerTrainer, weatherBoosts, bossHits, chargedShare,
  };
})();

if (typeof module === 'object' && module.exports) module.exports = RaidCalc;
