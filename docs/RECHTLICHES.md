# Rechtliches und Steuern – Checkliste für Deutschland

> **⚠ Keine Rechts- oder Steuerberatung.** Diese Checkliste soll dir einen Überblick geben, damit
> du die richtigen Fragen stellst. Gesetze und Grenzwerte ändern sich (Stand: Oktober 2026). Lass
> dich vor dem Start von einem **Steuerberater** beraten, bei Unsicherheit zu Impressum, Datenschutz
> oder Marken auch von einem **Anwalt** (IT-/Medienrecht). Ein einmaliges Erstgespräch kostet
> meist weniger als eine einzige Abmahnung.

---

## Übersicht – was du erledigen musst

- [ ] **Gewerbe anmelden** (bevor die ersten Einnahmen fließen)
- [ ] **Fragebogen zur steuerlichen Erfassung** über ELSTER abgeben
- [ ] **Umsatzsteuer**: Kleinunternehmerregelung oder Regelbesteuerung entscheiden (mit Steuerberater)
- [ ] **USt-IdNr** beim Bundeszentralamt für Steuern beantragen (empfohlen)
- [ ] **Impressum**: in der App (`config.js` → `LEGAL`) **und** online (`docs/site/impressum.html`)
- [ ] **Datenschutzerklärung** online (`docs/site/privacy-policy.html`) und in der App verlinkt
- [ ] **Einwilligung** für Werbung über Google UMP (AdMob-DSGVO-Nachricht veröffentlicht)
- [ ] **DSA-Händlerstatus** in der Play Console angeben
- [ ] **Einstufung** (IARC/USK) ehrlich ausfüllen
- [ ] **Marken** prüfen (Name „Blocko“)
- [ ] **Buchhaltung**: Belege von Google (Play + AdMob) monatlich ablegen, EÜR, Steuererklärungen

---

## 1. Gewerbe anmelden

Wer mit einer App über Werbung und Käufe dauerhaft Geld verdienen will, betreibt in aller Regel ein
**Gewerbe**. Das gilt auch nebenberuflich.

1. **Gewerbeanmeldung** beim Gewerbeamt deiner Stadt/Gemeinde. In vielen Orten geht das online.
   Die Gebühr liegt meist bei etwa 20–60 €.
   - Tätigkeit z. B.: „Entwicklung und Vertrieb von Software und Spiele-Apps sowie Erzielung von
     Werbeeinnahmen über digitale Plattformen“
2. Das Gewerbeamt informiert Finanzamt, IHK und ggf. die Berufsgenossenschaft. Die
   **IHK-Mitgliedschaft** ist Pflicht. Bei kleinem Gewinn fällt oft kein oder nur ein geringer
   Beitrag an.
