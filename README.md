# Raid-Kompass

Konter für alle Raid-Bosse ab 5 Sternen in **Pokémon GO**: Legendäre, Mysteriöse und Ultrabestien
(5-Sterne-Raids), alle **Mega-Entwicklungen** (Mega- und Mega-Legendär-Raids), Proto-Kyogre und Proto-Groudon
sowie die Crypto-Bosse aus 5-Sterne-Crypto-Raids. Dynamax- und Gigadynamax-Kämpfe stehen im
[Dyna-Kompass](https://jason-z-tech.github.io/dyna-kompass/).

- **Übersicht:** Raid-Kalender („Jetzt im Raid“ und „Demnächst“ mit Datum), Suche (deutsch oder englisch)
  und alle Bosse nach Raid-Art: Legendär, Mega, Crypto, Ultrabestien, Mysteriös, Proto.
- **Boss-Seite:** Boss-WP und -KP, Zeitlimit, geschätzte Spielerzahl, Fang-WP (Spanne und 100 %, mit und ohne
  Wetterboost), Wetter, Schwächen und Resistenzen, Basiswerte und alle Attacken des Bosses.
- **Konter:** bestes Team für eine Person, Top-Konter mit Attacken, DPS und TDO, die Besten je Angriffstyp.
  Einstellbar: Level 30/40/50, Wetter, Crypto-Pokémon, Mega & Proto, Legendäre/Mysteriöse/Ultrabestien,
  Elite-Attacken – und die Attacken des Bosses, falls man sie kennt.

**Online:** https://jason-z-tech.github.io/raid-kompass/

## Starten

Lokal: `index.html` doppelklicken. Die Seite braucht keinen Server und keine Installation.
Direktlinks: `index.html#boss=xerneas`, `index.html#boss=gengar-mega`, `index.html#boss=crypto-ho-oh`.

## Veröffentlichen (GitHub Pages)

Die Seite liegt im Repository `Jason-Z-tech/raid-kompass` und wird wie `dyna-kompass` von GitHub Pages direkt
aus dem Branch `main` ausgeliefert (Einstellung: *Settings → Pages → Deploy from a branch → main / (root)*).
Änderungen gehen online, sobald sie committet und gepusht sind:

```powershell
node scripts/build-data.mjs --refresh   # neue Spieldaten und Raid-Kalender
node tests/e2e.mjs                      # alles durchklicken
git add -A
git commit -m "Daten aktualisiert"
git push
```

Nach etwa einer Minute ist die neue Version online. Die Git-Identität ist nur für dieses Repository gesetzt
(`Jason-Z-tech`, noreply-Adresse von GitHub) – so erscheint keine private E-Mail-Adresse in den Commits.

**Wenn sich etwas in `js/` oder `css/` geändert hat:** vor dem Push in `index.html` und `datenschutz.html` den Zusatz
`?v=2026-10-05` an den Skript- und Stylesheet-Adressen auf das heutige Datum setzen (suchen und ersetzen).
Browser behalten Dateien von GitHub Pages bis zu 10 Minuten und würden sonst alte und neue Skripte mischen.

GitHub Pages unterstützt keine eigenen HTTP-Header; die Sicherheitsregeln (Content-Security-Policy) stehen
deshalb als `<meta>`-Tag in jeder Seite. `_headers` gilt nur, falls die Seite auf Netlify / Cloudflare Pages umzieht.
`.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert ausliefert.

## Testen

```powershell
node tests/e2e.mjs                                                 # lokale Kopie
node tests/e2e.mjs --url https://jason-z-tech.github.io/raid-kompass/   # veröffentlichte Seite
```

Startet ein unsichtbares Chrome (oder Edge) und klickt die Seite mit echten Mausklicks durch – auf Desktop-,
Tablet- und Handy-Breite: Raid-Arten, Suche, jede Boss-Seite (auf dem Desktop alle, sonst jede vierte), alle
Filter, die Boss-Attacken, „Weitere anzeigen“, Zurück-Link und Browser-Zurück, Direktlinks und die
Datenschutz-Seite. Geprüft wird u. a., dass Boss-WP und Fang-WP mit einer unabhängigen Rechnung übereinstimmen,
die Konter richtig sortiert sind, kein Team zwei Mega-Entwicklungen hat, ausgeschaltete Filter wirklich greifen,
nichts seitlich überläuft und der Browser keine Fehler meldet (z. B. fehlende Bilder).
Für den Raid-Kalender stellt der Test Datum und Uhrzeit im Browser um – eine Minute vor und nach einem
Raid-Wechsel – und jede Bildschirmbreite läuft in einer anderen Zeitzone (Zürich, Los Angeles, Auckland).
Mit `--url` nimmt der Test die erwarteten Werte aus den veröffentlichten Daten, nicht aus der lokalen Kopie.
Benötigt Node.js ab Version 22 und Chrome oder Edge.

## Daten aktualisieren

Wenn neue Raid-Bosse erscheinen oder der Raid-Kalender weiterläuft:

```powershell
node scripts/build-data.mjs --refresh
```

Das Skript
1. lädt die aktuellen Spieldaten (Game Master von [PokeMiners](https://github.com/PokeMiners/game_masters)) und die
   offiziellen deutschen und englischen Spieltexte ([holoholo-text](https://github.com/sora10pls/holoholo-text)),
2. nimmt nur Pokémon auf, die im Spiel erschienen sind (Angaben von [PvPoke](https://github.com/pvpoke/pvpoke)),
3. stellt die Raid-Bosse zusammen (siehe [Welche Bosse?](#welche-bosse)),
4. liest den Raid-Kalender von [Leek Duck](https://leekduck.com/raid-bosses/) über [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck),
5. wählt die Bilder aus, die die Seite braucht (alle Bosse und alle Pokémon, die irgendwo weit oben in einer
   Konter-Liste stehen), lädt die Artworks von [PokeAPI](https://pokeapi.co) und wandelt sie mit dem vorhandenen
   Chrome/Edge in kleine **WebP**-Dateien um,
6. schreibt alles nach `data/raid-data.js`.

Ohne `--refresh` werden die zwischengespeicherten Daten aus `scripts/.cache/` verwendet.
Benötigt nur Node.js (ab Version 22, wegen des eingebauten WebSocket) und Chrome oder Edge, keine Pakete.
Das Bild-Umwandeln dauert beim ersten Mal ein paar Minuten; danach werden nur neue Bilder umgewandelt.

Am Ende listet das Skript Hinweise auf, z. B. einen Boss aus dem Raid-Kalender, den es keinem Pokémon zuordnen
konnte. Dann den Namen prüfen und – falls nötig – die Zuordnung in `scripts/build-data.mjs` ergänzen.

## Welche Bosse?

Raid-Bosse werden aus den Spieldaten abgeleitet, damit neue Bosse automatisch dazukommen:

- alle erschienenen **Mega-Entwicklungen und Protomorphosen** (Mega-Raids, Mega-Legendär-Raids, Proto-Raids).
  Fehlt eine ganz neue Mega-Entwicklung noch im Game Master (wie Mega-Staraptor kurz nach dem Start), kommen
  ihre Werte von PvPoke.
- alle erschienenen **Legendären, Mysteriösen und Ultrabestien** – außer denen in `NOT_RAID_BOSSES`
  (Pokémon, die es nie als Raid-Boss gab, etwa Mew, die Galar-Vögel, Zygarde oder Endynalos). Als Konter zählen sie trotzdem.
- von Legendären die **Crypto-Form**, sobald es sie im Spiel gibt (5-Sterne-Crypto-Raids).

Zwei kleine, von Hand gepflegte Listen oben in `scripts/build-data.mjs` ergänzen das:

- `CATCH_AS`: Nach Raids gegen Fusionen und Kronen-Formen fängt man die Grundform (Kyurem nach Schwarzem Kyurem,
  Necrozma nach Abendmähne-Necrozma, Zacian Heldenhafter Krieger nach König des Schwertes).
- `SUPER_MEGA`: Mega-Entwicklungen, die als **Super-Mega-Raid** kamen (Schilde, die nur Mega-Pokémon brechen).
  Die Boss-Seite zeigt dann einen Hinweis.

Der **Raid-Kalender** kommt von Leek Duck. Termine sind Ortszeit: Raids wechseln überall zur selben Uhrzeit vor Ort,
deshalb vergleicht die Seite sie mit der Uhr des Geräts – ohne Umrechnung in eine Zeitzone. Läuft der Kalender aus,
verschwindet „Jetzt im Raid“ von selbst; ein `--refresh` bringt die nächsten Wochen.

## So wird gerechnet

- **Boss-WP:** (Angriff + 15) × √(Verteidigung + 15) × √(Boss-KP) ÷ 10. Boss-KP: 15 000 (5 Sterne, Crypto),
  9 000 (Mega), 22 500 (Mega-Legendär, Proto). Angriff und Verteidigung des Bosses mit dem Faktor 0,79 und
  perfekten Werten. Zeitlimit 300 Sekunden.
- **Fang-WP:** Level 20 (mit Wetterboost Level 25), Werte von 10/10/10 bis 15/15/15, bei Crypto-Raids ab 6/6/6.
  Bei Mega- und Proto-Raids fängt man die normale Form. „100 %“ ist 15/15/15.
- **Schaden pro Treffer:** ⌊0,5 × Stärke × Angriff ÷ Verteidigung × Faktoren⌋ + 1. Faktoren: STAB 1,2,
  Typ-Effektivität (1,6 / 0,625 / 0,390625), Wetter 1,2, Crypto-Pokémon Angriff × 1,2 und Verteidigung × 0,833.
  Crypto-Bosse machen und nehmen 20 % mehr Schaden (ihre Wut ab 60 % KP ist nicht eingerechnet).
- **Mega-Bonus:** Eine aktive Mega-Entwicklung verstärkt die Attacken **aller anderen** im Raid um 10 %
  (Attacken ihres Typs um 30 %), ihre eigenen aber nicht. Da er von den Mitspielenden abhängt, ist er nicht eingerechnet.
- **DPS und TDO:** Formel nach GamePress („Comprehensive DPS“): Energie aus Sofort-Attacken und aus erlittenem
  Schaden (0,5 pro KP). Der Boss lädt seine Energie ebenfalls mit erlittenem Schaden (0,5 pro KP, so steht es in
  den Spieldaten) und setzt die Lade-Attacke mit 50 % Wahrscheinlichkeit ein, sobald die Energie reicht; zwischen
  zwei Attacken wartet er im Schnitt 2 Sekunden. Ohne gewählte Boss-Attacken wird über alle möglichen Paare gemittelt.
- **Wertung:** (DPS³ × TDO)<sup>¼</sup> – Tempo zählt mehr als Ausdauer. Pro Pokémon zählt das beste Attacken-Paar.
  Signatur-Attacken, die eine Form erst durch Fusion oder Krone bekommt (Sonnenstahlstrahl, Behemoth-Klinge …),
  zählen mit; Kraftreserve nicht (ihr Typ ist im Raid Zufall – beim Boss wird sie neutral gerechnet).
- **Spielerzahl:** Jede Person kämpft mit dem besten Team (sechs verschiedene Arten, höchstens eine
  Mega-Entwicklung) bis zum Ende der Zeit, Wechsel 1 Sekunde, Neu-Beitreten 10 Sekunden. Boss-KP geteilt durch den
  Schaden einer Person ergibt die Mindestzahl. Die Spanne auf der Boss-Seite reicht von Top-Kontern auf Level 40 bis
  zu Level-30-Pokémon ohne Mega und Crypto. Crypto-Raids brauchen immer mindestens 2 Personen
  (8 Erlöste Edelsteine, höchstens 5 pro Person).

Die Werte sind eine Schätzung: Ausweichen, Freundschafts-Bonus und Zufall im Kampf sind nicht eingerechnet.

## Aufbau

```
index.html                 Übersicht und Boss-Seite (#boss=<schlüssel>)
datenschutz.html           Datenschutzerklärung
assets/favicon.svg         Seiten-Icon (eigenes Design: Raid-Ei)
css/style.css              Design
js/calc.js                 Kampf-Rechnung (DPS, TDO, Rangliste, Spielerzahl) – auch vom Daten-Skript genutzt
js/shared.js               gemeinsame Bausteine (DOM-Helfer, Texte, Datum, Formatierung)
js/overview.js             Übersicht: Raid-Kalender, Suche, Raid-Art, Kacheln
js/detail.js               Boss-Seite: Boss-Infos, Filter, Team, Konter
js/app.js                  Start und Navigation
data/raid-data.js          erzeugte Daten (nicht von Hand bearbeiten)
assets/img/                Pokémon-Bilder als WebP (erzeugt)
assets/fonts/              Schriften, lokal eingebunden
scripts/build-data.mjs     Daten-Skript
scripts/images.mjs         Bilder mit Chrome in WebP umwandeln
scripts/browser.mjs        steuert Chrome (für Bilder und Tests)
tests/e2e.mjs              Klick-Test
.nojekyll                  GitHub Pages liefert die Dateien unverändert aus
_headers                   Sicherheits-Header, falls die Seite später auf Netlify / Cloudflare Pages umzieht
```

## Lizenzen und Hinweise

- **Schriften:** Chakra Petch und Manrope, SIL Open Font License (siehe `assets/fonts/OFL-*.txt`).
- **Bilder:** Offizielle Artworks über PokeAPI. Sie sind urheberrechtlich geschützt (Nintendo / Creatures / GAME FREAK)
  und werden hier ohne Lizenz in einem nicht-kommerziellen Fanprojekt verwendet – wie auf vielen Pokémon-GO-Infoseiten.
- **Raid-Kalender:** Daten von [Leek Duck](https://leekduck.com) über ScrapedDuck – nicht-kommerziell, ohne Werbung,
  mit Quellenangabe (Bedingungen von ScrapedDuck).
- Inoffizielles, nicht-kommerzielles Fanprojekt ohne Verbindung zu Nintendo, The Pokémon Company oder Scopely.
  Pokémon, Pokémon GO und die Namen der Pokémon sind Marken von Nintendo. © Pokémon/Nintendo/Creatures/GAME FREAK.

## Plan B: Bilder entfernen

Falls eine Löschaufforderung (z. B. an GitHub) kommt, sofort ohne offizielle Bilder neu bauen und veröffentlichen:

```powershell
node scripts/build-data.mjs --no-images   # entfernt assets/img/, zeigt Pokédex-Nummer + Typfarben
git add -A
git commit -m "Offizielle Artworks entfernt"
git push
```

Wichtig: Die Bilder bleiben danach noch in der Git-Historie. Verlangt die Meldung auch deren Entfernung,
muss die Historie bereinigt oder das Repository neu angelegt werden.
Mit einem normalen `node scripts/build-data.mjs` kommen die Bilder aus dem Zwischenspeicher zurück.
