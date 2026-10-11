import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryInspectSessionResult,
  MemoryOverview,
  MemoryReadResult,
  MemoryRuntimeConfig,
  MemorySearchResult,
  MemorySearchScope,
} from '../../types';
import { useAppStore } from '../../store';
import { SettingsContentSection } from './shared';

type SearchMode = 'workspace' | 'all' | 'global';

const DEFAULT_MEMORY_RUNTIME: MemoryRuntimeConfig = {
  llm: {
    inheritFromActive: true,
    apiKey: '',
    baseUrl: '',
    model: '',
    timeoutMs: 180000,
  },
  embedding: {
    inheritFromActive: true,
    apiKey: '',
    baseUrl: '',
    model: 'text-embedding-3-small',
    timeoutMs: 180000,
  },
  useEmbedding: false,
  maxNavSteps: 2,
  ingestionConcurrency: 4,
  storageRoot: '',
  evalEnabled: false,
  evalWorkspaces: [],
  evalMaxRounds: 12,
  evalArtifactsRoot: '',
  promptIterationRounds: 2,
};

function cloneRuntimeConfig(runtime?: MemoryRuntimeConfig): MemoryRuntimeConfig {
  const source = runtime || DEFAULT_MEMORY_RUNTIME;
  return {
    llm: { ...DEFAULT_MEMORY_RUNTIME.llm, ...source.llm },
    embedding: { ...DEFAULT_MEMORY_RUNTIME.embedding, ...source.embedding },
    useEmbedding: source.useEmbedding ?? DEFAULT_MEMORY_RUNTIME.useEmbedding,
    maxNavSteps: source.maxNavSteps ?? DEFAULT_MEMORY_RUNTIME.maxNavSteps,
    ingestionConcurrency:
      source.ingestionConcurrency ?? DEFAULT_MEMORY_RUNTIME.ingestionConcurrency,
    storageRoot: source.storageRoot ?? DEFAULT_MEMORY_RUNTIME.storageRoot,
    evalEnabled: source.evalEnabled ?? DEFAULT_MEMORY_RUNTIME.evalEnabled,
    evalWorkspaces: Array.isArray(source.evalWorkspaces)
      ? [...source.evalWorkspaces]
      : [...(DEFAULT_MEMORY_RUNTIME.evalWorkspaces || [])],
    evalMaxRounds: source.evalMaxRounds ?? DEFAULT_MEMORY_RUNTIME.evalMaxRounds,
    evalArtifactsRoot: source.evalArtifactsRoot ?? DEFAULT_MEMORY_RUNTIME.evalArtifactsRoot,
    promptIterationRounds:
      source.promptIterationRounds ?? DEFAULT_MEMORY_RUNTIME.promptIterationRounds,
  };
}

