# Monetarisierung – wie Blocko Geld verdient

Hier steht, **wie** die App Geld verdient, **welche Stellschrauben** du hast, **was realistisch
ist** und **was du auf keinen Fall tun darfst**. Grundsatz von Blocko: fair, freiwillig, nie
irreführend. Das ist nicht nur nett. Es schützt dein AdMob-Konto und deine Bewertungen, und am Ende
auch deine Einnahmen.

---

## 1. Die drei Einnahmequellen im Überblick

| Quelle | Anteil am Umsatz (typisch, grobe Erfahrungswerte) | Bemerkung |
|---|---|---|
| Belohnungsvideos (Rewarded) | oft der größte Anteil | freiwillig, hoher eCPM, Spieler mögen sie |
| Interstitials | mittlerer Anteil | stören am meisten, deshalb streng getaktet |
| Banner | kleiner, aber stetiger Anteil | niedriger eCPM, viele Impressionen |
| In-App-Käufe | klein bis mittel, sehr ungleich verteilt | wenige Käufer (oft unter 2 % der Spieler) |

---

## 2. Werbung, wie sie im Spiel umgesetzt ist

### 2.1 Belohnungsvideos (Rewarded) – immer freiwillig

Der Button sagt immer, was es gibt („Video ansehen: Wiederbeleben“). Ein Video startet **nur**
nach einem Tipp des Spielers, nie automatisch.

| Platzierung | Wo | Regel |
|---|---|---|
| **Wiederbeleben** | Revive-Dialog nach „Kein Platz mehr!“ | einmal pro Runde. Alternativ `REVIVE_COINS` (600) Münzen: bewusst etwa 13 durchschnittliche Klassik-Runden wert, damit das Video die erste Wahl bleibt. Die ersten 2 Spiele: gratis ohne Video. „Nein danke“ ist sofort sichtbar und gleich groß. Der Countdown (5 s) startet beim Ablauf **nie** ein Video. |
| **×2 Münzen** | Game-over-Bildschirm | einmal pro Runde |
| **Gratis-Booster** | Abenteuer/Tagesrätsel: Booster-Dialog im Level und Shop | Hammer oder Mischen, zusammen max. `FREE_BOOSTER_ADS_PER_DAY` (3) pro Tag. Der Zähler steht im Spielstand (`save.ads.freeBoosters`) und überlebt einen App-Neustart. |
| **×2 Tagesbelohnung** | Login-Kalender | einmal pro Tag |
| **Gratis-Münzen** | Shop („Video ansehen: +40 Münzen“) | max. `FREE_COINS_ADS_PER_DAY` (3) pro Tag, ebenfalls im Spielstand |

Ad-Buttons in automatisch geöffneten Dialogen reagieren erst nach 500 ms
(`AD_BUTTON_ARM_MS`). So startet kein Video durch einen versehentlichen Doppeltipp.

### 2.2 Interstitials (Vollbild zwischen den Runden) – streng getaktet

Ein Interstitial wird **nur** versucht, wenn der Spieler einen Button antippt, der einen
Ergebnis-Bildschirm verlässt („Nochmal“, „Home“, „Weiter“, „Wiederholen“, „Karte“). Zusätzlich
müssen **alle** Bedingungen erfüllt sein:

1. Spieler hat **nicht** `remove_ads` gekauft.
2. Gesamte Spielzeit ≥ `INTERSTITIAL_MIN_TOTAL_PLAY_SEC` (480 s): In der ersten Sitzung gibt es
   praktisch keine Interstitials.
3. Aktive Spielzeit seit der letzten Vollbildwerbung (auch Rewarded) ≥
   `INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD` (180 s).
4. Echte Zeit seit der letzten Vollbildwerbung ≥ `INTERSTITIAL_MIN_INTERVAL_SEC` (120 s).
5. Nicht die erste Runde einer Sitzung (`SKIP_FIRST_RUN_OF_SESSION`).
6. Ergebnis-Bildschirm war mindestens `RESULT_SCREEN_MIN_MS` (1 s) sichtbar.

