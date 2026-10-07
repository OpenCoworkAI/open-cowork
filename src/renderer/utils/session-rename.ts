export type RenameKeyAction = 'save' | 'cancel' | null;

export function resolveRenameTitle(currentTitle: string, value: string): string | null {
  const title = value.trim();
  return title && title !== currentTitle ? title : null;
}

export function renameKeyAction(key: string, isComposing: boolean): RenameKeyAction {
  // While an IME is composing, Enter picks a candidate and Escape drops the
  // composition; neither should end the rename.
  if (isComposing) return null;
  if (key === 'Enter') return 'save';
  if (key === 'Escape') return 'cancel';
  return null;
}
