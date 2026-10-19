# Angaben in der Play Console – exakte Antworten für Blocko

Diese Datei enthält die Antworten für alle Formulare unter **Richtlinien → App-Inhalte** (bzw. im
Dashboard unter „App einrichten“). Sie beschreiben die App **so, wie sie gebaut ist**: kein Konto,
kein eigener Server, keine eigene Analyse. Daten erhebt nur das **Google Mobile Ads SDK**
(inkl. UMP-Einwilligung).

> **⚠ Du bist für die Richtigkeit verantwortlich.** Falsche Angaben können zur Entfernung der App
> führen. Prüfe beim Release (und bei jedem SDK-Update) Googles aktuelle Offenlegung für das
> Mobile Ads SDK: <https://developers.google.com/admob/android/privacy/play-data-disclosure>.
> Weicht die Seite von den Angaben hier ab, gelten **Googles aktuelle Angaben**.
>
> **⚠ Kommt ein neues SDK hinzu** (z. B. Mediation, Analytics, Crash-Reporting), musst du
> Datensicherheit, Datenschutzerklärung und ggf. `app-ads.txt` anpassen.

Menünamen können sich ändern. Gemeint sind jeweils die gleichnamigen Abschnitte unter
„App-Inhalte“.

---

## 1. Datenschutzerklärung

```
https://memo5561.github.io/blocko/privacy-policy.html
```

Muss öffentlich erreichbar sein (kein PDF, keine Anmeldung, nicht nach Ländern gesperrt) und zur
App passen. Die Datei liegt in `docs/site/privacy-policy.html`.

## 2. App-Zugriff

- **„Alle Funktionen sind ohne besondere Zugriffsrechte verfügbar“** auswählen.
  (Es gibt kein Login und keine gesperrten Bereiche. Prüfer kommen überall hin.)

## 3. Werbung

- **„Ja, meine App enthält Werbung“**. Im Store erscheint dann der Hinweis „Enthält Werbung“.

## 4. Einstufung von Inhalten (IARC-Fragebogen)

1. **E-Mail-Adresse** für das IARC-Zertifikat (deine Support-Adresse).
2. **Kategorie**: **Spiel** (Game).
3. Fragen ehrlich beantworten. Für Blocko gilt:

| Thema | Antwort | Begründung |
|---|---|---|
| Gewalt (auch Cartoon/Fantasy) | **Nein** | Abstrakte Blöcke. Partikel beim Abräumen sind keine Gewalt. |
| Angst/Horror | **Nein** | |
| Sexualität, Nacktheit | **Nein** | |
| Vulgäre Sprache, derber Humor | **Nein** | |
| Drogen, Alkohol, Tabak | **Nein** | (Werbung zählt hier nicht. Blockiere Alkohol bei Bedarf in AdMob.) |
| Glücksspiel (echt oder simuliert) | **Nein** | Kein Casino, keine Wetten |
| Zufallsgegenstände gegen Geld (Lootboxen) | **Nein** | Käufe liefern immer fest definierte Inhalte |
| Nutzer können miteinander interagieren / Inhalte austauschen | **Nein** | Kein Chat, keine Nutzerinhalte. Die Teilen-Funktion nutzt nur das Android-Teilen-Menü. |
| Teilt den Standort mit anderen Nutzern | **Nein** | |
| Digitale Käufe möglich | **Ja** | `remove_ads`, Münzpakete |
| Enthält Werbung (falls gefragt) | **Ja** | |
| Webbrowser / Suchmaschine / uneingeschränkter Internetzugang | **Nein** | Die WebView zeigt nur das eingebaute Spiel |

**Erwartetes Ergebnis:** **PEGI 3**, ESRB „Everyone“, jeweils mit dem Hinweis
**„In-Game-Käufe“** (In-Game Purchases).

## 5. Zielgruppe und Inhalte

1. **Altersgruppen der Zielgruppe**: **nur „18 und älter“** anhaken.
2. **„Könnte deine App unbeabsichtigt Kinder ansprechen?“** (falls gefragt): **Nein**.
   Begründung, falls ein Textfeld kommt:
   ```
   Blocko is an abstract block puzzle for adults (casual puzzle players). It has no characters, mascots, or child-directed themes, and the store listing does not target children.
   ```
3. Die App nimmt **nicht** am Familienprogramm (Families/„Von Lehrkräften empfohlen“) teil.

**Warum 18+?** Bei Altersgruppen unter 13 gilt die **Families-Richtlinie** (nur zertifizierte
Werbe-SDKs, keine personalisierte Werbung, viele Zusatzpflichten). Unter 14 verlangt **Art. 8
DSGVO** in Österreich (§ 4 Abs. 4 DSG) die Einwilligung der Erziehungsberechtigten für personalisierte Werbung. Die
Altersfreigabe (PEGI 3) ist davon getrennt. **⚠ Icon, Screenshots und Texte nicht kindlich
gestalten**, sonst kann Google die Zielgruppen-Angabe anzweifeln.

