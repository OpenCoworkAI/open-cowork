import { describe, expect, it } from 'vitest';
import { shouldAutoLaunchDefaultChrome } from '../src/main/mcp/chrome-launch-policy';
import type { MCPServerConfig } from '../src/main/mcp/mcp-manager';
import {
  formatMcpArgsInput,
  normalizeMcpConfigDocument,
  parseMcpArgsInput,
} from '../src/shared/mcp-config';

const preset: MCPServerConfig = {
  id: 'chrome',
  name: 'Chrome',
  type: 'stdio',
  enabled: true,
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url', 'http://localhost:9222'],
};

describe('Chrome MCP custom browser configuration', () => {
  it('retains automatic browser startup for the unmodified built-in preset', () => {
    expect(shouldAutoLaunchDefaultChrome(preset)).toBe(true);
    expect(shouldAutoLaunchDefaultChrome({ ...preset, command: 'C:\\node\\npx.cmd' })).toBe(true);
  });

  it.each([
    [
      '-y',
      'chrome-devtools-mcp@latest',
      '--executablePath',
      '/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium',
    ],
    ['-y', 'chrome-devtools-mcp@latest', '--browser-url', 'http://127.0.0.1:9333'],
    ['-y', 'chrome-devtools-mcp@latest', '--browserUrl=http://browser.example:9222'],
    ['-y', 'chrome-devtools-mcp@latest', '--headless'],
    ['-y', 'chrome-devtools-mcp@latest', '--wsEndpoint', 'ws://127.0.0.1:9333/devtools/browser/id'],
    [...preset.args!, '--headless'],
  ])('leaves custom browser args %j to the MCP server', (...args) => {
    expect(shouldAutoLaunchDefaultChrome({ ...preset, args })).toBe(false);
  });

  it('does not launch a local browser merely because an unrelated connector has Chrome in its name', () => {
    expect(
      shouldAutoLaunchDefaultChrome({
        ...preset,
        type: 'streamable-http',
        url: 'https://example.com/mcp',
      })
    ).toBe(false);
    expect(
      shouldAutoLaunchDefaultChrome({ ...preset, command: 'node', args: ['custom-server.js'] })
    ).toBe(false);
  });

  it.each([
    [
      '-y',
      'chrome-devtools-mcp@latest',
      '--executablePath',
      '/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium',
    ],
    ['--executablePath', 'C:\\Program Files\\Chromium\\chrome.exe', '--headless'],
    ['--chromeArg', '--user-agent=Hello world', ''],
    ['[literal', '--headless'],
  ])('keeps every configured browser argument intact through edit and save: %j', (...args) => {
    const edited = parseMcpArgsInput(formatMcpArgsInput(args));
    expect(edited).toEqual(args);
    const reloaded = normalizeMcpConfigDocument({ servers: [{ ...preset, args: edited }] });
    expect(reloaded.servers[0].args).toEqual(args);
  });

  it('rejects malformed argument arrays without applying a partial edit', () => {
    expect(() => parseMcpArgsInput('["--headless",')).toThrow();
    expect(() => parseMcpArgsInput('["--headless", 1]')).toThrow();
    expect(parseMcpArgsInput(' -y chrome-devtools-mcp@latest --headless ')).toEqual([
      '-y',
      'chrome-devtools-mcp@latest',
      '--headless',
    ]);
  });
});
