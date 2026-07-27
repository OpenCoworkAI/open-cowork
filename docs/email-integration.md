# E-Mail-Integration für Open Cowork

Diese Integration macht ein E-Mail-Postfach zu einem **Remote-Kanal** von Open Cowork:
Nutzer schreiben dem Agenten eine E-Mail, der Agent bearbeitet die Anfrage und
**antwortet als sauber verkettete Antwort im selben E-Mail-Thread**. Sie reiht sich
nahtlos neben die bestehenden Kanäle (Feishu, Slack) ein und nutzt genau dieselbe
Gateway-, Sitzungs- und Berechtigungslogik.

- **Empfangen:** IMAP (Polling des Posteingangs auf ungelesene Nachrichten)
- **Senden:** SMTP (Antwort mit `In-Reply-To` / `References` → korrektes Threading)
- **Sitzungszuordnung:** Ein E-Mail-Thread = eine Agenten-Sitzung. Folge-Antworten
  des Nutzers landen automatisch in derselben Sitzung.
- **Marktübliche Anbieter:** Gmail / Google Workspace, Outlook / Microsoft 365,
  Yahoo, iCloud, GMX, WEB.DE, Zoho – plus beliebige **eigene IMAP/SMTP-Server**.
- **Sichere Ablage der Zugangsdaten:** Das Passwort wird über den bestehenden
  **verschlüsselten** Konfigurationsspeicher (`electron-store` mit scrypt-Schlüssel,
  siehe `src/main/utils/store-encryption.ts`) verschlüsselt auf der Platte abgelegt
  und **niemals geloggt**.

---

## 1. Architektur / neu hinzugefügte Dateien

| Datei | Zweck |
|---|---|
| `src/main/remote/channels/email/email-channel.ts` | Der Kanal: IMAP-Empfang, SMTP-Antwort, Threading, Redaction |
| `src/main/remote/channels/email/email-providers.ts` | Presets (Host/Port) für gängige Anbieter + Auflösung |
| `src/main/remote/channels/email/index.ts` | Re-Exports |
| `src/main/remote/types.ts` | `EmailChannelConfig`, `EmailProvider`, `ChannelType += 'email'` |
| `src/main/remote/remote-config-store.ts` | `getEmailConfig()` / `setEmailConfig()` (verschlüsselt) |
| `src/main/remote/remote-manager.ts` | Registrierung des Kanals + `updateEmailConfig()` (Allowlist-Sync) |
| `src/main/index.ts` | IPC-Handler `remote.updateEmailConfig` |
| `src/preload/index.ts` | `window.electronAPI.remote.updateEmailConfig(config)` |
| `src/shared/ipc-types.ts` | Slim-Typ-Mirror für den Renderer |
| `src/renderer/components/remote/EmailConfigStep.tsx` | Konfigurations-UI (Schritt) |
| `src/renderer/i18n/locales/{en,zh}.json` | Übersetzungen (`remote.email*`) |
| `src/tests/remote/email-channel.test.ts` | Unit-Tests (Presets + Threading) |

Ablauf einer Nachricht:

```
Eingehende Mail ──IMAP──▶ EmailChannel.processIncoming()
        │                     │ (mailparser)
        │                     ▼
        │            RemoteMessage { channelId = Thread-Root-Message-ID }
        │                     ▼
        │            RemoteGateway  ──(Allowlist-Prüfung)──▶  MessageRouter ──▶ Agent
        │                                                                          │
Antwort ◀──SMTP── EmailChannel.send() ◀──(In-Reply-To/References)── RemoteManager ◀┘
```

---

## 2. Voraussetzungen installieren

Die Integration bringt drei etablierte Bibliotheken mit (bereits in
`package.json` eingetragen):

