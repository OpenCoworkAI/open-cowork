import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Content-level checks for the CompanionPairingCard component (same approach
 * as the other remote-control-panel tests): the card must fetch its QR payload
 * through the companion IPC surface, render the QR image and code, keep the
 * expiry countdown updated, and manage paired devices via IPC only.
 */

const cardPath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/CompanionPairingCard.tsx'
);
const cardContent = readFileSync(cardPath, 'utf8');

const enLocale = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json'),
    'utf8'
  )
);
const zhLocale = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json'),
    'utf8'
  )
);

describe('CompanionPairingCard', () => {
  it('generates the QR from the companion IPC payload, never from the phone-facing HTTP surface', () => {
    expect(cardContent).toContain("QRCode.toDataURL");
    // QR payload comes straight from the main-process pairing result.
    expect(cardContent).toContain('remote.companion.startPairing');
    // No direct HTTP calls to the gateway from the UI.
    expect(cardContent).not.toMatch(/fetch\s*\(/);
  });

  it('renders QR image and the one-time code with an expiry countdown', () => {
    expect(cardContent).toContain('data-testid="companion-qr-image"');
    expect(cardContent).toContain('data-testid="companion-expires"');
    expect(cardContent).toContain('remote.companion.expiresIn');
  });

  it('lists and revokes paired phones via the IPC surface (prefix only)', () => {
    expect(cardContent).toContain('remote.companion.listTokens');
    expect(cardContent).toContain('remote.companion.revokeToken');
  });

  it('disables the button when the companion module is off', () => {
    expect(cardContent).toContain('remote.companion.notEnabled');
    expect(cardContent).toContain('disabled={!isElectron || !enabled}');
  });
});

describe('companion i18n keys', () => {
  const expectedKeys = [
    'title',
    'desc',
    'generate',
    'regenerate',
    'expiredNote',
    'expiresIn',
    'notEnabled',
    'generateFailed',
    'pairedDevices',
    'noDevices',
    'revoke',
  ];

  it('exists in the en locale under remote.companion', () => {
    const section = enLocale.remote?.companion;
    expect(section).toBeDefined();
    for (const key of expectedKeys) {
      expect(section[key]).toBeTruthy();
    }
  });

  it('exists in the zh locale under remote.companion', () => {
    const section = zhLocale.remote?.companion;
    expect(section).toBeDefined();
    for (const key of expectedKeys) {
      expect(section[key]).toBeTruthy();
    }
  });
});
