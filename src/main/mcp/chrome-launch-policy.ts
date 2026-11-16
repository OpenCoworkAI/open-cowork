import type { MCPServerConfig } from './mcp-manager';

/**
 * Only the unmodified bundled preset needs Open Cowork to start a browser.
 * Custom browser paths, headless options, profiles and endpoints belong to
 * chrome-devtools-mcp, which launches/connects lazily when a tool is called.
 */
export function shouldAutoLaunchDefaultChrome(config: MCPServerConfig): boolean {
  if (config.type !== 'stdio') return false;
  const command = config.command?.split(/[\\/]/).pop()?.toLowerCase();
  if (!command || !['npx', 'npx.cmd', 'npx.exe'].includes(command)) return false;
  const presetArgs = ['-y', 'chrome-devtools-mcp@latest', '--browser-url', 'http://localhost:9222'];
  return (
    config.args?.length === presetArgs.length &&
    config.args.every((arg, index) => arg === presetArgs[index])
  );
}
