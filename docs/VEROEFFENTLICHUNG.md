# Blocko veröffentlichen – von null bis zur Live-App

Diese Anleitung führt dich Schritt für Schritt vom Quellcode bis zur fertigen App bei Google Play.
Du brauchst keine Erfahrung mit dem Veröffentlichen von Apps. Arbeite die Schritte der Reihe nach
ab und hake die Checklisten ab.

> **Stand: Oktober 2026.** Google ändert Menüs, Gebühren und Regeln regelmäßig. Wo ein Menüpfad
> steht („etwa unter …“), kann er bei dir leicht anders heißen. Im Zweifel gilt die offizielle Hilfe:
> Play Console Hilfe <https://support.google.com/googleplay/android-developer>, AdMob Hilfe
> <https://support.google.com/admob>.

**Zeichen in dieser Anleitung**

- **⚠ Fett mit Warnzeichen** = nicht rückgängig zu machen oder richtlinienkritisch. Bitte genau lesen.
- `- [ ]` = Checkliste zum Abhaken.

---

## Überblick und Zeitplan

| Schritt | Was | Dauer (ungefähr) |
|---|---|---|
| 0 | Name und Paket-ID festlegen, Markenrecht prüfen | 1 Abend |
| 1 | Android Studio, erste Debug-Version auf dem Handy | 1–2 Abende |
| 2 | Webseite (GitHub Pages): Datenschutz, Impressum, app-ads.txt | 1 Abend |
| 3 | AdMob-Konto, Anzeigenblöcke, Einwilligungsdialog | 1–2 Abende |
| 4 | Play-Console-Konto, Identitätsprüfung, Zahlungsprofil | Anmeldung 1 Abend, Prüfung **einige Tage** |
| 5 | App anlegen, Store-Eintrag, App-Inhalte | 1–2 Abende |
| 6 | In-App-Produkte, Testkäufe | 1 Abend |
| 7 | Signieren, App Bundle | 1 Abend |
| 8 | **Geschlossener Test: mindestens 12 Tester, 14 Tage am Stück**, danach Antrag auf Produktionszugriff | **mind. 2 Wochen + Prüfung (oft bis ca. 7 Tage)** |
| 9 | Live-Build, Release-Check, Upload, gestaffelter Rollout | 1 Abend + Prüfung |
| 10 | Nach dem Launch: beobachten, verbessern, Updates | laufend |

Rechne realistisch mit **4–6 Wochen** bis zur öffentlichen App.

> **Tipp:** Erstelle das Play-Console-Konto (Schritt 4) gleich am Anfang. Die Identitätsprüfung
> dauert oft mehrere Tage, und den 14-tägigen Test (Schritt 8) kannst du erst danach starten.

---

## Schritt 0 – Endgültigen App-Namen und Paket-ID festlegen

Die **Paket-ID** (Package Name, `applicationId`) ist die eindeutige Kennung deiner App, z. B.
`com.makdigitalstudio.blocko`.

**⚠ Die Paket-ID kann nach dem ersten Upload in die Play Console NIE mehr geändert werden. Sie ist
auch dann für immer verbraucht, wenn du die App löschst.** Der angezeigte App-Name im Store lässt
sich später dagegen jederzeit ändern.

### 0.1 Name prüfen (Markenrecht)

Ein Name, der schon als Marke geschützt ist, kann zu Abmahnungen oder zur Entfernung aus dem Store
führen. Prüfe deshalb vorab:

- [ ] **Google Play**: Suche nach „Blocko“ und ähnlichen Schreibweisen. Gibt es schon ein Spiel mit
      fast gleichem Namen?
- [ ] **Österreichisches Patentamt** (österreichische Marken): Markenrecherche auf <https://www.patentamt.at>.
      Relevant sind vor allem die Klassen **9** (Software/Spiele zum Herunterladen) und **41**
      (Unterhaltung/Online-Spiele).
- [ ] **EUIPO** (EU-Marken): <https://www.tmdn.org/tmview> (TMview durchsucht EU- und nationale
      Register) bzw. eSearch plus auf <https://euipo.europa.eu>.
- [ ] **WIPO** (international): Global Brand Database <https://branddb.wipo.int>.
- [ ] Normale Websuche, ggf. Social-Media-Namen.
- [ ] **Keine fremden Marken** im Namen oder in den Stichwörtern verwenden (z. B. „Tetris“ oder
      Namen bekannter Konkurrenz-Spiele).

Findest du eine ähnliche, ältere Marke für Spiele/Software, nimm lieber einen anderen Namen. Bei
Unsicherheit: kurze Erstberatung bei einem Anwalt für Markenrecht. Mehr dazu in
[RECHTLICHES.md](RECHTLICHES.md).

### 0.2 Paket-ID wählen

Die Paket-ID folgt der Form „umgedrehte Domain + App“. `com.makdigitalstudio.blocko` passt, wenn
dein GitHub-Benutzername **memo5561** ist und du die Webseite `memo5561.github.io` nutzt (Schritt 2).
Hast du einen anderen Benutzernamen oder eine eigene Domain, ändere die Paket-ID **jetzt**:

1. `game/js/config.js`:
   - `PACKAGE_ID: 'io.github.DEINNAME.blocko'`
   - `PLAY_STORE_URL` und `PLAY_STORE_MARKET_URL` (enthalten die Paket-ID)
   - `PRIVACY_POLICY_URL` und `IMPRINT_URL` (enthalten die Webseiten-Adresse)
2. `android/app/build.gradle.kts`: `applicationId = "io.github.DEINNAME.blocko"`.
   **Das ist der Wert, der für Google Play zählt.**
3. Optional, aber sauberer: `namespace` in derselben Datei und den Kotlin-Paketordner
   (`android/app/src/main/java/com/makdigitalstudio/blocko/`) anpassen. Am einfachsten geht das in
   Android Studio: Rechtsklick auf das Paket → **Refactor → Rename**. `namespace` und
   `applicationId` dürfen sich technisch auch unterscheiden.
4. `docs/site/index.html`: den Google-Play-Link (enthält die Paket-ID) anpassen.
5. `npm run check-release` meldet einen Fehler, wenn `applicationId` und `PACKAGE_ID` nicht
   übereinstimmen.

Nutzt du einen anderen GitHub-Namen als `memo5561`, ersetze ihn auch in allen Adressen dieser
Anleitung und in STORE_LISTING.md / PLAY_CONSOLE_ANGABEN.md durch deinen.

Regeln: nur Kleinbuchstaben, Ziffern, Punkte und Unterstriche, mindestens zwei Teile, jeder Teil
beginnt mit einem Buchstaben.

### 0.3 App-Namen überall eintragen (falls du „Blocko“ änderst)

- [ ] `game/js/config.js` → `APP_NAME`
- [ ] Android: `android/app/src/main/res/values/strings.xml` → `app_name` (Name unter dem Icon)
- [ ] Texte im Spiel (`game/js/ui/i18n.js`, falls der Name dort vorkommt)
- [ ] `tools/templates/feature-graphic.html` und `game/assets/icon.svg` (falls Schriftzug), danach `npm run icons`
- [ ] `docs/site/*.html`, `docs/STORE_LISTING.md`

**Checkliste Schritt 0**
- [ ] Name geprüft (Play, Patentamt AT, EUIPO/TMview, WIPO)
- [ ] Paket-ID endgültig festgelegt und in `config.js` + `build.gradle.kts` eingetragen
- [ ] `npm run check-release` meldet **keinen** Fehler zur Paket-ID (andere Fehler sind jetzt noch normal)

---

## Schritt 1 – Android Studio installieren und die App auf dem Handy starten

