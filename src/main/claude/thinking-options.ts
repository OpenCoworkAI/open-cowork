export type ThinkingOptions =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' };

export function buildThinkingOptions(enableThinking: boolean): ThinkingOptions {
  if (enableThinking) {
    return { type: 'enabled', budget_tokens: 10000 };
  }
  return { type: 'disabled' };
}
