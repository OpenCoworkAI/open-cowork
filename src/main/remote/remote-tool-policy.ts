/** Authorization uses canonical tool identity; display names are only for prompts. */
const SAFE_LOCAL_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'ls',
  'webfetch',
  'web_fetch',
  'websearch',
  'web_search',
]);

const SAFE_BROWSER_TOOLS = new Set([
  'navigate_page',
  'take_screenshot',
  'take_snapshot',
  'click',
  'fill',
  'hover',
  'list_pages',
  'select_page',
  'new_page',
  'close_page',
  'wait_for',
  'press_key',
  'get_network_request',
  'list_network_requests',
  'list_console_messages',
]);

export function normalizeRemoteToolNameForAutoApprove(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  const mcp = normalized.match(/^mcp__(.+?)__(.+)$/);
  // Never grant another MCP server the Chrome policy just because its tool has
  // the same display name. Unknown canonical namespaces remain unknown.
  return mcp && mcp[1] === 'chrome' ? mcp[2] : normalized;
}

export function isSafeRemoteAutoApprovedTool(toolName: string): boolean {
  const normalized = normalizeRemoteToolNameForAutoApprove(toolName);
  return SAFE_LOCAL_TOOLS.has(normalized) || SAFE_BROWSER_TOOLS.has(normalized);
}
