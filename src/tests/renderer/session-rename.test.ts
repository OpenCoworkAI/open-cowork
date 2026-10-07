import { describe, expect, it } from 'vitest';
import { renameKeyAction, resolveRenameTitle } from '../../renderer/utils/session-rename';

describe('resolveRenameTitle', () => {
  it('saves the trimmed new title', () => {
    expect(resolveRenameTitle('Old title', '  Quarterly plan  ')).toBe('Quarterly plan');
  });

  it('shortens an edited title to the 200-character limit the main process accepts', () => {
    const long = 'x'.repeat(250);

    expect(resolveRenameTitle(long, `${long}!`)).toBe('x'.repeat(200));
  });

  it('keeps a stored title over the limit when the edit is cancelled', () => {
    const long = 'x'.repeat(250);

    expect(resolveRenameTitle(long, long)).toBeNull();
  });

  it('keeps the old title for a blank or unchanged value', () => {
    expect(resolveRenameTitle('Old title', '   ')).toBeNull();
    expect(resolveRenameTitle('Old title', ' Old title ')).toBeNull();
  });
});

describe('renameKeyAction', () => {
  const key = (value: string, isComposing = false, keyCode = 0) => ({
    key: value,
    isComposing,
    keyCode,
  });

  it('saves on Enter and cancels on Escape', () => {
    expect(renameKeyAction(key('Enter'))).toBe('save');
    expect(renameKeyAction(key('Escape'))).toBe('cancel');
    expect(renameKeyAction(key('a'))).toBeNull();
  });

  it('leaves Enter and Escape to the IME while it is composing', () => {
    expect(renameKeyAction(key('Enter', true))).toBeNull();
    expect(renameKeyAction(key('Escape', true))).toBeNull();
  });

  it('treats keyCode 229 as IME input even when isComposing is false', () => {
    expect(renameKeyAction(key('Enter', false, 229))).toBeNull();
  });
});
