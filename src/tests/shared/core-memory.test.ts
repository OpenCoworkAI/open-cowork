import { describe, expect, it } from 'vitest';
import { CORE_MEMORY_ERRORS, localizeCoreMemoryError } from '../../shared/core-memory';
import { stripIpcErrorPrefix } from '../../shared/ipc-error';

const translate = (key: string, options?: Record<string, unknown>) =>
  `${key} ${JSON.stringify(options)}`;

describe('localizeCoreMemoryError', () => {
  it('translates a core memory error that Electron wrapped', () => {
    const message = stripIpcErrorPrefix(
      `Error invoking remote method 'memory.writeCoreEntry': Error: ${CORE_MEMORY_ERRORS.valueTooLong}`
    );

    expect(localizeCoreMemoryError(message, translate)).toBe(
      'memory.coreErrorValueTooLong {"max":500}'
    );
  });

  it('shows other errors without the Electron prefix', () => {
    const message = stripIpcErrorPrefix(
      "Error invoking remote method 'memory.getCoreEntries': Error: Memory service not initialized"
    );

    expect(localizeCoreMemoryError(message, translate)).toBe('Memory service not initialized');
  });
});