**Nie**: beim App-Start, beim Zurückkehren in die App, beim Beenden/Zurück-Taste, aus dem
Pausenmenü, im Tutorial, nach einem Kauf, während ein Dialog offen ist, mitten in einer Runde.

### 2.3 Banner

- **Adaptiver Banner** in einem **festen nativen Bereich unter dem Spiel**. Der Spielbereich wird
  dadurch nie verschoben oder verkleinert, und unter den Spielsteinen bleibt ein Abstand frei. So
  gibt es keine versehentlichen Klicks.
- Kein Banner im Tutorial und in der ersten Runde.
- Mit `remove_ads` wird der Banner entfernt.
- Abschaltbar mit `ADS.BANNER_ENABLED = false`, falls du nur auf Video-Werbung setzen willst.

### 2.4 Sanfter Hinweis auf „Werbefrei“

Nach mindestens `UPSELL_AFTER_INTERSTITIALS` (3) gezeigten Interstitials erscheint auf dem
Game-over-Bildschirm höchstens **einmal pro Tag** ein kleiner Chip „Werbefrei“. Kein Popup, keine
Unterbrechung.

---

## 3. Stellschrauben in `game/js/config.js` (`CONFIG.ADS`)

**Goldene Regel:** Ändere **einen** Wert pro Update. Beobachte 1–2 Wochen lang die Bindung (D1/D7)
**und** die Einnahmen pro täglichem Nutzer (ARPDAU). Mehr Werbung bringt kurzfristig mehr Geld,
vertreibt aber Spieler. Das kostet langfristig mehr, als es bringt.

| Einstellung | Standard | Sicherer Bereich | Wirkung / Risiko |
|---|---|---|---|
| `INTERSTITIAL_MIN_TOTAL_PLAY_SEC` | 480 | 300–900 | Kleiner = früher Geld, aber neue Spieler springen eher ab (D1 sinkt). |
| `INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD` | 180 | 120–300 | Der wichtigste Takt-Wert. Unter 120 s fühlt es sich für viele „zugemüllt“ an. |
| `INTERSTITIAL_MIN_INTERVAL_SEC` | 120 | 90–240 | **Nicht unter 90 s.** Zu häufige Interstitials verstoßen gegen AdMob-Richtlinien. |
| `SKIP_FIRST_RUN_OF_SESSION` | true | true | Erste Runde nach dem Start bleibt werbefrei. Empfehlung: so lassen. |
| `SESSION_GAP_MIN` | 30 | 15–60 | Ab wie vielen Minuten Pause eine neue Sitzung beginnt. |
| `RUN_MIN_PIECES` | 8 | 5–12 | Sehr kurze Runden zählen nicht für den Werbetakt, nicht als gespieltes Spiel und bringen weder Rekord noch Münzen. |
| `RESULT_SCREEN_MIN_MS` | 1000 | 800–2000 | Der Spieler soll sein Ergebnis erst sehen. |
| `AD_BUTTON_ARM_MS` | 500 | 400–800 | Schutz vor Fehlklicks. **Nicht auf 0 setzen.** |
| `REVIVE_COUNTDOWN_SEC` | 5 | 5–8 | Länger = mehr Revive-Videos, aber auch mehr Wartezeit. |
| `FREE_COINS_ADS_PER_DAY` | 3 | 2–6 | Mehr = mehr Rewarded-Umsatz, aber Münzen verlieren an Wert (weniger Käufe). |
| `FREE_BOOSTER_ADS_PER_DAY` | 3 | 2–6 | Gratis-Booster per Video (Shop und Booster-Dialog im Level teilen sich den Zähler). Ohne Grenze wären Booster-Münzpreise wertlos und jedes Level per Video lösbar. |
| `UPSELL_AFTER_INTERSTITIALS` | 3 | 2–6 | Wann der „Werbefrei“-Chip zum ersten Mal erscheint. |
| `BANNER_ENABLED` | true | – | Banner bringen in DE wenig. Abschalten kann die Bindung leicht erhöhen. |

Passend dazu in `CONFIG.ECONOMY`: `FREE_COINS_AD_AMOUNT` (40), `REVIVE_COINS` (600),
`REMOVE_ADS_GIFT` (500 Münzen + 1 Hammer + 1 Mischen).

