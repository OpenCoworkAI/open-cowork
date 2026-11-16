// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
const translate = (key: string) => key;
const api = {
  platform: 'win32',
  config: {
    get: vi.fn(),
    save: vi.fn(),
  },
  sandbox: { getStatus: vi.fn() },
};

let SettingsSandbox: typeof import('../src/renderer/components/settings/SettingsSandbox').SettingsSandbox;

beforeAll(async () => {
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true });
  ({ SettingsSandbox } = await import('../src/renderer/components/settings/SettingsSandbox'));
});

beforeEach(() => {
  api.platform = 'win32';
  api.config.get.mockResolvedValue({ sandboxEnabled: false });
  api.config.save.mockResolvedValue({ success: true, config: { sandboxEnabled: true } });
  api.sandbox.getStatus.mockResolvedValue({
    platform: 'win32',
    mode: 'native',
    initialized: false,
    wsl: { available: false },
  });
});

afterEach(cleanup);

describe('sandbox enable switch', () => {
  it('enables WSL even before prerequisites are installed and persists the setting', async () => {
    const view = render(createElement(SettingsSandbox));
    const toggle = await view.findByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.config.save).toHaveBeenCalledWith({ sandboxEnabled: true }));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('keeps the persisted state and displays an error when saving fails', async () => {
    api.config.save.mockResolvedValue({ success: false });
    const view = render(createElement(SettingsSandbox));
    const toggle = await view.findByRole('switch');
    fireEvent.click(toggle);
    await view.findByText('sandbox.failedToSave');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('does not present native Linux execution as an available isolated sandbox', async () => {
    api.platform = 'linux';
    api.config.get.mockResolvedValue({ sandboxEnabled: true });
    api.sandbox.getStatus.mockResolvedValue({
      platform: 'linux',
      mode: 'native',
      initialized: true,
    });
    const view = render(createElement(SettingsSandbox));
    const toggle = await view.findByRole('switch');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(view.queryByText('sandbox.readyStatus')).toBeNull();
    fireEvent.click(toggle);
    expect(api.config.save).not.toHaveBeenCalled();
  });
});
