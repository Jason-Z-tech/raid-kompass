'use strict';

// Übersicht: Raid-Kalender (jetzt und demnächst), Suche, Raid-Art und alle Bosse als Kacheln.

const Overview = (() => {
  const { el, data } = Raid;

  // Filter-Chips: "Mega" umfasst auch Mega-Legendär.
  const FILTERS = [
    { id: 'all', label: 'Alle', match: () => true },
    { id: 'legendary', label: 'Legendär', match: (b) => b.category === 'legendary' },
    { id: 'mega', label: 'Mega', match: (b) => b.category === 'mega' || b.category === 'megaLegendary' },
    { id: 'shadow', label: 'Crypto', match: (b) => b.category === 'shadow' },
    { id: 'ultrabeast', label: 'Ultrabestien', match: (b) => b.category === 'ultrabeast' },
    { id: 'mythical', label: 'Mysteriös', match: (b) => b.category === 'mythical' },
    { id: 'primal', label: 'Proto', match: (b) => b.category === 'primal' },
  ];

  const state = { filter: 'all', query: '' };
  const tiles = new Map(); // Boss-Schlüssel -> <li>

  // Reihenfolge: Pokédex-Nummer, dann normal vor Mega/Proto vor Crypto.
  const VARIANT_ORDER = { normal: 0, mega: 1, primal: 1 };
  const sortedBosses = () => [...data.bosses].sort((a, b) => {
    const pa = Raid.pokemon(a.pokemon);
    const pb = Raid.pokemon(b.pokemon);
    return pa.dex - pb.dex || VARIANT_ORDER[pa.variant] - VARIANT_ORDER[pb.variant] || Number(a.shadow) - Number(b.shadow)
      || a.name.localeCompare(b.name, 'de');
  });

  function bossLink(boss, { size = 'sm', extra = null } = {}) {
    const pokemon = Raid.pokemon(boss.pokemon);
    return el('a', { class: 'boss-tile', href: `#boss=${boss.key}`, data: { boss: boss.key } }, [
      Raid.pokemonArt(pokemon, { size, shadow: boss.shadow }),
      el('span', { class: 'boss-tile__name', text: boss.name }),
      el('span', { class: 'boss-tile__meta' }, [Raid.categoryBadge(boss), Raid.typeDots(pokemon.types)]),
      extra,
    ]);
  }

  // ---------- Raid-Kalender ----------

  let scheduleTimer = null;

  function renderSchedule() {
    clearTimeout(scheduleTimer);
    scheduleNextRefresh();
    const now = [];
    const soon = [];
    for (const boss of data.bosses) {
      const { state: s, slot } = Raid.scheduleState(boss);
      if (s === 'now') now.push({ boss, slot });
      if (s === 'soon') soon.push({ boss, slot });
    }
    soon.sort((a, b) => Raid.localDate(a.slot.start) - Raid.localDate(b.slot.start) || a.boss.name.localeCompare(b.boss.name, 'de'));
    const section = document.getElementById('schedule');
    section.hidden = !now.length && !soon.length;
    const group = (title, items, badge, id) => (items.length ? el('div', { class: `schedule__group schedule__group--${id}` }, [
      el('h3', { class: 'schedule__title', text: title }),
      el('ul', { class: 'schedule__list', id: `schedule-${id}` }, items.map(({ boss, slot }) => el('li', {}, [
        bossLink(boss, { size: 'md', extra: badge(slot) }),
      ]))),
    ]) : null);
    document.getElementById('schedule-groups').replaceChildren(...[
      group('Jetzt im Raid', now, () => el('span', { class: 'badge badge--now', text: 'Jetzt' }), 'now'),
      group('Demnächst', soon, (slot) => el('span', { class: 'badge badge--soon', text: `Ab ${Raid.formatDay(slot.start)}` }), 'soon'),
    ].filter(Boolean));
  }

  // Beim nächsten Start oder Ende eines Raid-Termins neu zeichnen (Tabs, die offen bleiben).
  function scheduleNextRefresh() {
    const now = Date.now();
    let next = Infinity;
    for (const boss of data.bosses) {
      for (const s of boss.schedule) {
        for (const t of [s.start, s.end]) {
          const time = t ? Raid.localDate(t).getTime() : Infinity;
          if (time > now && time < next) next = time;
        }
      }
    }
    if (Number.isFinite(next)) scheduleTimer = setTimeout(renderSchedule, Math.min(next - now + 1000, 2 ** 31 - 1));
  }

  // ---------- Filter und Kacheln ----------

  function renderFilters() {
    const options = document.getElementById('category-options');
    options.replaceChildren(...FILTERS.map((f) => {
      const count = data.bosses.filter(f.match).length;
      return el('label', {}, [
        el('input', { type: 'radio', name: 'category', value: f.id, checked: f.id === state.filter, autocomplete: 'off' }),
        el('span', {}, [f.label, ' ', el('small', { text: String(count) })]),
      ]);
    }));
    options.addEventListener('change', (e) => {
      state.filter = e.target.value;
      applyFilter();
    });
  }

  function renderGrid() {
    const grid = document.getElementById('boss-grid');
    grid.replaceChildren(...sortedBosses().map((boss) => {
      const li = el('li', { data: { boss: boss.key } }, [bossLink(boss)]);
      tiles.set(boss.key, li);
      return li;
    }));
  }

  function applyFilter() {
    const filter = FILTERS.find((f) => f.id === state.filter) ?? FILTERS[0];
    const query = Raid.normalize(state.query);
    let shown = 0;
    for (const boss of data.bosses) {
      const haystack = Raid.normalize(`${boss.name} ${boss.nameEn ?? ''}`);
      const visible = filter.match(boss) && (!query || haystack.includes(query));
      tiles.get(boss.key).hidden = !visible;
      if (visible) shown++;
    }
    document.getElementById('bosses-count').textContent = `${shown} von ${data.bosses.length} Bossen`;
    const empty = document.getElementById('boss-empty');
    empty.hidden = shown > 0;
    // Ohne Treffer sagen, ob die gewählte Raid-Art schuld ist – unter "Alle" gäbe es vielleicht welche.
    const elsewhere = !shown && query && filter.id !== 'all'
      ? data.bosses.filter((b) => Raid.normalize(`${b.name} ${b.nameEn ?? ''}`).includes(query)).length : 0;
    empty.textContent = shown ? ''
      : elsewhere ? `Unter „${filter.label}“ passt kein Boss zu „${state.query}“ – unter „Alle“ gibt es ${elsewhere} Treffer.`
        : `Kein Raid-Boss passt zu „${state.query}“.`;
    document.getElementById('search-clear').hidden = !state.query;
  }

  function renderMeta() {
    const count = (match) => data.bosses.filter(match).length;
    const meta = document.getElementById('data-meta');
    meta.replaceChildren(
      el('strong', { text: String(data.bosses.length) }), ' Raid-Bosse · ',
      `${count((b) => b.category === 'mega' || b.category === 'megaLegendary' || b.category === 'primal')} Mega & Proto · `,
      `${count((b) => b.category === 'shadow')} Crypto`,
      data.sources.gameMasterDate ? ` · Spieldaten vom ${Raid.formatDate(data.sources.gameMasterDate)}` : '',
    );
  }

  function init() {
    renderMeta();
    renderSchedule();
    renderFilters();
    renderGrid();
    applyFilter();
    const search = document.getElementById('search');
    search.addEventListener('input', () => { state.query = search.value; applyFilter(); });
    document.getElementById('finder').addEventListener('submit', (e) => e.preventDefault());
    document.getElementById('search-clear').addEventListener('click', () => {
      search.value = '';
      state.query = '';
      applyFilter();
      search.focus();
    });
    // Der Browser stellt Formularwerte beim Neuladen wieder her – Anzeige daran angleichen.
    window.addEventListener('pageshow', () => {
      state.query = search.value;
      state.filter = document.querySelector('input[name=category]:checked')?.value ?? 'all';
      applyFilter();
      renderSchedule();
    });
    // "Jetzt im Raid" auf dem neuesten Stand halten: beim Zurückkehren in den Tab und zum nächsten Wechsel.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderSchedule(); });
  }

  // Nach der Rückkehr aus der Detailansicht die zuletzt geöffnete Kachel fokussieren.
  function focusTile(key) {
    const link = tiles.get(key)?.querySelector('a');
    if (!link || tiles.get(key).hidden) return false;
    link.focus({ preventScroll: true });
    return true;
  }

  return { init, focusTile, refreshSchedule: renderSchedule };
})();