**Spielzeit vor einem Video zählt nicht doppelt:** Wer mitten in der Runde ein Belohnungsvideo
ansieht (Revive, Gratis-Booster), startet den Interstitial-Takt neu. Die Spielzeit, die bis dahin in
dieser Runde schon vergangen war, wird beim Rundenende nicht noch einmal angerechnet
(`AdPolicy.markRewardedShown(runPlaySecSoFar)`, `save.ads.runSecAtAd`). Das echte Intervall zwischen zwei Vollbild-Anzeigen ist
dadurch wirklich mindestens `INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD` Sekunden Spielzeit.

Zusätzliches Sicherheitsnetz: In AdMob kannst du beim Interstitial-Block ein **Frequency Capping**
setzen (z. B. max. 15 pro Stunde). Das greift, falls im Code einmal etwas schiefgeht.

---

## 4. In-App-Käufe: Strategie und Preispsychologie

### 4.1 Produkte

| ID | Inhalt | Preisvorschlag | Rolle |
|---|---|---|---|
| `remove_ads` | Banner + Interstitials weg, Belohnungsvideos bleiben freiwillig, **Geschenk** 500 Münzen + 1 Hammer + 1 Mischen (einmalig) | **4,99 €** | Hauptprodukt. Viele Spieler zahlen lieber einmal, als Werbung zu sehen. |
| `coins_small` | 1.500 Münzen | **1,99 €** | Einstieg, „Impulskauf“ |
| `coins_large` | 6.000 Münzen | **4,99 €** | „Bestes Angebot“ (4× Münzen für 2,5× Preis) |

### 4.2 Warum diese Preise?

- **Werbefrei für 4,99 €** ist im Casual-Genre ein üblicher Preis. Das Geschenk macht den Kauf
  „mehr wert“ und belohnt Käufer sofort sichtbar. Weil Belohnungsvideos erhalten bleiben, verlierst
  du bei zahlenden Spielern nicht den kompletten Werbeumsatz.
- **Anker-Effekt**: `coins_large` kostet so viel wie `remove_ads`, enthält aber 4× so viele Münzen
  wie das kleine Paket. Das kleine Paket wirkt dadurch als Einstieg, das große als kluger Kauf.
  Das „Bestes Angebot“-Badge verstärkt das. Es ist wahr, also kein Trick.
- **Wert im Spiel** (gemessen mit `node tools/simulate.mjs --economy`, siehe 4.3): Ein aktiver
  Spieler (30 Minuten am Tag, keine Videos) verdient etwa 700 Münzen am Tag, ein Gelegenheitsspieler
  (15 Minuten) etwa 500. Designs kosten 1.500 / 3.000 / 5.000 / 10.000 Münzen, Booster 120–150, die
  Münz-Wiederbelebung 600. `coins_small` (1.500) entspricht dem ersten Design (Candy) und etwa
  **2–3 Tagen Spielzeit**, `coins_large` (6.000) etwa **8–12 Tagen**. Münzpakete sind also eine
  **Abkürzung**, keine Pflicht. So bleibt das Spiel fair, und trotzdem lohnt sich die Abkürzung.
- **Preisendungen ,99** und **lokale Preise**: Google rechnet die Preise automatisch um. Für
  Länder mit niedriger Kaufkraft kannst du in der Play Console niedrigere lokale Preise setzen.
  Prüfe dort auch, ob Preisexperimente für Einmalkaufprodukte angeboten werden.

### 4.3 Die Münz-Wirtschaft in Zahlen

Die Zahlen stammen aus `node tools/simulate.mjs --economy`. Der Simulator spielt ganze Tage mit der
echten `Progression` (Login-Kalender, Missionen, Abenteuer, Tagesrätsel, Level-Ups) und den
Test-Spielern des Balancings (`greedy` = normaler Spieler, `planner` = sehr guter Spieler). Er
rechnet jede Münze einer Quelle zu und kauft Designs, sobald sie bezahlbar sind. Aufruf mit
Optionen: `--days=30 --players=3 --profiles=casual,engaged,strong --ads=0|1`.

