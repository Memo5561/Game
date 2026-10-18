# Marketing – erste Tester, erste Nutzer, gute Bewertungen

Kurz und praktisch, ohne Werbebudget. Grundsätze: **ehrlich, regelmäßig, nah an der Community.**

---

## 1. ASO – App Store Optimization (kostenlos und am wichtigsten)

- [ ] **Titel** mit Gattungsbegriff: „Blocko: Block Puzzle“. Den Titel nicht ständig ändern.
- [ ] **Kurzbeschreibung**: die wichtigsten Suchbegriffe natürlich eingebaut (Block-Puzzle, offline,
      entspannen). Texte: [STORE_LISTING.md](STORE_LISTING.md)
- [ ] **Icon**: kräftige Farben, erkennbar auch in klein, kein Text. Teste es neben Konkurrenz-Icons
      in der Play-Suche: Fällt es auf?
- [ ] **Erste 2–3 Screenshots**: Sie entscheiden. Großes Spielfeld, ein Abräum-Moment, ein kurzer
      Satz Text.
- [ ] **Lokalisierte Einträge**: mindestens DE + EN vollständig, Kurzbeschreibungen in allen
      8 Sprachen. Später vollständige Beschreibungen und Screenshots mit übersetztem Text.
- [ ] **Store-Eintrag-Tests** (A/B) in der Play Console: immer nur **eine** Änderung testen
      (z. B. Icon-Hintergrund, erster Screenshot), mindestens 7 Tage laufen lassen.
- [ ] **Benutzerdefinierte Store-Einträge** pro Land, wenn ein Land besonders gut läuft.
- [ ] **Bewertung und Absturzrate** beeinflussen die Sichtbarkeit in der Suche. Qualität ist Marketing.

## 2. Die ersten 12+ Tester (geschlossener Test, Pflicht)

Ablauf siehe [VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md), Schritt 8. **Lade 15–20 Personen ein.**

- **Persönlich fragen** (am besten): Familie, Freunde, Kollegen, Mitbewohner, Verein, Nachbarn.
  Eine kurze, nette Nachricht mit klarer Anleitung:
  > „Ich habe ein kleines Puzzle-Spiel entwickelt und brauche Tester für 14 Tage. Du brauchst nur ein
  > Android-Handy mit Google-Konto. 1) Schick mir deine Gmail-Adresse. 2) Öffne den Link, den ich dir
  > schicke, und tippe auf ‚Tester werden‘. 3) Installiere die App und spiel ein paarmal pro Woche.
  > Bitte bleib 14 Tage angemeldet. Danke!“
- **Spieleentwickler-Communitys**: lokale Indie-Game-Treffen, Discord-Server von Indie-Entwicklern,
  Reddit-Communitys für gegenseitiges Testen (Regeln der jeweiligen Community lesen). Gegenseitiges
  Testen („ich teste deins, du testest meins“) ist üblich. Echte Tester mit echtem Feedback sind
  aber mehr wert als reine Zahlen.
- **Keine bezahlten „Tester-Pakete“** mit Fake-Konten oder Bots. Das kann den Antrag auf
  Produktionszugriff gefährden.
- **Feedback einsammeln**: kurzes Formular (Fragen siehe VEROEFFENTLICHUNG.md, 8.2) und eine
  Erinnerung nach 3 und nach 10 Tagen.
- **⚠ Testbuild mit `BLOCKO_ADS_MODE=test`**. Bitte Tester nie, auf Werbung zu klicken.

## 3. Die ersten 1.000 Nutzer ohne bezahlte Werbung

1. **Kurzvideos** (TikTok, YouTube Shorts, Instagram Reels) – der stärkste kostenlose Kanal für
   Puzzle-Spiele:
   - 7–15 Sekunden, Hochformat, ohne lange Einleitung: sofort ein „befriedigender“ Moment
     (Reihe + Spalte gleichzeitig, Kombo-Kette, komplett leeres Spielfeld)
   - Formate: „Schaffst du das?“ (knifflige Stellung zeigen, Auflösung im nächsten Clip), „Mein
     bester Zug heute“, „Neues Design: Gold“, Entwickler-Einblicke („Ich habe allein ein Spiel
     gebaut“)
   - **regelmäßig** posten (z. B. 3× pro Woche), Hashtags wie #blockpuzzle #puzzlegame #indiedev
     #gamedev
   - Spielszenen vorbereiten: im Browser mit `?debug=1` und `__blocko.startGame(...)`
