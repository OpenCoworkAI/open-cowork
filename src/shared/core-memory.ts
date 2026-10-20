/** A core memory is one short fact that goes into every prompt. */
export const MAX_CORE_MEMORY_VALUE_LENGTH = 500;

/** Errors from editing core memory; each message is the i18n key Settings shows. */
export const CORE_MEMORY_ERRORS = {
  emptyValue: 'memory.coreErrorEmptyValue',
  valueTooLong: 'memory.coreErrorValueTooLong',
  entryNotFound: 'memory.coreErrorEntryNotFound',
} as const;

const coreMemoryErrorKeys = new Set<string>(Object.values(CORE_MEMORY_ERRORS));

export function localizeCoreMemoryError(
  message: string,
  translate: (key: string, options?: Record<string, unknown>) => string
): string {
  return coreMemoryErrorKeys.has(message)
    ? translate(message, { max: MAX_CORE_MEMORY_VALUE_LENGTH })
    : message;
}
