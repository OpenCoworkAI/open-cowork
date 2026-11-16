interface AuthFrame {
  url: string;
}
interface AuthWebContents {
  mainFrame: AuthFrame;
  isDestroyed(): boolean;
}
interface AuthIpcEvent {
  sender: AuthWebContents;
  senderFrame: AuthFrame | null;
}

/** Account mutations are restricted to the app window's current main document. */
export function assertTrustedAuthIpcSender(
  event: AuthIpcEvent,
  trustedContents: AuthWebContents | null | undefined,
  expectedDocumentUrl: string
): void {
  const deny = () => {
    throw new Error('Untrusted account-authentication IPC sender.');
  };
  if (
    !trustedContents ||
    trustedContents.isDestroyed() ||
    event.sender !== trustedContents ||
    !event.senderFrame ||
    event.senderFrame !== trustedContents.mainFrame
  )
    deny();
  try {
    const actual = new URL(event.senderFrame!.url);
    const expected = new URL(expectedDocumentUrl);
    // Hash routes are in-document navigation; origin, path and query must
    // still identify the exact packaged page or configured dev-server page.
    actual.hash = '';
    expected.hash = '';
    if (actual.href !== expected.href || !['file:', 'http:', 'https:'].includes(expected.protocol))
      deny();
  } catch {
    deny();
  }
}
