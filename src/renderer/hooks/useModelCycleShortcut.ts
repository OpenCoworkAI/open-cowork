import { useEffect } from 'react';
import { useAppStore, type GlobalNotice } from '../store';
import { createModelCycleKeydownHandler, type ModelCycleTarget } from '../utils/model-cycle';

function noticeForCycledTarget(target: ModelCycleTarget): GlobalNotice {
  if (target.kind === 'set') {
    return {
      id: `notice-model-cycled-${Date.now()}`,
      type: 'success',
      message: `Switched to ${target.name} (${target.model})`,
      messageKey: 'chat.modelCycledSet',
      messageValues: { name: target.name, model: target.model },
    };
  }

  return {
    id: `notice-model-cycled-${Date.now()}`,
    type: 'success',
    message: `Switched model to ${target.model}`,
    messageKey: 'chat.modelCycled',
    messageValues: { model: target.model },
  };
}

/**
 * Desktop equivalent of the pi TUI's Ctrl+P / Shift+Ctrl+P model cycle.
 * Persists via config.switchSet / config.save so the next turn hot-swaps
 * through the existing AgentSession.setModel path in the agent runner.
 */
export function useModelCycleShortcut() {
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    const cycleInFlight = { current: false };
    const handler = createModelCycleKeydownHandler({
      getContext: () => {
        const state = useAppStore.getState();
        return {
          config: state.appConfig,
          settingsOpen: state.showSettings,
          configModalOpen: state.showConfigModal,
        };
      },
      cycleInFlight,
      switchSet: (id) => window.electronAPI.config.switchSet({ id }),
      saveModel: (model) => window.electronAPI.config.save({ model }),
      onCycled: (target) => {
        setGlobalNotice(noticeForCycledTarget(target));
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        setGlobalNotice({
          id: `notice-model-cycle-error-${Date.now()}`,
          type: 'error',
          message,
        });
      },
    });

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setGlobalNotice]);
}
