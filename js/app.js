'use strict';

// Start und Navigation: #boss=<schlüssel> zeigt die Detailansicht, sonst die Übersicht.

(() => {
  const overviewView = document.getElementById('view-overview');
  const detailView = document.getElementById('view-detail');
  const BASE_TITLE = document.title;
  let view = null; // noch nichts angezeigt
  let listScroll = null; // Scroll-Position der Übersicht, nur wenn sie vorher sichtbar war
  let lastKey = null;
  let lastTileInSchedule = false; // kam der Klick aus dem Raid-Kalender? Dann dorthin zurück, nicht in die Liste

  function keyFromHash() {
    const match = /^#boss=([a-z0-9-]+)$/.exec(window.location.hash);
    return match && Raid.boss(match[1]) ? match[1] : null;
  }

  function showOverview() {
    detailView.hidden = true;
    detailView.replaceChildren();
    overviewView.hidden = false;
    document.title = BASE_TITLE;
    if (view === 'overview') return;
    Overview.refreshSchedule();
    const firstView = view === null;
    view = 'overview';
    if (firstView) return;
    // Zurück zur gemerkten Stelle und zur zuletzt geöffneten Kachel. Kam man per Direktlink,
    // gibt es keine gemerkte Stelle: dann oben bei der Liste beginnen.
    if (listScroll !== null) {
      window.scrollTo(0, listScroll);
      // Der Raid-Kalender wird beim Zurückkehren neu gezeichnet – die Kachel dort neu suchen.
      const tile = lastTileInSchedule && lastKey ? document.querySelector(`#schedule-groups a.boss-tile[data-boss="${lastKey}"]`) : null;
      if (tile) {
        tile.focus({ preventScroll: true });
        return;
      }
      if (lastKey && Overview.focusTile(lastKey)) return;
    } else {
      window.scrollTo(0, 0);
    }
    document.getElementById('main').focus({ preventScroll: true });
  }

  function showDetail(key) {
    if (view === 'overview') listScroll = window.scrollY;
    Detail.render(key, detailView);
    overviewView.hidden = true;
    detailView.hidden = false;
    document.title = `${Raid.boss(key).name} – Konter, WP & Attacken | Raid-Kompass`;
    view = 'detail';
    lastKey = key;
    const top = document.getElementById('main').getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 8));
    document.getElementById('detail-title')?.focus({ preventScroll: true });
  }

  // Jede Adresse ohne gültigen Boss zeigt die Übersicht (auch alte Lesezeichen wie #main).
  function route() {
    const key = keyFromHash();
    // Zurück/Vorwärts meldet der Browser doppelt (popstate und hashchange) – nur einmal zeichnen.
    if (key && view === 'detail' && key === lastKey && !detailView.hidden) return;
    if (key) showDetail(key); else showOverview();
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
    // "Zum Inhalt springen" ohne neuen Verlaufseintrag – sonst stünde #main zwischen Boss und Übersicht.
    document.querySelector('.skip-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      const main = document.getElementById('main');
      main.focus({ preventScroll: true });
      main.scrollIntoView();
    });
    // Der Zurück-Link führt zur Übersicht, ohne einen leeren "#" in der Adresse zu hinterlassen.
    document.addEventListener('click', (e) => {
      const back = e.target.closest('#back');
      if (!back) return;
      e.preventDefault();
      if (history.state?.fromOverview) history.back();
      else { history.pushState(null, '', window.location.pathname + window.location.search); route(); }
    });
    // Kacheln merken sich, dass man von der Übersicht kam – dann bringt "Zurück" exakt dorthin.
    document.getElementById('view-overview').addEventListener('click', (e) => {
      const tile = e.target.closest('a.boss-tile');
      if (!tile || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      lastTileInSchedule = Boolean(tile.closest('#schedule'));
      history.pushState({ fromOverview: true }, '', `#boss=${tile.dataset.boss}`);
      route();
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
