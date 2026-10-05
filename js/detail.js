'use strict';

// Detailansicht eines Raid-Bosses: Boss-Infos (WP, Fang-WP, Wetter, Schwächen, Attacken),
// Filter für die Konter, bestes Team mit geschätzter Spielerzahl und die Rangliste.

const Detail = (() => {
  const { el, data, formatNumber, formatFactor } = Raid;

  const LIST_STEP = 20;
  const LIST_MAX = 60;
  const DEFAULTS = { level: data?.rules.defaultLevel ?? 40, shadow: true, mega: true, legendary: true, elite: true, weather: '' };

  // Filter bleiben beim Wechsel zu einem anderen Boss erhalten, die Boss-Attacken nicht.
  const state = { ...DEFAULTS, bossFast: '', bossCharged: '', listSize: LIST_STEP };
  let boss = null;
  let container = null;
  const cache = new Map();

  // ---------- Rechnung ----------

  // Die volle Rangliste (alle Varianten) hängt nur von Level, Elite, Wetter und Boss-Attacken ab –
  // die Schalter für Crypto, Mega und Legendäre filtern sie nur. So bleibt jeder Klick schnell.
  function fullRanking(opts = state) {
    const key = [boss.key, opts.level, opts.elite, opts.weather, opts.bossFast, opts.bossCharged].join('|');
    if (!cache.has(key)) {
      if (cache.size > 40) cache.clear();
      cache.set(key, RaidCalc.rank(data, boss, {
        level: opts.level, elite: opts.elite, weather: opts.weather || null,
        bossFast: opts.bossFast || null, bossCharged: opts.bossCharged || null,
        shadow: true, mega: true, legendary: true,
      }));
    }
    return cache.get(key);
  }

  const passes = (entry, opts) => (opts.shadow || !entry.attacker.shadow)
    && (opts.mega || entry.attacker.variant === 'normal')
    && (opts.legendary || !entry.attacker.class);

  const ranking = (opts = state) => fullRanking(opts).filter((e) => passes(e, opts));

  // Spielerzahl: bestes Team mit den Einstellungen – und zum Vergleich mit Level-30-Pokémon ohne Mega/Crypto.
  function trainerRange() {
    const best = { ...DEFAULTS, level: 40, bossFast: '', bossCharged: '' };
    const casual = { ...best, level: 30, shadow: false, mega: false };
    return [best, casual].map((opts) => RaidCalc.estimateTrainers(data, boss, ranking(opts)).trainers);
  }

  // ---------- Bausteine ----------

  const moveOf = (id) => ({ id, ...data.moves[id] });

  function moveChip(move, elite = false) {
    return el('span', { class: 'move' }, [
      el('span', { class: 'move__name', text: move.name }),
      Raid.typeChip(move.type, true),
      elite ? Raid.eliteBadge() : null,
    ]);
  }

  const isElite = (attacker, moveId) => attacker.eliteFast.includes(moveId) || attacker.eliteCharged.includes(moveId);

  function factorList(entries) {
    return el('div', { class: 'factor-list' }, entries.map(({ type, factor }) =>
      el('span', { class: `type-chip type-chip--small type-${Raid.slugOf(type)}` }, [`${data.types[type]} ${formatFactor(factor)}`])));
  }

  // Rechnerische Spielerzahl auf eine Nachkommastelle, immer aufgerundet: "2,04" wird "2,1", nie "2,0".
  const exactPeople = (n) => formatNumber(Math.ceil(n * 10 - 1e-9) / 10, 1);

  // ---------- Boss ----------

  function bossPanel(pokemon, bossStat) {
    const { state: when, slot } = Raid.scheduleState(boss);
    const [lo, hi] = trainerRange().map((n) => (Number.isFinite(n) ? Math.ceil(n) : null));
    const tier = data.tiers[boss.tier];
    const crowd = !lo ? 'unbekannt' : lo === hi ? (lo <= 1 ? 'allein' : `${lo} Personen`) : `${lo}–${hi ?? '?'} Personen`;
    return el('section', { class: `boss boss--${boss.category}`, 'aria-labelledby': 'detail-title' }, [
      Raid.pokemonArt(pokemon, { size: 'lg', eager: true, shadow: boss.shadow }),
      el('div', { class: 'boss__info' }, [
        el('p', { class: 'boss__label', text: `${tier.label} · ${Raid.CATEGORIES[boss.category].label}` }),
        el('h2', { class: 'boss__name', id: 'detail-title', tabindex: '-1', text: boss.name }),
        el('div', { class: 'boss__chips' }, [
          ...pokemon.types.map((t) => Raid.typeChip(t)),
          when === 'now' ? el('span', { class: 'badge badge--now', text: 'Jetzt im Raid' }) : null,
          when === 'soon' ? el('span', { class: 'badge badge--soon', text: `Im Raid ab ${Raid.formatDay(slot.start)}` }) : null,
          boss.schedule.some((s) => s.shiny) ? el('span', { class: 'badge badge--shiny', text: 'Schillernd möglich' }) : null,
        ]),
        el('dl', { class: 'facts facts--boss' }, [
          el('div', {}, [el('dt', { text: 'Boss-WP' }), el('dd', { text: formatNumber(bossStat.cp) })]),
          el('div', {}, [el('dt', { text: 'Boss-KP' }), el('dd', { text: formatNumber(bossStat.hp) })]),
          el('div', {}, [el('dt', { text: 'Zeitlimit' }), el('dd', { text: `${tier.timerS / 60} Minuten` })]),
          el('div', { title: 'Mit den besten Kontern auf Level 40 bis zu Level-30-Pokémon ohne Mega und Crypto' }, [
            el('dt', { text: 'Spieler*innen' }), el('dd', { text: crowd }),
          ]),
        ]),
        ...bossNotes(),
      ]),
    ]);
  }

  // Hinweise zur Raid-Art: Crypto (Wut, Erlöste Edelsteine), Super-Mega-Raid (Schilde), Mega-Bonus.
  function bossNotes() {
    const notes = [];
    if (boss.shadow) {
      notes.push(['boss__note boss__note--shadow', 'Crypto-Raid: Der Boss macht und nimmt 20 % mehr Schaden (schon eingerechnet). Ab 60 % KP wird er rasend und viel stärker – mit 8 Erlösten Edelsteinen (höchstens 5 pro Person) bändigt ihr ihn wieder. Deshalb braucht ihr mindestens 2 Personen.']);
    }
    if (boss.superMega) {
      notes.push(['boss__note boss__note--mega', 'Kam auch als Super-Mega-Raid: Dort baut der Boss Schilde auf, die nur Mega-Pokémon mit einer Lade-Attacke brechen – jede Person höchstens einen. Dafür braucht ihr 7 bis 10 Personen, alle mit einem Mega-Pokémon im Team.']);
    }
    if (boss.category === 'mega' || boss.category === 'megaLegendary' || boss.category === 'primal') {
      notes.push(['boss__note', 'Tipp: Bringt selbst Mega-Entwicklungen mit. Eine aktive Mega-Entwicklung verstärkt die Attacken aller anderen im Raid um 10 %, Attacken ihres Typs um 30 % – ihre eigenen aber nicht. Dieser Bonus ist in der Rangliste nicht eingerechnet.']);
    }
    return notes.map(([cls, text]) => el('p', { class: cls, text }));
  }

  // Zusatz, wenn man nach dem Raid nicht genau den Boss fängt (Mega, Proto, Fusion, Krone).
  function catchSuffix(caught) {
    if (boss.catchPokemon === boss.pokemon) return '';
    const variant = Raid.pokemon(boss.pokemon).variant;
    if (variant === 'primal') return ' (ohne Protomorphose)';
    if (variant === 'mega') return ' (ohne Mega-Entwicklung)';
    return caught.name.includes('(') ? '' : ' (in seiner Grundform)';
  }

  function catchCard() {
    const caught = Raid.pokemon(boss.catchPokemon);
    const range = RaidCalc.catchRange(data, boss);
    const cp = (level) => RaidCalc.combatPower(caught, RaidCalc.cpmAt(data, level));
    const weathers = data.weather.filter((w) => caught.types.some((t) => w.types.includes(t)));
    const row = (label, r) => el('tr', {}, [
      el('th', { scope: 'row', text: label }),
      el('td', { text: `${formatNumber(r.min)} – ${formatNumber(r.max)}` }),
      el('td', {}, [el('strong', { text: formatNumber(r.max) })]),
    ]);
    const caughtName = boss.shadow ? `Crypto-${caught.name}` : caught.name;
    return el('article', { class: 'info-card info-card--catch' }, [
      el('h3', { text: 'Fangen' }),
      el('table', { class: 'cp-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { scope: 'col', text: 'WP-Spanne' }), el('th', { scope: 'col', text: '100 %' })])]),
        el('tbody', {}, [
          row(`Normal (Level ${range.normal.level})`, range.normal),
          row(`Mit Wetterboost (Level ${range.boosted.level})`, range.boosted),
        ]),
      ]),
      el('p', { class: 'info-card__line' }, [
        'Wetterboost bei ', el('strong', { text: weathers.map((w) => w.name).join(', ') || '—' }), '.',
      ]),
      el('p', { class: 'info-card__line' }, [
        `Gefangen wird ${caughtName}`, catchSuffix(caught),
        `. Mit 100 %: ${formatNumber(cp(40))} WP auf Level 40, ${formatNumber(cp(50))} WP auf Level 50.`,
      ]),
    ]);
  }

  function typeCard(pokemon) {
    const factors = Raid.TYPE_ORDER.map((type) => ({ type, factor: RaidCalc.effectiveness(data, type, pokemon.types) }));
    const weak = factors.filter((f) => f.factor > 1).sort((a, b) => b.factor - a.factor);
    const strong = factors.filter((f) => f.factor < 1).sort((a, b) => a.factor - b.factor);
    return el('article', { class: 'info-card' }, [
      el('h3', { text: 'Schwach gegen' }), factorList(weak),
      el('h3', { text: 'Resistent gegen' }), factorList(strong),
    ]);
  }

  function statCard(pokemon) {
    const max = { atk: 414, def: 396, sta: 496 };
    const stat = (label, value, top) => el('div', { class: 'stat' }, [
      el('span', { class: 'stat__label', text: label }),
      el('span', { class: 'stat__track' }, [el('span', { class: 'stat__fill', style: { '--fill': `${Math.min(100, Math.round((value / top) * 100))}%` } })]),
      el('span', { class: 'stat__value', text: String(value) }),
    ]);
    return el('article', { class: 'info-card' }, [
      el('h3', { text: 'Basiswerte' }),
      stat('Angriff', pokemon.base.atk, max.atk),
      stat('Verteidigung', pokemon.base.def, max.def),
      stat('Ausdauer', pokemon.base.sta, max.sta),
      boss.shadow ? el('p', { class: 'info-card__line', text: 'Als Crypto-Boss macht und nimmt er 20 % mehr Schaden.' }) : null,
    ]);
  }

  // Attacken des Bosses: anklicken, um nur dieses Paar zu rechnen (sonst Durchschnitt aller Paare).
  function movesCard() {
    const group = (kind, label, ids) => el('div', { class: 'boss-moves__group', role: 'group', 'aria-label': label }, [
      el('h4', { text: label }),
      el('div', { class: 'boss-moves__options' }, [
        moveButton(kind, '', el('span', { class: 'move__name', text: 'Alle' })),
        ...ids.map((id) => {
          const m = moveOf(id);
          return moveButton(kind, id, [el('span', { class: 'move__name', text: m.name }), Raid.typeChip(m.type, true)]);
        }),
      ]),
    ]);
    return el('article', { class: 'info-card info-card--moves' }, [
      el('h3', { text: 'Attacken des Bosses' }),
      el('p', { class: 'info-card__line', text: 'Kennst du die Attacken? Wähle sie aus – die Konter passen sich an.' }),
      group('bossFast', 'Sofort-Attacke', boss.fast),
      group('bossCharged', 'Lade-Attacke', boss.charged),
    ]);
  }

  function moveButton(kind, id, content) {
    return el('button', {
      type: 'button',
      class: 'move-btn',
      'aria-pressed': String(state[kind] === id),
      data: { kind, move: id },
      onclick: () => {
        state[kind] = id;
        state.listSize = LIST_STEP;
        renderCounters();
        container.querySelector(`.move-btn[data-kind="${kind}"][data-move="${id}"]`)?.focus();
      },
    }, content);
  }

  // ---------- Konter ----------

  function controls() {
    const level = el('fieldset', { class: 'segmented', id: 'level-filter' }, [
      el('legend', { class: 'control-label', text: 'Level deiner Pokémon' }),
      el('div', { class: 'segmented__options' }, data.rules.levels.map((lv) => el('label', {}, [
        el('input', {
          type: 'radio', name: 'level', value: String(lv), checked: state.level === lv, autocomplete: 'off',
          onchange: () => { state.level = lv; state.listSize = LIST_STEP; renderCounters(); focusControl(`input[name=level][value="${lv}"]`); },
        }),
        el('span', { text: `Level ${lv}` }),
      ]))),
    ]);
    const weather = el('label', { class: 'select' }, [
      el('span', { class: 'control-label', text: 'Wetter' }),
      el('select', {
        id: 'weather', autocomplete: 'off',
        onchange: (e) => { state.weather = e.target.value; state.listSize = LIST_STEP; renderCounters(); focusControl('#weather'); },
      }, [
        el('option', { value: '', text: 'Ohne Wetterboost', selected: !state.weather }),
        ...data.weather.map((w) => el('option', {
          value: w.id, selected: state.weather === w.id,
          text: `${w.name} (${w.types.map((t) => data.types[t]).join(', ')})`,
        })),
      ]),
    ]);
    const toggle = (key, label) => el('label', { class: 'toggle' }, [
      el('input', {
        type: 'checkbox', id: `toggle-${key}`, checked: state[key], autocomplete: 'off',
        onchange: (e) => { state[key] = e.target.checked; state.listSize = LIST_STEP; renderCounters(); focusControl(`#toggle-${key}`); },
      }),
      el('span', { class: 'toggle__track', 'aria-hidden': 'true' }),
      el('span', { text: label }),
    ]);
    const changed = ['level', 'shadow', 'mega', 'legendary', 'elite', 'weather'].some((k) => state[k] !== DEFAULTS[k])
      || state.bossFast || state.bossCharged;
    return el('form', { class: 'counter-controls', id: 'counter-controls', autocomplete: 'off', onsubmit: (e) => e.preventDefault() }, [
      level,
      weather,
      el('div', { class: 'counter-controls__toggles' }, [
        toggle('shadow', 'Crypto-Pokémon'),
        toggle('mega', 'Mega & Proto'),
        toggle('legendary', 'Legendäre, Mysteriöse & Ultrabestien'),
        toggle('elite', 'Elite-Attacken'),
      ]),
      changed ? el('button', {
        type: 'button', class: 'reset-btn', id: 'reset',
        onclick: () => { Object.assign(state, DEFAULTS, { bossFast: '', bossCharged: '', listSize: LIST_STEP }); renderCounters(); focusControl('input[name=level]:checked'); },
      }, ['Zurücksetzen']) : null,
    ]);
  }

  function focusControl(selector) {
    container.querySelector(selector)?.focus({ preventScroll: true });
  }

  function movesLine(entry) {
    const a = entry.attacker;
    return el('p', { class: 'row__moves' }, [
      moveChip(entry.fast, isElite(a, entry.fast.id)),
      el('span', { class: 'row__plus', 'aria-hidden': 'true', text: '+' }),
      moveChip(entry.charged, isElite(a, entry.charged.id)),
    ]);
  }

  function teamSection(list) {
    const est = RaidCalc.estimateTrainers(data, boss, list);
    const tier = data.tiers[boss.tier];
    let verdict;
    if (!Number.isFinite(est.raw)) verdict = 'Mit diesen Filtern lässt sich keine Spielerzahl schätzen.';
    else if (est.raw <= est.minTrainers && est.minTrainers > 1) {
      verdict = `Rechnerisch reicht ${est.raw <= 1 ? 'schon der Schaden einer Person' : `der Schaden von ${exactPeople(est.raw)} Personen`} – im Crypto-Raid braucht ihr trotzdem mindestens ${est.minTrainers} Personen für die Erlösten Edelsteine.`;
    } else if (est.raw <= 1) {
      verdict = 'Rechnerisch schaffst du den Boss mit diesem Team sogar allein – plane trotzdem eine zweite Person ein.';
    } else {
      verdict = `Rechnerisch braucht ihr mindestens ${Math.ceil(est.raw - 1e-9)} Personen mit solchen Teams (genau: ${exactPeople(est.raw)}).`;
    }
    return el('section', { class: 'team', 'aria-labelledby': 'team-title' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-title', id: 'team-title', text: 'Bestes Team' }),
        el('p', { text: 'Sechs Pokémon für eine Person – verschiedene Arten, höchstens eine Mega-Entwicklung.' }),
      ]),
      el('ol', { class: 'team__members', id: 'team-members' }, est.team.map((entry) => el('li', { class: 'member' }, [
        Raid.pokemonArt(entry.attacker, { size: 'sm', shadow: entry.attacker.shadow }),
        el('div', { class: 'member__info' }, [
          el('p', { class: 'member__name' }, [el('span', { text: Raid.attackerName(entry.attacker) }), ...Raid.attackerBadges(entry.attacker)]),
          el('p', { class: 'member__moves', text: `${entry.fast.name} + ${entry.charged.name}` }),
        ]),
      ]))),
      el('p', { class: 'team__verdict', id: 'team-verdict' }, [
        `Eine Person schafft damit rund ${formatNumber(Math.round(est.perTrainer / 10) * 10)} Schaden in ${tier.timerS / 60} Minuten, der Boss hat ${formatNumber(tier.hp)} KP. `,
        el('strong', { text: verdict }),
      ]),
    ]);
  }

  function rankingSection(list) {
    const shown = list.slice(0, state.listSize);
    const top = list[0]?.score ?? 1;
    const more = Math.min(LIST_MAX, list.length) > state.listSize;
    return el('section', { class: 'counters', 'aria-labelledby': 'counters-title' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-title', id: 'counters-title', text: 'Top-Konter' }),
        el('p', { id: 'counters-count', text: `${formatNumber(list.length)} Pokémon gerechnet · Level ${state.level} · ${state.weather ? data.weather.find((w) => w.id === state.weather).name : 'ohne Wetter'}` }),
      ]),
      list.length ? el('ol', { class: 'rows', id: 'counter-list' }, shown.map((entry, i) => {
        const a = entry.attacker;
        // tabindex -1: Nach "Weitere anzeigen" springt der Fokus auf die erste neue Zeile.
        return el('li', { class: `row${i < 3 ? ` row--top row--top-${i + 1}` : ''}`, tabindex: '-1', style: { '--i': String(Math.min(i, 12)) } }, [
          el('span', { class: 'row__rank', text: String(i + 1) }),
          Raid.pokemonArt(a, { size: 'sm', shadow: a.shadow }),
          el('div', { class: 'row__info' }, [
            el('p', { class: 'row__name' }, [el('span', { text: Raid.attackerName(a) }), ...Raid.attackerBadges(a)]),
            movesLine(entry),
          ]),
          el('div', { class: 'row__metric' }, [
            Raid.meter('Wertung', `${formatNumber((entry.score / top) * 100)} %`, entry.score / top, 'score'),
            el('p', { class: 'row__numbers' }, [
              el('span', { title: 'Schaden pro Sekunde' }, ['DPS ', el('strong', { text: formatNumber(entry.dps, 1) })]),
              el('span', { title: 'Gesamtschaden, bis das Pokémon besiegt ist' }, ['TDO ', el('strong', { text: formatNumber(entry.tdo) })]),
            ]),
          ]),
        ]);
      })) : el('p', { class: 'state', text: 'Mit diesen Filtern bleibt kein Pokémon übrig.' }),
      more ? el('button', {
        type: 'button', class: 'more-btn', id: 'more',
        onclick: () => { state.listSize = Math.min(LIST_MAX, state.listSize + LIST_STEP); renderCounters(); focusControl(`#counter-list > li:nth-child(${state.listSize - LIST_STEP + 1})`); },
      }, [`Weitere ${Math.min(LIST_STEP, Math.min(LIST_MAX, list.length) - state.listSize)} anzeigen`]) : null,
    ]);
  }

  // Bester Konter je Angriffstyp, der den Boss sehr effektiv trifft – hilft, wenn die Top-Konter fehlen.
  function byTypeSection(list, pokemon) {
    const types = Raid.TYPE_ORDER
      .map((type) => ({ type, factor: RaidCalc.effectiveness(data, type, pokemon.types) }))
      .filter((t) => t.factor > 1)
      .sort((a, b) => b.factor - a.factor);
    const items = types.map(({ type, factor }) => {
      const best = list.filter((e) => e.charged.type === type).slice(0, 3);
      return best.length ? { type, factor, best } : null;
    }).filter(Boolean);
    if (!items.length) return null;
    return el('section', { class: 'by-type', 'aria-labelledby': 'by-type-title' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-title', id: 'by-type-title', text: 'Die Besten je Typ' }),
        el('p', { text: 'Nach Typ der Lade-Attacke – falls dir die Top-Konter fehlen.' }),
      ]),
      el('div', { class: 'by-type__grid' }, items.map(({ type, factor, best }) => el('article', { class: `type-card type-${Raid.slugOf(type)}` }, [
        el('h3', { class: 'type-card__head' }, [Raid.typeChip(type), el('span', { class: 'type-card__factor', text: `${formatFactor(factor)} effektiv` })]),
        el('ol', { class: 'type-card__list' }, best.map((entry) => el('li', {}, [
          Raid.pokemonArt(entry.attacker, { size: 'xs', shadow: entry.attacker.shadow }),
          el('span', { class: 'type-card__name' }, [
            el('strong', { text: Raid.attackerName(entry.attacker) }),
            el('span', { text: `${entry.fast.name} + ${entry.charged.name}` }),
          ]),
        ]))),
      ]))),
    ]);
  }

  function renderCounters() {
    const pokemon = Raid.pokemon(boss.pokemon);
    const list = ranking();
    const scrollY = window.scrollY;
    container.querySelector('#counter-area').replaceChildren(
      controls(),
      list.length ? teamSection(list) : null,
      rankingSection(list),
      byTypeSection(list, pokemon),
    );
    for (const btn of container.querySelectorAll('.move-btn')) btn.setAttribute('aria-pressed', String(state[btn.dataset.kind] === btn.dataset.move));
    // Neu zeichnen darf die Seite nicht verschieben.
    window.scrollTo(0, scrollY);
  }

  function render(key, target) {
    boss = Raid.boss(key);
    container = target;
    state.bossFast = '';
    state.bossCharged = '';
    state.listSize = LIST_STEP;
    const pokemon = Raid.pokemon(boss.pokemon);
    const bossStat = RaidCalc.bossStats(data, boss);
    target.replaceChildren(
      el('a', { class: 'back-link', href: '#', id: 'back' }, ['← Alle Raid-Bosse']),
      bossPanel(pokemon, bossStat),
      el('div', { class: 'info-grid' }, [catchCard(), typeCard(pokemon), statCard(pokemon), movesCard()]),
      el('div', { id: 'counter-area' }),
    );
    renderCounters();
  }

  return { render, current: () => boss };
})();
