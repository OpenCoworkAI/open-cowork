/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  collectMcpConnectorRenderFields,
  formatMcpTypeLabel,
  normalizeMcpConfigInput,
} from '../src/shared/mcp-config';
import { PanelErrorBoundary } from '../src/renderer/components/PanelErrorBoundary';
import { SettingsConnectors } from '../src/renderer/components/settings/SettingsConnectors';
import '../src/renderer/i18n/config';

interface McpTestApi {
  getServers: ReturnType<typeof vi.fn>;
  getServersForSettings: ReturnType<typeof vi.fn>;
  getPresets: ReturnType<typeof vi.fn>;
  getServerStatus: ReturnType<typeof vi.fn>;
  getTools: ReturnType<typeof vi.fn>;
  saveServer: ReturnType<typeof vi.fn>;
  deleteServer: ReturnType<typeof vi.fn>;
}

// SettingsConnectors captures `window.electronAPI` at module load (`isElectron`).
const mcp = vi.hoisted(() => {
  const api: McpTestApi = {
    getServers: vi.fn(),
    getServersForSettings: vi.fn(),
    getPresets: vi.fn(),
    getServerStatus: vi.fn(),
    getTools: vi.fn(),
    saveServer: vi.fn(),
    deleteServer: vi.fn(),
  };
  const target = window as Window & { electronAPI?: { mcp: McpTestApi } };
  target.electronAPI = { mcp: api };
  return api;
});

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as unknown;
}

/** Same pipeline SettingsConnectors uses after `mcp.getServers()`. */
function connectorCardsFromIpcPayload(loaded: unknown) {
  return collectMcpConnectorRenderFields(normalizeMcpConfigInput(loaded).servers);
}

function ExplodingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('connectors render failed');
  }
  return createElement('div', null, 'connectors ok');
}

function RetryHarness() {
  const [resetKey, setResetKey] = useState(0);
  const [shouldThrow, setShouldThrow] = useState(true);
  return createElement(
    PanelErrorBoundary,
    {
      name: 'SettingsConnectors',
      resetKey: `connectors:${resetKey}`,
      fallback: createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            setShouldThrow(false);
            setResetKey((key) => key + 1);
          },
        },
        'Retry'
      ),
    },
    createElement(ExplodingChild, { shouldThrow })
  );
}