### 1.1 Installation

1. Lade **Android Studio** herunter: <https://developer.android.com/studio>. Das Projekt nutzt AGP
   9.4. Dafür brauchst du mindestens **Android Studio „Quail 4 | 2026.1.4“** (aktuell z. B.
   „Rabbit 1 | 2026.2.1“).
2. Installieren und beim ersten Start den Standard-Setup-Assistenten durchlaufen. Er lädt das
   Android SDK herunter.
3. Falls Android Studio beim Öffnen fehlende SDK-Plattformen meldet (das Projekt nutzt compileSdk 37
   und targetSdk 36): auf den Link „Install missing platform(s)“ klicken.

### 1.2 Projekt öffnen

1. **File → Open…** → den Ordner **`android/`** in diesem Projekt wählen (nicht den Hauptordner).
2. Den ersten **Gradle-Sync** abwarten. Beim ersten Mal kann das 5–15 Minuten dauern, weil viel
   heruntergeladen wird.
3. Fehler beim Sync? Lies [android/README.md](../android/README.md) (Abschnitt Fehlerbehebung). Oft
   hilft **File → Invalidate Caches… → Restart** oder ein Update von Android Studio.

### 1.3 Handy vorbereiten (USB-Debugging)

1. Handy: **Einstellungen → Über das Telefon → 7× auf „Build-Nummer“ tippen** → „Du bist jetzt
   Entwickler“. (Der Pfad unterscheidet sich je nach Hersteller etwas.)
2. **Einstellungen → System → Entwickleroptionen → USB-Debugging** einschalten.
3. Handy per USB-Kabel verbinden und auf dem Handy „USB-Debugging zulassen“ bestätigen.
   Alternativ geht auch „Wireless debugging“ (Android 11+) über **Pair Devices Using Wi-Fi** in
   Android Studio.
4. In Android Studio oben in der Geräteliste dein Handy wählen. Die Build-Variante ist **debug**
   (links **Build Variants**). Dann auf **Run ▶** klicken.

Offizielle Anleitung: <https://developer.android.com/studio/run/device>

### 1.4 Was die Debug-Version zeigt

- **Nur Testanzeigen** von Google, gekennzeichnet mit „Test Ad“. Damit verdienst du nichts,
  riskierst aber auch nichts. `debug` und `staging` nutzen **immer** Googles Test-App-ID und
  Test-Anzeigenblöcke, egal was in `gradle.properties` steht.
- Der **Einwilligungsdialog (UMP)** erscheint nach dem ersten Game-over. In der Debug-Version wird
  dafür ein Standort im EWR simuliert. Das klappt im **Emulator** automatisch. Auf einem **echten
  Handy** nur, wenn seine gehashte Geräte-ID in `BLOCKO_TEST_DEVICE_IDS` steht (siehe Schritt 3.9).
  Wegen der Test-App-ID siehst du hier Googles **Beispiel-Dialog**, nicht deine eigene Nachricht. Deine
  eigene DSGVO-Nachricht (Schritt 3.5) erscheint nur in einem Release-Build mit `BLOCKO_ADS_MODE=live`
  (prüfen in Schritt 9.3). Zum erneuten Testen: App-Daten löschen
  (**Einstellungen → Apps → Blocko → Speicher → Daten löschen**).
- **Käufe** funktionieren in der Debug-Version erst, wenn die App in der Play Console existiert,
  die Produkte angelegt sind und dein Google-Konto Lizenztester ist (Schritt 6).
- WebView-Debugging ist aktiv: In Chrome auf dem PC `chrome://inspect` öffnen, so siehst du die
  JavaScript-Konsole der App.

Weitere Build-Varianten (Details in [android/README.md](../android/README.md)):

| Variante | Zweck | Werbung | Signatur |
|---|---|---|---|
| `debug` | Entwickeln, Debuggen | Testanzeigen | Debug-Schlüssel |
| `staging` | Release-Einstellungen (optimiert/verkleinert) lokal testen | Testanzeigen | Debug-Schlüssel |
| `release` | Upload zu Google Play | je nach `BLOCKO_ADS_MODE` (`test`/`live`) | dein Upload-Schlüssel (Schritt 7) |

**Checkliste Schritt 1**
- [ ] Android Studio (Quail 4 oder neuer) installiert, Projekt `android/` synchronisiert
- [ ] Debug-Version läuft auf dem Handy, Tutorial und erste Runde funktionieren
- [ ] Testanzeigen erscheinen nach dem ersten Game-over (spätestens nach Schritt 3)

---

## Schritt 2 – Webseite mit Datenschutzerklärung, Impressum und app-ads.txt (GitHub Pages)

Google Play verlangt eine **öffentlich erreichbare Datenschutzerklärung** (als Webseite, kein PDF).
In Österreich brauchst du außerdem ein **Impressum** (§ 5 ECG, § 14 UGB, § 63 GewO, § 25 Mediengesetz). AdMob prüft die Datei **app-ads.txt** im
Stammverzeichnis deiner Entwickler-Webseite. Das alles hostest du kostenlos mit GitHub Pages.

### 2.1 Platzhalter ausfüllen

Öffne in `docs/site/` die Dateien `privacy-policy.html` und `impressum.html` und ersetze alle
gelb markierten Platzhalter durch deine echten Daten:

- Name, Anschrift (Quellenstraße 24b/21/9, 1100 Wien), E-Mail und Telefon sind bereits eingetragen
- Die mit `XXXX` markierten Felder im Impressum ausfüllen: Unternehmensgegenstand/Gewerbewortlaut,
  Gewerbebehörde, Wirtschaftskammer/Fachgruppe
- Firmenbuch (nur falls eingetragen) und UID-Nummer (nur falls vorhanden): ausfüllen oder den
  Abschnitt löschen (Hinweise stehen als Kommentar in der Datei)
- Zum Schluss im `<body>`-Tag `class="draft"` entfernen. Dann verschwinden die gelbe Markierung und
  der Entwurfs-Hinweis.

Prüfe das Ergebnis lokal: Datei im Browser öffnen (Doppelklick). `npm run check-release` meldet,
solange noch Platzhalter in den beiden Seiten stehen.

Trage dieselben Daten in `game/js/config.js` → `LEGAL` ein. Daraus entsteht das Impressum
**in der App** (Einstellungen → Impressum).

**⚠ Diese Daten sind danach öffentlich.** Lies vorher den Abschnitt „Impressum“ in
[RECHTLICHES.md](RECHTLICHES.md), vor allem wenn du deine Privatadresse nicht veröffentlichen willst.

### 2.2 Repository anlegen

1. Melde dich bei <https://github.com> an (Benutzer **memo5561**, oder deiner, dann siehe Schritt 0.2).
2. **New repository** → Name **genau** `memo5561.github.io` → **Public** → Create.
   Ein Repository mit diesem Namen wird automatisch zur „User Site“ unter
   `https://memo5561.github.io/`.
3. Lade die Dateien in **diese Struktur** hoch (über **Add file → Upload files**, Ordner kannst du
   per Drag & Drop hineinziehen):

```
memo5561.github.io/            (Wurzel des Repositorys)
├── app-ads.txt                ← MUSS in der Wurzel liegen (aus docs/site/app-ads.txt)
├── index.html                 ← Kopie von docs/site/index.html (Startseite, optional)
└── blocko/
    ├── index.html             ← docs/site/index.html
    ├── privacy-policy.html    ← docs/site/privacy-policy.html
    └── impressum.html         ← docs/site/impressum.html
```

4. **Settings → Pages**: Prüfe, dass „Deploy from a branch“, Branch `main` und Ordner `/ (root)`
   eingestellt sind. Nach 1–5 Minuten ist die Seite online.