2. **Communitys**: Reddit (z. B. Communitys für Android-Spiele, Indie-Games, „Play my game“; vorher
   die Regeln zur Eigenwerbung lesen), Discord, Foren. Erzähl ehrlich: „Ich habe allein ein faires
   Block-Puzzle ohne Energiesystem gebaut, Feedback willkommen.“
3. **Persönliches Umfeld**: Bitte Freunde, die App **weiterzuempfehlen** (Teilen-Funktion im
   Spiel), nicht „5 Sterne zu geben“.
4. **Lokale Presse und Blogs**: „Indie-Entwickler aus [Stadt] veröffentlicht sein erstes Spiel“.
   Lokalzeitungen mögen solche Geschichten. Dazu kurze Pressemitteilung + Screenshots + Link.
5. **Updates als Anlass**: Neues Design, Saison-Event, neue Sprache sind jeweils Anlass für einen
   Post.
6. **Cross-Promotion** (ab dem zweiten Spiel): AdMob-Eigenwerbung (House Ads) zwischen deinen Apps.

## 4. Bewertungen – nur auf erlaubte Weise

**Erlaubt und eingebaut:**
- Die **Google-Bewertungskarte** (In-App Review) erscheint automatisch nach einem **neuen Rekord**,
  frühestens ab dem 5. Spiel und **nur einmal**. Es gibt keine Frage vorher und keinen Button dafür.
  So verlangt es Google.
- Der Punkt **„Bewerten“** in den Einstellungen öffnet den Play Store (nicht die Karte).

**Was du zusätzlich tun solltest:**
- [ ] **Auf jede Rezension antworten**, freundlich und konkret, gerade auf schlechte: „Danke! Der
      Fehler ist in Version 1.0.3 behoben.“ Nutzer ändern danach oft ihre Bewertung.
- [ ] Wiederkehrende Kritik ernst nehmen und im nächsten Update beheben.
- [ ] Abstürze schnell beheben (Android Vitals). Abstürze sind die häufigste Ursache für 1-Stern-Bewertungen.

**⚠ Verboten** (führt zur Entfernung der App):
- Bewertungen kaufen, tauschen oder mit Münzen/Belohnungen belohnen
- „Gefällt dir die App?“ fragen und nur Zufriedene zum Bewerten schicken (Review-Gating)
- „Bitte gib 5 Sterne“-Texte, Bewertungen von Freunden in Massen am selben Tag
- Die Bewertungskarte per Button auslösen

## 5. Community und Bindung

- **Feedback-Kanal**: Support-E-Mail (im Store und Impressum), später evtl. ein Discord-Server.
- **Kleine Events**: Wochen-Challenges in den Social-Posts („Wer schafft heute mehr als 5.000
  Punkte im Tagesrätsel?“), saisonale Designs (Halloween, Winter).
- **Changelog** in den Versionshinweisen: Zeig, dass die App gepflegt wird.
- **Zuhören statt verkaufen**: Spieler-Ideen umsetzen und das öffentlich danken.

## 6. Lokalisierte Store-Einträge

1. Reihenfolge nach Potenzial: **EN, DE**, dann **ES, PT-BR, FR, IT, TR, RU**.
2. Kurzbeschreibungen liegen in STORE_LISTING.md für alle 8 Sprachen bereit.
3. Vollständige Beschreibung: aus dem Englischen übersetzen (z. B. DeepL) und **von Muttersprachlern
   prüfen** lassen (Tester fragen!).
4. Screenshots mit übersetztem Text erhöhen die Conversion spürbar. Fang mit den Ländern an, aus
   denen die meisten Installationen kommen (Play Console → Statistiken).
5. Hinweis: In manchen Ländern sind Werbung oder Play-Zahlungen eingeschränkt (z. B. hat Google
   2022 Werbung und Play-Zahlungen in Russland ausgesetzt). Russische Texte helfen trotzdem
   russischsprachigen Spielern in anderen Ländern.
