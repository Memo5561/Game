# Deine Checkliste: Von diesem Repo zur veröffentlichten App

Das Spiel ist fertig gebaut und getestet. Was jetzt noch fehlt, kann nur **du** erledigen, weil es deine
Identität, deine Konten und deine Daten braucht. Die ausführliche Anleitung steht in
[VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md). Diese Seite ist die Kurzfassung in der richtigen Reihenfolge.

## Ehrlich vorab

- **Nichts davon wurde auf einem echten Android-Gerät gebaut oder gespielt.** In der Build-Umgebung gab es
  weder Android SDK noch Zugriff auf Google Maven. Der Kotlin-Code wurde gegen das echte Android-17-Framework
  typgeprüft, aber **dein erster Gradle-Sync in Android Studio ist der erste echte Build**. Rechne mit
  kleinen Anpassungen (siehe `android/README.md`, Abschnitt „Fallback-Toolchain“).
- **Das Spiel wurde im Browser (Chromium) mit Touch-Emulation getestet**, nicht auf einem Handy.
  Teste vor dem Upload auf mindestens einem echten Gerät: Ziehen, Werbung, Käufe, Zurück-Taste.
- **Die Sounds wurden nie von einem Menschen gehört.** Sie sind nur per Messung geprüft. Hör sie dir an
  (`node tools/audio-check.mjs` schreibt WAV-Dateien nach `tools/out/audio/`).
- **Umsatz ist nicht garantiert.** Der Markt für Block-Puzzle ist hart umkämpft. Siehe `README.md`,
  Abschnitt „Ehrliche Erwartungen“, und [MONETARISIERUNG.md](MONETARISIERUNG.md).

## Schritt für Schritt

1. **Name und Paket-ID festlegen** – die Paket-ID kann nach dem ersten Upload nie mehr geändert werden.
   Ändere sie in `game/js/config.js` (`PACKAGE_ID`, URLs) **und** in `android/app/build.gradle.kts`.
   Prüfe vorher, ob „Blocko“ als Marke/App-Name frei ist.
2. **Deine Daten eintragen** in `game/js/config.js` → `LEGAL`: Name, ladungsfähige Anschrift,
   E-Mail und **Telefonnummer oder Kontaktformular** (Pflicht nach § 5 DDG). Dieselben Daten gehören in
   `docs/site/impressum.html` und `docs/site/privacy-policy.html`.
3. **Webseite veröffentlichen** (GitHub Pages, Repo `memo5561.github.io`): Inhalt von `docs/site/`.
   Die URLs müssen zu `PRIVACY_POLICY_URL` / `IMPRINT_URL` in `config.js` passen.
4. **Android Studio** installieren, Ordner `android/` öffnen, synchronisieren, Debug-Build auf einem
   Handy starten. Hier zeigt sich, ob der Build durchläuft.
5. **AdMob-Konto** anlegen, App und Anzeigenblöcke (Banner, Interstitial, Rewarded) erstellen, IDs in
   `android/gradle.properties` eintragen, **Datenschutz-/Einwilligungsnachricht (DSGVO)** in AdMob
   veröffentlichen, `app-ads.txt` ausfüllen (`docs/site/app-ads.txt`).
6. **Play-Console-Konto** (einmalige Gebühr, Identitätsprüfung), App anlegen, Store-Eintrag aus
   [STORE_LISTING.md](STORE_LISTING.md), Bilder aus `store/` (`npm run assets` erzeugt Screenshots neu),
   Angaben aus [PLAY_CONSOLE_ANGABEN.md](PLAY_CONSOLE_ANGABEN.md) (Zielgruppe **18+**, Datensicherheit,
   Werbung = ja).
7. **In-App-Produkte** anlegen: `remove_ads` (einmalig, ca. 4,99 €), `coins_small` (ca. 1,99 €),
   `coins_large` (ca. 4,99 €). IDs müssen exakt stimmen. Mit Lizenztestern ausprobieren (inkl. Rückerstattung).
8. **Signieren:** Upload-Key erzeugen und **sicher mehrfach sichern** (Verlust = große Probleme).
9. **Geschlossener Test:** Bei neuen privaten Entwicklerkonten sind **12 Tester über 14 Tage** Pflicht,
   bevor du die Produktion beantragen kannst. Nutze dafür `BLOCKO_ADS_MODE=test`, damit deine Tester
   nicht versehentlich echte Anzeigen anklicken (das kann dein AdMob-Konto sperren).
10. **Vor dem Release:** `BLOCKO_ADS_MODE=live` mit echten IDs, dann `npm run check-release`.
    Der Check meldet, solange noch Platzhalter (Impressum, Telefon, Ad-IDs, `app-ads.txt`) übrig sind.
11. **Steuern/Recht:** Gewerbeanmeldung, Steuerberater fragen (Kleinunternehmer, Umsatzsteuer bei
    Google-Auszahlungen). Siehe [RECHTLICHES.md](RECHTLICHES.md) – das ist keine Rechtsberatung.

## Was du selbst nie tun solltest

- Eigene Anzeigen anklicken oder Freunde „zur Unterstützung“ klicken lassen (AdMob-Sperre).
- Bewertungen kaufen oder tauschen.
- Die Anzeigen-Abstände oder Layouts so ändern, dass Werbung neben Bedienelementen liegt.

## Wenn etwas nicht klappt

- Gradle-Sync schlägt fehl → `android/README.md`, Fallback-Toolchain (AGP 8.13.2 + Gradle 8.14.x).
- Tests laufen lokal mit `npm install`, `npm test` (Logik) und `npm run e2e` (Browser, Playwright).
- Spiel im Browser testen: `npm run serve`, dann `http://localhost:8080/?debug=1`.