**Zielwerte** (so sind die Preise gedacht):

| Frage | Ziel |
|---|---|
| Münzen pro Tag, 30 Min Spielzeit, keine Videos | 500–800 |
| Erstes Design (Candy, 1.500) | nach 2–3 Tagen |
| Letztes Design (Gold, 10.000), darauf gespart | nach 2–3 Wochen |
| Münz-Wiederbelebung (600) im Vergleich zu einer Klassik-Runde | deutlich teurer (mehrere Runden) |
| `coins_small` / `coins_large` in Tagen Spielzeit | mehrere Tage |

**Ergebnis** (30 Tage, 3 Spieler je Profil, `ECONOMY` wie in `config.js`):

| Profil | Münzen/Tag | Candy | Gold (darauf gespart) | alle 4 Designs | Revive = Runden | `coins_small` | `coins_large` |
|---|---|---|---|---|---|---|---|
| Gelegenheit, 15 Min, ohne Videos | ca. 500 | Tag 4 | Tag 20 | nach über 30 Tagen | 8,9 | 3,0 Tage | 12 Tage |
| **Aktiv, 30 Min, ohne Videos** | **ca. 720** | **Tag 3** | **Tag 14** | Tag 27 | 8,5 | 2,1 Tage | 8,3 Tage |
| Aktiv, 30 Min, alle Videos | ca. 1.400 | Tag 2 | Tag 8 | Tag 14 | 6,6 | 1,1 Tage | 4,3 Tage |
| Sehr gut, 45 Min, ohne Videos | ca. 1.040 | Tag 2 | Tag 10 | Tag 19 | 4,3 | 1,4 Tage | 5,8 Tage |
| Sehr gut, 45 Min, alle Videos | ca. 1.930 | Tag 2 | Tag 6 | Tag 11 | 3,0 | 0,8 Tage | 3,1 Tage |

„Revive = Runden“ heißt: Die 600 Münzen der Wiederbelebung sind so viele durchschnittliche
Klassik-Runden wert (eine Runde bringt im Median 45–60 Münzen, ein sehr guter Spieler 95–130).

**Woher die Münzen kommen** (aktiver Spieler ohne Videos, grob): Klassik-Runden 25 %, Abenteuer-Level
24 %, Login-Kalender 18 %, Tagesrätsel 12 %, Missionen samt Bonus 14 %, Level-Ups 6 %. Mit Videos kommen
Verdopplungen (×2 auf Runde, Level und Login) und die Gratis-Münzen dazu: etwa das 1,9-Fache.

**Stellschrauben** (`CONFIG.ECONOMY`). Ändere nie mehrere gleichzeitig, und prüfe danach die
Tabelle oben mit dem Simulator:

| Einstellung | Standard | Wirkung |
|---|---|---|
| `RUN_COINS_FACTOR` | 0,5 | Klassik-Runde = Faktor × √Punkte (2.500 Punkte = 25, 10.000 = 50, 40.000 = 100 Münzen). Die Wurzel verhindert, dass lange Kombi-Runden die Wirtschaft sprengen. Runden unter `RUN_MIN_PIECES` Teilen zahlen nichts. |
| `LEVEL_COMPLETE_COINS`, `LEVEL_STAR_COINS` | 30, 10 | Erster Sieg im Abenteuer: Level-Belohnung (schwer ×1,5, sehr schwer ×2) plus 10 je Stern. Wiederholungen zahlen nur neu erspielte Sterne. |
| `DAILY_CHALLENGE_COINS` | 100 | Erster Sieg im Tagesrätsel des Tages. |
| `DAILY_REWARDS` | 30 / 50 / 70 / 100 / 140 / 200 / 350 | 7-Tage-Login-Kalender, im Schnitt etwa 130 Münzen am Tag. |
| `MISSION_REWARDS`, `MISSION_BONUS_COINS` | 20 / 30 / 45, 40 | Drei Tagesmissionen und der Bonus für alle drei. |
| `LEVEL_UP_COINS` | 50 | Pro Spielerlevel. |
| `REVIVE_COINS` | 600 | Muss deutlich mehr kosten als eine Runde einbringt, sonst ersetzt die Münz-Wiederbelebung das Video. |
| `THEMES[...].price` | 1.500 / 3.000 / 5.000 / 10.000 | Münz-Designs. Sind alle gekauft, bleiben nur Booster und Revive als Münz-Verbrauch. Für ein langes Spiel sind weitere Designs (saisonal) die beste Maßnahme. |

