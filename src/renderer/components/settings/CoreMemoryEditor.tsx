import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeCoreMemoryError, MAX_CORE_MEMORY_VALUE_LENGTH } from '../../../shared/core-memory';
import { stripIpcErrorPrefix } from '../../../shared/ipc-error';
import type { CoreMemoryListEntry, MemoryOverview } from '../../types';
import { SettingsContentSection } from './shared';

export function CoreMemoryEditor({
  overview,
  disabled,
  onChanged,
  onStatus,
}: {
  /** A new overview means core memory may have changed elsewhere (clear, rebuild). */
  overview: MemoryOverview | null;
  disabled: boolean;
  /** Called after a saved change; refreshing the rest of the page is the caller's job. */
  onChanged: () => void;
  onStatus: (status: string | null) => void;
}) {
  const { t } = useTranslation();
  const errorText = useCallback(
    (error: unknown) =>
      localizeCoreMemoryError(
        stripIpcErrorPrefix(error instanceof Error ? error.message : String(error)),
        t
      ),
    [t]
  );
  /** `null` until the first load succeeds; the empty state is only for a loaded, empty list. */
  const [entries, setEntries] = useState<CoreMemoryListEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.memory.getCoreEntries().then(
      (next) => {
        if (cancelled) return;
        setEntries(next);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(errorText(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [overview, errorText]);

  const run = async (action: () => Promise<CoreMemoryListEntry[]>, success: string) => {
    setIsSaving(true);
    onStatus(null);
    try {
      setEntries(await action());
      setLoadError(null);
      setEditingKey(null);
      onStatus(success);
      onChanged();
    } catch (error) {
      onStatus(errorText(error));
    } finally {
      setIsSaving(false);
    }
  };

  const busy = disabled || isSaving;

  return (
    <SettingsContentSection
      title={t('memory.coreEditorTitle')}
      description={t('memory.coreEditorDescription')}
    >
      {loadError && (
        <div className="rounded-lg border border-rose-300/60 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {t('memory.coreEditorLoadFailed', { error: loadError })}
        </div>
      )}
      {entries === null ? null : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-muted bg-background/50 p-3 text-sm text-text-muted">
          {t('memory.coreEditorEmpty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.combinedKey}
              className="rounded-lg border border-border-muted bg-background/80 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  {t(`memory.coreCategory.${entry.category ?? 'other'}`)}
                </span>
                <span className="text-sm font-medium text-text-primary">{entry.key}</span>
                {entry.userWritten && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    {t('memory.coreUserWritten')}
                  </span>
                )}
              </div>
              {editingKey === entry.combinedKey ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                    maxLength={MAX_CORE_MEMORY_VALUE_LENGTH}
                    aria-label={t('memory.coreValueLabel', { key: entry.key })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        void run(
                          () => window.electronAPI.memory.writeCoreEntry(entry.combinedKey, draft),
                          t('memory.coreSaved')
                        );
                      }}
                      disabled={busy || !draft.trim()}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('common.save')}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      disabled={isSaving}
                      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">
                    {entry.value}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => {
                        setEditingKey(entry.combinedKey);
                        setDraft(entry.value);
                      }}
                      disabled={busy}
                      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => {
                        if (!window.confirm(t('memory.coreForgetConfirm', { key: entry.key }))) {
                          return;
                        }
                        void run(
                          () => window.electronAPI.memory.forgetCoreEntry(entry.combinedKey),
                          t('memory.coreForgotten')
                        );
                      }}
                      disabled={busy}
                      className="rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
                    >
                      {t('memory.coreForget')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsContentSection>
  );
}