## 6. Nachrichten-Apps

- **Nein**, Blocko ist keine Nachrichten-App.

## 7. Datensicherheit (Data safety)

### 7.1 Schritt „Datenerhebung und Sicherheit“

| Frage | Antwort |
|---|---|
| Erhebt oder teilt deine App erforderliche Nutzerdatentypen? | **Ja** (durch das Google Mobile Ads SDK) |
| Werden alle erhobenen Nutzerdaten bei der Übertragung verschlüsselt? | **Ja** (das SDK nutzt HTTPS/TLS) |
| Welche Methoden zur Kontoerstellung unterstützt deine App? | **„Meine App erlaubt keine Kontoerstellung“** → es ist **keine URL zur Kontolöschung** nötig |
| Können Nutzer die Löschung ihrer Daten beantragen (ohne Konto)? (falls gefragt) | **Nein**. Du selbst speicherst keine Nutzerdaten. Werbedaten verarbeitet Google; Nutzer können ihre Werbe-ID in den Android-Einstellungen zurücksetzen bzw. löschen. |
| Unabhängige Sicherheitsprüfung | nicht nötig (leer lassen) |

### 7.2 Schritt „Datentypen“ – diese anhaken

| Kategorie | Datentyp |
|---|---|
| **Standort** | **Ungefährer Standort** (aus der IP-Adresse) |
| **App-Aktivitäten** | **App-Interaktionen** (z. B. Anzeigen gesehen/angetippt) |
| **App-Informationen und -Leistung** | **Absturzprotokolle**, **Diagnosedaten** |
| **Geräte- oder andere IDs** | **Geräte- oder andere IDs** (Werbe-ID, App-Set-ID) |

**Nicht** anhaken: Name, E-Mail, Fotos, Kontakte, Finanzinformationen/Kaufverlauf, genauer
Standort, Nachrichten, Gesundheit, Dateien, Kalender, Websuchverlauf usw.

### 7.3 Schritt „Datennutzung und -verarbeitung“ – für jeden angehakten Datentyp

| Datentyp | Erhoben | Geteilt | Kurzlebig verarbeitet? | Erforderlich / optional | Zwecke |
|---|---|---|---|---|---|
| Ungefährer Standort | Ja | Ja | Nein | Erforderlich | Werbung oder Marketing · Analysen · Betrugsprävention, Sicherheit und Compliance |
| App-Interaktionen | Ja | Ja | Nein | Erforderlich | Werbung oder Marketing · Analysen · Betrugsprävention, Sicherheit und Compliance |
| Absturzprotokolle | Ja | Ja | Nein | Erforderlich | Analysen |
| Diagnosedaten | Ja | Ja | Nein | Erforderlich | Analysen |
| Geräte- oder andere IDs | Ja | Ja | Nein | Erforderlich | Werbung oder Marketing · Analysen · Betrugsprävention, Sicherheit und Compliance |

Hinweise:
- „Geteilt“ ist hier bewusst vorsichtig angegeben, weil die Daten an Google als Werbeanbieter
  gehen. Richte dich nach Googles aktueller Offenlegungsseite (Link oben).
- „Erforderlich“: Nutzer können die Erhebung in der App nicht komplett abschalten. Über die
  Einwilligung (UMP) entscheiden EU-Nutzer nur, ob Werbung **personalisiert** wird.

### 7.4 Was **nicht** als „erhoben“ gilt

- **Spielstand** (Punkte, Münzen, Einstellungen) im WebView-`localStorage` und in einer privaten
  Datei der App: Er bleibt **auf dem Gerät**, und du hast keinen Zugriff darauf. Daten, die nur
  auf dem Gerät verarbeitet werden, gelten bei Google nicht als „erhoben“.
- **Android-Sicherung** (Auto Backup ins Google-Konto des Nutzers): verschlüsselt, von Google
  verwaltet, du hast keinen Zugriff. Wird nicht angegeben.
- **Käufe**: Die Zahlung wickelt Google Play ab. Blocko speichert nur Kauf-Token lokal und
  überträgt sie an keinen eigenen Server. (Nutzt du später einen eigenen Server zur Kaufprüfung,
  musst du das neu bewerten.)
- **Bewertungskarte** (In-App Review): Die Bewertung verarbeitet der Play Store selbst.
- **Erinnerungen**: werden lokal auf dem Gerät geplant, ohne Server.

## 8. Behörden-Apps