**⚠ Wenn du die Einnahmen der Spieler änderst**, ändern sich zugleich der Wert der Münzpakete und der
Anreiz für Videos. Zu viele Münzen entwerten `coins_small`/`coins_large` und das Video „×2“. Zu wenige
machen das Spiel zäh. Dieselben Zahlen gelten für Booster: Gratis-Booster per Video sind auf
`FREE_BOOSTER_ADS_PER_DAY` begrenzt, damit die Münzpreise der Booster etwas wert bleiben.

### 4.4 Spätere Ideen (erst wenn das Spiel läuft)

- **Starterpaket** (einmaliges Angebot für neue Spieler, z. B. Münzen + Booster + Design), klar
  befristet und ehrlich beschriftet.
- **Saisonale Designs** (Halloween, Winter) als Münz- oder Echtgeld-Kauf.
- Größeres Münzpaket (z. B. 9,99 €), wenn Spieler das große Paket oft kaufen.
- **Kein** Abo und **keine** Lootboxen/Zufallskäufe. Lootboxen sind rechtlich heikel (Jugendschutz)
  und widersprechen dem fairen Konzept.

**⚠ Wenn du Münzmengen änderst**: `config.js` → `PRODUCTS`, die Beschreibung in der Play Console
und ggf. die Shop-Texte gleichzeitig anpassen. Produkt-IDs **nie** ändern.

---

## 5. Was kann man realistisch verdienen?

**⚠ Die folgenden Zahlen sind grobe Branchen-Schätzungen für Casual-/Puzzle-Spiele auf Android
(Stand 2025/2026). Sie schwanken stark nach Land, Saison (Q4 ist höher, Januar niedriger),
Einwilligungsrate, Spielertyp und Wettbewerb. Sie sind keine Prognose und keine Garantie.**

### 5.1 Begriffe

- **eCPM**: Einnahmen pro 1.000 Impressionen (in AdMob: „Beobachteter eCPM“, bereits nach Googles Anteil).
- **DAU**: tägliche aktive Nutzer. **ARPDAU**: Einnahmen pro täglichem aktiven Nutzer.
- **Fill Rate / Abgleichrate**: Anteil der Anfragen, für die eine Anzeige geliefert wird.
- **Anzeigerate (Show Rate)**: Anteil geladener Anzeigen, die tatsächlich gezeigt werden.
- **D1/D7/D30-Retention**: Anteil der Neuinstallationen, die nach 1/7/30 Tagen noch spielen.
- **LTV**: Einnahmen über die gesamte „Lebenszeit“ eines Spielers. **CPI**: Kosten pro Installation bei bezahlter Werbung.

### 5.2 Grobe eCPM-Bandbreiten (nur AdMob, ohne Mediation)

| Format | Deutschland / DACH / Westeuropa | USA | „Tier-3“-Märkte (z. B. Indien, Indonesien, viele Länder Lateinamerikas/Afrikas) |
|---|---|---|---|
| Rewarded | ca. 5–25 € | ca. 8–30 € | ca. 0,30–3 € |
| Interstitial | ca. 3–15 € | ca. 5–20 € | ca. 0,20–2 € |
| Banner | ca. 0,10–1 € | ca. 0,20–1,50 € | ca. 0,02–0,15 € |

Ohne Einwilligung (EU-Nutzer, die ablehnen) liefert Google nur eingeschränkte bzw. nicht
personalisierte Werbung. Die eCPMs und Fill-Raten sind dann **deutlich niedriger**.

### 5.3 Grobe ARPDAU-Bandbreiten (Werbung + Käufe)

| Markt | ARPDAU (grob) |
|---|---|
| Deutschland / Westeuropa | ca. 0,01–0,06 € |
| USA | ca. 0,02–0,10 € |
| Tier-3-Märkte | ca. 0,002–0,01 € |

