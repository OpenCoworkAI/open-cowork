import { describe, expect, it, vi } from 'vitest';
import type { ApiConfigSet, AppConfig, ProviderProfileKey } from '../../renderer/types';
import en from '../../renderer/i18n/locales/en.json';
import zh from '../../renderer/i18n/locales/zh.json';
import {
  applyModelCycleTarget,
  createModelCycleKeydownHandler,
  getConfigSetModel,
  listModelCycleTargets,
  matchModelCycleShortcut,
  pickNextModelCycleTarget,
  type ModelCycleKeyEvent,
  type ModelCycleTarget,
} from '../../renderer/utils/model-cycle';

function keyEvent(overrides: Partial<ModelCycleKeyEvent> = {}): ModelCycleKeyEvent {
  return {
    key: 'p',
    code: 'KeyP',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
}

function makeSet(
  id: string,
  name: string,
  model: string,
  profileKey: ProviderProfileKey = 'openai'
): ApiConfigSet {
  return {
    id,
    name,
    provider: 'openai',
    customProtocol: 'openai',
    activeProfileKey: profileKey,
    profiles: {
      [profileKey]: {
        apiKey: 'sk-test',
        model,
      },
    },
    enableThinking: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const defaultSet = makeSet('default', 'Default', 'gpt-5.4');
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    activeProfileKey: 'openai',
    profiles: defaultSet.profiles,
    activeConfigSetId: 'default',
    configSets: [defaultSet],
    enableThinking: false,
    isConfigured: true,
    ...overrides,
  };
}

describe('matchModelCycleShortcut', () => {
  it('maps Ctrl+P to forward cycling', () => {
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true }))).toBe('forward');
  });

  it('maps Cmd+P to forward cycling (macOS CmdOrCtrl convention)', () => {
    expect(matchModelCycleShortcut(keyEvent({ metaKey: true }))).toBe('forward');
  });

  it('maps Shift+Ctrl+P and Shift+Cmd+P to backward cycling', () => {
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true, shiftKey: true, key: 'P' }))).toBe(
      'backward'
    );
    expect(matchModelCycleShortcut(keyEvent({ metaKey: true, shiftKey: true, key: 'P' }))).toBe(
      'backward'
    );
  });

  it('ignores unmodified P, Alt+P, other letters, IME composition, and key repeat', () => {
    expect(matchModelCycleShortcut(keyEvent())).toBeNull();
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true, key: 't', code: 'KeyT' }))).toBeNull();
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true, isComposing: true }))).toBeNull();
    expect(matchModelCycleShortcut(keyEvent({ ctrlKey: true, repeat: true }))).toBeNull();
  });
});

