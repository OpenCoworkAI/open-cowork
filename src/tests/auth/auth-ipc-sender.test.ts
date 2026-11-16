import { describe, expect, it } from 'vitest';
import { assertTrustedAuthIpcSender } from '../../main/auth/auth-ipc-sender';

const documentUrl =
  'file:///Applications/Open%20Cowork.app/Contents/Resources/app.asar/dist/index.html';
function fixture(url = documentUrl) {
  const mainFrame = { url };
  const contents = { mainFrame, isDestroyed: () => false };
  return { contents, event: { sender: contents, senderFrame: mainFrame } };
}

describe('account-authentication IPC sender', () => {
  it('accepts the app main document including its settings hash route', () => {
    const host = fixture(`${documentUrl}#/settings`);
    expect(() => assertTrustedAuthIpcSender(host.event, host.contents, documentUrl)).not.toThrow();
  });

  it('accepts the configured dev-server page but rejects another port and document', () => {
    const host = fixture('http://localhost:5173/#/settings');
    expect(() =>
      assertTrustedAuthIpcSender(host.event, host.contents, 'http://localhost:5173')
    ).not.toThrow();
    expect(() =>
      assertTrustedAuthIpcSender(host.event, host.contents, 'http://localhost:5174')
    ).toThrow();
    expect(() =>
      assertTrustedAuthIpcSender(host.event, host.contents, 'http://localhost:5173/other')
    ).toThrow();
  });

  it('rejects other windows, subframes and destroyed or missing app windows', () => {
    const host = fixture();
    expect(() => assertTrustedAuthIpcSender(host.event, fixture().contents, documentUrl)).toThrow();
    expect(() =>
      assertTrustedAuthIpcSender(
        { ...host.event, senderFrame: { url: documentUrl } },
        host.contents,
        documentUrl
      )
    ).toThrow();
    expect(() =>
      assertTrustedAuthIpcSender({ ...host.event, senderFrame: null }, host.contents, documentUrl)
    ).toThrow();
    expect(() => assertTrustedAuthIpcSender(host.event, null, documentUrl)).toThrow();
    host.contents.isDestroyed = () => true;
    expect(() => assertTrustedAuthIpcSender(host.event, host.contents, documentUrl)).toThrow();
  });

  it.each([
    'https://example.com',
    'file:///tmp/index.html',
    `${documentUrl}?external=true`,
    'data:text/html,hello',
  ])('rejects navigation away from the app document: %s', (url) => {
    const host = fixture(url);
    expect(() => assertTrustedAuthIpcSender(host.event, host.contents, documentUrl)).toThrow();
  });
});
