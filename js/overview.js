'use strict';

// Startseite und Kategorien: "Jetzt im Raid", Kacheln je Raid-Art, Suche über alle Bosse und die
// Boss-Liste einer Raid-Art.

const Overview = (() => {
  const { el, data } = Raid;

  // Raid-Arten in der Reihenfolge der Startseite. "Mega" umfasst auch Mega-Legendär.
  const GROUPS = [
    { id: 'legendary', title: 'Legendär', heading: 'Legendäre Raid-Bosse', text: '5-Sterne-Raids', match: (b) => b.category === 'legendary' },
    { id: 'mega', title: 'Mega', heading: 'Mega-Raid-Bosse', text: 'Mega- und Mega-Legendär-Raids', match: (b) => b.category === 'mega' || b.category === 'megaLegendary' },
    { id: 'shadow', title: 'Crypto', heading: 'Crypto-Raid-Bosse', text: '5-Sterne-Crypto-Raids', match: (b) => b.category === 'shadow' },
    { id: 'ultrabeast', title: 'Ultrabestien', heading: 'Ultrabestien', text: '5-Sterne-Raids', match: (b) => b.category === 'ultrabeast' },
    { id: 'mythical', title: 'Mysteriös', heading: 'Mysteriöse Raid-Bosse', text: '5-Sterne-Raids', match: (b) => b.category === 'mythical' },
    { id: 'primal', title: 'Proto', heading: 'Proto-Raid-Bosse', text: 'Proto-Raids', match: (b) => b.category === 'primal' },
  ];
  const groupById = new Map(GROUPS.map((g) => [g.id, g]));
  const groupOf = (boss) => GROUPS.find((g) => g.match(boss));

  // Reihenfolge: Pokédex-Nummer, dann normal vor Mega/Proto vor Crypto.
  const VARIANT_ORDER = { normal: 0, mega: 1, primal: 1 };
  const byDex = (a, b) => {
    const pa = Raid.pokemon(a.pokemon);
    const pb = Raid.pokemon(b.pokemon);
    return pa.dex - pb.dex || VARIANT_ORDER[pa.variant] - VARIANT_ORDER[pb.variant] || Number(a.shadow) - Number(b.shadow)
      || a.name.localeCompare(b.name, 'de');
  };

  const state = { query: '' };

  function bossLink(boss, { size = 'sm', extra = null, eager = false } = {}) {
    const pokemon = Raid.pokemon(boss.pokemon);
    return el('a', { class: 'boss-tile', href: `#boss=${boss.key}`, data: { boss: boss.key } }, [
      Raid.pokemonArt(pokemon, { size, shadow: boss.shadow, eager }),
      el('span', { class: 'boss-tile__name', text: boss.name }),
      el('span', { class: 'boss-tile__meta' }, [Raid.categoryBadge(boss), Raid.typeDots(pokemon.types)]),
      extra,
    ]);
  }

  const nowBadge = () => el('span', { class: 'badge badge--now', text: 'Jetzt' });
  const isNow = (boss) => Raid.scheduleState(boss).state === 'now';

  // ---------- Jetzt im Raid ----------

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
    document.getElementById('schedule').hidden = !now.length && !soon.length;
    document.getElementById('schedule-now').replaceChildren(...now.map(({ boss }) => el('li', {}, [bossLink(boss, { size: 'md', extra: nowBadge(), eager: true })])));
    document.getElementById('schedule-now').hidden = !now.length;
    document.getElementById('schedule-soon-wrap').hidden = !soon.length;
    document.getElementById('schedule-soon-count').textContent = `(${soon.length})`;
    document.getElementById('schedule-soon').replaceChildren(...soon.map(({ boss, slot }) => el('li', {}, [
      bossLink(boss, { extra: el('span', { class: 'badge badge--soon', text: `Ab ${Raid.formatDay(slot.start)}` }) }),
    ])));
    // Die Kacheln der Raid-Arten zeigen, wie viele Bosse gerade im Raid sind.
    renderCategoryCards();
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

  // ---------- Raid-Arten ----------

  function renderCategoryCards() {
    document.getElementById('category-grid').replaceChildren(...GROUPS.map((g) => {
      const bosses = data.bosses.filter(g.match);
      if (!bosses.length) return null;
      // Vorschau: zuerst Bosse, die gerade im Raid sind, dann die ersten nach Pokédex.
      const preview = [...bosses].sort((a, b) => Number(isNow(b)) - Number(isNow(a)) || byDex(a, b)).slice(0, 3);
      const current = bosses.filter(isNow).length;
      return el('li', {}, [el('a', { class: `category-card category-card--${g.id}`, href: `#kategorie=${g.id}`, data: { category: g.id } }, [
        el('span', { class: 'category-card__art', 'aria-hidden': 'true' }, preview.map((b) => Raid.pokemonArt(Raid.pokemon(b.pokemon), { size: 'sm', shadow: b.shadow, eager: true }))),
        el('span', { class: 'category-card__title', text: g.title }),
        el('span', { class: 'category-card__text' }, [g.text, el('span', { class: 'category-card__count', text: ` ${bosses.length} Bosse` })]),
        current ? el('span', { class: 'badge badge--now', text: `${current} jetzt im Raid` }) : null,
      ])]);
    }).filter(Boolean));
  }

  // ---------- Suche ----------

  function applySearch() {
    const query = Raid.normalize(state.query);
    const results = document.getElementById('search-results');
    document.getElementById('search-clear').hidden = !state.query;
    document.getElementById('category-grid').hidden = Boolean(query);
    results.hidden = !query;
    if (!query) return;
    const hits = data.bosses.filter((b) => Raid.normalize(`${b.name} ${b.nameEn ?? ''}`).includes(query)).sort(byDex);
    document.getElementById('search-count').textContent = hits.length
      ? `${hits.length} ${hits.length === 1 ? 'Boss passt' : 'Bosse passen'} zu „${state.query}“`
      : `Kein Raid-Boss passt zu „${state.query}“.`;
    document.getElementById('search-grid').replaceChildren(...hits.map((boss) => el('li', {}, [bossLink(boss, { extra: isNow(boss) ? nowBadge() : null })])));
  }

  // ---------- Boss-Liste einer Raid-Art ----------

  function renderCategory(id, target) {
    const g = groupById.get(id);
    const bosses = data.bosses.filter(g.match).sort(byDex);
    target.replaceChildren(
      el('a', { class: 'back-link', href: '#', id: 'category-back' }, ['← Alle Raid-Arten']),
      el('div', { class: `category-head category-head--${g.id}` }, [
        el('p', { class: 'category-head__eyebrow', text: g.text }),
        el('h2', { class: 'section-title', id: 'category-title', tabindex: '-1', text: g.heading }),
        el('p', { class: 'section-head__count', id: 'category-count', text: `${bosses.length} Bosse – tippe einen an für Konter und Infos.` }),
      ]),
      el('ul', { class: 'boss-grid', id: 'category-grid-list' }, bosses.map((boss) => el('li', { data: { boss: boss.key } }, [
        bossLink(boss, { extra: isNow(boss) ? nowBadge() : null }),
      ]))),
    );
  }

  function init() {
    const count = (match) => data.bosses.filter(match).length;
    document.getElementById('data-meta').replaceChildren(
      el('strong', { text: String(data.bosses.length) }), ' Raid-Bosse · ',
      `${count((b) => b.category === 'mega' || b.category === 'megaLegendary' || b.category === 'primal')} Mega & Proto · `,
      `${count((b) => b.category === 'shadow')} Crypto`,
      data.sources.gameMasterDate ? ` · Spieldaten vom ${Raid.formatDate(data.sources.gameMasterDate)}` : '',
    );
    renderSchedule();
    const search = document.getElementById('search');
    search.addEventListener('input', () => { state.query = search.value; applySearch(); });
    document.getElementById('finder').addEventListener('submit', (e) => e.preventDefault());
    document.getElementById('search-clear').addEventListener('click', () => {
      search.value = '';
      state.query = '';
      applySearch();
      search.focus();
    });
    // Der Browser stellt Formularwerte beim Neuladen wieder her – Anzeige daran angleichen.
    window.addEventListener('pageshow', () => {
      state.query = search.value;
      applySearch();
      renderSchedule();
    });
    // "Jetzt im Raid" auf dem neuesten Stand halten: beim Zurückkehren in den Tab und zum nächsten Wechsel.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderSchedule(); });
  }

  return {
    init, renderCategory, refreshSchedule: renderSchedule, groupOf, hasGroup: (id) => groupById.has(id),
    groupTitle: (id) => groupById.get(id)?.heading,
  };
})();
