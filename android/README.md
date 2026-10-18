# Blocko – Android-App (Android Studio)

Native Kotlin-Hülle für das HTML5-Spiel aus `../game/`: WebView + AdMob (mit Google-UMP-Einwilligung),
Google Play Billing, Speichern, Haptik, Erinnerungs-Benachrichtigung, Teilen und In-App-Bewertung.
Das Spiel wird **nicht kopiert**: `game/` ist direkt der Assets-Ordner der App
(`https://appassets.androidplatform.net/assets/index.html`).

| Werkzeug | Version |
|---|---|
| Android Gradle Plugin | 9.4.0 (Kotlin ist eingebaut, kein `kotlin-android`-Plugin) |
| Gradle (Wrapper) | 9.6.1 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 24 (Android 7.0) |
| Java | 17 |
| Bibliotheken | `gradle/libs.versions.toml` |

## 1. Öffnen, bauen, starten

1. Neueste Android Studio-Version installieren, im SDK Manager **Android SDK Platform 37** installieren.
2. In Android Studio **Open** → den Ordner `android/` wählen (nicht den Projekt-Hauptordner).
3. Die erste Gradle-Synchronisierung lädt Gradle, Plugin und Bibliotheken (einige Minuten).
4. Handy per USB (Entwickleroptionen + USB-Debugging) oder Emulator wählen → **Run ▶**.

Kommandozeile (im Ordner `android/`): `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`).

## 2. Build-Typen (Fenster „Build Variants“)

| Typ | Zweck | Werbung | Signatur |
|---|---|---|---|
| `debug` | Entwicklung, WebView-Debugging (`chrome://inspect`), Einwilligung wird wie in der EU getestet | immer Google-Testanzeigen | Debug-Key |
| `staging` | Release-Konfiguration (R8/Minify) zum Testen auf dem eigenen Handy | immer Google-Testanzeigen | Debug-Key |
| `release` | Google Play (AAB) | laut `BLOCKO_ADS_MODE` | `keystore.properties` |

## 3. Werbe-IDs und Version (`android/gradle.properties`)

```properties
BLOCKO_VERSION_CODE=1          # bei JEDEM Upload um 1 erhöhen
BLOCKO_VERSION_NAME=1.0.0
BLOCKO_ADS_MODE=test           # test = Testanzeigen, live = echte IDs (nur release)
BLOCKO_ADMOB_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY
BLOCKO_ADMOB_BANNER_ID=ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ
BLOCKO_ADMOB_INTERSTITIAL_ID=...
BLOCKO_ADMOB_REWARDED_ID=...
BLOCKO_TEST_DEVICE_IDS=        # optional, Hash aus Logcat ("setTestDeviceIds")
```

- Für den **geschlossenen Test** (12 Tester / 14 Tage) `BLOCKO_ADS_MODE=test` lassen.
- Für die **Produktion** `BLOCKO_ADS_MODE=live` + echte IDs. Ein Release-Build mit `live` und leeren,
  Test- oder Platzhalter-IDs bricht mit einer klaren Meldung ab (Task `checkReleaseAdIds`).
- In AdMob unter **Datenschutz & Mitteilungen** eine **DSGVO-Nachricht** für die App anlegen und
  veröffentlichen – sonst erscheint in der EU kein Einwilligungsformular und es gibt kaum Anzeigen.
- `app-ads.txt` auf der Entwickler-Website (siehe `docs/`).

## 4. Signieren und AAB erstellen

Einfachster Weg: **Build → Generate Signed App Bundle / APK → Android App Bundle**, Upload-Key anlegen
und gut sichern. Alternativ automatisch: `keystore.properties.example` nach `keystore.properties`
kopieren (wird von git ignoriert), ausfüllen und `./gradlew bundleRelease` ausführen. Ergebnis:
`app/build/outputs/bundle/release/app-release.aab`. Bei Google Play die **Play App-Signatur** aktivieren.

## 5. In-App-Produkte (Play Console → Monetarisieren → Einmalkaufprodukte)

IDs exakt so anlegen (wie `game/js/config.js`): `remove_ads` (Werbung entfernen), `coins_small`,
`coins_large` (Münzpakete). „Mehrfachkauf“ (Menge > 1) **nicht** aktivieren. Käufe funktionieren erst,
wenn ein Build mit derselben App-ID in einem Test-Track hochgeladen ist und dein Konto als
**Lizenztester** eingetragen ist.

## 6. Falls die erste Synchronisierung mit AGP 9 scheitert (Fallback)

Nur wenn Android Studio AGP 9.4 nicht unterstützt oder ein Fehler nicht lösbar ist:

1. `gradle/wrapper/gradle-wrapper.properties`:
   `distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.5-bin.zip` und
   `distributionSha256Sum=6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854`