3. **Fragebogen zur steuerlichen Erfassung** über **ELSTER** (<https://www.elster.de>) innerhalb
   eines Monats nach Beginn abgeben. Dort wählst du auch Kleinunternehmerregelung ja/nein. Du
   bekommst eine **Steuernummer**.
4. **Nebenberuflich?** Prüfe deinen Arbeitsvertrag (Nebentätigkeit ggf. anzeigen). Bist du
   Student, arbeitslos oder familienversichert, können Einkünfte Auswirkungen haben (BAföG,
   Arbeitslosengeld, Familienversicherung der Krankenkasse). Bitte vorher klären.

## 2. Umsatzsteuer

### 2.1 Kleinunternehmerregelung (§ 19 UStG) oder Regelbesteuerung?

| | Kleinunternehmer | Regelbesteuerung |
|---|---|---|
| Voraussetzung (seit 2025) | Umsatz im **Vorjahr ≤ 25.000 €** und im **laufenden Jahr ≤ 100.000 €** (netto) | immer möglich |
| Umsatzsteuer auf eigene Umsätze | keine | ja (für Umsätze in Deutschland) |
| Vorsteuerabzug (z. B. auf Testhandy, Software) | **nein** | ja |
| Aufwand | gering | Umsatzsteuer-Voranmeldungen, Jahreserklärung |

Bei Blocko gehen deine Umsätze ohnehin fast nur an Google-Gesellschaften in Irland (siehe 2.2).
Welche Variante für dich günstiger ist, hängt von deinen Ausgaben ab. **Das gehört zu den ersten
Fragen an den Steuerberater.**

### 2.2 Auszahlungen von Google: Leistungen an ein irisches Unternehmen (Reverse Charge)

- **In-App-Käufe**: Gegenüber den Kunden verkauft Google Play die Inhalte und kümmert sich um die
  Umsatzsteuer der Kunden in der EU. Du rechnest mit einer **irischen Google-Gesellschaft** ab (für
  Play typischerweise Google Commerce Ltd.). Maßgeblich ist, was auf deinen Zahlungsbelegen steht.
- **AdMob**: Die Werbeeinnahmen zahlt **Google Ireland Ltd.** aus.
- Beides sind in der Regel **Leistungen an Unternehmer im EU-Ausland**. Ort der Leistung ist
  Irland, in Deutschland fällt keine Umsatzsteuer an, die Steuer schuldet der Empfänger
  (**Reverse Charge**).
- Mit **Regelbesteuerung** meldest du diese Umsätze in der Umsatzsteuer-Voranmeldung (bisher
  Kennzahl 21) und in der **Zusammenfassenden Meldung** (ZM) an das BZSt. Dafür brauchst du eine
  **USt-IdNr**. Kleinunternehmer sind nach bisherigem Recht von der ZM befreit. Bitte bestätigen
  lassen.
- **USt-IdNr** beantragen: online beim Bundeszentralamt für Steuern (<https://www.bzst.de>).
  Trage sie im Play-Zahlungsprofil und in AdMob ein, wenn Google danach fragt, und auch im
  Impressum (`CONFIG.LEGAL.VAT_ID`).

**⚠ Falle für Kleinunternehmer:** Kaufst du Leistungen von ausländischen Unternehmen ein (z. B.
Google-Ads-Werbung für deine App, Software-Abos, ggf. die Play-Registrierungsgebühr), kann die
Umsatzsteuer nach **§ 13b UStG** bei **dir** anfallen, auch als Kleinunternehmer. Dann musst du sie
ans Finanzamt zahlen und darfst sie nicht als Vorsteuer abziehen. Frag deinen Steuerberater, bevor
du Werbung im Ausland einkaufst.

### 2.3 US-Steuerformulare

AdMob (und ggf. das Play-Zahlungsprofil) fragt nach **US-Steuerinformationen** (Privatpersonen
meist **W-8BEN**). Ohne Angaben kann Google Quellensteuer auf Einnahmen von US-Nutzern einbehalten.
Zur Anwendung des Doppelbesteuerungsabkommens Deutschland–USA berät dich dein Steuerberater.

## 3. Einkommensteuer und Gewerbesteuer

- Dein **Gewinn** (Einnahmen minus Ausgaben) ist steuerpflichtig, als Einkünfte aus Gewerbebetrieb.
- Ermittlung per **Einnahmenüberschussrechnung (EÜR)**, abgegeben mit der Einkommensteuererklärung
  (Anlage EÜR + Anlage G) über ELSTER.
- **Typische Ausgaben**: Play-Registrierungsgebühr, Testgeräte (bis 800 € netto als geringwertiges
  Wirtschaftsgut sofort absetzbar), Software, Domain, Werbung, Fachliteratur, Steuerberater.
- **Gewerbesteuer**: Für Einzelunternehmer gilt ein **Freibetrag von 24.500 €** Gewerbeertrag pro
  Jahr. Darunter fällt keine Gewerbesteuer an.
- **Rücklagen bilden**: Lege einen Teil der Einnahmen für Steuern zurück (Faustregel 25–35 %). Das
  Finanzamt kann Vorauszahlungen festsetzen.
- **Aufbewahrung**: Belege (Google-Zahlungsbelege, Rechnungen) geordnet ablegen. Fristen: Buchungsbelege
  8 Jahre, Aufzeichnungen 10 Jahre (bitte aktuell prüfen).

## 4. Impressum (§ 5 DDG)

Als geschäftsmäßiger Anbieter eines digitalen Dienstes aus Deutschland brauchst du ein
**Impressum** nach **§ 5 Digitale-Dienste-Gesetz (DDG)**. Das DDG hat 2024 das Telemediengesetz
ersetzt.

**Pflichtangaben** (für Einzelunternehmer):
- [ ] **Vor- und Nachname** (bei Firmen: Firma, Rechtsform, Vertretungsberechtigte)
- [ ] **Ladungsfähige Anschrift** (Straße, Hausnummer, PLZ, Ort). **Ein Postfach reicht nicht.**
- [ ] **E-Mail-Adresse**
- [ ] **Zweiter schneller Kontaktweg**: Telefonnummer (empfohlen) oder ein Kontaktformular. Für den
      DSA-Händlerstatus verlangt Google ohnehin eine Telefonnummer.
- [ ] **USt-IdNr** bzw. **Wirtschafts-Identifikationsnummer**, falls vorhanden
- [ ] Handelsregister/Registernummer, falls eingetragen

**Wo?**
- **In der App**: Einstellungen → Impressum. Die Inhalte kommen aus `game/js/config.js` → `LEGAL`.
  Der Bildschirm funktioniert auch offline.
- **Online**: `docs/site/impressum.html` (GitHub Pages)
- **Im Store**: über die Website in den Kontaktdaten und die Händlerangaben

`npm run check-release` verweigert die Freigabe, solange in `CONFIG.LEGAL` oder in den beiden
HTML-Seiten Platzhalter stehen.

**Privatadresse veröffentlichen?** Das ist der häufigste Knackpunkt. Möglichkeiten:
- eigene Privatanschrift (einfachste und rechtlich sicherste Lösung)
- **Geschäftsanschrift**, an der du tatsächlich erreichbar bist bzw. Post zugestellt werden kann
  (z. B. Coworking-Space, Büroservice)
- reine „Impressum-Adressen“/virtuelle Büros sind **rechtlich umstritten**. Lass dich beraten, bevor
  du so etwas nutzt.

**Kein OS-Link mehr nötig:** Die EU-Plattform zur Online-Streitbeilegung (OS-Plattform) wurde im
**Juli 2025 eingestellt**. Der früher übliche Link darauf ist nicht mehr erforderlich und sollte
entfernt werden. Den freiwilligen Hinweis zur Verbraucherschlichtung (§ 36 VSBG) müssen
Unternehmen mit höchstens 10 Beschäftigten nicht geben. Die Vorlage enthält trotzdem einen
kurzen, unschädlichen Satz dazu.

## 5. Datenschutz (DSGVO und TDDDG)

### 5.1 Was die App verarbeitet

| Verarbeitung | Rechtsgrundlage (Vorschlag) | Umsetzung in Blocko |
|---|---|---|
| **Spielstand auf dem Gerät** (localStorage + private Datei) | § 25 Abs. 2 Nr. 2 **TDDDG** (unbedingt erforderlich für das gewünschte Spiel), Art. 6 Abs. 1 lit. b DSGVO | Keine Einwilligung nötig. Kein Server, kein Konto. |
| **Werbung (AdMob)**: Werbe-ID, Gerätedaten, IP | **Einwilligung**: Art. 6 Abs. 1 lit. a DSGVO + § 25 Abs. 1 TDDDG, eingeholt über **Google UMP** (IAB TCF) | Kein Werbeabruf vor `canRequestAds()`. Widerruf in Einstellungen → Datenschutz-Einstellungen. |
| Nicht personalisierte/eingeschränkte Werbung ohne Einwilligung | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Finanzierung, Betrugsprävention), soweit keine Einwilligung nötig ist | wird von Google gesteuert |
| **Käufe** (Google Play Billing) | Art. 6 Abs. 1 lit. b DSGVO | Zahlungsdaten verarbeitet nur Google. Lokal nur Kauf-Token. |
| **Erinnerungen** | Einwilligung (Systemdialog), lokal | keine Daten an Server |
| **Support-E-Mails** | Art. 6 Abs. 1 lit. b/f DSGVO | E-Mails nach Erledigung löschen |
| **Webseite** (GitHub Pages) | Art. 6 Abs. 1 lit. f DSGVO | GitHub verarbeitet IP-Adressen beim Ausliefern |

### 5.2 Checkliste Datenschutz

- [ ] Datenschutzerklärung (`docs/site/privacy-policy.html`) ausgefüllt, online und in der App
      verlinkt (Einstellungen → Datenschutzerklärung)
- [ ] Inhalt passt zu den Angaben zur **Datensicherheit** in der Play Console
- [ ] AdMob-**DSGVO-Nachricht** veröffentlicht, in allen Sprachen
- [ ] **„Nicht einwilligen“** auf der ersten Ebene aktiviert (empfohlen). Deutsche
      Datenschutzbehörden und Gerichte verlangen zunehmend, dass Ablehnen genauso einfach ist wie
      Zustimmen.
- [ ] Spiel funktioniert **vollständig ohne Einwilligung** (kein „Zustimmen oder nicht spielen“)
- [ ] Optional: kurzes **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30 DSGVO) anlegen. Die
      Tabelle oben ist eine gute Grundlage.
