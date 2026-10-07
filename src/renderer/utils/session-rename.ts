import { MAX_RENAMED_SESSION_TITLE_LENGTH } from '../../shared/session-title';

export type RenameKeyAction = 'save' | 'cancel' | null;

export function resolveRenameTitle(currentTitle: string, value: string): string | null {
  const edited = value.trim();
  // Compare before shortening: Escape puts the stored title back, and a stored
  // title can already exceed the limit (session.start does not cap it).
  if (!edited || edited === currentTitle.trim()) return null;
  const title = edited.slice(0, MAX_RENAMED_SESSION_TITLE_LENGTH).trim();
  return title !== currentTitle ? title : null;
}

export function renameKeyAction(event: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): RenameKeyAction {
  // While an IME is composing, Enter picks a candidate and Escape drops the
  // composition; neither should end the rename. Some Windows IMEs commit a
  // candidate with an Enter whose isComposing is false but whose keyCode is 229.
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === 'Enter') return 'save';
  if (event.key === 'Escape') return 'cancel';
  return null;
}