describe('listModelCycleTargets / pickNextModelCycleTarget', () => {
  it('cycles config sets when more than one set is configured', () => {
    const config = makeConfig({
      configSets: [
        makeSet('default', 'DeepSeek', 'deepseek-chat', 'custom:openai'),
        makeSet('vision', 'Vision', 'gpt-5.4'),
      ],
      activeConfigSetId: 'default',
      model: 'deepseek-chat',
    });

    const targets = listModelCycleTargets(config);
    expect(targets).toEqual([
      { kind: 'set', id: 'default', name: 'DeepSeek', model: 'deepseek-chat' },
      { kind: 'set', id: 'vision', name: 'Vision', model: 'gpt-5.4' },
    ]);

    expect(
      pickNextModelCycleTarget(
        targets,
        { configSetId: 'default', model: 'deepseek-chat' },
        'forward'
      )
    ).toEqual({ kind: 'set', id: 'vision', name: 'Vision', model: 'gpt-5.4' });
    expect(
      pickNextModelCycleTarget(targets, { configSetId: 'vision', model: 'gpt-5.4' }, 'forward')
    ).toEqual({ kind: 'set', id: 'default', name: 'DeepSeek', model: 'deepseek-chat' });
  });

  it('wraps backward across three config sets', () => {
    const targets = listModelCycleTargets(
      makeConfig({
        configSets: [
          makeSet('a', 'A', 'model-a'),
          makeSet('b', 'B', 'model-b'),
          makeSet('c', 'C', 'model-c'),
        ],
        activeConfigSetId: 'a',
        model: 'model-a',
      })
    );

    expect(pickNextModelCycleTarget(targets, { configSetId: 'a' }, 'backward')).toEqual({
      kind: 'set',
      id: 'c',
      name: 'C',
      model: 'model-c',
    });
  });

  it('does not borrow the current config model when a target set has no model', () => {
    const emptySet: ApiConfigSet = {
      ...makeSet('empty', 'Empty', ''),
      profiles: { openai: { apiKey: 'sk-test', model: '' } },
    };
    const targets = listModelCycleTargets(
      makeConfig({
        configSets: [emptySet, makeSet('vision', 'Vision', 'gpt-5.4')],
        activeConfigSetId: 'empty',
        model: 'gpt-5.4',
      })
    );
    expect(targets).toEqual([
      { kind: 'set', id: 'empty', name: 'Empty', model: '' },
      { kind: 'set', id: 'vision', name: 'Vision', model: 'gpt-5.4' },
    ]);
  });

  it('falls back to provider preset models when only one config set exists', () => {
    const targets = listModelCycleTargets(makeConfig({ model: 'gpt-5.4' }));
    expect(targets[0]).toEqual({ kind: 'model', model: 'gpt-5.4' });
    expect(targets.length).toBeGreaterThan(1);

    expect(pickNextModelCycleTarget(targets, { model: 'gpt-5.4' }, 'forward')).toEqual({
      kind: 'model',
      model: 'gpt-5.4-pro',
    });
    expect(pickNextModelCycleTarget(targets, { model: 'gpt-5.4' }, 'backward')?.model).toBe(
      'o4-mini'
    );
  });

  it('does not pick a next target when the list is empty or a singleton', () => {
    expect(
      pickNextModelCycleTarget(
        [{ kind: 'model', model: 'only-one' }],
        { model: 'only-one' },
        'forward'
      )
    ).toBeUndefined();
    expect(pickNextModelCycleTarget([], { model: 'only-one' }, 'forward')).toBeUndefined();
  });

  it('keeps a custom current model in the single-set cycle list', () => {
    const targets = listModelCycleTargets(makeConfig({ model: 'my-finetune' }));
    expect(targets[0]).toEqual({ kind: 'model', model: 'my-finetune' });
    expect(pickNextModelCycleTarget(targets, { model: 'my-finetune' }, 'forward')).toEqual({
      kind: 'model',
      model: 'gpt-5.4',
    });
  });

  it('reads the active profile model off a config set', () => {
    expect(getConfigSetModel(makeSet('a', 'A', 'kimi-k2-thinking', 'custom:openai'))).toBe(
      'kimi-k2-thinking'
    );
  });
});