- **Nein**, die App wird nicht von oder im Auftrag einer Behörde entwickelt.

## 9. Finanzfunktionen

- **„Meine App bietet keine Finanzfunktionen“** anhaken. (In-App-Käufe über Google Play zählen
  nicht als Finanzfunktion.)

## 10. Gesundheit

- **„Meine App hat keine Gesundheitsfunktionen“** (falls die Frage erscheint).

## 11. Werbe-ID (Advertising ID)

- **„Verwendet deine App eine Werbe-ID?“** → **Ja**
- **Zwecke**: **Werbung oder Marketing**, **Analysen**, **Betrugsprävention, Sicherheit und
  Compliance**
- Technisch: Das Google Mobile Ads SDK fügt die Berechtigung
  `com.google.android.gms.permission.AD_ID` automatisch zum Manifest hinzu. Ohne sie bekämen
  Geräte mit Android 13+ nur eine Werbe-ID aus Nullen, und die Werbeeinnahmen würden sinken.
  **Nicht entfernen.**

## 12. Weitere Erklärungen, die erscheinen können

| Erklärung | Antwort für Blocko |
|---|---|
| Vordergrunddienste (Foreground services) | Blocko nutzt **keine** eigenen Vordergrunddienste. Erscheint die Frage trotzdem (weil eine Bibliothek wie WorkManager die Berechtigung mitbringt), gib an, dass keine Vordergrunddienste verwendet werden. Bitte den Entwickler, die Berechtigung im Manifest zu entfernen. |
| Genaue Wecker (Exact alarms) | nicht verwendet |
| Vollbild-Benachrichtigungen (Full-screen intent) | nicht verwendet |
| Fotos/Videos, Kontakte, Standort, SMS, Anrufliste | nicht verwendet |
| Bedienungshilfen-API (Accessibility) | nicht verwendet |
| Glücksspiel mit Echtgeld | Nein |
| COVID-19 (falls noch vorhanden) | keine COVID-19-App |

## 13. Berechtigungen – was sie bedeuten (zum Verständnis und für Nutzerfragen)

| Berechtigung | Woher | Wofür |
|---|---|---|
| `INTERNET` | App | Werbung laden und Käufe über Google Play. Das Spiel selbst läuft offline. |
| `ACCESS_NETWORK_STATE` | App / Bibliotheken | Prüfen, ob eine Verbindung besteht (Werbung, Käufe) |
| `VIBRATE` | App | Vibrationsfeedback (in den Einstellungen abschaltbar) |
| `POST_NOTIFICATIONS` | App | Android 13+: tägliche Erinnerung. **Nur nach Zustimmung**: erst eine Frage im Spiel („Erinnere mich?“), dann der Systemdialog. Benachrichtigungen werden lokal geplant. |
| `com.google.android.gms.permission.AD_ID` | Google Mobile Ads SDK | Werbe-ID für Werbung (siehe Abschnitt 11) |
| `com.android.vending.BILLING` | Play Billing Library | In-App-Käufe |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` (ggf. weitere) | WorkManager | Geplante Erinnerung nach einem Neustart erhalten |
| `ACCESS_ADSERVICES_*` (ggf.) | Google Mobile Ads SDK | Privacy Sandbox auf Android (datenschutzfreundliche Werbe-APIs) |

Die vollständige Liste siehst du im APK Analyzer (AAB öffnen → `AndroidManifest.xml`). Keine
dieser Berechtigungen braucht ein eigenes Erklärungsformular, außer der Werbe-ID (Abschnitt 11).

## 14. Store-Einstellungen

- **Kategorie**: Spiel → **Puzzle**
- **Tags**: siehe [STORE_LISTING.md](STORE_LISTING.md)
- **Kontaktdaten**: E-Mail (Pflicht), Website **`https://memo5561.github.io`** (für `app-ads.txt`),
  Telefon optional

## 15. Kurz-Checkliste

- [ ] Datenschutzerklärung (URL erreichbar, Inhalt passt zu den Angaben hier)
- [ ] App-Zugriff: alles ohne Anmeldung
- [ ] Werbung: Ja
- [ ] Einstufung: abgeschlossen, Ergebnis PEGI 3 + In-Game-Käufe
- [ ] Zielgruppe: nur 18+, spricht Kinder nicht an
- [ ] Nachrichten-App: Nein
- [ ] Datensicherheit: 5 Datentypen wie in 7.2/7.3, verschlüsselt, kein Konto
- [ ] Behörden-App: Nein · Finanzfunktionen: keine · Gesundheit: keine
- [ ] Werbe-ID: Ja (Werbung, Analysen, Betrugsprävention)
- [ ] Kategorie Puzzle, Kontaktdaten mit Website