- [ ] Ein **Datenschutzbeauftragter** ist bei dir als Einzelperson nicht nötig (Pflicht erst ab 20
      Personen, die ständig personenbezogene Daten verarbeiten).
- [ ] Bei jedem neuen SDK (Mediation, Analytics, Crash-Reporting): Datenschutzerklärung,
      Datensicherheit und Einwilligung prüfen

### 5.3 Google als Verantwortlicher

Für personalisierte Werbung handelt Google als **eigener Verantwortlicher**. Die
Datenschutzbedingungen zwischen dir und Google (Controller-Controller Data Protection Terms) sind
Teil der AdMob-Bedingungen. Prüfe in AdMob unter den Konto-/Datenschutzeinstellungen, ob du ihnen
zugestimmt hast. Die Datenübermittlung in die USA stützt sich auf das **EU-US Data Privacy
Framework** (Google ist zertifiziert) und Standardvertragsklauseln.

## 6. EU Digital Services Act (DSA) – Händlerstatus

- Die Play Console fragt, ob du **Händler** (Trader) bist. Das verlangt Art. 30 DSA
  (Nachverfolgbarkeit von Unternehmern auf Online-Marktplätzen).
- Wer gewerblich handelt (Werbung, Käufe, Gewerbe angemeldet), ist **Händler**.
- **Öffentlich angezeigt** werden dann in der EU: **Name, Anschrift, Telefonnummer, E-Mail**. Google
  verifiziert Telefon und E-Mail.
