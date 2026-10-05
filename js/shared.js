'use strict';

// Gemeinsame Bausteine: Datenzugriff, DOM-Helfer, Texte, Datum und Formatierung.
// Klassisches Skript statt ES-Modul, damit die Seite auch per Doppelklick (file://) läuft.
// Alle Inhalte werden per textContent/DOM gebaut, nie per innerHTML (Schutz vor XSS).

const Raid = (() => {
  const data = window.RAID_DATA ?? null;
  const ready = Boolean(data?.bosses?.length && data?.pokemon?.length);
  if (ready) {
    // Nachschlage-Tabellen für die Rechnung (RaidCalc) und die Darstellung.
    data.pokemonByKey = Object.fromEntries(data.pokemon.map((p) => [p.key, p]));
  }
  const bossByKey = new Map(ready ? data.bosses.map((b) => [b.key, b]) : []);

  const TYPE_ORDER = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
    'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];

  // Kategorien der Bosse: Name, Raid-Art und Reihenfolge auf der Seite.
  const CATEGORIES = {
    legendary: { label: 'Legendär', tier: '5-Sterne-Raid' },
    mythical: { label: 'Mysteriös', tier: '5-Sterne-Raid' },
    ultrabeast: { label: 'Ultrabestie', tier: '5-Sterne-Raid' },
    mega: { label: 'Mega', tier: 'Mega-Raid' },
    megaLegendary: { label: 'Mega-Legendär', tier: 'Mega-Raid' },
    primal: { label: 'Proto', tier: 'Proto-Raid' },
    shadow: { label: 'Crypto', tier: '5-Sterne-Crypto-Raid' },
  };

  // ---------- DOM ----------

  // Baut Elemente ohne innerHTML, damit Daten nie als HTML interpretiert werden.
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
      else if (key === 'data') for (const [k, v] of Object.entries(value)) node.dataset[k] = v;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const formatNumber = (n, digits = 0) => n.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const formatFactor = (f) => `×${f.toLocaleString('de-CH', { maximumFractionDigits: 2 })}`;
  const slugOf = (type) => type.toLowerCase();

  // Suche ohne Rücksicht auf Groß-/Kleinschreibung und Akzente ("pokemon" findet "Pokémon").
  const normalize = (text) => text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u2640\u2642]+/g, ' ').trim();

  // ---------- Datum ----------

  // Termine des Raid-Kalenders sind Ortszeiten ohne Zeitzone ("2026-10-07T06:00"): Raids wechseln überall
  // zur selben Uhrzeit vor Ort. Deshalb als Ortszeit des Geräts lesen, nie über Weltzeit umrechnen.
  function localDate(text) {
    const [day, time = '00:00'] = text.split('T');
    const [y, m, d] = day.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
  }

  // "7. Oktober", mit Jahr nur, wenn es nicht das laufende ist.
  function formatDay(text) {
    const date = localDate(text);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('de-CH', sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const formatDate = (iso) => new Date(iso).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });

  // Raid-Termine eines Bosses relativ zu jetzt: läuft gerade, kommt bald, oder nichts davon.
  function scheduleState(boss, now = new Date()) {
    let next = null;
    for (const s of boss.schedule) {
      const start = localDate(s.start);
      const end = s.end ? localDate(s.end) : null;
      if (start <= now && (!end || now <= end)) return { state: 'now', slot: s };
      if (start > now && (!next || start < localDate(next.start))) next = s;
    }
    return next ? { state: 'soon', slot: next } : { state: null, slot: null };
  }

  // ---------- Bausteine ----------

  // Ohne Typ (Kraftreserve: im Raid zufällig) ein neutraler Chip "Zufall".
  function typeChip(type, small = false) {
    if (!type) return el('span', { class: `type-chip type-random${small ? ' type-chip--small' : ''}`, text: 'Zufall' });
    return el('span', { class: `type-chip type-${slugOf(type)}${small ? ' type-chip--small' : ''}`, text: data.types[type] });
  }

  function typeDots(types) {
    return el('span', { class: 'type-dots' }, types.map((t) => el('span', { class: `type-dot type-${slugOf(t)}`, title: data.types[t] })));
  }

  function categoryBadge(boss) {
    return el('span', { class: `badge badge--${boss.category}`, text: CATEGORIES[boss.category].label });
  }

  // Marken eines Angreifers: Crypto, Mega/Proto, Legendär/Mysteriös/Ultrabestie.
  function attackerBadges(attacker) {
    const badges = [];
    if (attacker.shadow) badges.push(el('span', { class: 'badge badge--shadow', text: 'Crypto' }));
    if (attacker.variant === 'mega') badges.push(el('span', { class: 'badge badge--mega', text: 'Mega' }));
    if (attacker.variant === 'primal') badges.push(el('span', { class: 'badge badge--primal', text: 'Proto' }));
    return badges;
  }

  function eliteBadge(text = 'Elite-TM') {
    return el('span', { class: 'badge badge--elite', text, title: 'Nur mit Elite-TM oder bei bestimmten Events erhältlich' });
  }

  function attackerName(attacker) {
    return attacker.shadow ? `Crypto-${attacker.name}` : attacker.name;
  }

  // Ohne Bild (Plan B oder seltenes Pokémon): Pokédex-Nummer auf einem Verlauf der Typfarben.
  function artFallback(pokemon) {
    const [first, second = first] = pokemon.types.map(slugOf);
    return el('span', {
      class: 'art__fallback',
      style: { '--c1': `var(--t-${first})`, '--c2': `var(--t-${second})` },
    }, [`#${String(pokemon.dex).padStart(3, '0')}`]);
  }

  function pokemonArt(pokemon, { eager = false, size = 'md', shadow = false } = {}) {
    const variant = pokemon.variant === 'normal' ? '' : ` art--${pokemon.variant}`;
    return el('div', { class: `art art--${size}${variant}${shadow ? ' art--shadow' : ''}` }, [
      pokemon.image
        ? el('img', { src: pokemon.image, alt: '', width: 256, height: 256, loading: eager ? 'eager' : 'lazy', decoding: 'async' })
        : artFallback(pokemon),
    ]);
  }

  function meter(label, valueText, ratio, modifier) {
    const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)));
    return el('div', { class: `meter meter--${modifier}` }, [
      el('div', { class: 'meter__head' }, [el('span', { text: label }), el('strong', { text: valueText })]),
      el('div', { class: 'meter__track', role: 'img', 'aria-label': `${label}: ${valueText}` }, [
        el('span', { class: 'meter__fill', style: { '--fill': `${pct}%` } }),
      ]),
    ]);
  }

  // Waagrechte Wischleiste mit Pfeil-Knöpfen; die Pfeile erscheinen nur, wenn es etwas zu scrollen gibt.
  function enhanceScroller(scroller) {
    const wrap = scroller.parentElement;
    const makeArrow = (dir) => el('button', {
      type: 'button',
      class: `scroll-arrow scroll-arrow--${dir}`,
      'aria-label': dir === 'prev' ? 'Nach links scrollen' : 'Nach rechts scrollen',
      tabindex: '-1',
      onclick: () => scroller.scrollBy({ left: (dir === 'prev' ? -1 : 1) * scroller.clientWidth * 0.8, behavior: 'smooth' }),
    });
    const prev = makeArrow('prev');
    const next = makeArrow('next');
    wrap.append(prev, next);
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      prev.hidden = scroller.scrollLeft <= 2;
      next.hidden = scroller.scrollLeft >= max - 2;
    };
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    new ResizeObserver(update).observe(scroller);
    update();
    return update;
  }

  function renderSources() {
    const target = document.getElementById('sources');
    if (!target || !ready) return;
    const { gameMaster, texts, releases, schedule, scheduleApi, images, gameMasterDate } = data.sources;
    const link = (source) => el('a', { href: source.url, text: source.name });
    const hasArtwork = data.pokemon.some((p) => p.image);
    target.replaceChildren(
      'Quellen: Spieldaten von ', link(gameMaster),
      gameMasterDate ? ` (Stand ${formatDate(gameMasterDate)})` : '',
      ', deutsche Namen aus den Spieltexten (', link(texts), '), erschienene Pokémon nach ', link(releases),
      ', Raid-Kalender von ', link(schedule), ' über ', link(scheduleApi),
      ...(hasArtwork ? [', Bilder von ', link(images)] : []), '. ',
      `Seite erstellt am ${formatDate(data.generatedAt)}.`,
      hasArtwork ? ' Artworks © Pokémon/Nintendo/Creatures/GAME FREAK.' : '',
    );
  }

  return {
    data, ready, bossByKey, TYPE_ORDER, CATEGORIES,
    el, formatNumber, formatFactor, slugOf, normalize, localDate, formatDay, formatDate, scheduleState,
    typeChip, typeDots, categoryBadge, attackerBadges, eliteBadge, attackerName, pokemonArt, meter,
    enhanceScroller, renderSources,
    boss: (key) => bossByKey.get(key) ?? null,
    pokemon: (key) => data.pokemonByKey[key],
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})();
