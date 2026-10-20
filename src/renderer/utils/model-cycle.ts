import { API_PROVIDER_PRESETS } from '../../shared/api-model-presets';
import type { ApiConfigSet, AppConfig, ProviderType } from '../types';

export type ModelCycleDirection = 'forward' | 'backward';

export type ModelCycleTarget =
  | { kind: 'set'; id: string; name: string; model: string }
  | { kind: 'model'; model: string };

export interface ModelCycleKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  preventDefault: () => void;
  stopPropagation?: () => void;
  stopImmediatePropagation?: () => void;
}

export interface ModelCycleContext {
  config: AppConfig | null;
  settingsOpen: boolean;
  configModalOpen: boolean;
}

export interface ModelCycleActions {
  switchSet: (id: string) => Promise<unknown>;
  saveModel: (model: string) => Promise<unknown>;
}

export interface ModelCycleHandlerOptions extends ModelCycleActions {
  getContext: () => ModelCycleContext;
  cycleInFlight: { current: boolean };
  onCycled: (target: ModelCycleTarget) => void;
  onError?: (error: unknown) => void;
}

function isProviderType(value: string | undefined): value is ProviderType {
  return (
    value === 'openrouter' ||
    value === 'anthropic' ||
    value === 'custom' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'ollama'
  );
}

export function getConfigSetModel(
  set: Pick<ApiConfigSet, 'activeProfileKey' | 'profiles'>
): string {
  return set.profiles?.[set.activeProfileKey]?.model?.trim() || '';
}

export function modelsForProvider(provider: string | undefined): string[] {
  if (!isProviderType(provider)) {
    return [];
  }
  return API_PROVIDER_PRESETS[provider].models.map((item) => item.id);
}

/**
 * Match the TUI's Ctrl+P / Shift+Ctrl+P model-cycle bindings, using CmdOrCtrl
 * so macOS follows the desktop app's existing Preferences accelerator
 * (`CmdOrCtrl+,`) while Ctrl+P still works for pi-TUI muscle memory.
 */
export function matchModelCycleShortcut(event: ModelCycleKeyEvent): ModelCycleDirection | null {
  if (event.repeat || event.isComposing || event.defaultPrevented) {
    return null;
  }
  if (event.altKey) {
    return null;
  }
  const hasPrimaryModifier = event.ctrlKey || event.metaKey;
  if (!hasPrimaryModifier) {
    return null;
  }
  const isP = event.code === 'KeyP' || event.key.toLowerCase() === 'p';
  if (!isP) {
    return null;
  }
  return event.shiftKey ? 'backward' : 'forward';
}

export function listModelCycleTargets(
  config: Pick<AppConfig, 'configSets' | 'activeConfigSetId' | 'model' | 'provider'>
): ModelCycleTarget[] {
  const sets = config.configSets || [];
  const activeId = config.activeConfigSetId || sets[0]?.id || '';
  const cycleableSets = sets.filter(
    (set) => set.id === activeId || Boolean(getConfigSetModel(set))
  );

  if (cycleableSets.length > 1) {
    return cycleableSets.map((set) => ({
      kind: 'set' as const,
      id: set.id,
      name: set.name,
      model: getConfigSetModel(set),
    }));
  }

  const currentModel = config.model?.trim() || (sets[0] ? getConfigSetModel(sets[0]) : '');
  const models: string[] = [];
  const seen = new Set<string>();
  for (const id of modelsForProvider(config.provider)) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    models.push(trimmed);
  }
  if (currentModel && !seen.has(currentModel)) {
    models.unshift(currentModel);
  }
  if (models.length <= 1) {
    return [];
  }
  return models.map((model) => ({ kind: 'model' as const, model }));
}

export function pickNextModelCycleTarget(
  targets: ModelCycleTarget[],
  current: { configSetId?: string; model?: string },
  direction: ModelCycleDirection
): ModelCycleTarget | undefined {
  if (targets.length <= 1) {
    return undefined;
  }

  let index = targets.findIndex((target) =>
    target.kind === 'set' ? target.id === current.configSetId : target.model === current.model
  );
  if (index === -1) {
    index = 0;
  }

  const delta = direction === 'forward' ? 1 : -1;
  const nextIndex = (index + delta + targets.length) % targets.length;
  return targets[nextIndex];
}

export async function applyModelCycleTarget(
  target: ModelCycleTarget,
  actions: ModelCycleActions
): Promise<void> {
  if (target.kind === 'set') {
    await actions.switchSet(target.id);
    return;
  }
  // config.save({ model }) writes the active config set's profile model.
  // SessionManager.reloadConfig / the next query then hot-swaps via setModel.
  await actions.saveModel(target.model);
}

export function createModelCycleKeydownHandler(
  options: ModelCycleHandlerOptions
): (event: ModelCycleKeyEvent) => void {
  return (event) => {
    const direction = matchModelCycleShortcut(event);
    if (!direction) {
      return;
    }

    if (options.cycleInFlight.current) {
      return;
    }

    const context = options.getContext();
    if (context.settingsOpen || context.configModalOpen || !context.config) {
      return;
    }

    const next = pickNextModelCycleTarget(
      listModelCycleTargets(context.config),
      {
        configSetId: context.config.activeConfigSetId,
        model: context.config.model,
      },
      direction
    );
    if (!next) {
      return;
    }

    // Consume the keystroke only when a cycle will actually run so Settings,
    // the config modal, and empty target lists do not swallow Ctrl/Cmd+P.
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();

    options.cycleInFlight.current = true;
    void applyModelCycleTarget(next, options)
      .then(() => {
        options.onCycled(next);
      })
      .catch((error) => {
        options.onError?.(error);
      })
      .finally(() => {
        options.cycleInFlight.current = false;
      });
  };
}
