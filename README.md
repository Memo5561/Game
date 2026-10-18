# Blocko – Block-Puzzle für Android

> **Start hier:** [docs/DEINE_CHECKLISTE.md](docs/DEINE_CHECKLISTE.md) – was du noch selbst tun musst (Konten, Impressum, Werbe-IDs) und was nicht getestet werden konnte.

**Blocko** ist ein 8×8-Block-Puzzle (das Genre von „Blöcke in Reihen legen und abräumen“): Du ziehst
Blöcke aufs Spielfeld, füllst Reihen und Spalten und räumst sie mit Kombos ab. Das Spiel ist eine
HTML5-App (reines JavaScript, Canvas, ohne Build-Schritt, komplett offline). Sie läuft in einer
schlanken nativen Android-Hülle (Kotlin, WebView). Die Hülle bringt AdMob-Werbung mit
Google-UMP-Einwilligung, Google Play Billing, sicheres Speichern, Vibration, Erinnerungen und
In-App-Bewertung mit.

> Diese Datei ist der Einstieg. Die Schritt-für-Schritt-Anleitung bis zur fertigen App im Play Store
> steht in **[docs/VEROEFFENTLICHUNG.md](docs/VEROEFFENTLICHUNG.md)**.

---

## Inhalt

1. [Was kann das Spiel?](#was-kann-das-spiel)
2. [Wie verdient Blocko Geld?](#wie-verdient-blocko-geld)
3. [Projektstruktur](#projektstruktur)
4. [Schnellstart: im Browser spielen](#schnellstart-im-browser-spielen)
5. [Tests](#tests)
6. [Android-App bauen](#android-app-bauen)
7. [Was ändere ich wo?](#was-ändere-ich-wo)
8. [Ehrliche Erwartungen](#ehrliche-erwartungen)
9. [Alle Dokumente](#alle-dokumente)

---

## Was kann das Spiel?

- **Klassisch**: endloser Modus mit Highscore-Jagd („Nur noch 120 bis zu deinem Rekord!“). Laufende
  Runden werden gespeichert und lassen sich fortsetzen.
- **Abenteuer (Journey)**: unendlich viele, prozedural erzeugte Level. Du sammelst Edelsteine
  (Diamant, Stern, Herz) und bekommst 1–3 Sterne. Dazu kommen schwere und sehr schwere Level, eine
  Levelkarte und Booster (Hammer, Mischen).
- **Tägliche Herausforderung**: jeden Tag ein Level, mit Belohnung und Serie (Streak).
- **Motivation**: 7-Tage-Login-Kalender (mit einem Kulanztag), 3 tägliche Missionen plus Bonus,
  Spielerlevel mit XP, Freischaltungen nach und nach.
- **6 Block-Designs** (Juwel, Neon, Candy, Holz, Pixel, Gold), mit Münzen kaufbar oder über das
  Spielerlevel freischaltbar.
- **Gutes erstes Spielerlebnis**: Nach dem Antippen des Icons beginnt in höchstens 3 Sekunden ein
  interaktives Tutorial. Werbung und Einwilligungsdialog kommen erst nach dem ersten Game-over.
- **Komfort**: synthetisierte Soundeffekte und Musik, Vibration, 8 Sprachen (de, en, es, fr, it,
  pt, tr, ru), Hoch- und Querformat (Tablets), freiwillige Erinnerungs-Benachrichtigung.
- **Fair**: kein Energiesystem, keine Zufallskäufe gegen Geld, keine Fake-Buttons, keine
  „Gefällt dir die App?“-Abfrage, keine manipulierte Schwierigkeit rund um deinen Rekord.

## Wie verdient Blocko Geld?

| Quelle | Wie | Details |
|---|---|---|
| **Belohnungsvideos** (Rewarded) | immer freiwillig, der Button nennt die Belohnung | Wiederbelebung, ×2 Münzen, Gratis-Booster, ×2 Tagesbelohnung, Gratis-Münzen |
| **Interstitials** | nur beim Verlassen eines Ergebnis-Bildschirms, begrenzt nach Spielzeit | nie beim Start, nie mitten im Spiel |
| **Banner** | adaptiver Banner in einem festen Bereich unter dem Spiel | verdeckt nichts, liegt nicht neben Bedienelementen |
| **In-App-Käufe** | `remove_ads` (werbefrei + Geschenk), `coins_small`, `coins_large` | Belohnungsvideos bleiben auch nach `remove_ads` freiwillig verfügbar |

Wie das genau funktioniert, welche Stellschrauben es gibt und was realistisch ist, steht in
**[docs/MONETARISIERUNG.md](docs/MONETARISIERUNG.md)**.

## Projektstruktur

```
game/                 Das Web-Spiel (= Assets der Android-App)
  index.html          Einstieg
  css/style.css       Styles
  assets/             Icon, Schriftart Nunito (OFL-Lizenz liegt bei)
  js/config.js        ★ Zentrale Einstellungen (Name, Paket-ID, Preise/Ökonomie, Werbetakt, Impressum)
  js/core/            Spiellogik (Brett, Teile, Punkte, Level) – ohne DOM
  js/meta/            Speicherstand, Fortschritt, Missionen, Werberegeln – ohne DOM
  js/render/ js/input/  Grafik (Canvas) und Drag & Drop
  js/audio/           Sound und Musik (WebAudio, ohne Audiodateien)
  js/ui/ js/app/      Bildschirme, Dialoge, Texte (i18n), Spielablauf
  js/platform/bridge.js  Brücke zur Android-App (+ Browser-Simulation)
android/              Android-Studio-Projekt (Kotlin) → siehe android/README.md
tests/unit/           Unit-Tests (node:test)
tests/e2e/            End-to-End-Tests (Playwright)
tools/                Dev-Server, Simulation, Store-Grafiken, Release-Check
store/                Erzeugte Play-Store-Grafiken (Icon 512, Feature-Grafik, Screenshots)
docs/                 Anleitungen (Deutsch), Store-Texte, Rechtliches
docs/site/            Webseiten zum Hochladen: Datenschutz, Impressum, app-ads.txt, Startseite
```

## Schnellstart: im Browser spielen

Voraussetzung: **Node.js 20 oder neuer** ([nodejs.org](https://nodejs.org)).

```bash
npm install
npm run serve
```

Öffne danach **http://localhost:8080/?debug=1** im Browser. Am besten nutzt du Chrome und die
Handy-Ansicht der Entwicklertools (F12 → Gerätesymbol).

- Im Browser werden Werbung und Käufe **simuliert**: Es erscheint ein Platzhalter-Overlay statt
  echter Werbung, Käufe sind gratis. So kannst du alles ohne Handy ausprobieren.
- `?debug=1` aktiviert die Debug-Schnittstelle `window.__blocko` in der Browser-Konsole (z. B.
  `__blocko.skipTutorial()`, `__blocko.setCoins(5000)`, `__blocko.forceGameOver()`).
- `?mock=fast` zeigt simulierte Werbung nur ganz kurz, `?mock=nofill` simuliert „keine Werbung
  verfügbar“.
- Den Fortschritt setzt du zurück über die Einstellungen im Spiel („Fortschritt zurücksetzen“) oder
  mit `__blocko.reset()`.

## Tests

```bash
npm test            # Unit-Tests (Spiellogik, Speicherstand, Ökonomie, Werberegeln)
npx playwright install chromium   # einmalig: Browser für die E2E-Tests herunterladen
npm run e2e         # End-to-End-Tests im echten Browser (Playwright)
npm run sim         # Bot-Simulation: prüft Schwierigkeit und Gewinnraten der Level
npm run check-release   # Release-Check: findet Platzhalter (Impressum, Werbe-IDs …) vor dem Upload
```

Weitere Werkzeuge: `npm run assets` erzeugt Store-Screenshots, `npm run icons` erzeugt App-Icon und
Feature-Grafik in `store/` neu.

## Android-App bauen

Kurzfassung (Details: **[android/README.md](android/README.md)** und
**[docs/VEROEFFENTLICHUNG.md](docs/VEROEFFENTLICHUNG.md)**, Schritt 1, 7 und 9):

1. Installiere **Android Studio** in einer aktuellen Version (für AGP 9.4 mindestens
   „Quail 4 | 2026.1.4“, z. B. „Rabbit 1 | 2026.2.1“).
2. **File → Open →** den Ordner `android/` öffnen und den Gradle-Sync abwarten.
3. Variante `debug` auf dem Handy starten (USB-Debugging). Die Debug-Version zeigt
   **Testanzeigen**.
4. Für den Play Store: in `android/gradle.properties` die Werte `BLOCKO_ADS_MODE=live`, die echten
   `BLOCKO_ADMOB_*`-IDs und `BLOCKO_VERSION_CODE` setzen. Danach `npm run check-release` ausführen
   und ein signiertes **App Bundle (AAB)** bauen.

Das Spiel aus `game/` wird beim Bauen automatisch als Asset in die App kopiert. Ein eigener
Web-Build ist nicht nötig.

## Was ändere ich wo?

| Was | Wo | Hinweis |
|---|---|---|
| App-Name | `game/js/config.js` → `APP_NAME`, Android `strings.xml` (`app_name`), Store-Eintrag, `docs/site/*.html`, `tools/templates/feature-graphic.html` | danach `npm run icons` |
| **Paket-ID** | `config.js` → `PACKAGE_ID`, `PLAY_STORE_URL`, `PLAY_STORE_MARKET_URL` **und** `android/app/build.gradle.kts` → `applicationId` | **Nach dem ersten Upload in die Play Console nicht mehr änderbar!** Siehe VEROEFFENTLICHUNG.md, Schritt 0 |
| Datenschutz-/Impressum-URL | `config.js` → `PRIVACY_POLICY_URL`, `IMPRINT_URL` | muss zur GitHub-Pages-Seite passen |
| Impressum (in der App) | `config.js` → `LEGAL` | Pflicht vor dem Release, `check-release` prüft das |
| Preise der In-App-Produkte | **Play Console** (nicht im Code) | Produkt-IDs in `config.js` → `PRODUCTS` müssen 1:1 übereinstimmen |
| Münzen pro Paket | `config.js` → `PRODUCTS.coins_small.coins` / `coins_large.coins` | Text im Store-Produkt anpassen |
| Ökonomie (Belohnungen, Preise für Designs/Booster) | `config.js` → `ECONOMY` | |
| Werbetakt (Interstitials, Gratis-Münzen …) | `config.js` → `ADS` | sichere Bereiche: MONETARISIERUNG.md |
| Werbe-IDs (AdMob) | `android/gradle.properties` → `BLOCKO_ADMOB_*` | **nicht** in `config.js` |
| Testmodus/Livemodus der Werbung | `android/gradle.properties` → `BLOCKO_ADS_MODE=test` bzw. `live` | |
| Versionsnummer | `android/gradle.properties` → `BLOCKO_VERSION_CODE` (+1 pro Upload), `BLOCKO_VERSION_NAME` und `config.js` → `VERSION` | Name und VERSION gleich halten |
| Schwierigkeit | `config.js` → `GENERATOR` | nach Änderungen `npm run sim` |

## Ehrliche Erwartungen

Bitte lies das, bevor du Zeit und Geld investierst:

- **Der Markt ist voll.** Block-Puzzles gehören zu den beliebtesten Casual-Genres. Es gibt Hunderte
  Konkurrenten, darunter sehr große Titel mit Millionenbudgets für Werbung. Ein gutes Spiel allein
  reicht nicht, damit es gefunden wird.
- **Worauf es ankommt:**
  1. **Store-Eintrag**: Icon, die ersten 2–3 Screenshots und die Kurzbeschreibung entscheiden, ob
     jemand installiert.
  2. **Bewertungen**: Viele gute Bewertungen bringen Sichtbarkeit in der Suche. Abstürze und
     ANRs (App reagiert nicht) senken sie.
  3. **Bindung (Retention)**: Kommen Spieler am nächsten Tag (D1) und nach einer Woche (D7) wieder?
     Das ist der wichtigste Hebel für Einnahmen.
  4. **Werbeeinnahmen pro Spieler**: Sie hängen stark vom Land, von der Einwilligungsrate (DSGVO),
     von der Fill-Rate und später von Mediation ab.
  5. **Nutzergewinnung**: ASO, Social Clips, Community. Bezahlte Werbung lohnt sich nur, wenn ein
     Spieler über seine Lebenszeit mehr einbringt, als seine Gewinnung kostet.
- **Realistisch** startet ein Indie-Spiel ohne Marketing mit wenigen Hundert bis wenigen Tausend
  Installationen. Die Einnahmen liegen dann oft bei einigen Euro bis zu niedrigen dreistelligen
  Beträgen im Monat. Mehr ist möglich, aber **nicht garantiert**. Rechenbeispiele und Bandbreiten
  findest du in [docs/MONETARISIERUNG.md](docs/MONETARISIERUNG.md).
- **Plane laufende Arbeit ein**: Updates (Google verlangt jedes Jahr ein neues Target-API-Level),
  Antworten auf Bewertungen, Buchhaltung und Steuern.

## Alle Dokumente

| Dokument | Inhalt |
|---|---|
| [docs/VEROEFFENTLICHUNG.md](docs/VEROEFFENTLICHUNG.md) | **Hauptanleitung**: von null bis zur Live-App im Play Store, Schritt für Schritt |
| [docs/MONETARISIERUNG.md](docs/MONETARISIERUNG.md) | Werbung, In-App-Käufe, Stellschrauben, realistische Zahlen, Verbote |
| [docs/STORE_LISTING.md](docs/STORE_LISTING.md) | Store-Texte zum Kopieren (DE/EN + Kurzbeschreibungen in 6 weiteren Sprachen) |
| [docs/PLAY_CONSOLE_ANGABEN.md](docs/PLAY_CONSOLE_ANGABEN.md) | Antworten für Datensicherheit, Werbe-ID, Zielgruppe, Einstufung usw. |
| [docs/RECHTLICHES.md](docs/RECHTLICHES.md) | Gewerbe, Steuern, Impressum, Datenschutz, DSA (keine Rechtsberatung) |
| [docs/MARKETING.md](docs/MARKETING.md) | ASO, erste Tester und Nutzer, Bewertungen, Community |
| [docs/site/](docs/site/) | Datenschutzerklärung, Impressum, app-ads.txt, Startseite für GitHub Pages |
| [android/README.md](android/README.md) | Android-Projekt: Build-Varianten, Konfiguration, Signieren |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technische Architektur (Englisch, für Entwickler) |

---

Schriftart: Nunito, SIL Open Font License 1.1 (`game/assets/fonts/OFL-LICENSE.txt`).