export function SettingsMemory() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const workingDir = useAppStore((state) => state.workingDir);
  const appConfig = useAppStore((state) => state.appConfig);

  const currentSession = sessions.find((session) => session.id === activeSessionId);
  const currentWorkspace = currentSession?.cwd || workingDir || '';
  const hasWorkspace = Boolean(currentWorkspace);

  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchMode>(currentWorkspace ? 'workspace' : 'all');
  const [sourceWorkspaceFilter, setSourceWorkspaceFilter] = useState<string>('');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [selected, setSelected] = useState<MemoryReadResult | null>(null);
  const [inspectedSession, setInspectedSession] = useState<MemoryInspectSessionResult | null>(null);
  const [files, setFiles] = useState<MemoryDebugFileInfo[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<MemoryDebugFileContent | null>(null);
  const [runtimeDraft, setRuntimeDraft] = useState<MemoryRuntimeConfig>(
    cloneRuntimeConfig(appConfig?.memoryRuntime)
  );
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const enabled = overview?.enabled ?? appConfig?.memoryEnabled ?? true;

  const groupedResults = useMemo(() => {
    return {
      core: results.filter((item) => item.kind === 'core'),
      sessions: results.filter((item) => item.kind === 'experience_session'),
      chunks: results.filter((item) => item.kind === 'experience_chunk'),
      raw: results.filter((item) => item.kind === 'raw_session'),
    };
  }, [results]);

  useEffect(() => {
    setRuntimeDraft(cloneRuntimeConfig(appConfig?.memoryRuntime));
  }, [appConfig?.memoryRuntime]);

  useEffect(() => {
    if (!hasWorkspace && scope === 'workspace') {
      setScope('all');
    }
  }, [hasWorkspace, scope]);

  const refreshOverview = async () => {
    const nextOverview = await window.electronAPI.memory.getOverview(currentWorkspace || undefined);
    setOverview(nextOverview);
  };

  const refreshFiles = async () => {
    const nextFiles = await window.electronAPI.memory.listFiles();
    setFiles(nextFiles);
    if (selectedFilePath && nextFiles.some((item) => item.filePath === selectedFilePath)) {
      const nextContent = await window.electronAPI.memory.readFile(selectedFilePath);
      setFileContent(nextContent);
    } else {
      setSelectedFilePath(null);
      setFileContent(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextOverview, nextFiles] = await Promise.all([
          window.electronAPI.memory.getOverview(currentWorkspace || undefined),
          window.electronAPI.memory.listFiles(),
        ]);
        if (!cancelled) {
          setOverview(nextOverview);
          setFiles(nextFiles);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentWorkspace]);

  const handleToggle = async () => {
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.setEnabled(!enabled);
      await refreshOverview();
      setStatus(!enabled ? t('memory.enabledStatus') : t('memory.disabledStatus'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSelected(null);
      setInspectedSession(null);
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      const nextResults = await window.electronAPI.memory.search({
        query: trimmed,
        cwd: hasWorkspace ? currentWorkspace : undefined,
        scope: scope as MemorySearchScope,
        sourceWorkspace:
          scope === 'workspace' && hasWorkspace
            ? currentWorkspace
            : sourceWorkspaceFilter || undefined,
        limit: 20,
      });
      setResults(nextResults);
      if (nextResults.length > 0) {
        const detail = await window.electronAPI.memory.read(nextResults[0].id);
        setSelected(detail);
        setInspectedSession(null);
      } else {
        setSelected(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectResult = async (id: string) => {
    setIsBusy(true);
    setStatus(null);
    try {
      const detail = await window.electronAPI.memory.read(id);
      setSelected(detail);
      setInspectedSession(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleInspectSession = async (sessionId: string, workspaceKey?: string) => {
    setIsBusy(true);
    setStatus(null);
    try {
      const detail = await window.electronAPI.memory.inspectSession(sessionId, workspaceKey);
      setInspectedSession(detail);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectFile = async (filePath: string) => {
    setIsBusy(true);
    setStatus(null);
    try {
      const nextContent = await window.electronAPI.memory.readFile(filePath);
      setSelectedFilePath(filePath);
      setFileContent(nextContent);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveRuntime = async () => {
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.config.save({
        memoryRuntime: runtimeDraft,
      });
      await refreshOverview();
      setStatus(t('memory.runtimeSaved'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRebuildWorkspace = async () => {
    if (!currentWorkspace) {
      return;
    }
    if (!window.confirm(t('memory.rebuildConfirm'))) {
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.rebuildWorkspace(currentWorkspace);
      await Promise.all([refreshOverview(), refreshFiles()]);
      setStatus(t('memory.rebuildSuccess'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRebuildAll = async () => {
    if (!window.confirm(t('memory.rebuildAllConfirm'))) {
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      const result = await window.electronAPI.memory.rebuildAll();
      await Promise.all([refreshOverview(), refreshFiles()]);
      setStatus(
        t('memory.rebuildAllSuccess', {
          sessionCount: result.sessionCount,
          workspaceCount: result.workspaceCount,
        })
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearWorkspace = async () => {
    if (!currentWorkspace) {
      return;
    }
    if (!window.confirm(t('memory.clearWorkspaceConfirm'))) {
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.clearWorkspace(currentWorkspace);
      setResults([]);
      setSelected(null);
      setInspectedSession(null);
      await Promise.all([refreshOverview(), refreshFiles()]);
      setStatus(t('memory.clearWorkspaceSuccess'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearCore = async () => {
    if (!window.confirm(t('memory.clearCoreConfirm'))) {
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.clearCoreMemory();
      setResults([]);
      setSelected(null);
      await Promise.all([refreshOverview(), refreshFiles()]);
      setStatus(t('memory.clearCoreSuccess'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsContentSection title={t('memory.title')} description={t('memory.description')}>
        <div className="flex flex-col gap-3 rounded-xl border border-border-muted bg-background-secondary/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {enabled ? t('memory.enabled') : t('memory.disabled')}
              </p>
              <p className="mt-1 text-xs text-text-muted">{t('memory.toggleHint')}</p>
            </div>
            <button
              onClick={() => {
                void handleToggle();
              }}
              disabled={isBusy}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                enabled
                  ? 'bg-accent text-white hover:opacity-90'
                  : 'bg-surface hover:bg-surface-hover text-text-primary border border-border'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {enabled ? t('memory.disableAction') : t('memory.enableAction')}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('memory.coreCount')} value={overview?.coreCount ?? 0} />
            <MetricCard
              label={t('memory.sessionCount')}
              value={overview?.experienceSessionCount ?? 0}
            />
            <MetricCard
              label={t('memory.chunkCount')}
              value={overview?.experienceChunkCount ?? 0}
            />
            <MetricCard
              label={t('memory.workspaceCount')}
              value={overview?.sourceWorkspaceCount ?? 0}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard
              label={t('memory.latestIngestion')}
              value={
                overview?.latestIngestionAt
                  ? new Date(overview.latestIngestionAt).toLocaleString()
                  : t('memory.noIngestionYet')
              }
            />
            <InfoCard
              label={t('memory.health')}
              value={
                overview?.failedSessionCount
                  ? t('memory.failedSessions', { count: overview.failedSessionCount })
                  : t('memory.healthy')
              }
              secondary={overview?.latestError || undefined}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard
              label={t('memory.storageRoot')}
              value={overview?.storageRoot || runtimeDraft.storageRoot || 'Default userData/memory'}
            />
            <InfoCard
              label={t('memory.currentWorkspace')}
              value={currentWorkspace || t('memory.noWorkspace')}
              secondary={
                overview?.topSourceWorkspaces?.length
                  ? `Top sources: ${overview.topSourceWorkspaces
                      .slice(0, 3)
                      .map(
                        (item) => `${item.workspaceKey} (${item.sessionCount}/${item.chunkCount})`
                      )
                      .join(' · ')}`
                  : undefined
              }
            />
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('memory.runtimeTitle')}
        description={t('memory.runtimeDescription')}
      >
        <div className="space-y-4 rounded-xl border border-border-muted bg-background-secondary/60 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <LabeledField label={t('memory.storageRoot')}>
              <input
                value={runtimeDraft.storageRoot || ''}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({ ...prev, storageRoot: event.target.value }))
                }
                placeholder={overview?.storageRoot || ''}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
            <LabeledField label={t('memory.maxNavSteps')}>
              <input
                type="number"
                min={0}
                max={4}
                value={runtimeDraft.maxNavSteps}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    maxNavSteps: Number(event.target.value || 0),
                  }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
            <LabeledField label={t('memory.ingestionConcurrency')}>
              <input
                type="number"
                min={1}
                max={16}
                value={runtimeDraft.ingestionConcurrency}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    ingestionConcurrency: Number(event.target.value || 1),
                  }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
            <ToggleField
              label={t('memory.useEmbedding')}
              checked={runtimeDraft.useEmbedding}
              onChange={(checked) =>
                setRuntimeDraft((prev) => ({
                  ...prev,
                  useEmbedding: checked,
                }))
              }
            />
            <ToggleField
              label={t('memory.evalEnabled')}
              checked={runtimeDraft.evalEnabled ?? false}
              onChange={(checked) =>
                setRuntimeDraft((prev) => ({
                  ...prev,
                  evalEnabled: checked,
                }))
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <LabeledField label={t('memory.evalArtifactsRoot')}>
              <input
                value={runtimeDraft.evalArtifactsRoot || ''}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({ ...prev, evalArtifactsRoot: event.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
            <LabeledField label={t('memory.evalMaxRounds')}>
              <input
                type="number"
                min={1}
                max={100}
                value={runtimeDraft.evalMaxRounds ?? 12}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    evalMaxRounds: Number(event.target.value || 12),
                  }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
            <LabeledField label={t('memory.promptIterationRounds')}>
              <input
                type="number"
                min={0}
                max={10}
                value={runtimeDraft.promptIterationRounds ?? 2}
                onChange={(event) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    promptIterationRounds: Number(event.target.value || 2),
                  }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
            </LabeledField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border-muted bg-background/80 p-3">
              <p className="text-sm font-medium text-text-primary">{t('memory.llmConfig')}</p>
              <ToggleField
                label={t('memory.inheritActive')}
                checked={runtimeDraft.llm.inheritFromActive}
                onChange={(checked) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    llm: { ...prev.llm, inheritFromActive: checked },
                  }))
                }
              />
              <LabeledField label={t('memory.modelOverride')}>
                <input
                  value={runtimeDraft.llm.model || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      llm: { ...prev.llm, model: event.target.value },
                    }))
                  }
                  placeholder={appConfig?.model || ''}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
              <LabeledField label={t('memory.baseUrlOverride')}>
                <input
                  value={runtimeDraft.llm.baseUrl || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      llm: { ...prev.llm, baseUrl: event.target.value },
                    }))
                  }
                  placeholder={appConfig?.baseUrl || ''}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
              <LabeledField label={t('memory.apiKeyOverride')}>
                <input
                  type="password"
                  value={runtimeDraft.llm.apiKey || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      llm: { ...prev.llm, apiKey: event.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
            </div>
            <div className="space-y-3 rounded-lg border border-border-muted bg-background/80 p-3">
              <p className="text-sm font-medium text-text-primary">{t('memory.embeddingConfig')}</p>
              <ToggleField
                label={t('memory.inheritActive')}
                checked={runtimeDraft.embedding.inheritFromActive}
                onChange={(checked) =>
                  setRuntimeDraft((prev) => ({
                    ...prev,
                    embedding: { ...prev.embedding, inheritFromActive: checked },
                  }))
                }
              />
              <LabeledField label={t('memory.modelOverride')}>
                <input
                  value={runtimeDraft.embedding.model || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      embedding: { ...prev.embedding, model: event.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
              <LabeledField label={t('memory.baseUrlOverride')}>
                <input
                  value={runtimeDraft.embedding.baseUrl || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      embedding: { ...prev.embedding, baseUrl: event.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
              <LabeledField label={t('memory.apiKeyOverride')}>
                <input
                  type="password"
                  value={runtimeDraft.embedding.apiKey || ''}
                  onChange={(event) =>
                    setRuntimeDraft((prev) => ({
                      ...prev,
                      embedding: { ...prev.embedding, apiKey: event.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </LabeledField>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                void handleSaveRuntime();
              }}
              disabled={isBusy}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('memory.saveRuntime')}
            </button>
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('memory.searchTitle')}
        description={t('memory.searchDescription')}
      >
        <div className="space-y-3 rounded-xl border border-border-muted bg-background-secondary/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('memory.searchPlaceholder')}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as SearchMode)}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none"
            >
              {hasWorkspace && <option value="workspace">{t('memory.scopeWorkspace')}</option>}
              <option value="all">{t('memory.scopeAll')}</option>
              <option value="global">{t('memory.scopeGlobal')}</option>
            </select>
            <select
              value={sourceWorkspaceFilter}
              onChange={(event) => setSourceWorkspaceFilter(event.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none"
            >
              <option value="">{t('memory.allSources')}</option>
              {overview?.topSourceWorkspaces?.map((item) => (
                <option key={item.workspaceKey} value={item.workspaceKey}>
                  {item.workspaceKey}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                void handleSearch();
              }}
              disabled={isBusy || !query.trim()}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('memory.searchAction')}
            </button>
          </div>
          {hasWorkspace && (
            <p className="text-xs text-text-muted">
              {t('memory.currentWorkspace')}: {currentWorkspace}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <ResultGroup
                title={t('memory.groupCore')}
                items={groupedResults.core}
                selectedId={selected?.id || null}
                onSelect={handleSelectResult}
                emptyLabel={t('memory.noResults')}
              />
              <ResultGroup
                title={t('memory.groupSessions')}
                items={groupedResults.sessions}
                selectedId={selected?.id || null}
                onSelect={handleSelectResult}
                emptyLabel={t('memory.noResults')}
              />
              <ResultGroup
                title={t('memory.groupChunks')}
                items={groupedResults.chunks}
                selectedId={selected?.id || null}
                onSelect={handleSelectResult}
                emptyLabel={t('memory.noResults')}
              />
              <ResultGroup
                title={t('memory.groupRawSessions')}
                items={groupedResults.raw}
                selectedId={selected?.id || null}
                onSelect={handleSelectResult}
                emptyLabel={t('memory.noResults')}
              />
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-border-muted bg-background/80 p-4">
                <p className="text-sm font-semibold text-text-primary">{t('memory.detailTitle')}</p>
                {selected ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-text-muted">
                        {selected.kind}
                      </p>
                      <p className="mt-1 text-sm font-medium text-text-primary">{selected.title}</p>
                    </div>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {selected.summary}
                    </p>
                    {selected.sourceFile && (
                      <p className="text-xs text-text-muted">
                        {t('memory.sourceFile')}: {selected.sourceFile}
                      </p>
                    )}
                    {selected.sessionId && (
                      <button
                        onClick={() => {
                          void handleInspectSession(
                            selected.sessionId!,
                            selected.sourceWorkspace || selected.workspaceKey
                          );
                        }}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-text-primary"
                      >
                        {t('memory.inspectSession')}
                      </button>
                    )}
                    {selected.details && (
                      <pre className="max-h-56 overflow-auto rounded-lg bg-background-secondary/80 p-3 text-xs leading-5 text-text-secondary whitespace-pre-wrap">
                        {selected.details}
                      </pre>
                    )}
                    {selected.rawText && (
                      <pre className="max-h-64 overflow-auto rounded-lg bg-background-secondary/80 p-3 text-xs leading-5 text-text-secondary whitespace-pre-wrap">
                        {selected.rawText}
                      </pre>
                    )}
                    {selected.sourceExcerpt && (
                      <div className="rounded-lg border border-border-muted bg-background-secondary/60 p-3 text-xs text-text-secondary whitespace-pre-wrap">
                        {selected.sourceExcerpt}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-muted">{t('memory.noSelection')}</p>
                )}
              </div>

              <div className="rounded-xl border border-border-muted bg-background/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text-primary">
                    {t('memory.inspectSession')}
                  </p>
                  {inspectedSession?.filePath && (
                    <button
                      onClick={() => {
                        void window.electronAPI.showItemInFolder(inspectedSession.filePath);
                      }}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-text-primary"
                    >
                      {t('memory.revealInFinder')}
                    </button>
                  )}
                </div>
                {inspectedSession ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-border-muted bg-background-secondary/60 p-3">
                      <p className="text-xs text-text-muted">
                        {inspectedSession.sourceWorkspace || t('memory.noWorkspace')}
                      </p>
                      <p className="mt-1 text-sm font-medium text-text-primary">
                        {inspectedSession.session.summary}
                      </p>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-background-secondary/80 p-3 text-xs leading-5 text-text-secondary whitespace-pre-wrap">
                      {JSON.stringify(inspectedSession.session.rawSession, null, 2)}
                    </pre>
                    <div className="space-y-2">
                      {inspectedSession.chunks.map((chunk) => (
                        <div
                          key={chunk.id}
                          className="rounded-lg border border-border-muted bg-background-secondary/60 p-3"
                        >
                          <p className="text-sm font-medium text-text-primary">{chunk.summary}</p>
                          <p className="mt-1 text-xs text-text-muted">
                            turns: {chunk.sourceTurns.join(', ')}
                          </p>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                            {chunk.rawText}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-muted">{t('memory.inspectSessionHint')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('memory.filesTitle')}
        description={t('memory.filesDescription')}
      >
        <div className="grid gap-4 rounded-xl border border-border-muted bg-background-secondary/60 p-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {t('memory.fileList')}
              </p>
              <button
                onClick={() => {
                  void refreshFiles();
                }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-text-primary"
              >
                {t('memory.refreshFiles')}
              </button>
            </div>
            {files.length > 0 ? (
              files.map((file) => (
                <button
                  key={file.filePath}
                  onClick={() => {
                    void handleSelectFile(file.filePath);
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedFilePath === file.filePath
                      ? 'border-accent bg-accent/5'
                      : 'border-border-muted bg-background/80 hover:bg-surface-hover'
                  }`}
                >
                  <p className="text-sm font-medium text-text-primary">{file.label}</p>
                  <p className="mt-1 text-xs text-text-muted">{file.filePath}</p>
                  <p className="mt-2 text-[11px] text-text-muted">
                    {file.sizeBytes} bytes
                    {typeof file.sessionCount === 'number'
                      ? ` · ${file.sessionCount} sessions`
                      : ''}
                    {typeof file.chunkCount === 'number' ? ` · ${file.chunkCount} chunks` : ''}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border-muted bg-background/50 p-3 text-sm text-text-muted">
                {t('memory.noFiles')}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-muted bg-background/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">{t('memory.fileContent')}</p>
                {fileContent?.filePath && (
                  <p className="mt-1 text-xs text-text-muted">{fileContent.filePath}</p>
                )}
              </div>
              {fileContent?.filePath && (
                <button
                  onClick={() => {
                    void window.electronAPI.showItemInFolder(fileContent.filePath);
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-text-primary"
                >
                  {t('memory.revealInFinder')}
                </button>
              )}
            </div>
            {fileContent ? (
              <pre className="mt-3 max-h-[34rem] overflow-auto rounded-lg bg-background-secondary/80 p-3 text-xs leading-5 text-text-secondary whitespace-pre-wrap">
                {fileContent.parsed
                  ? JSON.stringify(fileContent.parsed, null, 2)
                  : fileContent.text || t('memory.emptyFile')}
              </pre>
            ) : (
              <p className="mt-3 text-sm text-text-muted">{t('memory.selectFileHint')}</p>
            )}
          </div>
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('memory.maintenanceTitle')}
        description={t('memory.maintenanceDescription')}
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              void handleRebuildWorkspace();
            }}
            disabled={!hasWorkspace || isBusy}
            className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('memory.rebuildWorkspace')}
          </button>
          <button
            onClick={() => {
              void handleRebuildAll();
            }}
            disabled={isBusy}
            className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('memory.rebuildAll')}
          </button>
          <button
            onClick={() => {
              void handleClearWorkspace();
            }}
            disabled={!hasWorkspace || isBusy}
            className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {t('memory.clearWorkspace')}
          </button>
          <button
            onClick={() => {
              void handleClearCore();
            }}
            disabled={isBusy}
            className="rounded-lg border border-rose-300/60 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
          >
            {t('memory.clearCore')}
          </button>
        </div>
      </SettingsContentSection>

      {status && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/70 px-4 py-3 text-sm text-text-secondary">
          {status}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-muted bg-background/80 p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function InfoCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-lg border border-border-muted bg-background/80 p-3 text-xs text-text-muted">
      <p className="font-medium text-text-secondary">{label}</p>
      <p className="mt-1 break-all">{value}</p>
      {secondary ? <p className="mt-2 break-all text-rose-500">{secondary}</p> : null}
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border-muted bg-background/70 px-3 py-2.5">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function ResultGroup({
  title,
  items,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  title: string;
  items: MemorySearchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void | Promise<void>;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{title}</p>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                void onSelect(item.id);
              }}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selectedId === item.id
                  ? 'border-accent bg-accent/5'
                  : 'border-border-muted bg-background/80 hover:bg-surface-hover'
              }`}
            >
              <p className="text-sm font-medium text-text-primary">{item.title}</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">{item.contentPreview}</p>
              {(item.sourceWorkspace || item.sourceSessionTitle) && (
                <p className="mt-2 text-[11px] text-text-muted">
                  {[item.sourceWorkspace, item.sourceSessionTitle].filter(Boolean).join(' · ')}
                </p>
              )}
              {item.sourceFile && (
                <p className="mt-2 text-[11px] text-text-muted">{item.sourceFile}</p>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-muted bg-background/50 p-3 text-sm text-text-muted">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