5. Teste im Browser. Die Adressen müssen **genau** mit `config.js` übereinstimmen:
   - [ ] <https://memo5561.github.io/blocko/privacy-policy.html> = `PRIVACY_POLICY_URL`
   - [ ] <https://memo5561.github.io/blocko/impressum.html> = `IMPRINT_URL`
   - [ ] <https://memo5561.github.io/app-ads.txt> (die Publisher-ID trägst du in Schritt 3 ein)

`app-ads.txt` füllst du erst nach Schritt 3 mit deiner echten Publisher-ID. Lade die Datei dann
noch einmal hoch.

**Hinweis:** Alles in einem öffentlichen Repository ist für jeden sichtbar, auch die alte
Versionsgeschichte. Lade dort **niemals** Schlüssel, Passwörter oder `keystore.properties` hoch.

**Checkliste Schritt 2**
- [ ] Platzhalter in `privacy-policy.html` und `impressum.html` ersetzt
- [ ] `config.js` → `LEGAL` mit denselben Daten gefüllt
- [ ] Seiten online, URLs stimmen mit `config.js` überein
- [ ] `app-ads.txt` liegt in der Wurzel (Inhalt folgt in Schritt 3)

---

## Schritt 3 – AdMob einrichten

### 3.1 Konto anlegen

1. <https://admob.google.com> → mit deinem Google-Konto anmelden (am besten dasselbe wie für die
   Play Console).
2. Land **Österreich**, Zeitzone und Währung (EUR) wählen. **⚠ Zeitzone und Zahlungswährung lassen
   sich später nicht oder nur schwer ändern.**
3. Den AdMob-Bedingungen zustimmen.

### 3.2 App hinzufügen

1. **Apps → App hinzufügen → Android**.
2. „Ist die App in einem unterstützten App-Shop veröffentlicht?“ → **Nein** (noch nicht; verknüpfen
   kannst du sie später, siehe 3.8).
3. App-Name „Blocko“ → Hinzufügen.
4. Notiere die **App-ID** (Format `ca-app-pub-1234567890123456~1234567890`). Sie enthält eine
   **Tilde (~)**.

### 3.3 Anzeigenblöcke erstellen

Unter **Apps → Blocko → Anzeigenblöcke → Anzeigenblock hinzufügen** legst du drei Blöcke an:

| Typ | Vorschlag für den Namen | Einstellungen |
|---|---|---|
| **Banner** | `blocko_banner` | Standard. Die adaptive Größe legt die App im Code fest. |
| **Interstitial** | `blocko_interstitial` | Anzeigentypen: Bild & Video (Standard). Optional unter „Erweiterte Einstellungen“ ein Frequency Capping als Sicherheitsnetz, z. B. max. 15 pro Stunde. |
| **Rewarded (Belohnung)** | `blocko_rewarded` | Belohnung: Menge `1`, Element `reward`. Die tatsächliche Belohnung bestimmt die App selbst. |

Jeder Block hat eine **Anzeigenblock-ID** (Format `ca-app-pub-1234567890123456/1234567890`) mit einem
**Schrägstrich (/)**.

### 3.4 IDs in die App eintragen

Öffne `android/gradle.properties` und trage ein:

```properties
BLOCKO_ADMOB_APP_ID=ca-app-pub-…~…
BLOCKO_ADMOB_BANNER_ID=ca-app-pub-…/…
BLOCKO_ADMOB_INTERSTITIAL_ID=ca-app-pub-…/…
BLOCKO_ADMOB_REWARDED_ID=ca-app-pub-…/…
# bleibt "test" bis Schritt 9!
BLOCKO_ADS_MODE=test
```

Im Modus `test` nutzt die App Googles offizielle **Test-App-ID und Test-Anzeigenblöcke**. Deine
eigenen IDs werden **nur** im Build-Typ `release` mit `BLOCKO_ADS_MODE=live` verwendet. `debug` und
`staging` zeigen immer Testanzeigen. Ein `live`-Release-Build bricht mit einer Fehlermeldung ab, wenn
eine ID fehlt, eine Google-Test-ID ist oder nicht wie eine echte AdMob-ID aussieht (Gradle-Prüfung
`checkReleaseAdIds`). Details: [android/README.md](../android/README.md).

### 3.5 Einwilligungsdialog (DSGVO) veröffentlichen – Pflicht für EU-Nutzer

Ohne veröffentlichte Nachricht erscheint in der App kein Einwilligungsdialog. Dann bekommst du in
der EU kaum Einnahmen und verstößt gegen Google-Richtlinien.

1. AdMob: **Datenschutz und Mitteilungen** (Privacy & messaging) → **Europäische Vorschriften**
   (European regulations / DSGVO) → **Nachricht erstellen**.
2. **Apps**: Blocko auswählen.
3. **Sprachen**: alle 8 Sprachen des Spiels hinzufügen: **Deutsch, Englisch, Spanisch,
   Französisch, Italienisch, Portugiesisch, Türkisch, Russisch**. Standardsprache: Englisch.
4. **Datenschutzerklärung-URL**: `https://memo5561.github.io/blocko/privacy-policy.html`.
5. **Nutzeroptionen**: „Einwilligen“ und „Optionen verwalten“ sind Standard. **Empfehlung: zusätzlich
   „Nicht einwilligen“ (Do not consent) aktivieren.** Ablehnen sollte so einfach sein wie Zustimmen.
   Das verlangen die deutschen Datenschutzbehörden. Es senkt zwar die Einwilligungsrate etwas,
   senkt aber dein rechtliches Risiko deutlich (siehe [RECHTLICHES.md](RECHTLICHES.md)).
6. **Werbepartner**: die Standardauswahl („häufig verwendete Werbepartner“) beibehalten.
7. Optisch gestalten (App-Name, ggf. Logo) → **Veröffentlichen**.

Die Einstellung „Datenschutz-Einstellungen“ im Spiel (Einstellungen) öffnet diesen Dialog erneut.
So können Nutzer ihre Einwilligung jederzeit ändern oder widerrufen.

**Optional: Nachricht für US-Bundesstaaten** (US state regulations, z. B. Kalifornien): Unter
Datenschutz und Mitteilungen → **US-Bundesstaaten** eine Nachricht erstellen und veröffentlichen.
Dann sehen Nutzer dort eine Opt-out-Möglichkeit („Do Not Sell or Share“) in den
Datenschutz-Einstellungen. Empfohlen, wenn du die App weltweit anbietest.

### 3.6 Werbung filtern (Blocking controls)

**Apps → Blockierungseinstellungen** (Blocking controls) → für alle Apps:

- [ ] **Sensible Kategorien**: **Glücksspiel und Wetten** (Gambling & betting) und **Dating**
      blockieren. Je nach Geschmack auch „Alkohol“, „Schnell reich werden“ und „Sexuelle Inhalte“
      (soweit angeboten).
- [ ] **Maximale Altersfreigabe für Anzeigen**: **T** (Teen) oder strenger. Die App setzt im Code
      ohnehin maximal T.
- [ ] Gelegentlich ins **Prüfungscenter für Anzeigen** (Ad review center) schauen und unpassende
      Anzeigen blockieren.

Blockieren kostet etwas Umsatz. Ein Puzzle mit Casino-Werbung schadet aber Bewertungen und Image.

### 3.7 Zahlungen und Steuern

