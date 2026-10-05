'use strict';

// Boss-Seite: oben kompakt das Wichtigste (Boss-WP, 100-%-Fang-WP, Wetter, Schwächen, Spielerzahl),
// darunter zwei Reiter – "Konter" (bestes Team, Top-Konter, beste Mega-Entwicklung) und "Boss-Infos".

const Detail = (() => {
  const { el, data, formatNumber, formatFactor } = Raid;

  const LIST_STEP = 10;
  const LIST_MAX = 50;
  // Crypto-Pokémon sind standardmäßig aus: Sie sind selten und stünden sonst fast immer ganz oben.
  const DEFAULTS = { level: data?.rules.defaultLevel ?? 40, shadow: false, legendary: true, elite: true, weather: '' };
  const TABS = [
    { id: 'konter', label: 'Konter' },
    { id: 'infos', label: 'Boss-Infos' },
  ];

  // Einstellungen bleiben beim Wechsel zu einem anderen Boss erhalten, die Boss-Attacken nicht.
  const state = { ...DEFAULTS, bossFast: '', bossCharged: '', listSize: LIST_STEP, tab: 'konter', moreOpen: false };
  let boss = null;
  let container = null;
  const cache = new Map();

  // ---------- Rechnung ----------

  // Die volle Rangliste (alle Varianten) hängt nur von Level, Elite, Wetter und Boss-Attacken ab –
  // die Schalter für Crypto und Legendäre filtern sie nur. So bleibt jeder Klick schnell.
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

  const isMega = (attacker) => attacker.variant === 'mega' || attacker.variant === 'primal';
  const passes = (entry, opts) => (opts.shadow || !entry.attacker.shadow) && (opts.legendary || !entry.attacker.class);

  // Alle Pokémon, die die Schalter durchlassen – mit Mega-Entwicklungen (für das Team).
  const ranking = (opts = state) => fullRanking(opts).filter((e) => passes(e, opts));

  // Spielerzahl: von den besten Kontern (Level 40, mit Crypto und Mega) bis zu Level-30-Pokémon ohne beides.
  function trainerRange() {
    const best = { ...DEFAULTS, shadow: true, level: 40, bossFast: '', bossCharged: '' };
    const casual = { ...best, level: 30, shadow: false };
    return [
      RaidCalc.estimateTrainers(data, boss, ranking(best)).trainers,
      RaidCalc.estimateTrainers(data, boss, ranking(casual).filter((e) => !isMega(e.attacker))).trainers,
    ];
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

  function factors(pokemon) {
    const all = Raid.TYPE_ORDER.map((type) => ({ type, factor: RaidCalc.effectiveness(data, type, pokemon.types) }));
    return {
      weak: all.filter((f) => f.factor > 1).sort((a, b) => b.factor - a.factor),
      strong: all.filter((f) => f.factor < 1).sort((a, b) => a.factor - b.factor),
    };
  }

  // Rechnerische Spielerzahl auf eine Nachkommastelle, immer aufgerundet: "2,04" wird "2,1", nie "2,0".
  const exactPeople = (n) => formatNumber(Math.ceil(n * 10 - 1e-9) / 10, 1);

  function crowdText() {
    const [lo, hi] = trainerRange().map((n) => (Number.isFinite(n) ? Math.ceil(n) : null));
    if (!lo) return 'unbekannt';
    if (lo === hi) return lo <= 1 ? 'allein' : `${lo} Personen`;
    return `${lo}–${hi ?? '?'} Personen`;
  }

  // ---------- Kopf: das Wichtigste auf einen Blick ----------

  function bossPanel(pokemon) {
    const { state: when, slot } = Raid.scheduleState(boss);
    const bossStat = RaidCalc.bossStats(data, boss);
    const range = RaidCalc.catchRange(data, boss);
    const caught = Raid.pokemon(boss.catchPokemon);
    const weathers = data.weather.filter((w) => caught.types.some((t) => w.types.includes(t))).map((w) => w.name).join(', ');
    const tier = data.tiers[boss.tier];
    const fact = (label, value, title = null) => el('div', { title }, [el('dt', { text: label }), el('dd', { text: value })]);
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
          fact('Boss-WP', formatNumber(bossStat.cp)),
          fact('Fang-WP 100 %', formatNumber(range.normal.max), `Level ${range.normal.level}, Werte 15/15/15`),
          fact('Mit Wetter 100 %', formatNumber(range.boosted.max), `Level ${range.boosted.level}${weathers ? `, Wetterboost bei ${weathers}` : ''}`),
          fact('Spieler*innen', crowdText(), 'Mit den besten Kontern auf Level 40 bis zu Level-30-Pokémon ohne Mega und Crypto'),
        ]),
        el('p', { class: 'boss__weak' }, [el('span', { class: 'boss__weak-label', text: 'Schwach gegen' }), factorList(factors(pokemon).weak)]),
        boss.shadow ? el('p', { class: 'boss__note boss__note--shadow', text: 'Crypto-Raid: Der Boss macht und nimmt 20 % mehr Schaden (schon eingerechnet). Ab 60 % KP wird er rasend – mit 8 Erlösten Edelsteinen (höchstens 5 pro Person) bändigt ihr ihn wieder. Deshalb braucht ihr mindestens 2 Personen.' }) : null,
      ]),
    ]);
  }

  // ---------- Reiter "Boss-Infos" ----------

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
    const { weak, strong } = factors(pokemon);
    return el('article', { class: 'info-card' }, [
      el('h3', { text: 'Schwach gegen' }), factorList(weak),
      el('h3', { text: 'Resistent gegen' }), factorList(strong),
    ]);
  }

  function statCard(pokemon) {
    const max = { atk: 414, def: 396, sta: 496 };
    const tier = data.tiers[boss.tier];
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
      el('p', { class: 'info-card__line' }, [
        `Als Raid-Boss: ${formatNumber(tier.hp)} KP, ${tier.timerS / 60} Minuten Zeit.`,
        boss.shadow ? ' Als Crypto-Boss macht und nimmt er 20 % mehr Schaden.' : '',
      ]),
    ]);
  }

  function movesCard() {
    const list = (label, ids) => [
      el('h4', { text: label }),
      el('div', { class: 'factor-list' }, ids.map((id) => moveChip(moveOf(id)))),
    ];
    return el('article', { class: 'info-card' }, [
      el('h3', { text: 'Attacken des Bosses' }),
      ...list('Sofort-Attacken', boss.fast),
      ...list('Lade-Attacken', boss.charged),
      el('p', { class: 'info-card__line', text: 'Kennst du seine Attacken? Unter „Konter“ → „Mehr Einstellungen“ kannst du sie auswählen.' }),
    ]);
  }

  function infoNotes() {
    const notes = [];
    if (boss.superMega) {
      notes.push(['boss__note boss__note--mega', 'Kam auch als Super-Mega-Raid: Dort baut der Boss Schilde auf, die nur Mega-Pokémon mit einer Lade-Attacke brechen – jede Person höchstens einen. Dafür braucht ihr 7 bis 10 Personen, alle mit einem Mega-Pokémon im Team.']);
    }
    return notes.map(([cls, text]) => el('p', { class: cls, text }));
  }

  function infosPanel(pokemon) {
    return [
      ...infoNotes(),
      el('div', { class: 'info-grid' }, [catchCard(), typeCard(pokemon), statCard(pokemon), movesCard()]),
    ];
  }

  // ---------- Reiter "Konter": Einstellungen ----------

  function toggle(key, label, hint = null) {
    return el('label', { class: 'toggle' }, [
      el('input', {
        type: 'checkbox', id: `toggle-${key}`, checked: state[key], autocomplete: 'off',
        onchange: (e) => { state[key] = e.target.checked; state.listSize = LIST_STEP; renderPanel(); focusControl(`#toggle-${key}`); },
      }),
      el('span', { class: 'toggle__track', 'aria-hidden': 'true' }),
      el('span', { class: 'toggle__text' }, [label, hint ? el('small', { text: hint }) : null]),
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
        renderPanel();
        focusControl(`.move-btn[data-kind="${kind}"][data-move="${id}"]`);
      },
    }, content);
  }

  function bossMoveChoice(kind, label, ids) {
    return el('div', { class: 'boss-moves__group', role: 'group', 'aria-label': `${label} des Bosses` }, [
      el('span', { class: 'control-label', text: `${label} des Bosses` }),
      el('div', { class: 'boss-moves__options' }, [
        moveButton(kind, '', el('span', { class: 'move__name', text: 'Alle' })),
        ...ids.map((id) => {
          const m = moveOf(id);
          return moveButton(kind, id, [el('span', { class: 'move__name', text: m.name }), Raid.typeChip(m.type, true)]);
        }),
      ]),
    ]);
  }

  function controls() {
    const level = el('fieldset', { class: 'segmented', id: 'level-filter' }, [
      el('legend', { class: 'control-label', text: 'Level deiner Pokémon' }),
      el('div', { class: 'segmented__options' }, data.rules.levels.map((lv) => el('label', {}, [
        el('input', {
          type: 'radio', name: 'level', value: String(lv), checked: state.level === lv, autocomplete: 'off',
          onchange: () => { state.level = lv; state.listSize = LIST_STEP; renderPanel(); focusControl(`input[name=level][value="${lv}"]`); },
        }),
        el('span', { text: `Level ${lv}` }),
      ]))),
    ]);
    const weather = el('label', { class: 'select' }, [
      el('span', { class: 'control-label', text: 'Wetter' }),
      el('select', {
        id: 'weather', autocomplete: 'off',
        onchange: (e) => { state.weather = e.target.value; state.listSize = LIST_STEP; renderPanel(); focusControl('#weather'); },
      }, [
        el('option', { value: '', text: 'Ohne Wetterboost', selected: !state.weather }),
        ...data.weather.map((w) => el('option', {
          value: w.id, selected: state.weather === w.id,
          text: `${w.name} (${w.types.map((t) => data.types[t]).join(', ')})`,
        })),
      ]),
    ]);
    const changed = ['level', 'shadow', 'legendary', 'elite', 'weather'].some((k) => state[k] !== DEFAULTS[k])
      || state.bossFast || state.bossCharged;
    const more = el('details', {
      class: 'more-settings', id: 'more-settings', open: state.moreOpen,
      ontoggle: (e) => { state.moreOpen = e.target.open; },
    }, [
      el('summary', { text: 'Mehr Einstellungen' }),
      el('div', { class: 'more-settings__body' }, [
        weather,
        el('div', { class: 'counter-controls__toggles' }, [
          toggle('legendary', 'Legendäre, Mysteriöse & Ultrabestien'),
          toggle('elite', 'Elite-Attacken', 'nur mit Elite-TM oder von Events'),
        ]),
        bossMoveChoice('bossFast', 'Sofort-Attacke', boss.fast),
        bossMoveChoice('bossCharged', 'Lade-Attacke', boss.charged),
      ]),
    ]);
    return el('form', { class: 'counter-controls', id: 'counter-controls', autocomplete: 'off', onsubmit: (e) => e.preventDefault() }, [
      level,
      el('div', { class: 'crypto-switch' }, [toggle('shadow', 'Crypto-Pokémon', state.shadow ? 'an – Crypto-Pokémon zählen mit' : 'aus – nur normale Pokémon')]),
      more,
      changed ? el('button', {
        type: 'button', class: 'reset-btn', id: 'reset',
        onclick: () => {
          Object.assign(state, DEFAULTS, { bossFast: '', bossCharged: '', listSize: LIST_STEP });
          renderPanel();
          focusControl('input[name=level]:checked');
        },
      }, ['Zurücksetzen']) : null,
    ]);
  }

  function focusControl(selector) {
    container.querySelector(selector)?.focus({ preventScroll: true });
  }

  // ---------- Reiter "Konter": Listen ----------

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
    if (!Number.isFinite(est.raw)) verdict = 'Mit diesen Einstellungen lässt sich keine Spielerzahl schätzen.';
    else if (est.raw <= est.minTrainers && est.minTrainers > 1) {
      verdict = `Rechnerisch reicht ${est.raw <= 1 ? 'schon der Schaden einer Person' : `der Schaden von ${exactPeople(est.raw)} Personen`} – im Crypto-Raid braucht ihr trotzdem mindestens ${est.minTrainers} Personen für die Erlösten Edelsteine.`;
    } else if (est.raw <= 1) {
      verdict = 'Rechnerisch schaffst du den Boss mit diesem Team sogar allein – plane trotzdem eine zweite Person ein.';
    } else {
      verdict = `Rechnerisch braucht ihr mindestens ${Math.ceil(est.raw - 1e-9)} Personen mit solchen Teams (genau: ${exactPeople(est.raw)}).`;
    }
    return el('section', { class: 'team', 'aria-labelledby': 'team-title' }, [
      el('div', { class: 'section-head' }, [
        el('h3', { class: 'section-title section-title--small', id: 'team-title', text: 'Bestes Team' }),
        el('p', { text: 'Sechs verschiedene Pokémon für eine Person, höchstens eine Mega-Entwicklung.' }),
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

  function counterRow(entry, i, top, { compact = false } = {}) {
    const a = entry.attacker;
    // tabindex -1: Nach "Weitere anzeigen" springt der Fokus auf die erste neue Zeile.
    return el('li', { class: `row${!compact && i < 3 ? ` row--top row--top-${i + 1}` : ''}`, tabindex: '-1', style: { '--i': String(Math.min(i, 12)) } }, [
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
  }

  function rankingSection(list) {
    const shown = list.slice(0, state.listSize);
    const top = list[0]?.score ?? 1;
    const more = Math.min(LIST_MAX, list.length) > state.listSize;
    const weatherName = state.weather ? data.weather.find((w) => w.id === state.weather).name : 'ohne Wetter';
    return el('section', { class: 'counters', 'aria-labelledby': 'counters-title' }, [
      el('div', { class: 'section-head' }, [
        el('h3', { class: 'section-title section-title--small', id: 'counters-title', text: 'Top-Konter' }),
        el('p', { id: 'counters-count', text: `Level ${state.level} · ${weatherName} · ${state.shadow ? 'mit' : 'ohne'} Crypto-Pokémon` }),
      ]),
      list.length ? el('ol', { class: 'rows', id: 'counter-list' }, shown.map((entry, i) => counterRow(entry, i, top)))
        : el('p', { class: 'state', text: 'Mit diesen Einstellungen bleibt kein Pokémon übrig.' }),
      more ? el('button', {
        type: 'button', class: 'more-btn', id: 'more',
        onclick: () => {
          state.listSize = Math.min(LIST_MAX, state.listSize + LIST_STEP);
          renderPanel();
          focusControl(`#counter-list > li:nth-child(${state.listSize - LIST_STEP + 1})`);
        },
      }, [`Weitere ${Math.min(LIST_STEP, Math.min(LIST_MAX, list.length) - state.listSize)} anzeigen`]) : null,
    ]);
  }

  // Mega-Entwicklungen getrennt: Pro Person ist im Raid nur eine aktiv.
  function megaSection(megas) {
    if (!megas.length) return null;
    const top = megas[0].score;
    return el('section', { class: 'megas', 'aria-labelledby': 'megas-title' }, [
      el('div', { class: 'section-head' }, [
        el('h3', { class: 'section-title section-title--small', id: 'megas-title', text: 'Beste Mega-Entwicklung' }),
        el('p', { text: 'Pro Person ist nur eine aktiv. Sie stärkt außerdem die Attacken aller anderen im Raid (+10 %, ihres Typs +30 %).' }),
      ]),
      el('ol', { class: 'rows rows--compact', id: 'mega-list' }, megas.slice(0, 3).map((entry, i) => counterRow(entry, i, top, { compact: true }))),
    ]);
  }

  // Bester Konter je Angriffstyp, der den Boss sehr effektiv trifft – hilft, wenn die Top-Konter fehlen.
  function byTypeSection(list, pokemon) {
    const items = factors(pokemon).weak.map(({ type, factor }) => {
      const best = list.filter((e) => e.charged.type === type).slice(0, 3);
      return best.length ? { type, factor, best } : null;
    }).filter(Boolean);
    if (!items.length) return null;
    return el('details', { class: 'by-type', id: 'by-type' }, [
      el('summary', {}, [el('span', { text: 'Die Besten je Typ' }), el('small', { text: ' – falls dir die Top-Konter fehlen' })]),
      el('div', { class: 'by-type__grid' }, items.map(({ type, factor, best }) => el('article', { class: `type-card type-${Raid.slugOf(type)}` }, [
        el('h4', { class: 'type-card__head' }, [Raid.typeChip(type), el('span', { class: 'type-card__factor', text: `${formatFactor(factor)} effektiv` })]),
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

  function countersPanel(pokemon) {
    const all = ranking();
    const normal = all.filter((e) => !isMega(e.attacker));
    return [
      controls(),
      all.length ? teamSection(all) : null,
      rankingSection(normal),
      megaSection(all.filter((e) => isMega(e.attacker))),
      byTypeSection(normal, pokemon),
    ];
  }

  // ---------- Reiter ----------

  function tabs() {
    return el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Ansicht' }, TABS.map((t) => el('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${t.id}`,
      class: 'tabs__btn',
      'aria-selected': String(t.id === state.tab),
      'aria-controls': 'tab-panel',
      tabindex: t.id === state.tab ? '0' : '-1',
      onclick: () => selectTab(t.id),
      onkeydown: onTabKey,
    }, [t.label])));
  }

  function selectTab(id) {
    state.tab = id;
    for (const btn of container.querySelectorAll('.tabs__btn')) {
      const active = btn.id === `tab-${id}`;
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
    }
    container.querySelector('#tab-panel').setAttribute('aria-labelledby', `tab-${id}`);
    renderPanel();
    container.querySelector(`#tab-${id}`).focus();
  }

  // Pfeiltasten wechseln zwischen den Reitern (Tastatur-Bedienung).
  function onTabKey(e) {
    const i = TABS.findIndex((t) => t.id === state.tab);
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: TABS.length - 1 - i };
    if (!(e.key in moves)) return;
    e.preventDefault();
    selectTab(TABS[(i + moves[e.key] + TABS.length) % TABS.length].id);
  }

  function renderPanel() {
    const pokemon = Raid.pokemon(boss.pokemon);
    const scrollY = window.scrollY;
    container.querySelector('#tab-panel').replaceChildren(...(state.tab === 'konter' ? countersPanel(pokemon) : infosPanel(pokemon)).filter(Boolean));
    // Neu zeichnen darf die Seite nicht verschieben.
    window.scrollTo(0, scrollY);
  }

  // backToStart: Der Zurück-Link führt zur Startseite statt zur Raid-Art (man kam über Suche oder Kalender).
  function render(key, target, { backToStart = false } = {}) {
    // Ein anderer Boss beginnt immer mit den Kontern.
    if (boss?.key !== key) state.tab = 'konter';
    boss = Raid.boss(key);
    container = target;
    state.bossFast = '';
    state.bossCharged = '';
    state.listSize = LIST_STEP;
    const pokemon = Raid.pokemon(boss.pokemon);
    const group = Overview.groupOf(boss);
    target.replaceChildren(
      backToStart ? el('a', { class: 'back-link', href: '#', id: 'back' }, ['← Startseite'])
        : el('a', { class: 'back-link', href: `#kategorie=${group.id}`, id: 'back' }, [`← ${group.heading}`]),
      bossPanel(pokemon),
      tabs(),
      el('div', { id: 'tab-panel', class: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` }),
    );
    renderPanel();
  }

  return { render, current: () => boss };
})();