### 5.4 Beispielrechnung (keine Prognose!)

Angenommen, du hast **500 tägliche Spieler in Deutschland** mit einer ARPDAU von 0,03 €:
500 × 0,03 € = **15 € pro Tag ≈ 450 € pro Monat**.

Aber: Für 500 tägliche Spieler brauchst du bei typischer Bindung (D30 von wenigen Prozent)
**laufend** neue Installationen, grob **mehrere Tausend pro Monat**. Ohne Marketing schaffen das
die wenigsten Indie-Spiele. Realistisch für den Start sind **einige Euro bis niedrige dreistellige
Beträge pro Monat**. Darauf kannst du aufbauen.

**Grobe Orientierung für gute Casual-Puzzles**: D1 um 35–45 %, D7 um 12–20 %, D30 um 4–8 %.
Liegst du deutlich darunter, verbessere zuerst das Spiel. Mehr Werbung oder Marketing hilft dann
nicht.

---

## 6. Was die Einnahmen wirklich bewegt

1. **Bindung (D1/D7)**: Jeder Spieler, der wiederkommt, sieht wieder Werbung. Gute Bindung kommt
   von Tutorial, Fairness, Tagesbelohnung, Missionen, Abenteuer-Fortschritt und
   „Nur noch 120 bis zum Rekord“.
2. **Sitzungslänge und Sitzungen pro Tag**: mehr Spielzeit = mehr Werbegelegenheiten, ohne den
   Takt zu verschärfen.
3. **Einwilligungsrate (EU)**: Personalisierte Werbung bringt ein Vielfaches. Die
   DSGVO-Nachricht von AdMob ist standardisiert. Du kannst sie kaum „optimieren“, nur korrekt in
   allen Sprachen veröffentlichen. **⚠ Keine Tricks** (kein Druck, kein Verstecken des
   Ablehnen-Buttons, keine Spielsperre ohne Zustimmung).
4. **Fill Rate und Ländermix**: Spieler aus DE/AT/CH/USA/UK/Nordeuropa bringen ein Vielfaches
   von Spielern aus Tier-3-Ländern. Store-Texte in den passenden Sprachen helfen.
5. **Anzeigerate**: Die App lädt Anzeigen vor. Ist ein Rewarded-Button oft „nicht verfügbar“,
   fehlt dir Umsatz. Beobachte das in den AdMob-Berichten.
6. **Mediation (später)**: Ab etwa einigen Tausend täglichen Nutzern lohnt sich **AdMob-Mediation**
   mit Bidding-Partnern (z. B. AppLovin, Unity Ads, Liftoff, Meta Audience Network, Pangle,
   Mintegral). Mehr Bieter bedeuten höhere eCPMs. **Das ist keine reine Klickarbeit in AdMob:** Für
   jedes Netzwerk muss ein Adapter-SDK in die Android-App eingebaut werden. Danach musst du
   `app-ads.txt` (zusätzliche Zeilen pro Netzwerk), die Datensicherheitsangaben und die
   Datenschutzerklärung erweitern und erneut testen.
7. **Käufe**: Gute Platzierung des „Werbefrei“-Angebots (Shop + sanfter Chip) und echte Gründe für
   Münzen (schöne Designs).

---

## 7. Nutzergewinnung (User Acquisition) – Grundlagen

1. **ASO (App Store Optimization)** – kostenlos und am wichtigsten. Details in
   [MARKETING.md](MARKETING.md):
   - Titel mit Gattungsbegriff („Blocko: Block Puzzle“)
   - die ersten 2–3 Screenshots: großes, klares Spielfeld, eine Kombo, ein Satz Text
   - Kurzbeschreibung mit Suchbegriffen, lokalisiert
   - Store-Eintrag-Tests (A/B)
2. **Social-Media-Clips** (TikTok, YouTube Shorts, Instagram Reels): 10–20 Sekunden
   „befriedigende“ Abräum-Momente, Riesen-Kombos, „Schaffst du das?“-Rätselstellungen. Regelmäßig
   posten (z. B. 3× pro Woche). Ein einziger Clip, der viral geht, kann mehr bringen als jedes Budget.
