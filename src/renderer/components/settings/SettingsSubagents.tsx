import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { DEFAULT_SUBAGENT_CONFIG, type SubagentPreset } from '../../../shared/subagent-config';

const fieldClass = 'w-full px-3 py-2 rounded-lg bg-background border border-border text-sm';

export function SettingsSubagents() {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const setAppConfig = useAppStore((state) => state.setAppConfig);
  const [draft, setDraft] = useState(() =>
    structuredClone(appConfig?.subagent ?? DEFAULT_SUBAGENT_CONFIG)
  );
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    setDraft(structuredClone(appConfig?.subagent ?? DEFAULT_SUBAGENT_CONFIG));
  }, [appConfig?.subagent]);
  const preset = draft.presets[selected];
  const concurrencyValid =
    Number.isInteger(draft.maxConcurrent) && draft.maxConcurrent >= 1 && draft.maxConcurrent <= 8;
  const missingInstructions = draft.presets.filter((entry) => !entry.prompt.trim());
  const hiddenMissingInstructions = missingInstructions.filter((entry) => entry !== preset);

  function updatePreset(updates: Partial<SubagentPreset>) {
    setDraft((current) => ({
      ...current,
      defaultAgent:
        updates.name !== undefined && current.defaultAgent === preset.name
          ? updates.name
          : current.defaultAgent,
      presets: current.presets.map((entry, index) =>
        index === selected ? { ...entry, ...updates } : entry
      ),
    }));
  }

  async function save() {
    setBusy(true);
    setStatus('');
    try {
      const result = await window.electronAPI.config.save({
        subagent: {
          ...draft,
          presets: draft.presets.map((entry) => ({
            ...entry,
            allowedTools: entry.allowedTools?.map((name) => name.trim()).filter(Boolean),
          })),
        },
      });
      setAppConfig(result.config);
      setStatus(t('subagentSettings.saved'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {appConfig?.subagentConfigError && (
        <p role="alert" className="text-sm text-error break-words">
          {t('subagentSettings.invalidConfig', { error: appConfig.subagentConfigError })}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span>{t('subagentSettings.model')}</span>
          <input
            aria-label={t('subagentSettings.model')}
            className={fieldClass}
            value={draft.model}
            placeholder={appConfig?.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{t('subagentSettings.concurrency')}</span>
          <input
            aria-label={t('subagentSettings.concurrency')}
            type="number"
            min={1}
            max={8}
            step={1}
            required
            aria-invalid={!concurrencyValid}
            aria-describedby={concurrencyValid ? undefined : 'subagent-concurrency-error'}
            className={fieldClass}
            value={Number.isNaN(draft.maxConcurrent) ? '' : draft.maxConcurrent}
            onChange={(event) => setDraft({ ...draft, maxConcurrent: event.target.valueAsNumber })}
          />
          {!concurrencyValid && (
            <span id="subagent-concurrency-error" role="alert" className="block text-xs text-error">
              {t('subagentSettings.concurrencyInvalid')}
            </span>
          )}
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span>{t('subagentSettings.defaultRole')}</span>
          <select
            aria-label={t('subagentSettings.defaultRole')}
            className={fieldClass}
            value={draft.defaultAgent}
            onChange={(event) => setDraft({ ...draft, defaultAgent: event.target.value })}
          >
            <option value="">{t('subagentSettings.generalRole')}</option>
            {draft.presets.map((entry, index) => (
              <option key={index} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="flex-1 text-sm space-y-1">
            <span>{t('subagentSettings.roles')}</span>
            <select
              aria-label={t('subagentSettings.roles')}
              className={fieldClass}
              value={selected}
              onChange={(event) => setSelected(Number(event.target.value))}
            >
              {draft.presets.map((entry, index) => (
                <option key={index} value={index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={t('subagentSettings.add')}
            title={t('subagentSettings.add')}
            className="p-2 rounded-lg hover:bg-surface-hover"
            onClick={() => {
              let number = draft.presets.length + 1;
              while (draft.presets.some((entry) => entry.name === `agent-${number}`)) number++;
              setDraft({
                ...draft,
                presets: [
                  ...draft.presets,
                  { name: `agent-${number}`, description: '', prompt: '', model: '' },
                ],
              });
              setSelected(draft.presets.length);
            }}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!preset}
            aria-label={t('subagentSettings.remove')}
            title={t('subagentSettings.remove')}
            className="p-2 rounded-lg hover:bg-error/10 text-error disabled:opacity-50"
            onClick={() => {
              setDraft({
                ...draft,
                defaultAgent: draft.defaultAgent === preset.name ? '' : draft.defaultAgent,
                presets: draft.presets.filter((_, index) => index !== selected),
              });
              setSelected(0);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        {hiddenMissingInstructions.length > 0 && (
          <p role="alert" className="text-sm text-error break-words">
            {t('subagentSettings.incompleteAgents', {
              agents: hiddenMissingInstructions.map((entry) => entry.name).join(', '),
            })}
          </p>
        )}
        {preset && (
          <>
            <label className="block text-sm space-y-1">
              <span>{t('subagentSettings.name')}</span>
              <input
                aria-label={t('subagentSettings.name')}
                className={fieldClass}
                value={preset.name}
                onChange={(event) => updatePreset({ name: event.target.value })}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('subagentSettings.description')}</span>
              <input
                aria-label={t('subagentSettings.description')}
                className={fieldClass}
                value={preset.description}
                onChange={(event) => updatePreset({ description: event.target.value })}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('subagentSettings.roleModel')}</span>
              <input
                aria-label={t('subagentSettings.roleModel')}
                className={fieldClass}
                value={preset.model}
                placeholder={draft.model || appConfig?.model}
                onChange={(event) => updatePreset({ model: event.target.value })}
              />
            </label>
            <label className="block text-sm space-y-1">
              <span>{t('subagentSettings.instructions')}</span>
              <textarea
                aria-label={t('subagentSettings.instructions')}
                className={fieldClass}
                rows={4}
                required
                aria-invalid={!preset.prompt.trim()}
                aria-describedby={preset.prompt.trim() ? undefined : 'subagent-instructions-error'}
                value={preset.prompt}
                onChange={(event) => updatePreset({ prompt: event.target.value })}
              />
              {!preset.prompt.trim() && (
                <span
                  id="subagent-instructions-error"
                  role="alert"
                  className="block text-xs text-error"
                >
                  {t('subagentSettings.instructionsRequired')}
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={preset.allowedTools !== undefined}
                onChange={(event) =>
                  updatePreset({ allowedTools: event.target.checked ? [] : undefined })
                }
              />
              {t('subagentSettings.restrictTools')}
            </label>
            {preset.allowedTools !== undefined && (
              <label className="block text-sm space-y-1">
                <span>{t('subagentSettings.tools')}</span>
                <input
                  aria-label={t('subagentSettings.tools')}
                  className={fieldClass}
                  value={preset.allowedTools.join(',')}
                  onChange={(event) =>
                    updatePreset({
                      allowedTools: event.target.value.split(','),
                    })
                  }
                />
                {preset.allowedTools.every((name) => !name.trim()) && (
                  <span role="status" className="block text-xs text-text-muted">
                    {t('subagentSettings.noTools')}
                  </span>
                )}
              </label>
            )}
          </>
        )}
      </div>
      {status && (
        <p role="status" className="text-sm break-words">
          {status}
        </p>
      )}
      <button
        disabled={busy || !concurrencyValid || missingInstructions.length > 0}
        onClick={save}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {t('subagentSettings.save')}
      </button>
    </div>
  );
}