1. **Zahlungen → Zahlungsinformationen**: Name/Anschrift (wie im Ausweis), Bankkonto (IBAN).
2. **Steuerinformationen**: Google fragt nach US-Steuerangaben (für Privatpersonen meist Formular
   **W-8BEN**). Ohne diese Angaben kann Google Quellensteuer auf Einnahmen von US-Nutzern
   einbehalten. Beim Doppelbesteuerungsabkommen hilft dir ggf. dein Steuerberater bzw. Wirtschaftstreuhänder (Doppelbesteuerungsabkommen Österreich–USA).
3. **Adressbestätigung (PIN)**: Sobald deine Einnahmen eine kleine Schwelle erreichen, schickt Google
   einen Brief mit einer PIN, die du in AdMob eingibst.
4. **Auszahlung** erfolgt monatlich, sobald die Auszahlungsschwelle erreicht ist (für EUR bisher
   etwa 70 €; Stand Oktober 2026 bitte im Konto prüfen). Der Absender ist eine irische
   Google-Gesellschaft, siehe [RECHTLICHES.md](RECHTLICHES.md) (Reverse Charge).

### 3.8 app-ads.txt und Verknüpfung mit Google Play

1. Deine **Publisher-ID** findest du in AdMob unter **Einstellungen → Kontoinformationen**
   (Format `pub-1234567890123456`).
2. Ersetze in `docs/site/app-ads.txt` den Platzhalter `pub-XXXXXXXXXXXXXXXX` durch deine ID und lade
   die Datei erneut in die **Wurzel** von `memo5561.github.io` hoch.
3. Trage in der Play Console bei den Store-Kontaktdaten die **Website** `https://memo5561.github.io`
   ein (Schritt 5). Dort sucht AdMob nach `app-ads.txt`.
4. **Nach** der Veröffentlichung bei Google Play (Schritt 9): AdMob → **Apps → Blocko →
   App-Einstellungen → App-Shop-Details hinzufügen** → nach dem Paketnamen suchen → verknüpfen.
5. Den Status prüfst du unter **Apps → app-ads.txt**. Das Crawlen kann einige Tage dauern.
6. Neue Apps prüft AdMob vor der vollen Freigabe („App-Bereitschaft“). Bis dahin werden ggf.
   nur eingeschränkt Anzeigen ausgeliefert. Das ist normal.

### 3.9 Testgeräte – damit dein Konto nicht gesperrt wird

**⚠ Klicke NIEMALS auf deine eigenen echten Anzeigen und bitte niemanden darum.** AdMob erkennt
ungültige Zugriffe („Invalid Traffic“). Das führt zu Abzügen bis hin zur **dauerhaften
Kontosperrung**, die sich praktisch nicht rückgängig machen lässt.

- [ ] Dein Handy (und Testhandys) als **Testgerät** eintragen:
  - in AdMob: **Einstellungen → Testgeräte → Testgerät hinzufügen** (Werbe-ID des Handys: Android
    **Einstellungen → Google → Anzeigen** bzw. **Datenschutz → Werbung**), **und**
  - in der App: In Logcat (Android Studio, Suchfeld `setTestDeviceIds` bzw. `addTestDeviceHashedId`)
    erscheint beim ersten Laden einer Anzeige bzw. des Einwilligungsdialogs eine Zeile mit einer
    gehashten ID (32 Zeichen, z. B. `33BE2250B43518CCDA7DE426D04EE231`). Trage sie in
    `android/gradle.properties` ein, mehrere Geräte durch Komma getrennt:
    `BLOCKO_TEST_DEVICE_IDS=33BE2250B43518CCDA7DE426D04EE231,ABCDEF0123456789ABCDEF0123456789`.
    Diese Geräte bekommen nie echte Anzeigen, und auf ihnen funktioniert die EWR-Simulation des
    Einwilligungsdialogs.
- [ ] Freunde testen nur Builds mit `BLOCKO_ADS_MODE=test` (Schritt 8).
- [ ] Die App nicht in „Klick-Tausch“-Gruppen oder ähnlichen Gruppen teilen.

**Checkliste Schritt 3**
- [ ] AdMob-Konto, App und 3 Anzeigenblöcke angelegt, IDs in `gradle.properties`
- [ ] DSGVO-Nachricht in 8 Sprachen veröffentlicht (mit „Nicht einwilligen“)
- [ ] Optional: US-Nachricht veröffentlicht
- [ ] Glücksspiel und Dating blockiert, maximale Altersfreigabe T
- [ ] Zahlungs- und Steuerdaten eingetragen
- [ ] `app-ads.txt` mit echter Publisher-ID online
- [ ] Eigene Geräte als Testgeräte eingetragen

---

## Schritt 4 – Google-Play-Entwicklerkonto

### 4.1 Kontotyp wählen

Registrierung: <https://play.google.com/console/signup>

| | **Privat (persönlich)** | **Organisation** |
|---|---|---|
| Für wen | Einzelpersonen, auch mit Gewerbe als Einzelunternehmer | Firmen (GmbH, UG …), auch Einzelunternehmen mit D-U-N-S-Nummer |
| Nachweis | Amtlicher Ausweis | **D-U-N-S-Nummer** (kostenlos bei Dun & Bradstreet, dauert oft Tage bis Wochen) + Unternehmensnachweise |
| **Testpflicht** | **Ja: geschlossener Test mit mind. 12 Testern über 14 Tage, bevor du in Produktion veröffentlichen darfst** | Nein |
| Öffentlich sichtbar | Entwicklername; als „Händler“ in der EU auch Name, Anschrift, Telefon, E-Mail | Unternehmensdaten |

Für dich als Einzelentwickler ist das **private Konto** meist der einfachste Weg. Den 14-Tage-Test
schaffst du mit dieser Anleitung (Schritt 8).

### 4.2 Registrieren und verifizieren

1. Google-Konto mit **Bestätigung in zwei Schritten** (2FA) verwenden.
2. **Einmalige Registrierungsgebühr** bezahlen (bisher **25 US-Dollar**; Stand Oktober 2026 bitte
   bei der Anmeldung prüfen).
3. **Identitätsprüfung**: Name und Anschrift **genau wie im Ausweis** angeben und den Ausweis
   hochladen. Die Daten müssen zum Zahlungsprofil passen.
4. **Kontaktdaten bestätigen**: E-Mail und Telefonnummer per Code.
5. Ggf. **Zugriff auf ein Android-Gerät bestätigen**: Neue private Konten müssen das teilweise über
   die **Play Console-App** auf einem echten Android-Handy tun. Folge den Hinweisen auf der
   Startseite der Console.
6. **Entwicklername** wählen. Er steht im Store unter dem App-Namen, z. B. dein Name oder ein
   Studioname. Keine fremden Marken verwenden.
7. **Android-Entwicklerverifizierung**: Google verlangt ab 2026 schrittweise, dass alle Apps auf
   zertifizierten Android-Geräten von verifizierten Entwicklern stammen. Für Play-Apps läuft das
   über die Play Console. Prüfe die **Startseite der Play Console** auf Hinweise zur
   App-Registrierung und folge ihnen.

### 4.3 Händlerstatus (EU Digital Services Act)

Die Play Console fragt, ob du **Händler** (Trader) im Sinne des EU-Gesetzes über digitale Dienste
bist (etwa unter **Einstellungen → Entwicklerkonto → Kontodetails**).

- Wer mit der App Geld verdienen will (Werbung, Käufe), ist in aller Regel **Händler**.
- **⚠ Als Händler werden Name, Anschrift, Telefonnummer und E-Mail im Play Store für EU-Nutzer
  öffentlich angezeigt.** Ohne Angabe kann deine App in der EU nicht (mehr) angeboten werden.
- Hinweise zur Adresse: [RECHTLICHES.md](RECHTLICHES.md), Abschnitt DSA und Impressum.