- Ohne Angabe darf deine App in der EU nicht angeboten werden.

## 7. Verbraucherrecht bei digitalen Inhalten

- **Widerrufsrecht bei In-App-Käufen**: Gegenüber dem Käufer tritt **Google Play** als Verkäufer
  auf. Google zeigt die Widerrufsbelehrung, holt die Zustimmung zur sofortigen Lieferung ein (danach
  erlischt das Widerrufsrecht, § 356 Abs. 5 BGB) und bearbeitet Erstattungen nach den
  Play-Richtlinien. **Du musst dafür nichts einbauen.**
- Trotzdem: **Erstattungen kulant behandeln** (Play Console → Bestellverwaltung), z. B. bei
  Doppelkäufen oder technischen Problemen.
- **Digitale Produkte (§§ 327 ff. BGB)**: Auch eine kostenlose, werbefinanzierte App kann darunter
  fallen, wenn Nutzer „mit Daten bezahlen“. Folgen: Die App muss so funktionieren wie beschrieben,
  und du musst angemessen lange **Updates** (insbesondere Sicherheits- und Kompatibilitätsupdates)
  bereitstellen. Der Store-Text in STORE_LISTING.md beschreibt nur vorhandene Funktionen.
- **Wettbewerbsrecht (UWG)**: **Keine direkten Kaufaufforderungen an Kinder** (Anhang Nr. 28 UWG),
  keine irreführenden Angaben. Deshalb sind die Shop-Texte im Spiel neutral formuliert.
