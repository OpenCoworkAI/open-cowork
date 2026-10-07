export type RenameKeyAction = 'save' | 'cancel' | null;

export function resolveRenameTitle(currentTitle: string, value: string): string | null {
  const title = value.trim();
  return title && title !== currentTitle ? title : null;
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
