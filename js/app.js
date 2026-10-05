'use strict';

// Start und Navigation: Startseite (Raid-Arten), #kategorie=<art> (Bosse einer Raid-Art) und
// #boss=<schlüssel> (Boss-Seite). Zurück führt immer eine Ebene nach oben – an die gemerkte Stelle.

(() => {
  const views = {
    start: document.getElementById('view-start'),
    category: document.getElementById('view-category'),
    detail: document.getElementById('view-detail'),
  };
  const BASE_TITLE = document.title;
  let current = null; // aktuell angezeigte Route { view, key?, id? }
  const scrollMemory = new Map(); // Route -> Scroll-Position beim Verlassen
  let originList = null; // id der Liste, deren Kachel zuletzt angeklickt wurde

  const routeKey = (r) => (r.view === 'detail' ? `boss:${r.key}` : r.view === 'category' ? `kategorie:${r.id}` : 'start');

  // Jede Adresse ohne gültigen Boss oder gültige Raid-Art zeigt die Startseite (auch alte Lesezeichen).
  function parse(hash = window.location.hash) {
    const boss = /^#boss=([a-z0-9-]+)$/.exec(hash);
    if (boss && Raid.boss(boss[1])) return { view: 'detail', key: boss[1] };
    const category = /^#kategorie=([a-zA-Z]+)$/.exec(hash);
    if (category && Overview.hasGroup(category[1])) return { view: 'category', id: category[1] };
    return { view: 'start' };
  }

  const hashOf = (r) => (r.view === 'detail' ? `#boss=${r.key}` : r.view === 'category' ? `#kategorie=${r.id}` : '');

  // Ziel des Zurück-Links: Boss -> seine Raid-Art (oder die Startseite, wenn man von dort kam, etwa über
  // die Suche oder "Jetzt im Raid"), Raid-Art -> Startseite.
  function backHash(r) {
    if (r.view !== 'detail') return '';
    if (history.state?.inApp && history.state.from === '') return '';
    return `#kategorie=${Overview.groupOf(Raid.boss(r.key)).id}`;
  }

  function scrollToMain() {
    const top = document.getElementById('main').getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 8));
  }

  // Fokus beim Zurückkehren: auf die Kachel, von der man gekommen ist.
  function focusOrigin(r, previous) {
    let target = null;
    if (previous?.view === 'detail') {
      // Zuerst in der Liste, aus der man den Boss geöffnet hat (Suche oder "Jetzt im Raid").
      const visible = (list) => [...list].find((a) => a.getClientRects().length);
      const selector = `a.boss-tile[data-boss="${previous.key}"]`;
      target = (originList && visible(views[r.view].querySelectorAll(`#${originList} ${selector}`))) || visible(views[r.view].querySelectorAll(selector));
    } else if (previous?.view === 'category' && r.view === 'start') {
      target = views.start.querySelector(`.category-card[data-category="${previous.id}"]`);
    }
    (target ?? document.getElementById('main')).focus({ preventScroll: true });
  }

  function show(r, { restore = false } = {}) {
    const previous = current;
    if (previous && routeKey(previous) === routeKey(r)) return; // Zurück meldet der Browser doppelt
    if (previous) scrollMemory.set(routeKey(previous), window.scrollY);
    for (const [name, view] of Object.entries(views)) view.hidden = name !== r.view;
    if (previous?.view === 'detail' && r.view !== 'detail') views.detail.replaceChildren();
    current = r;

    if (r.view === 'detail') {
      Detail.render(r.key, views.detail, { backToStart: backHash(r) === '' });
      document.title = `${Raid.boss(r.key).name} – Konter, WP & Attacken | Raid-Kompass`;
    } else if (r.view === 'category') {
      Overview.renderCategory(r.id, views.category);
      document.title = `${Overview.groupTitle(r.id)} – Raid-Kompass`;
    } else {
      Overview.refreshSchedule();
      document.title = BASE_TITLE;
    }

    if (restore && scrollMemory.has(routeKey(r))) {
      window.scrollTo(0, scrollMemory.get(routeKey(r)));
      focusOrigin(r, previous);
    } else if (r.view === 'start') {
      if (previous) window.scrollTo(0, 0);
      if (previous) document.getElementById('main').focus({ preventScroll: true });
    } else {
      scrollToMain();
      document.getElementById(r.view === 'detail' ? 'detail-title' : 'category-title')?.focus({ preventScroll: true });
    }
  }

  // Vorwärts innerhalb der Seite: neuer Verlaufseintrag, markiert als "aus der Seite heraus" – mit der
  // Adresse, von der man kam.
  function navigate(hash) {
    history.pushState({ inApp: true, from: current ? hashOf(current) : null }, '', hash || window.location.pathname + window.location.search);
    show(parse(hash));
  }

  function init() {
    if (!Raid.ready) {
      document.getElementById('main').replaceChildren(Raid.el('div', { class: 'state state--error' }, [
        Raid.el('p', { class: 'state__title', text: 'Die Daten konnten nicht geladen werden.' }),
        Raid.el('p', { text: 'Die Datei data/raid-data.js fehlt oder ist leer. Führe "node scripts/build-data.mjs" aus.' }),
      ]));
      return;
    }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    Raid.renderSources();
    Overview.init();

    // "Zum Inhalt springen" ohne neuen Verlaufseintrag.
    document.querySelector('.skip-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      const main = document.getElementById('main');
      main.focus({ preventScroll: true });
      main.scrollIntoView();
    });

    document.getElementById('main').addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      // Zurück-Links: kam man genau von ihrem Ziel, per Verlauf zurück (mit Scroll-Position und Fokus),
      // sonst als neuer Schritt dorthin.
      if (link.id === 'back' || link.id === 'category-back') {
        e.preventDefault();
        const target = backHash(current);
        if (history.state?.inApp && history.state.from === target) history.back();
        else navigate(target);
        return;
      }
      const hash = link.getAttribute('href');
      if (!/^#(boss|kategorie)=/.test(hash)) return;
      e.preventDefault();
      originList = link.closest('ul[id]')?.id ?? null;
      navigate(hash);
    });

    window.addEventListener('popstate', () => show(parse(), { restore: true }));
    window.addEventListener('hashchange', () => show(parse(), { restore: true }));
    show(parse());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