### 4.4 Zahlungsprofil (Händlerkonto) für In-App-Käufe

Damit du In-App-Produkte verkaufen kannst, brauchst du ein **Händlerkonto (Payments Profile)**:

1. Play Console → etwa unter **Einstellungen → Zahlungsprofil** bzw. **Monetarisierung einrichten**
   → Zahlungsprofil erstellen oder verknüpfen.
2. Angaben: Name/Firma, Anschrift, Bankkonto (IBAN), Kundensupport-E-Mail, ggf. UID-Nummer,
   Steuerangaben.
3. Google behält bei Verkäufen eine **Servicegebühr** ein. Bisher sind das 15 % auf die erste
   1 Mio. USD Umsatz pro Jahr, darüber 30 %. Die Bedingungen ändern sich (u. a. durch EU-Regeln).
   Stand Oktober 2026 bitte in der Play Console Hilfe prüfen.

**Checkliste Schritt 4**
- [ ] Konto erstellt, Gebühr bezahlt
- [ ] Identität, E-Mail, Telefon (und ggf. Gerät) verifiziert
- [ ] Händlerstatus (DSA) angegeben
- [ ] Zahlungsprofil für In-App-Käufe eingerichtet

---

## Schritt 5 – App anlegen, Store-Eintrag und App-Inhalte

### 5.1 App erstellen

Play Console → **Alle Apps → App erstellen**:

- **App-Name**: `Blocko: Block Puzzle` (max. 30 Zeichen, später änderbar)
- **Standardsprache**: **Englisch (USA) – en-US**. Diese Sprache sehen alle Länder, für die es
  keine Übersetzung gibt. Deutsch fügst du als Übersetzung hinzu.
- **App oder Spiel**: **Spiel**
- **Kostenlos oder kostenpflichtig**: **Kostenlos**. **⚠ Eine kostenlose App kann später nicht mehr
  kostenpflichtig werden.**
- Erklärungen (Programmrichtlinien, US-Exportgesetze) bestätigen.

Danach führt dich das **Dashboard** durch die Aufgaben „App einrichten“.

### 5.2 Store-Eintrag (Hauptdarstellung im Store)

Die fertigen Texte zum Kopieren stehen in **[STORE_LISTING.md](STORE_LISTING.md)**.

- [ ] Titel, Kurzbeschreibung, vollständige Beschreibung (en-US und de-DE, weitere Sprachen
      optional)
- [ ] **App-Symbol** 512 × 512 PNG: `store/icon-512.png`
- [ ] **Feature-Grafik** 1024 × 500: `store/feature-graphic.png`
- [ ] **Screenshots Smartphone**: mindestens 2, besser 4–8. Erzeugen mit `npm run assets`. Die
      Bilder landen in `store/`, der genaue Ordner steht in der Ausgabe des Befehls.
- [ ] Optional, empfohlen: Screenshots für 7- und 10-Zoll-Tablets (für die Darstellung auf Tablets)
- [ ] Optional: Promo-Video (YouTube-Link, Idee in STORE_LISTING.md)

Neu erzeugen nach Design-Änderungen: `npm run icons` (Icon + Feature-Grafik) und `npm run assets`
(Screenshots).

### 5.3 Store-Einstellungen

- **Kategorie**: Spiele → **Puzzle**
- **Tags**: siehe STORE_LISTING.md
- **Kontaktdaten**: E-Mail (Pflicht, öffentlich), **Website `https://memo5561.github.io`**
  (wichtig für app-ads.txt), Telefon optional

### 5.4 App-Inhalte (Richtlinien-Angaben)

Unter **Richtlinien → App-Inhalte** (bzw. im Dashboard). Die exakten Antworten stehen in
**[PLAY_CONSOLE_ANGABEN.md](PLAY_CONSOLE_ANGABEN.md)**. Kurzfassung:

| Abschnitt | Antwort |
|---|---|
| Datenschutzerklärung | `https://memo5561.github.io/blocko/privacy-policy.html` |
| App-Zugriff | Alle Funktionen ohne Anmeldung verfügbar |
| Werbung | **Ja, enthält Werbung** |
| Einstufung (IARC-Fragebogen) | Kategorie Spiel. Werbung + digitale Käufe ehrlich angeben. Erwartet: **PEGI 3** (USK gilt nur für Deutschland) mit Hinweis **„In-Game-Käufe“** |
| Zielgruppe | **Nur „18 und älter“**. „Spricht Kinder an?“ → **Nein** |
| Datensicherheit | siehe PLAY_CONSOLE_ANGABEN.md (Daten über das Google Mobile Ads SDK) |
| Werbe-ID | **Ja**, für Werbung/Analysen/Betrugsprävention |
| Behörden-App | Nein |
| Finanzfunktionen | Keine |
| Gesundheit | Keine Gesundheitsfunktionen |
| Nachrichten-App | Nein |

**Warum Zielgruppe 18+?** Wählst du Altersgruppen unter 13 Jahren, gilt das
**Google-Play-Familienprogramm** (Families Policy). Dann darfst du nur speziell zertifizierte
Werbe-SDKs nutzen, keine personalisierte Werbung zeigen und musst viele Zusatzregeln erfüllen. Bei
Kindern unter 14 verlangt außerdem **Art. 8 DSGVO** (in Österreich, § 4 Abs. 4 DSG) die Einwilligung der
Erziehungsberechtigten für personalisierte Werbung. Blocko ist ein Gelegenheitsspiel für Erwachsene. Die
**Altersfreigabe** (PEGI 3) ist davon unabhängig: Sie sagt nur, dass der Inhalt für alle unbedenklich
ist. **⚠ Gestalte Icon, Screenshots und Texte nicht kindlich** (keine Comic-Maskottchen, keine
Sprache, die sich an Kinder richtet). Sonst kann Google die App trotzdem als „für Kinder
ansprechend“ einstufen.

**Checkliste Schritt 5**
- [ ] App erstellt (Spiel, kostenlos)
- [ ] Store-Eintrag mit Grafiken und Screenshots vollständig
- [ ] Kategorie Puzzle, Kontaktdaten inkl. Website
- [ ] Alle App-Inhalte-Abschnitte ausgefüllt (grüne Haken im Dashboard)

---

## Schritt 6 – In-App-Produkte und Testkäufe

### 6.1 Voraussetzungen

- Zahlungsprofil aus Schritt 4.4 ist eingerichtet.
- Die Produktseite lässt sich erst nutzen, wenn **ein Build mit der Billing-Bibliothek
  hochgeladen** wurde. Lade dazu zuerst einen signierten Release-Build (Schritt 7, `test`-Modus) in
  den **internen Test** hoch (Schritt 8.1).

### 6.2 Produkte anlegen

Play Console → **Monetarisieren → Produkte → Einmalkaufprodukte** (früher „In-App-Produkte“) →
**Produkt erstellen**. Die Console fragt ggf. nach einer **Kaufoption**. Wähle „Kaufen“ (Buy) mit
einem festen Preis.

**⚠ Produkt-IDs können nach dem Anlegen nicht geändert und nach dem Löschen nie wieder verwendet
werden. Tippe sie exakt so ein (kleingeschrieben, mit Unterstrich):**