describe('createModelCycleKeydownHandler', () => {
  function setup(
    config: AppConfig,
    contextOverrides: { settingsOpen?: boolean; configModalOpen?: boolean } = {}
  ) {
    const switchSet = vi.fn(async () => ({ success: true, config }));
    const saveModel = vi.fn(async () => ({ success: true, config }));
    const onCycled = vi.fn();
    const onError = vi.fn();
    const handler = createModelCycleKeydownHandler({
      getContext: () => ({
        config,
        settingsOpen: contextOverrides.settingsOpen ?? false,
        configModalOpen: contextOverrides.configModalOpen ?? false,
      }),
      cycleInFlight: { current: false },
      switchSet,
      saveModel,
      onCycled,
      onError,
    });
    return { handler, switchSet, saveModel, onCycled, onError };
  }

  it('invokes switchSet for Ctrl+P when multiple config sets exist', async () => {
    const config = makeConfig({
      configSets: [
        makeSet('default', 'DeepSeek', 'deepseek-chat'),
        makeSet('vision', 'Vision', 'gpt-5.4'),
      ],
      activeConfigSetId: 'default',
      model: 'deepseek-chat',
    });
    const { handler, switchSet, saveModel, onCycled } = setup(config);
    const event = keyEvent({ ctrlKey: true });

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(onCycled).toHaveBeenCalledWith({
        kind: 'set',
        id: 'vision',
        name: 'Vision',
        model: 'gpt-5.4',
      });
    });
    expect(switchSet).toHaveBeenCalledWith('vision');
    expect(saveModel).not.toHaveBeenCalled();
  });

  it('invokes switchSet for Shift+Ctrl+P with the previous config set', async () => {
    const config = makeConfig({
      configSets: [
        makeSet('a', 'A', 'model-a'),
        makeSet('b', 'B', 'model-b'),
        makeSet('c', 'C', 'model-c'),
      ],
      activeConfigSetId: 'a',
      model: 'model-a',
    });
    const { handler, switchSet, onCycled } = setup(config);

    handler(keyEvent({ ctrlKey: true, shiftKey: true, key: 'P' }));

    await vi.waitFor(() => {
      expect(onCycled).toHaveBeenCalledWith({
        kind: 'set',
        id: 'c',
        name: 'C',
        model: 'model-c',
      });
    });
    expect(switchSet).toHaveBeenCalledWith('c');
  });

  it('invokes saveModel for Cmd+P when cycling presets in a single set', async () => {
    const { handler, switchSet, saveModel, onCycled } = setup(makeConfig({ model: 'gpt-5.4' }));
    const event = keyEvent({ metaKey: true });

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(onCycled).toHaveBeenCalledWith({ kind: 'model', model: 'gpt-5.4-pro' });
    });
    expect(saveModel).toHaveBeenCalledWith('gpt-5.4-pro');
    expect(switchSet).not.toHaveBeenCalled();
  });

  it('does not cycle while Settings or the config modal is open', async () => {
    const config = makeConfig({
      configSets: [makeSet('default', 'A', 'a'), makeSet('other', 'B', 'b')],
    });
    const settingsEvent = keyEvent({ ctrlKey: true });
    const settings = setup(config, { settingsOpen: true });
    settings.handler(settingsEvent);
    expect(settings.switchSet).not.toHaveBeenCalled();
    expect(settingsEvent.preventDefault).not.toHaveBeenCalled();

    const modalEvent = keyEvent({ ctrlKey: true });
    const modal = setup(config, { configModalOpen: true });
    modal.handler(modalEvent);
    expect(modal.switchSet).not.toHaveBeenCalled();
    expect(modalEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('does not consume Ctrl+P when a cycle is already in flight', () => {
    const config = makeConfig({
      configSets: [makeSet('default', 'A', 'a'), makeSet('other', 'B', 'b')],
    });
    const switchSet = vi.fn(async () => ({ success: true, config }));
    const saveModel = vi.fn(async () => ({ success: true, config }));
    const event = keyEvent({ ctrlKey: true });
    const handler = createModelCycleKeydownHandler({
      getContext: () => ({
        config,
        settingsOpen: false,
        configModalOpen: false,
      }),
      cycleInFlight: { current: true },
      switchSet,
      saveModel,
      onCycled: vi.fn(),
    });

    handler(event);

    expect(switchSet).not.toHaveBeenCalled();
    expect(saveModel).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not consume Ctrl+P when config is null', () => {
    const switchSet = vi.fn(async () => undefined);
    const saveModel = vi.fn(async () => undefined);
    const event = keyEvent({ ctrlKey: true });
    const handler = createModelCycleKeydownHandler({
      getContext: () => ({
        config: null,
        settingsOpen: false,
        configModalOpen: false,
      }),
      cycleInFlight: { current: false },
      switchSet,
      saveModel,
      onCycled: vi.fn(),
    });

    handler(event);

    expect(switchSet).not.toHaveBeenCalled();
    expect(saveModel).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('does not call preventDefault when there is no cycle target', () => {
    const lonely = makeSet('default', 'Default', 'only-one');
    const config = makeConfig({
      provider: 'not-a-provider' as AppConfig['provider'],
      model: 'only-one',
      activeProfileKey: 'openai',
      profiles: lonely.profiles,
      configSets: [lonely],
    });
    const { handler, switchSet, saveModel } = setup(config);
    const event = keyEvent({ ctrlKey: true });

    expect(listModelCycleTargets(config)).toEqual([]);
    handler(event);

    expect(switchSet).not.toHaveBeenCalled();
    expect(saveModel).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('does not steal unrelated shortcuts or unmodified typing', () => {
    const { handler, switchSet, saveModel } = setup(makeConfig());
    handler(keyEvent({ key: 't', code: 'KeyT', ctrlKey: true }));
    handler(keyEvent({ key: 'p' }));
    expect(switchSet).not.toHaveBeenCalled();
    expect(saveModel).not.toHaveBeenCalled();
  });
});

describe('applyModelCycleTarget', () => {
  it('routes set targets to switchSet and model targets to saveModel', async () => {
    const switchSet = vi.fn(async () => undefined);
    const saveModel = vi.fn(async () => undefined);
    const setTarget: ModelCycleTarget = {
      kind: 'set',
      id: 'vision',
      name: 'Vision',
      model: 'gpt-5.4',
    };

    await applyModelCycleTarget(setTarget, { switchSet, saveModel });
    expect(switchSet).toHaveBeenCalledWith('vision');
    expect(saveModel).not.toHaveBeenCalled();

    await applyModelCycleTarget({ kind: 'model', model: 'o3' }, { switchSet, saveModel });
    expect(saveModel).toHaveBeenCalledWith('o3');
  });
});

describe('model-cycle i18n', () => {
  it('keeps cycle strings under the chat namespace in en and zh', () => {
    expect(en.chat.modelCycled).toContain('{{model}}');
    expect(en.chat.modelCycledSet).toContain('{{name}}');
    expect(en.chat.modelCycledSet).toContain('{{model}}');
    expect(zh.chat.modelCycled).toContain('{{model}}');
    expect(zh.chat.modelCycledSet).toContain('{{name}}');
    expect(zh.chat.modelCycledSet).toContain('{{model}}');
  });
});