3. **Cross-Promotion**: Wenn du später ein zweites Spiel hast, kannst du über AdMob **Eigenwerbung**
   (House Ads) kostenlos füreinander werben.
4. **Günstige bezahlte Tests** (optional, erst wenn D1/D7 gut sind): z. B. Google-Ads-App-Kampagne
   mit kleinem Budget (z. B. 10–20 € am Tag für eine Woche). Ziel ist nicht Gewinn, sondern
   **zu messen**: Was kostet eine Installation (CPI)? Wie gut bleiben diese Spieler? Faustregel:
   Bezahlte Werbung lohnt sich nur, wenn **LTV > CPI**. Bei Puzzle-Spielen in Deutschland liegt der
   CPI grob bei 0,50–2 €, in Tier-3-Märkten oft unter 0,30 € (sehr grobe Schätzung).
5. **Bewertungen**: Die App zeigt die Google-Bewertungskarte automatisch nach einem neuen Rekord,
   ab dem 5. Spiel und nur einmal. Mehr dazu in MARKETING.md.

---

## 8. Was du auf keinen Fall tun darfst

Diese Dinge führen zu **Kontosperrung (AdMob)**, **App-Entfernung (Play)** oder Abmahnungen. Eine
AdMob-Sperre ist in der Praxis meist **endgültig**.

- **⚠ Eigene Anzeigen anklicken** oder Freunde/Familie/Gruppen bitten, auf Anzeigen zu klicken
  („zur Unterstützung“). Eigene Geräte immer als Testgeräte eintragen.
- **⚠ Belohnung für Klicks** auf Anzeigen. Belohnt werden darf nur das **Ansehen** eines
  Rewarded-Videos, nie ein Klick, und nie mit einem Interstitial oder Banner.
- **⚠ Layouts für versehentliche Klicks**: Banner direkt neben Spielsteinen oder Buttons,
  Interstitials, die erscheinen, während der Spieler gerade tippt, Anzeigen, die Inhalte überlagern.
  Der feste Banner-Bereich und die Tipp-Regel für Interstitials in Blocko verhindern das. Baue das
  nicht um.
- **⚠ Fake-Buttons**: falsche „X“-Schließen-Buttons, Buttons, die wie Spiel-Buttons aussehen, aber
  Werbung starten, versteckte „Nein danke“-Optionen, Countdown, der automatisch ein Video startet.
- **Interstitials** beim App-Start, beim Verlassen der App, mitten im Spiel oder mehrmals
  hintereinander.
- **Werbung in Benachrichtigungen** oder Benachrichtigungen, die mit Verlust drohen („Deine Münzen
  verfallen!“).
- **Bewertungen kaufen, tauschen oder belohnen** („5 Sterne = 100 Münzen“), vorab fragen „Gefällt
  dir die App?“ und nur Zufriedene zur Bewertung schicken (Review-Gating), oder die
  Google-Bewertungskarte per Button auslösen. Der „Bewerten“-Button in den Einstellungen öffnet
  deshalb den Play Store und **nicht** die Karte.
- **Installationen kaufen** (Bot-/Klickfarmen) oder an „Incentivized Install“-Programmen ohne
  Kennzeichnung teilnehmen.
- **Irreführende Store-Texte**: „#1“, „Bestes Spiel“, erfundene Auszeichnungen, Fremdmarken
  (z. B. „Tetris“) als Stichwort.
- **Zufallskäufe gegen Echtgeld** (Lootboxen) oder versteckte Preise.
- **Kinder ansprechen** (Zielgruppe ist 18+). Keine direkten Kaufaufforderungen an Kinder, wie
  „Kauf jetzt!“. Die Shop-Texte im Spiel sind bewusst neutral formuliert.
- **Schwierigkeit manipulieren**, damit Spieler öfter Revive-Videos schauen. Blocko liest den
  Rekord bewusst nicht für die Erzeugung der Teile aus. So bleibt das Spiel fair.

Offizielle Richtlinien: AdMob-Programmrichtlinien <https://support.google.com/admob/answer/6128543>,
Google-Play-Richtlinien <https://play.google.com/about/developer-content-policy/>.
