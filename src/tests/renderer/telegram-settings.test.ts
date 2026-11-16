import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TelegramConfigStep } from '../../renderer/components/remote/TelegramConfigStep';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe('Telegram settings form', () => {
  it('saves token and explicit allowed user IDs through preload', async () => {
    const update = vi.fn(async (_config: unknown) => ({ success: true }));
    vi.stubGlobal('window', { electronAPI: { remote: { updateTelegramConfig: update } } });
    const onSaved = vi.fn(async () => {});
    act(() => {
      tree = create(React.createElement(TelegramConfigStep, { onSaved }));
    });
    const inputs = tree!.root.findAllByType('input');
    act(() => {
      inputs[0].props.onChange({ target: { value: '123456:token' } });
      inputs[1].props.onChange({ target: { value: '42, 43' } });
    });
    await act(async () => {
      await tree!.root.findByType('button').props.onClick();
    });
    expect(update).toHaveBeenCalledWith({
      type: 'telegram',
      botToken: '123456:token',
      dm: { policy: 'allowlist', allowFrom: ['42', '43'] },
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it('clearing a saved token disconnects the connector', async () => {
    const update = vi.fn(async (_config: unknown) => ({ success: true }));
    vi.stubGlobal('window', { electronAPI: { remote: { updateTelegramConfig: update } } });
    act(() => {
      tree = create(
        React.createElement(TelegramConfigStep, {
          onSaved: async () => {},
          config: {
            type: 'telegram',
            botToken: '123456:token',
            dm: { policy: 'allowlist', allowFrom: ['42'] },
          },
        })
      );
    });
    act(() => tree!.root.findAllByType('input')[0].props.onChange({ target: { value: '' } }));
    await act(async () => {
      await tree!.root.findByType('button').props.onClick();
    });
    expect(update).toHaveBeenCalledWith(null);
  });
  it('blocks a token without allowed users and displays a localized error', async () => {
    const update = vi.fn();
    vi.stubGlobal('window', { electronAPI: { remote: { updateTelegramConfig: update } } });
    act(() => {
      tree = create(React.createElement(TelegramConfigStep, { onSaved: async () => {} }));
    });
    act(() =>
      tree!.root.findAllByType('input')[0].props.onChange({ target: { value: '123456:token' } })
    );
    await act(async () => {
      await tree!.root.findByType('button').props.onClick();
    });
    expect(update).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children).toEqual([
      'remote.telegramSaveError',
    ]);
  });
});
