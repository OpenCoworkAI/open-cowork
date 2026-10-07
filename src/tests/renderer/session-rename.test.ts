import { describe, expect, it } from 'vitest';
import { renameKeyAction, resolveRenameTitle } from '../../renderer/utils/session-rename';

describe('resolveRenameTitle', () => {
  it('saves the trimmed new title', () => {
    expect(resolveRenameTitle('Old title', '  Quarterly plan  ')).toBe('Quarterly plan');
  });

  it('keeps the old title for a blank or unchanged value', () => {
    expect(resolveRenameTitle('Old title', '   ')).toBeNull();
    expect(resolveRenameTitle('Old title', ' Old title ')).toBeNull();
  });
});

describe('renameKeyAction', () => {
  it('saves on Enter and cancels on Escape', () => {
    expect(renameKeyAction('Enter', false)).toBe('save');
    expect(renameKeyAction('Escape', false)).toBe('cancel');
    expect(renameKeyAction('a', false)).toBeNull();
  });

  it('leaves Enter and Escape to the IME while it is composing', () => {
    expect(renameKeyAction('Enter', true)).toBeNull();
    expect(renameKeyAction('Escape', true)).toBeNull();
  });
});