2. `build.gradle.kts` (Hauptordner):
   ```kotlin
   plugins {
       id("com.android.application") version "8.13.2" apply false
       id("org.jetbrains.kotlin.android") version "2.3.21" apply false
   }
   ```
3. `app/build.gradle.kts`: im `plugins`-Block `id("org.jetbrains.kotlin.android")` ergänzen,
   `compileSdk = 36` setzen und am Dateiende ergänzen:
   ```kotlin
   kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
   ```
4. `gradle/libs.versions.toml`: `androidxCore = "1.17.0"`. Meldet Gradle danach
   „Dependency … requires compileSdk 37“, die genannte Bibliothek eine Version zurückstellen.
5. In `AndroidManifest.xml` bleibt alles gleich. Erneut synchronisieren.

## 7. Manuelle Tests auf dem Gerät (vor jeder Veröffentlichung)

- [ ] **Brücke in staging/release**: Build-Typ `staging` installieren. Spiel startet, Splash verschwindet
      (≤ 2,5 s), Tutorial läuft, Speichern funktioniert nach App-Neustart, Haptik, Teilen, Links (Datenschutz,
      Impressum, „Bewerten“ öffnet den Play Store). Logcat-Filter `Blocko` ohne Fehler.
- [ ] **Erster Start / Werbung**: Kein Banner, keine Einwilligung und keine Werbung während Tutorial und
      erster Runde. Erst nach Verlassen des ersten Game-over-Bildschirms erscheint (in der EU) das
      Einwilligungsformular, danach Testbanner unten. Zwischenwerbung nur beim Verlassen eines
      Ergebnisbildschirms, Belohnungsvideo (z. B. Wiederbeleben) gibt die Belohnung erst nach dem Schließen.
      Einstellungen → Datenschutz öffnet das Datenschutzformular.
- [ ] **Käufe mit Lizenztester** (Build aus dem internen Test-Track installieren):
      Testkarte „wird immer genehmigt“ → Münzen bzw. werbefrei sofort; Abbrechen → keine Änderung;
      **„Langsame Testkarte, wird nach einigen Minuten genehmigt“** → Status „ausstehend“, Münzen kommen
      erst nach Genehmigung (auch wenn die App inzwischen geschlossen war); „abgelehnt“ → nichts.
- [ ] **Werbung entfernen**: Banner verschwindet sofort, keine Zwischenwerbung, Belohnungsvideos bleiben.
      „Käufe wiederherstellen“ nach Neuinstallation stellt es wieder her.
- [ ] **Erstattung**: Kauf in der Play Console (Bestellverwaltung) erstatten → App neu öffnen (mit Internet)
      → Werbung ist wieder aktiv. Offline-Start ändert den Status nicht.
- [ ] **Prozess-Ende während des Kaufs**: Kaufdialog offen lassen, `adb shell am kill io.github.memo5561.blocko`
      (oder Entwickleroptionen „Aktivitäten nicht speichern“), Kauf abschließen, App öffnen → Münzen kommen
      **genau einmal** an.
- [ ] **Zurück-Taste**: jede Ansicht laut Zurück-Tabelle; auf dem Startbildschirm geht die App in den
      Hintergrund (wird nicht beendet), beim Zurückkommen läuft alles weiter.
- [ ] **Drehen / Tablet / Foldable**: Handy bleibt im Hochformat. Tablet dreht ohne Neuladen (Spielstand
      bleibt), Banner passt sich der neuen Breite an, das Spiel springt nicht in der Höhe.
- [ ] **Pause**: Home-Taste während einer Runde → Pause-Dialog beim Zurückkommen. Während einer
      Werbeanzeige oder des Kaufdialogs erscheint **kein** Pause-Dialog.
- [ ] **Benachrichtigungen** (Android 13+): Nach „Ja“ im Spiel erscheint der Systemdialog. Erlauben →
      Erinnerung wird beim Verlassen geplant (Android Studio → App Inspection → Background Task Inspector:
      `blocko_reminder`). Zweimal ablehnen → Einstellungen bieten „Benachrichtigungs-Einstellungen“ an.
- [ ] **WebView-Absturz**: `adb shell ps -A | grep sandboxed_process` und den Prozess mit
      `adb shell kill <PID>` beenden → das Spiel lädt neu (nach 4 Abstürzen in 60 s: „Erneut versuchen“).
- [ ] **Offline**: Flugmodus → Spiel startet und läuft, Shop zeigt keine Preise, kein Absturz.
- [ ] **Merged Manifest** (AndroidManifest.xml → Tab „Merged Manifest“): keine `FOREGROUND_SERVICE`-
      Berechtigung (wird absichtlich entfernt), sonst nur erwartete Berechtigungen (Datensicherheit-Formular).