describe('Settings MCP Connectors blank-page regression (#216)', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mcp.getPresets.mockResolvedValue({});
    mcp.getServerStatus.mockResolvedValue([]);
    mcp.getTools.mockResolvedValue([]);
    mcp.saveServer.mockResolvedValue({ success: true });
    mcp.deleteServer.mockResolvedValue(undefined);
  });

  it('turns malformed IPC / agent-installed payloads into renderable connector cards', () => {
    const tavilyDocument = loadFixture('mcp-config-agent-tavily.json');
    const mixedDocument = loadFixture('mcp-config-mixed-agent-installed.json');
    const stringEncoded = {
      servers: JSON.stringify((tavilyDocument as { servers: unknown }).servers),
    };

    for (const payload of [tavilyDocument, mixedDocument, stringEncoded]) {
      const cards = connectorCardsFromIpcPayload(payload);
      expect(cards.length).toBeGreaterThan(0);
      expect(
        cards.every(
          (card) =>
            typeof card.name === 'string' &&
            card.name.length > 0 &&
            typeof card.typeLabel === 'string' &&
            card.typeLabel.length > 0
        )
      ).toBe(true);
    }

    const tavilyCards = connectorCardsFromIpcPayload(tavilyDocument);
    expect(tavilyCards).toEqual([
      expect.objectContaining({
        name: 'tavily-mcp',
        typeLabel: 'STDIO',
        commandLine: 'npx -y tavily-mcp@latest',
        enabled: true,
      }),
    ]);
  });

  it('does not throw when connector type or args are missing (legacy list crash)', () => {
    expect(formatMcpTypeLabel(undefined)).toBe('STDIO');
    expect(() =>
      collectMcpConnectorRenderFields(
        normalizeMcpConfigInput({
          servers: [{ name: 'tavily-mcp', command: 'npx', args: '-y tavily-mcp@latest' }],
        }).servers
      )
    ).not.toThrow();
  });

  it('renders connector cards when IPC returns an agent-installed servers map', async () => {
    mcp.getServersForSettings.mockResolvedValue(loadFixture('mcp-config-agent-tavily.json'));

    render(createElement(SettingsConnectors, { isActive: true }));

    expect(await screen.findByText('tavily-mcp')).toBeTruthy();
    expect(screen.getByText('STDIO')).toBeTruthy();
    expect(screen.getByText('npx -y tavily-mcp@latest')).toBeTruthy();
    expect(screen.queryByText('No connectors configured')).toBeNull();
  });

  it('renders connector cards when IPC returns servers as a JSON string', async () => {
    const tavilyDocument = loadFixture('mcp-config-agent-tavily.json') as { servers: unknown };
    mcp.getServersForSettings.mockResolvedValue({
      servers: JSON.stringify(tavilyDocument.servers),
    });

    render(createElement(SettingsConnectors, { isActive: true }));

    expect(await screen.findByText('tavily-mcp')).toBeTruthy();
    expect(screen.getByText('npx -y tavily-mcp@latest')).toBeTruthy();
  });

  it('renders mixed agent-installed rows that used to crash type and args formatting', async () => {
    mcp.getServersForSettings.mockResolvedValue(
      loadFixture('mcp-config-mixed-agent-installed.json')
    );

    render(createElement(SettingsConnectors, { isActive: true }));

    expect(await screen.findByText('Chrome')).toBeTruthy();
    expect(screen.getByText('tavily-mcp')).toBeTruthy();
    expect(screen.getAllByText('STDIO').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('npx -y tavily-mcp@latest')).toBeTruthy();
  });

  it('renders Claude mcpServers when the payload also has an empty servers array', async () => {
    const document = loadFixture('mcp-config-claude-mcpServers.json') as Record<string, unknown>;
    mcp.getServersForSettings.mockResolvedValue({ servers: [], ...document });

    render(createElement(SettingsConnectors, { isActive: true }));

    expect(await screen.findByText('tavily-mcp')).toBeTruthy();
    expect(screen.getByText('tavily-remote')).toBeTruthy();
    expect(screen.getByText('https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-test-key')).toBeTruthy();
  });

  it('ignores malformed individual presets when the preset list is expanded', async () => {
    mcp.getServersForSettings.mockResolvedValue(loadFixture('mcp-config-agent-tavily.json'));
    mcp.getPresets.mockResolvedValue({
      echo: { name: 'Echo', type: 'stdio', command: 'echo', args: ['hello'] },
      bad: null,
      text: 'not-a-preset',
      list: ['not-a-preset'],
    });
    render(createElement(SettingsConnectors, { isActive: true }));
    expect(await screen.findByText('tavily-mcp')).toBeTruthy();
    expect(await screen.findByText('Echo')).toBeTruthy();
    fireEvent.click(screen.getByText('Hide'));
    fireEvent.click(await screen.findByText('Show'));
    expect(await screen.findByText('Echo')).toBeTruthy();
    expect(screen.queryByText('not-a-preset')).toBeNull();
  });

  it.each([{ servers: 'not-json' }, { mcpServers: 42 }])(
    'shows a repair message instead of an empty configuration for %j',
    async (document) => {
      mcp.getServersForSettings.mockResolvedValue(document);
      render(createElement(SettingsConnectors, { isActive: true }));
      expect(await screen.findByText(/existing configuration has been preserved/i)).toBeTruthy();
      expect(screen.queryByText('No connectors configured')).toBeNull();
    }
  );

  it('surfaces a configuration repair error rejected by the real IPC read path', async () => {
    mcp.getServersForSettings.mockRejectedValue(
      new Error('Error invoking remote method: MCP_CONFIG_NEEDS_REPAIR')
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(createElement(SettingsConnectors, { isActive: true }));
    expect(await screen.findByText(/existing configuration has been preserved/i)).toBeTruthy();
    expect(screen.queryByText('No connectors configured')).toBeNull();
    consoleError.mockRestore();
  });

  it('keeps repair guidance visible, prevents writes, and unlocks after a successful reread', async () => {
    mcp.getServers.mockResolvedValue([]);
    mcp.getServersForSettings.mockResolvedValue({ servers: 'not-json' });
    mcp.getPresets.mockResolvedValue({ echo: { name: 'Echo', type: 'stdio', command: 'echo' } });
    const view = render(createElement(SettingsConnectors, { isActive: true }));
    expect(await screen.findByText(/existing configuration has been preserved/i)).toBeTruthy();
    expect(await screen.findByText('Echo')).toBeTruthy();
    const custom = screen.getByRole('button', {
      name: 'Add Custom Connector',
    }) as HTMLButtonElement;
    const preset = screen.getByRole('button', { name: 'Add', exact: true }) as HTMLButtonElement;
    expect(custom.disabled).toBe(true);
    expect(preset.disabled).toBe(true);
    fireEvent.click(custom);
    fireEvent.click(preset);
    expect(screen.getByText(/existing configuration has been preserved/i)).toBeTruthy();
    expect(mcp.saveServer).not.toHaveBeenCalled();
    expect(mcp.getServers).not.toHaveBeenCalled();

    view.rerender(createElement(SettingsConnectors, { isActive: false }));
    mcp.getServersForSettings.mockResolvedValue(loadFixture('mcp-config-agent-tavily.json'));
    view.rerender(createElement(SettingsConnectors, { isActive: true }));
    expect(await screen.findByText('tavily-mcp')).toBeTruthy();
    expect(screen.queryByText(/existing configuration has been preserved/i)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Add Custom Connector' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('shows the connectors fallback after a render error and recovers on Retry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(createElement(RetryHarness));

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('connectors ok')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('connectors ok')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    consoleError.mockRestore();
  });
});
