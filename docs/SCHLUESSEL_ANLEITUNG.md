# Upload-Schlüssel erzeugen und für den GitHub-Build hinterlegen

Google Play verlangt, dass die App mit einem **Upload-Schlüssel** signiert ist. Den Schlüssel erzeugst
**du selbst**. Er darf nie im Repository landen und niemand außer dir sollte ihn sehen (auch ich nicht).
Der GitHub-Workflow „Release AAB (signed)“ liest ihn aus vier **Secrets**, die nur du setzen kannst.

> **Wichtig:** Ohne diesen Schlüssel und sein Passwort kannst du keine Updates mehr hochladen.
> Google kann einen verlorenen Upload-Schlüssel zwar zurücksetzen (Play Console → Einstellungen →
> App-Signatur), das dauert aber und ist lästig. **Sichere die Datei und die Passwörter an mindestens
> zwei Orten** (z. B. Passwort-Manager und ein USB-Stick), nicht nur auf einem Gerät.

## Weg A: Nur mit dem Handy (empfohlen, kein PC nötig)

GitHub erzeugt den Schlüssel für dich. Du brauchst nur den Handy-Browser (am besten „Desktop-Ansicht“).

**A1. Zugriffstoken erstellen** (damit der Workflow die Secrets setzen darf)
GitHub → dein Profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
- Name: `blocko-secrets`, Ablauf: 30 Tage
- Repository access: **Only select repositories → Game**
- Permissions → Repository permissions → **Secrets: Read and write**
- Erstellen und den Token **sofort kopieren** (wird nur einmal gezeigt).

**A2. Zwei Secrets anlegen** (Repo `Memo5561/Game` → Settings → Secrets and variables → Actions → New repository secret)
| Name | Wert |
|---|---|
| `SECRETS_PAT` | der Token aus A1 |
| `KEY_BACKUP_PASSPHRASE` | ein langes Passwort, das **du dir merkst und separat notierst** (mind. 12 Zeichen). Ohne dieses Passwort lässt sich das Backup nicht öffnen. |

**A3. Workflow starten:** Reiter **Actions → „Create upload key (once)“ → Run workflow**. Das Feld „overwrite“ **leer lassen**.

**A4. Backup herunterladen:** Im fertigen Lauf unter **Artifacts** die Datei `blocko-upload-key-backup-ENCRYPTED` laden (nur 7 Tage verfügbar) und an **zwei verschiedenen Orten** sichern (z. B. Cloud-Speicher und E-Mail an dich). Die Datei ist mit deiner Passphrase verschlüsselt.

**A5. Token löschen:** Danach den Token aus A1 bei GitHub widerrufen und das Secret `SECRETS_PAT` löschen. Er wird nur zum Anlegen gebraucht.

Danach sind die vier Secrets (`ANDROID_KEYSTORE_*`, `ANDROID_KEY_*`) gesetzt, und „Release AAB (signed)“ funktioniert.

> Backup öffnen (nur im Notfall, am PC oder in Termux):
> `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in blocko-upload-key-backup.enc -out backup.tgz && tar xzf backup.tgz`

## Weg B: Am PC (falls du doch einen hast)

### B1. Schlüssel erzeugen (einmalig, am PC)

Du brauchst Java (ist in **Android Studio** enthalten) oder ein installiertes JDK 17+.

Öffne ein Terminal (Windows: PowerShell) in einem **privaten** Ordner, nicht im Projektordner, und führe aus:

```bash
keytool -genkeypair -v -keystore blocko-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

- Er fragt nach einem **Passwort** (Schlüsselspeicher) und danach nach deinem Namen und Ort. Die Angaben
  sind frei, nimm deinen Namen. Bei „Schlüsselpasswort“ kannst du **Enter** drücken, dann gilt dasselbe Passwort.
- Wenn `keytool` nicht gefunden wird: In Android Studio liegt es unter
  `<Android-Studio-Ordner>/jbr/bin/keytool` (Windows: `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`).
- Alternativ in Android Studio: *Build → Generate Signed App Bundle → Create new…* erzeugt dieselbe Datei.

Du erhältst die Datei **`blocko-upload.jks`**.

### B2. Datei in Base64 umwandeln (für GitHub)

**Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("blocko-upload.jks")) | Set-Clipboard
```
**macOS / Linux:**
```bash
base64 -w0 blocko-upload.jks      # macOS: base64 -i blocko-upload.jks
```
Der lange Text (eine Zeile) ist der Wert für das erste Secret.

### B3. Vier Secrets bei GitHub eintragen

Repo `Memo5561/Game` → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Wert |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | der lange Base64-Text aus Schritt 2 |
| `ANDROID_KEYSTORE_PASSWORD` | dein Schlüsselspeicher-Passwort |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | dein Schlüsselpasswort (dasselbe wie oben, wenn du Enter gedrückt hast) |

Danach die Zwischenablage leeren und die Base64-Datei löschen.

## 4. Bundle bauen

Repo → Reiter **Actions** → links **„Release AAB (signed)“** → **Run workflow**:

- **ads_mode = `test`** für den **geschlossenen Test** (Google-Testwerbung, damit deine Tester nicht
  versehentlich echte Anzeigen anklicken, das kann dein AdMob-Konto sperren).
- **ads_mode = `live`** erst für die Produktion: Dann müssen echte AdMob-IDs in `android/gradle.properties`
  stehen und `node tools/check-release.mjs` muss grün sein (der Workflow prüft das und bricht sonst ab).
- **version_code**: bei **jedem** Upload um 1 erhöhen (1, 2, 3, …).

Nach ein paar Minuten steht im Lauf unter **Artifacts** die Datei `blocko-release-aab-…`. Das ZIP enthält
die `.aab`, die du in der Play Console hochlädst (Test → Geschlossener Test → Neuen Release erstellen).

## 5. Play App Signing

Beim ersten Upload bietet die Play Console **Play App Signing** an: Google verwaltet den eigentlichen
App-Signaturschlüssel, du lädst nur mit dem Upload-Schlüssel hoch. Das ist der Standard, bitte aktiviert lassen.

## Sicherheit

- Gib die Secrets niemals in Issues, Chats oder Commits weiter.
- Das Repository ist **öffentlich**; Secrets werden dort trotzdem nicht angezeigt. Workflows von
  fremden Pull Requests (Forks) bekommen sie nicht. Lass bei Bedarf unter *Settings → Actions → General*
  Workflows von Fremden nur nach Freigabe laufen.