- [`imapflow`](https://www.npmjs.com/package/imapflow) – moderner IMAP-Client
- [`nodemailer`](https://www.npmjs.com/package/nodemailer) – SMTP-Versand
- [`mailparser`](https://www.npmjs.com/package/mailparser) – MIME-Parsing

Installieren:

```bash
npm install
```

Danach Typprüfung/Tests:

```bash
npm run typecheck
npm run test -- email-channel
```

---

## 3. Anbieter vorbereiten (App-Passwort)

Die meisten großen Anbieter erlauben IMAP/SMTP nur mit einem **App-spezifischen
Passwort** (nicht dem normalen Login-Passwort) und aktivem 2FA:

| Anbieter | IMAP | SMTP | App-Passwort nötig? |
|---|---|---|---|
| Gmail / Google Workspace | `imap.gmail.com:993` (TLS) | `smtp.gmail.com:465` (TLS) | **Ja** |
| Outlook / Microsoft 365 | `outlook.office365.com:993` (TLS) | `smtp.office365.com:587` (STARTTLS) | **Ja** |
| Yahoo Mail | `imap.mail.yahoo.com:993` (TLS) | `smtp.mail.yahoo.com:465` (TLS) | **Ja** |
| iCloud Mail | `imap.mail.me.com:993` (TLS) | `smtp.mail.me.com:587` (STARTTLS) | **Ja** |
| GMX | `imap.gmx.net:993` (TLS) | `mail.gmx.net:465` (TLS) | Nein (IMAP in den GMX-Einstellungen aktivieren) |
| WEB.DE | `imap.web.de:993` (TLS) | `smtp.web.de:587` (STARTTLS) | Nein (IMAP aktivieren) |
| Zoho Mail | `imap.zoho.com:993` (TLS) | `smtp.zoho.com:465` (TLS) | **Ja** |

> Diese Werte sind als Presets in `email-providers.ts` hinterlegt – bei Auswahl
> eines Anbieters müssen nur Adresse und Passwort eingegeben werden.

Für **eigene Server** (`provider: 'custom'`) gibst du IMAP- und SMTP-Host/Port
selbst an. Faustregel für `secure`:
`true` = implizites TLS (993 / 465), `false` = STARTTLS-Port (143 / 587).

Empfehlung: Lege ein **eigenes Postfach** an (z. B. `assistant@deine-domain.de`),
nicht dein persönliches – so ist der Zugriff sauber abgegrenzt.

---

## 4. Konfigurieren

Es gibt zwei Wege. **Weg A** (UI) ist der Endnutzer-Weg, **Weg B** (IPC-Konsole)
der schnelle Test-Weg.

### Weg A – UI-Schritt einbinden

Die fertige React-Komponente liegt unter
`src/renderer/components/remote/EmailConfigStep.tsx`. Sie wird analog zu
`FeishuConfigStep`/`SlackConfigStep` in das `RemoteControlPanel` eingehängt.
`ConfigStep` enthält bereits `'email'`. Konkret im
`src/renderer/components/RemoteControlPanel.tsx`:

1. **Importieren und State anlegen:**

   ```tsx
   import { EmailConfigStep } from './remote/EmailConfigStep';

   const [emailProvider, setEmailProvider] = useState('gmail');
   const [emailAddress, setEmailAddress] = useState('');
   const [emailPassword, setEmailPassword] = useState('');
   const [emailFromName, setEmailFromName] = useState('Open Cowork Assistant');
   const [emailImapHost, setEmailImapHost] = useState('');
   const [emailImapPort, setEmailImapPort] = useState('993');
   const [emailSmtpHost, setEmailSmtpHost] = useState('');
   const [emailSmtpPort, setEmailSmtpPort] = useState('587');
   const [emailDmPolicy, setEmailDmPolicy] = useState('allowlist');
   const [emailAllowFrom, setEmailAllowFrom] = useState('');
   ```

2. **Beim Laden vorbelegen** (in der bestehenden `useEffect`-Ladelogik, dort wo
   `configResult.channels?.feishu` gelesen wird):

   ```tsx
   if (configResult.channels?.email) {
     const e = configResult.channels.email;
     setEmailProvider(e.provider || 'gmail');
     setEmailAddress(e.user || '');
     setEmailPassword(e.password || '');
     setEmailFromName(e.fromName || '');
     setEmailImapHost(e.imap?.host || '');
     setEmailImapPort(String(e.imap?.port ?? 993));
     setEmailSmtpHost(e.smtp?.host || '');
     setEmailSmtpPort(String(e.smtp?.port ?? 587));
     setEmailDmPolicy(e.dm?.policy || 'allowlist');
     setEmailAllowFrom((e.dm?.allowFrom || []).join(', '));
   }
   ```

3. **In `saveConfig()` speichern** (neben dem `updateFeishuConfig`-Aufruf):

   ```tsx
   if (emailAddress && emailPassword) {
     await window.electronAPI.remote.updateEmailConfig({
       type: 'email',
       provider: emailProvider as any,
       user: emailAddress,
       password: emailPassword,
       fromName: emailFromName || undefined,
       imap:
         emailProvider === 'custom'
           ? { host: emailImapHost, port: Number(emailImapPort), secure: Number(emailImapPort) === 993 }
           : undefined,
       smtp:
         emailProvider === 'custom'
           ? { host: emailSmtpHost, port: Number(emailSmtpPort), secure: Number(emailSmtpPort) === 465 }
           : undefined,
       dm: {
         policy: emailDmPolicy as 'open' | 'pairing' | 'allowlist',
         allowFrom: emailAllowFrom
           .split(',')
           .map((s) => s.trim().toLowerCase())
           .filter(Boolean),
       },
     });
   }
   ```

4. **Schritt rendern** (im Step-Switch, neben `activeStep === 'feishu'`):

   ```tsx
   {activeStep === 'email' && (
     <EmailConfigStep
       provider={emailProvider}
       address={emailAddress}
       password={emailPassword}
       fromName={emailFromName}
       imapHost={emailImapHost}
       imapPort={emailImapPort}
       smtpHost={emailSmtpHost}
       smtpPort={emailSmtpPort}
       dmPolicy={emailDmPolicy}
       allowFrom={emailAllowFrom}
       onProviderChange={setEmailProvider}
       onAddressChange={setEmailAddress}
       onPasswordChange={setEmailPassword}
       onFromNameChange={setEmailFromName}
       onImapHostChange={setEmailImapHost}
       onImapPortChange={setEmailImapPort}
       onSmtpHostChange={setEmailSmtpHost}
       onSmtpPortChange={setEmailSmtpPort}
       onDmPolicyChange={setEmailDmPolicy}
       onAllowFromChange={setEmailAllowFrom}
     />
   )}
   ```

   Den Navigationseintrag „E-Mail“ (`remote.stepEmail`) in `ConfigStepNav`
   ergänzen, damit der Schritt anwählbar ist.

### Weg B – schnell per IPC (Entwickler-Konsole)

Im laufenden Dev-Build (`npm run dev`) in den DevTools der App:

```js
await window.electronAPI.remote.updateEmailConfig({
  type: 'email',
  provider: 'gmail',
  user: 'assistant@example.com',
  password: 'APP-PASSWORT',            // App-spezifisches Passwort
  fromName: 'Open Cowork Assistant',
  dm: { policy: 'allowlist', allowFrom: ['ich@example.com'] },
});

// Remote-Gateway starten (registriert den E-Mail-Kanal):
await window.electronAPI.remote.setEnabled(true);

// Status prüfen:
await window.electronAPI.remote.getStatus();
```

---

## 5. Berechtigungen (wichtig für die Sicherheit)

E-Mail ist ein **nach außen offener** Kanal – jeder kann an die Adresse schreiben.
`updateEmailConfig()` synchronisiert deshalb die `dm.policy` in die Gateway-
Autorisierung:

- **`allowlist` (empfohlen, Standard):** Nur die unter `allowFrom` genannten
  Absenderadressen dürfen den Agenten steuern. Alle anderen erhalten die
  Standard-Ablehnung. Die Adressen werden als `email:<adresse>` in die
  Gateway-Allowlist eingetragen (gemischt mit anderen Kanälen, ohne diese zu
  überschreiben).
- **`pairing`:** Unbekannte Absender bekommen einen Kopplungscode, den ein
  Administrator bestätigen muss.
- **`open`:** Jeder Absender darf – nur für abgeschottete Testumgebungen.

> **Niemals** `open` mit einem produktiven Postfach kombinieren.

---

## 6. Testen

1. Konfiguration speichern (Weg A oder B) und Remote aktivieren.
2. Von einer **erlaubten** Adresse eine Mail an das Bot-Postfach schicken,
   z. B. Betreff „Test“, Text „Fasse dich kurz: sag Hallo.“.
3. Innerhalb des Poll-Intervalls (Standard 30 s) erscheint in Open Cowork eine
   neue Remote-Sitzung; die Agenten-Antwort kommt als **Reply im selben Thread**
   zurück.
4. Antworte auf diese Mail → die Folge-Nachricht landet in **derselben** Sitzung.

Logs (Präfix `[Email]`) zeigen Verbindungsaufbau, gefundene Nachrichten und
Versand. Zugangsdaten tauchen dort nicht auf.

---

## 7. Konfigurationsschema (`EmailChannelConfig`)

```ts
{
  type: 'email';
  provider: 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'gmx' | 'webde' | 'zoho' | 'custom';
  user: string;                 // Login / Postfachadresse
  password: string;             // (App-)Passwort – verschlüsselt gespeichert
  fromAddress?: string;         // Absenderadresse (Default: user)
  fromName?: string;            // Anzeigename
  imap?: { host: string; port: number; secure: boolean };  // Pflicht bei 'custom'
  smtp?: { host: string; port: number; secure: boolean };  // Pflicht bei 'custom'
  mailbox?: string;             // Default: 'INBOX'
  pollIntervalSec?: number;     // Default: 30, Minimum: 10
  dm: {
    policy: 'open' | 'pairing' | 'allowlist';
    allowFrom?: string[];       // erlaubte Absenderadressen (bei 'allowlist')
  };
}
```

---

## 8. Fehlerbehebung

| Symptom | Ursache / Lösung |
|---|---|
| `SMTP … verify`-Fehler beim Start | Falsches Passwort oder App-Passwort fehlt; bei 587 STARTTLS (`secure:false`), bei 465 implizites TLS (`secure:true`). |
| IMAP verbindet, aber nichts passiert | Absender steht nicht in `allowFrom`; Mail war bereits gelesen (nur **ungelesene** werden verarbeitet). |
| Antwort kommt nicht als Reply im Thread | Manche Clients threaden nur bei gleichem Betreff; die Integration setzt zusätzlich `In-Reply-To`/`References`. |
| Endlosschleife eigener Mails | Wird verhindert: Mails von der eigenen Absenderadresse werden ignoriert. |
| Gmail „Anmeldung blockiert“ | 2FA aktivieren und ein App-Passwort erzeugen (siehe Provider-Link im UI-Schritt). |

---

## 9. Grenzen / mögliche Erweiterungen

- Aktuell **Polling** (robust, providerunabhängig). IMAP-`IDLE` für Echtzeit ist
  als Erweiterung möglich (`imapflow` unterstützt es).
- Anhänge eingehender Mails werden derzeit nicht an den Agenten weitergereicht
  (nur Text/HTML-Body). Ausgehende Antworten sind reiner Text.
- Pro Postfach wird genau **ein** E-Mail-Kanal betrieben.