- Eigene AGB/EULA sind nicht zwingend. Es gelten die Standardbedingungen von Google Play.

## 8. Jugendschutz

- Die Einstufung erfolgt über den **IARC-Fragebogen** in der Play Console. Daraus entsteht
  automatisch eine **USK-Kennzeichnung** (rechtlich anerkannt) und PEGI usw.
- Erwartet: **USK ab 0** mit dem Zusatzhinweis **„In-Game-Käufe“**.
- **Ehrlich antworten.** Falsche Angaben können zur Entfernung und Neubewertung führen.
- Keine Lootboxen oder Zufallskäufe gegen Echtgeld (in Blocko nicht vorhanden).
- Zielgruppe in der Play Console: 18+ (siehe PLAY_CONSOLE_ANGABEN.md). Das ist unabhängig von der USK-Einstufung.

## 9. Marken und Urheberrecht

- **Namensprüfung** vor dem ersten Upload: DPMAregister (<https://register.dpma.de>), TMview
  (<https://www.tmdn.org/tmview>), WIPO Global Brand Database (<https://branddb.wipo.int>), Google
  Play. Relevante Klassen: **9** (Spielesoftware) und **41** (Unterhaltung/Online-Spiele).
- **Eigene Marke anmelden** (optional, später): beim DPMA (online bisher ab ca. 290 € für bis zu
  3 Klassen) oder als EU-Marke beim EUIPO (bisher ab ca. 850 € für eine Klasse). Stand Oktober 2026
  bitte prüfen.
- **Fremde Marken** (z. B. „Tetris“, Namen von Konkurrenzspielen) nicht im Namen, Icon, in
  Beschreibungen oder Stichwörtern verwenden.
- **Eigene Werke**: Code, Grafiken und Sounds (synthetisiert) stammen aus diesem Projekt. Die
  Schriftart **Nunito** steht unter der SIL Open Font License; die Lizenzdatei liegt in
  `game/assets/fonts/`.
- **Künstlersozialkasse**: Beauftragst du Freiberufler für Grafik, Musik oder Texte, kann
  **Künstlersozialabgabe** anfallen. Frag deinen Steuerberater.

## 10. Barrierefreiheit (BFSG)

Das Barrierefreiheitsstärkungsgesetz gilt seit Juni 2025 u. a. für Dienstleistungen im
elektronischen Geschäftsverkehr. **Kleinstunternehmen** (unter 10 Beschäftigte und höchstens
2 Mio. € Jahresumsatz bzw. Bilanzsumme), die Dienstleistungen anbieten, sind in der Regel
**ausgenommen**. Gute Lesbarkeit und große Touch-Flächen sind trotzdem sinnvoll.

---

## Fragen für das Erstgespräch mit dem Steuerberater

1. Kleinunternehmerregelung oder Regelbesteuerung, was ist für mich günstiger?
2. Wie verbuche ich Auszahlungen von Google Play (Google Commerce Ltd.?) und AdMob (Google Ireland
   Ltd.)? Brauche ich ZM und USt-IdNr?
3. Was muss ich bei Werbeausgaben im Ausland (Google Ads) nach § 13b UStG beachten?
4. W-8BEN: wie ausfüllen (Doppelbesteuerungsabkommen)?
5. Welche Ausgaben kann ich absetzen (Handy, PC anteilig, Software, Arbeitszimmer)?
6. Muss ich Vorauszahlungen leisten? Wie viel sollte ich zurücklegen?
7. Hat das Auswirkungen auf meine Hauptbeschäftigung, Krankenversicherung oder Sozialleistungen?