| Produkt-ID | Name (DE / EN) | Beschreibung (DE / EN) | Preisvorschlag |
|---|---|---|---|
| `remove_ads` | Werbefrei / Remove Ads | Entfernt Banner und Werbung zwischen den Runden. Freiwillige Belohnungsvideos bleiben verfügbar. Mit Geschenk: 500 Münzen, 1 Hammer, 1 Mischen. / Removes banner and between-game ads. Optional reward videos stay available. Includes a gift: 500 coins, 1 hammer, 1 shuffle. | **4,99 €** |
| `coins_small` | 1.500 Münzen / 1,500 Coins | Ein Münzpaket für Designs, Booster und Wiederbelebungen. / A coin pack for themes, boosters and revives. | **1,99 €** |
| `coins_large` | 6.000 Münzen / 6,000 Coins | Großes Münzpaket: viermal so viele Münzen wie das kleine Paket. / Big coin pack: four times the coins of the small pack. | **4,99 €** |

- Ob ein Produkt verbrauchbar ist (Münzen) oder dauerhaft (werbefrei), legt **die App** fest. In
  der Console gibt es dafür keine Einstellung.
- Preise in EUR **inklusive** Mehrwertsteuer eingeben. Google rechnet sie in andere Währungen um
  („Lokale Preise“). Die Umsatzsteuer gegenüber Kunden wickelt Google ab.
- Ändere die Münzmengen nur zusammen mit `config.js` → `PRODUCTS` und der Beschreibung.
- Jedes Produkt **aktivieren**.

### 6.3 Lizenztester einrichten

1. Play Console → etwa unter **Einstellungen → Lizenztests** (License testing) → Google-Konten der
   Tester eintragen (deines zuerst). Lizenzantwort: `RESPOND_NORMALLY`.
2. Diese Konten bezahlen **nicht** wirklich. Im Kaufdialog stehen Test-Zahlungsmittel zur Auswahl.
3. **⚠ Tester, die KEINE Lizenztester sind, zahlen auch in Testversionen mit echtem Geld.** Trage
   deshalb alle Tester aus Schritt 8, die kaufen wollen, als Lizenztester ein.

### 6.4 Testkäufe – diese Fälle durchspielen

Installiere die App **aus dem Play Store** (Testlink aus Schritt 8). Das Handy muss mit dem
Lizenztester-Konto als Hauptkonto angemeldet sein.

- [ ] **`coins_small` mit „Testkarte, wird immer genehmigt“** → Münzen kommen sofort an, Kauf ist wiederholbar.
- [ ] **`coins_large`** → ebenso, „Bestes Angebot“-Hinweis sichtbar.
- [ ] **„Testkarte, wird immer abgelehnt“** → keine Münzen, verständliche Meldung.
- [ ] **„Langsame Testkarte, wird nach einigen Minuten genehmigt“** → zuerst „ausstehend“, **keine**
      Münzen. Nach ein paar Minuten (App neu öffnen) kommen die Münzen **genau einmal** an.
- [ ] **„Langsame Testkarte, wird nach einigen Minuten abgelehnt“** → es kommen nie Münzen an.
- [ ] **`remove_ads`** → Banner verschwindet, keine Interstitials mehr, Geschenk (500 Münzen,
      1 Hammer, 1 Mischen) kommt **einmal** an. Belohnungsvideos bleiben möglich.
- [ ] **Nach 5 Minuten** ist `remove_ads` noch aktiv. (Bei Lizenztestern erstattet Google
      unbestätigte Käufe nach 3 Minuten automatisch. Bleibt der Kauf, funktioniert die Bestätigung.)
- [ ] **Neu installieren** → Einstellungen → „Käufe wiederherstellen“ → werbefrei ist wieder aktiv,
      das Geschenk kommt **nicht** doppelt.
- [ ] **Erstattung testen**: Play Console → **Bestellverwaltung** (Order management) → Bestellung
      von `remove_ads` öffnen → **Erstatten** und **Berechtigung entziehen** → App schließen und neu
      öffnen → Werbung ist wieder da.
- [ ] Ohne Internet kaufen → verständliche Fehlermeldung, kein Absturz.

Offizielle Testanleitung: <https://developer.android.com/google/play/billing/test>

**Checkliste Schritt 6**
- [ ] 3 Produkte mit exakten IDs angelegt, Preise gesetzt, aktiviert
- [ ] Lizenztester eingetragen
- [ ] Alle Testkäufe oben erfolgreich

---

## Schritt 7 – Signieren und App Bundle bauen

Google Play nimmt nur **signierte Android App Bundles (.aab)** an. Dabei gibt es zwei Schlüssel:

- **Upload-Schlüssel** (dein Schlüssel): Damit signierst du jedes AAB vor dem Hochladen.
- **App-Signaturschlüssel** (bei Google): Mit **Play App Signing** (Pflicht für neue Apps) signiert
  Google die App für die Nutzer. Beim ersten Upload einfach den Standard „Google erstellt und
  schützt den Schlüssel“ übernehmen.

### 7.1 Upload-Schlüssel erstellen – Variante A: Android Studio (empfohlen für Einsteiger)

1. Build-Variante **release** wählen.
2. **Build → Generate Signed App Bundle or APK… → Android App Bundle → Next**.
3. **Create new…** (Key store path):
   - Speicherort **außerhalb** des Projektordners, z. B. `Dokumente/Schluessel/blocko-upload.jks`
   - sicheres Passwort für Keystore und Schlüssel
   - Alias: `upload`
   - **Gültigkeit: mindestens 25 Jahre**
   - Vor- und Nachname, Land `DE` (die übrigen Felder sind optional)
4. **Next → release → Create**. Das AAB liegt danach unter `android/app/release/` bzw.
   `android/app/build/outputs/bundle/release/` (Android Studio zeigt einen Link „locate“).

### 7.2 Variante B: keystore.properties (für Builds per Kommandozeile)

1. Kopiere `android/keystore.properties.example` nach **`android/keystore.properties`** und trage ein:
   ```properties
   storeFile=/Pfad/zu/Schluessel/blocko-upload.jks   # relativ zu android/ oder absoluter Pfad
   storePassword=DEIN_KEYSTORE_PASSWORT
   keyAlias=upload
   keyPassword=DEIN_SCHLUESSEL_PASSWORT
   ```
   Einen Schlüssel kannst du auch auf der Kommandozeile erzeugen (der Befehl steht in der
   Beispieldatei, `keytool` gehört zum JDK von Android Studio).
2. Im Ordner `android/`: `./gradlew bundleRelease` (Windows: `gradlew.bat bundleRelease`). Das
   signierte AAB liegt dann unter `android/app/build/outputs/bundle/release/app-release.aab`.
3. Ohne `keystore.properties` ist der Release-Build **unsigniert**. Dann signierst du ihn mit dem
   Assistenten aus Variante A.

`keystore.properties` und `*.jks` stehen in `.gitignore`. **⚠ Niemals committen oder hochladen.**

### 7.3 Upload-Schlüssel sichern – sofort!

**⚠ Ohne Upload-Schlüssel kannst du keine Updates hochladen.** Mit Play App Signing kannst du bei
Verlust zwar eine Zurücksetzung des Upload-Schlüssels bei Google beantragen. Das kostet aber Zeit
und Nerven.

- [ ] `.jks`-Datei an **mindestens zwei** sicheren Orten speichern (z. B. verschlüsselter USB-Stick
      **und** verschlüsselter Cloud-Speicher)
- [ ] Passwörter und Alias im **Passwort-Manager**
- [ ] Niemals in Git, niemals per E-Mail, niemals in das GitHub-Pages-Repository

### 7.4 Versionsnummern

In `android/gradle.properties`:

- `BLOCKO_VERSION_CODE`: ganze Zahl. **Jeder Upload braucht eine höhere Zahl als alle vorherigen**
  (1, 2, 3, …). Ein Code, den du schon hochgeladen hast, ist für immer verbraucht, auch in
  Testtracks.
- `BLOCKO_VERSION_NAME`: Anzeige für Nutzer, z. B. `1.0.0`, `1.0.1`, `1.1.0`. Halte
  `config.js` → `VERSION` gleich (`check-release` warnt sonst).

Offiziell: <https://developer.android.com/studio/publish/app-signing>,
<https://developer.android.com/studio/publish/versioning>

**Checkliste Schritt 7**
- [ ] Upload-Schlüssel erstellt (25+ Jahre), doppelt gesichert, Passwörter im Passwort-Manager
- [ ] Signiertes Release-AAB gebaut
- [ ] Versionscode erhöht

---

## Schritt 8 – Testen: interner Test, geschlossener Test (12 Tester / 14 Tage), Produktionszugriff

### 8.1 Interner Test (schnell, für dich)

1. In `android/gradle.properties`: **`BLOCKO_ADS_MODE=test`**, Versionscode erhöhen.
2. `npm run check-release` ausführen. Für einen Test-Build darf **nur** der Fehler
   „BLOCKO_ADS_MODE is not "live"“ übrig bleiben. Impressum und Datenschutzerklärung sollten schon
   fertig und online sein, weil Tester und Google-Prüfer sie sehen.
3. Release-AAB signiert bauen (Schritt 7).
4. Play Console → **Testen → Interner Test → Neuen Release erstellen** → AAB hochladen → Name/Notizen
   → speichern → veröffentlichen.
5. **Tester**: Liste mit deinem Konto (und Lizenztestern) anlegen. Den Teilnahme-Link am Handy öffnen
   → „Tester werden“ → App aus dem Play Store installieren.
6. Hier machst du die Testkäufe aus Schritt 6 und testest die Bewertungskarte. Beim internen Test
   gibt es kein Kontingent, die Karte erscheint immer, solange dein Konto die App noch nicht bewertet hat.

Der interne Test zählt **nicht** für die 12-Tester-Pflicht.

### 8.2 Geschlossener Test – Pflicht für neue private Konten

**Regel (Stand Oktober 2026):** Neue private Entwicklerkonten müssen einen **geschlossenen Test**
durchführen, an dem **mindestens 12 Tester in den letzten 14 Tagen ununterbrochen** teilgenommen
haben. Erst dann kannst du den **Produktionszugriff** beantragen.

**⚠ Verwende für diesen Build unbedingt `BLOCKO_ADS_MODE=test`.** Freunde und Familie klicken sonst
gern „zur Unterstützung“ auf echte Anzeigen. Das ist ungültiger Traffic und kann dein AdMob-Konto
sperren lassen.

So richtest du den Test ein:

1. **Testen → Geschlossener Test → Track verwalten** (Standard-Track „Alpha“) → **Neuen Release
   erstellen** → dasselbe AAB wie im internen Test (oder ein neueres) hochladen.
2. **Länder/Regionen**: Österreich und alle Länder deiner Tester.
3. **Tester**: E-Mail-Liste anlegen (Gmail-Adressen bzw. Google-Konten der Tester) **oder** eine
   Google Group verwenden. Bei vielen Testern ist eine Gruppe bequemer.
4. **Feedback-Kanal** angeben (deine E-Mail-Adresse oder ein Formular-Link).
5. Release zur **Prüfung** senden. Die erste Prüfung kann einige Tage dauern.
6. Nach der Freigabe den **Teilnahme-Link** (Opt-in-URL) an die Tester schicken. Jeder Tester:
   Link öffnen (mit dem eingetragenen Google-Konto) → **„Tester werden“** → App über den Link im
   Play Store installieren.

**Tester finden** (mehr in [MARKETING.md](MARKETING.md)):

- Familie, Freunde, Kollegen, Vereinskameraden (alle brauchen ein Android-Handy mit Google-Konto)
- Lokale Spieleentwickler-Treffen, Discord-Server, Reddit-Communitys für Testtausch
- **Lade 15–20 Personen ein**, nicht nur 12. Wer vorzeitig aussteigt, zählt nicht, und dann beginnt
  die Frist für die fehlenden Plätze von vorn.
- Bitte die Tester, **14 Tage lang angemeldet zu bleiben** und die App ein paar Mal pro Woche zu
  spielen. Entferne keine Tester während der Frist.

**Was du die Tester fragen solltest** (kurzes Formular, z. B. 5 Fragen):

1. Handy-Modell und Android-Version?
2. Gab es Abstürze, Hänger, schwarze Bildschirme oder Grafikfehler? Wann genau?
3. War das Tutorial verständlich? Wusstest du sofort, was zu tun ist?
4. War das Spiel zu leicht oder zu schwer (Klassisch, Abenteuer, Tagesrätsel)?
5. Waren Texte in deiner Sprache abgeschnitten oder falsch übersetzt?
6. Fühlte sich die Werbung zu häufig an? (Im Test erscheinen Testanzeigen.)
7. Was hat dir am meisten gefallen, was am wenigsten? Würdest du weiterspielen?

Notiere das Feedback und was du daraufhin geändert hast. Das brauchst du für den Antrag.
Veröffentliche Verbesserungen ruhig als neue Testversion (Versionscode +1). Die 14-Tage-Frist läuft
weiter, solange die Tester angemeldet bleiben.

### 8.3 Produktionszugriff beantragen

Wenn das Dashboard anzeigt, dass die Bedingung erfüllt ist: **Dashboard → Zugriff auf Produktion
beantragen**. Google fragt u. a.:

- **Zum Test**: Wie hast du Tester gefunden? Wie leicht war das? Wie aktiv waren sie? Welches
  Feedback kam?
- **Zur App**: Zielgruppe, Nutzen, was die App besonders macht, erwartete Installationen im ersten
  Jahr.
- **Zur Produktionsreife**: Was hast du aufgrund des Feedbacks geändert? Warum ist die App bereit?

Antworte **ehrlich, konkret und mit Beispielen**, z. B. „Tester mit Samsung A14 meldeten
abgeschnittene türkische Texte im Shop. Behoben in Version 1.0.2.“ Die Prüfung dauert laut Google
meist bis zu etwa 7 Tage. Bei Ablehnung: weiter testen, verbessern und erneut beantragen.

**Checkliste Schritt 8**
- [ ] Interner Test läuft, Testkäufe erledigt
- [ ] Geschlossener Test mit `BLOCKO_ADS_MODE=test` freigegeben
- [ ] 15–20 Tester eingeladen, mindestens 12 seit 14 Tagen ununterbrochen dabei
- [ ] Feedback gesammelt und umgesetzt (mit Notizen)
- [ ] Produktionszugriff beantragt und erhalten

---

## Schritt 9 – Produktions-Release

### 9.1 Live-Build vorbereiten

- [ ] `android/gradle.properties`: **`BLOCKO_ADS_MODE=live`** und alle vier echten `BLOCKO_ADMOB_*`-IDs
      (der Release-Build bricht sonst mit einer Meldung von `checkReleaseAdIds` ab)
- [ ] `BLOCKO_TEST_DEVICE_IDS` enthält deine eigenen Geräte (damit du auch im Live-Build nur Testanzeigen siehst)
- [ ] `BLOCKO_VERSION_CODE` erhöht, `BLOCKO_VERSION_NAME` = `config.js` → `VERSION`
- [ ] `config.js` → `LEGAL` vollständig (Name, Anschrift, E-Mail, empfohlen Telefon)
- [ ] `docs/site/privacy-policy.html` + `impressum.html` ausgefüllt **und online**, `app-ads.txt` mit echter Publisher-ID online
- [ ] AdMob: DSGVO-Nachricht veröffentlicht

### 9.2 Prüfen

Im Hauptordner des Projekts:

```bash
npm test
npm run e2e
npm run check-release
```

`check-release` muss mit **„✔ Release check passed.“** enden. Warnungen (⚠) solltest du lesen.
Fehler (✘) **musst** du beheben, bevor du hochlädst.

### 9.3 AAB bauen und mit dem APK Analyzer prüfen

1. Signiertes Release-AAB bauen (Schritt 7).
2. Android Studio → **Build → Analyze APK…** → die `.aab`-Datei wählen:
   - [ ] **Kein `lib/`-Ordner** mit `.so`-Dateien erwartet (die App enthält keinen nativen Code).
         Falls doch `.so`-Dateien da sind: In der Spalte „Alignment“ dürfen keine Warnungen stehen.
         Google Play verlangt die Unterstützung von **16-KB-Speicherseiten**. Ab 1. Februar 2027
         werden Updates ohne diese Unterstützung abgelehnt.
   - [ ] **AndroidManifest.xml**: `targetSdkVersion` = **36** (Pflicht für neue Apps und Updates
         seit 31. August 2026), `minSdkVersion` = 24, kein `android:debuggable="true"`
   - [ ] Berechtigungen plausibel (siehe PLAY_CONSOLE_ANGABEN.md)
   - [ ] `base/assets/` enthält `index.html`, `js/`, `css/`, `assets/`, aber keine Tests oder `node_modules`
3. **Live-Build zuerst selbst testen**: AAB in den **internen Test** hochladen, installieren, eine
   Runde spielen. Auf deinem als Testgerät eingetragenen Handy erscheinen echte Anzeigenblöcke mit
   „Test Ad“-Kennzeichnung. **⚠ Erscheint keine Test-Kennzeichnung, nicht klicken!**
   - [ ] Jetzt erscheint **deine eigene DSGVO-Nachricht** (Sprache des Handys, Buttons „Einwilligen“,
         „Optionen verwalten“, ggf. „Nicht einwilligen“). Die Release-Version simuliert keinen
         Standort. Du siehst den Dialog, weil du dich in Österreich (EWR) befindest.
   - [ ] Einstellungen → Datenschutz-Einstellungen öffnet den Dialog erneut.

### 9.4 Hochladen und gestaffelt ausrollen

1. Play Console → **Produktion → Neuen Release erstellen** → AAB hochladen (oder den geprüften
   Release aus dem internen Test **hochstufen**).
2. **Versionshinweise** (de-DE, en-US), z. B. „Erste Version von Blocko. Viel Spaß!“
3. **Länder/Regionen** auswählen (für den Start z. B. alle).
4. **Gestaffelter Rollout**: zunächst **10–20 %** der Nutzer.
5. **Release prüfen → Rollout starten**. Die erste Prüfung neuer Apps kann mehrere Tage dauern.
6. Nach 1–3 Tagen ohne Probleme (Abstürze, schlechte Bewertungen): auf 50 %, dann 100 %
   erhöhen. Bei Problemen: **Rollout anhalten**, beheben, neue Version hochladen.
7. Danach AdMob mit dem Store-Eintrag verknüpfen (Schritt 3.8).

Offiziell: <https://developer.android.com/google/play/requirements/target-sdk>,
<https://developer.android.com/guide/practices/page-sizes>

**Checkliste Schritt 9**
- [ ] `check-release` grün, Tests grün
- [ ] AAB mit APK Analyzer geprüft (targetSdk 36, kein nativer Code bzw. 16 KB ok)
- [ ] Live-Build im internen Test selbst ausprobiert
- [ ] Produktion: gestaffelter Rollout gestartet
- [ ] AdMob-App mit Play-Eintrag verknüpft, app-ads.txt-Status „gefunden“

---

## Schritt 10 – Nach dem Launch

### 10.1 Regelmäßig prüfen

**Täglich in der ersten Woche, danach wöchentlich:**

- [ ] **Android Vitals** (Play Console → Qualität → Android Vitals). Google senkt die Sichtbarkeit
      deiner App, wenn diese Grenzwerte überschritten werden:
  - von Nutzern bemerkte **Absturzrate unter 1,09 %** (pro Gerätemodell unter 8 %)
  - von Nutzern bemerkte **ANR-Rate unter 0,47 %** (pro Gerätemodell unter 8 %)
- [ ] **Bewertungen und Rezensionen**: freundlich und zeitnah antworten (innerhalb von 1–2 Tagen),
      gemeldete Fehler beheben und das in der Antwort erwähnen.
- [ ] **Statistiken**: Installationen, Deinstallationen, „Behaltene Installationen“ (Bindung D1/D7/D30),
      Store-Eintrag-Conversion (Besucher → Installationen).
- [ ] **AdMob-Berichte**: geschätzte Einnahmen, eCPM je Format und Land, Abgleichrate (Match Rate),
      Anzeigerate (Show Rate), Impressionen pro Nutzer.
- [ ] **Einwilligungsrate**: AdMob → Datenschutz und Mitteilungen → Berichte. Wie viele EU-Nutzer
      stimmen zu?
- [ ] **Richtlinien-Postfach**: E-Mails von Google Play und das AdMob-**Richtliniencenter**.
      Warnungen sofort ernst nehmen.

### 10.2 Verbessern

- **Store-Eintrag A/B-testen**: Play Console → **Store-Eintrag-Tests** (Store listing
  experiments). Teste immer nur **eine** Sache (Icon, erster Screenshot oder Kurzbeschreibung) und
  lass den Test mindestens 7 Tage laufen.
- **Werbetakt vorsichtig anpassen** (`config.js` → `ADS`): Ändere immer nur **einen** Wert pro
  Update, warte 1–2 Wochen und vergleiche die Bindung (D1/D7) und die Einnahmen pro Nutzer. Sichere
  Bereiche stehen in [MONETARISIERUNG.md](MONETARISIERUNG.md).
- **Schwierigkeit**: Änderungen an `config.js` → `GENERATOR` immer mit `npm run sim` prüfen.
- Ideen für neue Inhalte (neues Design, Events) stehen in MONETARISIERUNG.md und MARKETING.md.

### 10.3 Updates veröffentlichen

1. Änderungen machen, `npm test` und `npm run e2e` ausführen.
2. `BLOCKO_VERSION_CODE` +1, `BLOCKO_VERSION_NAME` und `config.js` → `VERSION` anpassen.
3. `npm run check-release`, AAB bauen, mit dem APK Analyzer kurz prüfen.
4. Optional zuerst in den internen oder geschlossenen Test, dann Produktion mit gestaffeltem Rollout.

**Wiederkehrende Pflichten (bitte im Kalender eintragen):**

- **Target-API-Level**: Google verlangt jedes Jahr (bisher jeweils bis 31. August) ein neueres
  Target-API-Level für Updates und neue Apps. Aktuell gilt API 36. Rechne 2027 mit API 37.
  Prüfe: <https://developer.android.com/google/play/requirements/target-sdk>
- **Play Billing Library**: Version 8 ist bis 31. August 2027 erlaubt, Version 9 (verwendet:
  9.1.0) bis 31. August 2028. Rechtzeitig aktualisieren:
  <https://developer.android.com/google/play/billing/deprecation-faq>
- **Google Mobile Ads SDK / UMP**: regelmäßig aktualisieren (Hinweise in AdMob beachten).
- **Datensicherheit**: Kommt ein neues SDK hinzu (z. B. Mediation), Angaben in der Play Console,
  Datenschutzerklärung und `app-ads.txt` anpassen.
- **Steuern/Buchhaltung**: monatlich Belege von Google (Play + AdMob) ablegen, siehe RECHTLICHES.md.
