import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  Package,
  Power,
  PowerOff,
  Trash2,
  Plus,
  Loader2,
  FolderOpen,
  Globe,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Skill, PluginCatalogItemV2, InstalledPlugin, PluginComponentKind } from '../../types';
import { useAppStore } from '../../store';
import { SettingsContentSection } from './shared';
import type { LocalizedBanner } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsSkills({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const skillsStorageChangedAt = useAppStore((state) => state.skillsStorageChangedAt);
  const skillsStorageChangeEvent = useAppStore((state) => state.skillsStorageChangeEvent);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [storagePath, setStoragePath] = useState('');
  const [plugins, setPlugins] = useState<PluginCatalogItemV2[]>([]);
  const [installedPluginsByKey, setInstalledPluginsByKey] = useState<
    Record<string, InstalledPlugin>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [isPluginLoading, setIsPluginLoading] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [pluginActionKey, setPluginActionKey] = useState<string | null>(null);
  const [pluginToastMessage, setPluginToastMessage] = useState('');
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const pluginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const componentOrder: PluginComponentKind[] = ['skills', 'commands', 'agents', 'hooks', 'mcp'];

  function normalizePluginLookupKey(value: string | undefined): string {
    if (!value) {
      return '';
    }
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getCatalogLookupKeys(plugin: PluginCatalogItemV2): string[] {
    const keys = new Set<string>();
    const addKey = (value: string | undefined) => {
      if (!value) {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      keys.add(trimmed);
      keys.add(trimmed.toLowerCase());
      const normalized = normalizePluginLookupKey(trimmed);
      if (normalized) {
        keys.add(normalized);
      }
    };

    addKey(plugin.name);
    addKey(plugin.pluginId);

    const marketplaceId = plugin.pluginId?.split('@')[0];
    addKey(marketplaceId);

    return [...keys];
  }

  useEffect(() => {
    if (!skillsStorageChangeEvent) {
      return;
    }
    if (skillsStorageChangeEvent.reason === 'fallback') {
      setError({ text: t('skills.storagePathFallback') });
      return;
    }
    if (skillsStorageChangeEvent.reason === 'watcher_error') {
      setError({
        text: t('skills.storageWatcherError', {
          message: skillsStorageChangeEvent.message || '',
        }),
      });
    }
  }, [skillsStorageChangeEvent, t]);

  function showPluginInstallToast(message: string) {
    setPluginToastMessage(message);
    if (pluginToastTimerRef.current) {
      clearTimeout(pluginToastTimerRef.current);
    }
    pluginToastTimerRef.current = setTimeout(() => {
      setPluginToastMessage('');
      pluginToastTimerRef.current = null;
    }, 5000);
  }

  const loadSkills = useCallback(async (silent = false) => {
    try {
      const [skillsResult, storagePathResult] = await Promise.allSettled([
        window.electronAPI.skills.getAll(),
        window.electronAPI.skills.getStoragePath(),
      ]);
      const errors: string[] = [];

      if (skillsResult.status === 'fulfilled') {
        setSkills(skillsResult.value || []);
      } else {
        errors.push(
          skillsResult.reason instanceof Error
            ? skillsResult.reason.message
            : tRef.current('skills.failedToLoad')
        );
      }
      if (storagePathResult.status === 'fulfilled') {
        setStoragePath(storagePathResult.value || '');
      } else {
        errors.push(
          storagePathResult.reason instanceof Error
            ? storagePathResult.reason.message
            : tRef.current('skills.storagePathUnavailable')
        );
      }

      if (errors.length > 0) {
        throw new Error(errors.join(' | '));
      }

      if (!silent) {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      if (!silent) {
        setError({
          text:
            err instanceof Error && err.message
              ? `${tRef.current('skills.failedToLoad')}: ${err.message}`
              : tRef.current('skills.failedToLoad'),
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return () => {
        if (pluginToastTimerRef.current) {
          clearTimeout(pluginToastTimerRef.current);
        }
      };
    }

    void loadSkills();

    return () => {
      if (pluginToastTimerRef.current) {
        clearTimeout(pluginToastTimerRef.current);
      }
    };
  }, [isActive, loadSkills]);

  useEffect(() => {
    if (isElectron && isActive && skillsStorageChangedAt > 0) {
      void loadSkills(true);
    }
  }, [isActive, loadSkills, skillsStorageChangedAt]);

  async function loadPlugins() {
    try {
      setIsPluginLoading(true);
      const [catalog, installed] = await Promise.all([
        window.electronAPI.plugins.listCatalog({ installableOnly: false }),
        window.electronAPI.plugins.listInstalled(),
      ]);
      setPlugins(catalog || []);
      const nextInstalledByKey: Record<string, InstalledPlugin> = {};
      const addLookupKey = (key: string, plugin: InstalledPlugin) => {
        if (!key || nextInstalledByKey[key]) {
          return;
        }
        nextInstalledByKey[key] = plugin;
      };
      for (const plugin of installed || []) {
        const candidates = [
          plugin.name,
          plugin.name?.toLowerCase(),
          normalizePluginLookupKey(plugin.name),
          plugin.pluginId,
          plugin.pluginId?.toLowerCase(),
          normalizePluginLookupKey(plugin.pluginId),
        ].filter((value): value is string => Boolean(value));
        for (const key of candidates) {
          addLookupKey(key, plugin);
        }
      }
      setInstalledPluginsByKey(nextInstalledByKey);
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setIsPluginLoading(false);
    }
  }

  async function handleBrowsePlugins() {
    setIsPluginModalOpen(true);
    await loadPlugins();
  }

  async function handleInstall() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({
        type: 'folder.select',
        payload: {},
      });
      if (!folderPath) return;

      setIsLoading(true);
      const validation = await window.electronAPI.skills.validate(folderPath);

      if (!validation.valid) {
        setError({ text: `Invalid skill folder: ${validation.errors.join(', ')}` });
        return;
      }

      const result = await window.electronAPI.skills.install(folderPath);
      if (result.success) {
        await loadSkills();
        setError(null);
        setSuccess(null);
      }
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToInstall') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectStoragePath() {
    try {
      const folderPath = await window.electronAPI.invoke<string | null>({
        type: 'folder.select',
        payload: {},
      });
      if (!folderPath) return;

      setIsLoading(true);
      const result = await window.electronAPI.skills.setStoragePath(folderPath, true);
      if (result.success) {
        setStoragePath(result.path);
        await loadSkills(true);
        setError(null);
        setSuccess({
          text: t('skills.storagePathUpdated', {
            migrated: result.migratedCount,
            skipped: result.skippedCount,
          }),
        });
        setTimeout(() => setSuccess(null), 5000);
      }
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t('skills.storagePathUpdateFailed'),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenStoragePath() {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.skills.openStoragePath();
      if (!result.success) {
        setError({ text: result.error || t('skills.storagePathOpenFailed') });
        return;
      }
      setStoragePath(result.path);
      setError(null);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.storagePathOpenFailed') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRefreshSkills() {
    setIsLoading(true);
    try {
      await loadSkills();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(skillId: string, skillName: string) {
    if (!confirm(t('skills.deleteSkill', { name: skillName }))) return;

    setIsLoading(true);
    try {
      await window.electronAPI.skills.delete(skillId);
      await loadSkills();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToDelete') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled(skill: Skill) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.setEnabled(skill.id, !skill.enabled);
      await loadSkills();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.failedToToggle') });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleInstallPlugin(plugin: PluginCatalogItemV2) {
    const installTarget = plugin.pluginId ?? plugin.name;
    setPluginActionKey(`install:${installTarget}`);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.plugins.install(installTarget);
      await loadSkills();
      await loadPlugins();
      const message = t('skills.pluginInstallSuccess', { name: result.plugin.name });
      setSuccess({ text: message });
      showPluginInstallToast(message);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetPluginEnabled(plugin: InstalledPlugin, enabled: boolean) {
    setPluginActionKey(`enabled:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setEnabled(plugin.pluginId, enabled);
      await loadPlugins();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleSetComponentEnabled(
    plugin: InstalledPlugin,
    component: PluginComponentKind,
    enabled: boolean
  ) {
    setPluginActionKey(`component:${plugin.pluginId}:${component}`);
    setError(null);
    try {
      await window.electronAPI.plugins.setComponentEnabled(plugin.pluginId, component, enabled);
      await loadPlugins();
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  async function handleUninstallPlugin(plugin: InstalledPlugin) {
    if (!confirm(t('skills.pluginUninstall', { name: plugin.name }))) {
      return;
    }

    setPluginActionKey(`uninstall:${plugin.pluginId}`);
    setError(null);
    try {
      await window.electronAPI.plugins.uninstall(plugin.pluginId);
      await loadPlugins();
      showPluginInstallToast(t('skills.pluginUninstalled', { name: plugin.name }));
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : t('skills.pluginInstallFailed') });
    } finally {
      setPluginActionKey(null);
    }
  }

  const builtinSkills = skills.filter((s) => s.type === 'builtin');
  const customSkills = skills.filter((s) => s.type !== 'builtin');

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4" />
          {success.key ? t(success.key) : success.text}
        </div>
      )}

      <SettingsContentSection
        title={t('skills.storagePathTitle')}
        description={t('skills.storagePathHint')}
      >
        <div className="text-xs text-text-muted break-all">
          {storagePath || t('skills.storagePathUnavailable')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <button
            onClick={handleSelectStoragePath}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            {t('skills.selectStoragePath')}
          </button>
          <button
            onClick={handleOpenStoragePath}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <Globe className="w-4 h-4" />
            {t('skills.openStoragePath')}
          </button>
          <button
            onClick={handleRefreshSkills}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            {t('skills.refreshSkills')}
          </button>
        </div>
      </SettingsContentSection>

      {/* Built-in Skills */}
      <SettingsContentSection
        title={t('skills.builtinSkills')}
        description={t('skills.builtinSkillsDesc')}
      >
        {builtinSkills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onToggleEnabled={() => handleToggleEnabled(skill)}
            onDelete={null}
            isLoading={isLoading}
          />
        ))}
      </SettingsContentSection>

      {/* Custom Skills */}
      <SettingsContentSection
        title={t('skills.customSkills')}
        description={t('skills.installSkillsDesc')}
      >
        {customSkills.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('skills.noCustomSkills')}</p>
            <p className="text-sm mt-1">{t('skills.installSkillsDesc')}</p>
          </div>
        ) : (
          customSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggleEnabled={() => handleToggleEnabled(skill)}
              onDelete={() => handleDelete(skill.id, skill.name)}
              isLoading={isLoading}
            />
          ))
        )}
      </SettingsContentSection>

      <SettingsContentSection
        title={t('skills.pluginsTitle')}
        description={t('skills.pluginsDesc')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button
            onClick={handleBrowsePlugins}
            disabled={isLoading || isPluginLoading}
            className="w-full py-3 px-4 rounded-lg border border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            {isPluginLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Package className="w-5 h-5" />
            )}
            {t('skills.browsePlugins')}
          </button>
          <button
            onClick={handleInstall}
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-lg border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
            {t('skills.installSkillFromFolder')}
          </button>
        </div>
      </SettingsContentSection>

      {isPluginModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border border-border bg-surface shadow-elevated">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">
                {t('skills.pluginListTitle')}
              </h3>
              <button
                onClick={() => setIsPluginModalOpen(false)}
                className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh]">
              {isPluginLoading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-text-secondary">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t('common.loading')}</span>
                </div>
              ) : plugins.length === 0 ? (
                <div className="py-8 text-center text-text-muted">{t('skills.noPluginsFound')}</div>
              ) : (
                plugins.map((plugin) => (
                  <div
                    key={plugin.pluginId || plugin.name}
                    className="rounded-lg border border-border bg-surface-hover p-4"
                  >
                    {(() => {
                      const installedPlugin = getCatalogLookupKeys(plugin)
                        .map((key) => installedPluginsByKey[key])
                        .find((item): item is InstalledPlugin => Boolean(item));
                      const installTarget = plugin.pluginId ?? plugin.name;
                      const isInstalling = pluginActionKey === `install:${installTarget}`;
                      const componentEntries = componentOrder.filter(
                        (component) => plugin.componentCounts[component] > 0
                      );
                      const isMarketplaceCatalog = plugin.catalogSource === 'claude-marketplace';
                      const hasKnownComponents = componentEntries.length > 0;
                      const isInstallable = plugin.installable;
                      return (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium text-text-primary truncate">
                                  {plugin.name}
                                </h4>
                                {plugin.version && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-surface text-text-muted">
                                    v{plugin.version}
                                  </span>
                                )}
                              </div>
                              {plugin.description && (
                                <p className="text-sm text-text-muted line-clamp-2">
                                  {plugin.description}
                                </p>
                              )}
                              {hasKnownComponents ? (
                                <p className="text-xs text-text-muted mt-2">
                                  {t('skills.pluginComponents', {
                                    skills: plugin.componentCounts.skills,
                                    commands: plugin.componentCounts.commands,
                                    agents: plugin.componentCounts.agents,
                                    hooks: plugin.componentCounts.hooks,
                                    mcp: plugin.componentCounts.mcp,
                                  })}
                                </p>
                              ) : (
                                isMarketplaceCatalog &&
                                !installedPlugin && (
                                  <p className="text-xs text-text-muted mt-2">
                                    {t('skills.pluginComponentsAvailableAfterInstall')}
                                  </p>
                                )
                              )}
                              {hasKnownComponents &&
                                plugin.componentCounts.hooks > 0 &&
                                !installedPlugin && (
                                  <p className="text-xs text-warning mt-1">
                                    {t('skills.pluginComponentHooksDisabledByDefault')}
                                  </p>
                                )}
                              {hasKnownComponents &&
                                plugin.componentCounts.mcp > 0 &&
                                !installedPlugin && (
                                  <p className="text-xs text-warning mt-1">
                                    {t('skills.pluginComponentMcpDisabledByDefault')}
                                  </p>
                                )}
                              {!isInstallable && !isMarketplaceCatalog && (
                                <p className="text-xs text-error mt-1">
                                  {t('skills.pluginNoComponents')}
                                </p>
                              )}
                            </div>
                            {installedPlugin ? (
                              <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
                                <CheckCircle className="w-4 h-4" />
                                {t('skills.pluginInstalled')}
                              </span>
                            ) : (
                              <button
                                onClick={() => handleInstallPlugin(plugin)}
                                disabled={!isInstallable || pluginActionKey !== null}
                                className="px-3 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                              >
                                {isInstalling ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('common.install')}
                                  </span>
                                ) : (
                                  t('skills.pluginInstall')
                                )}
                              </button>
                            )}
                          </div>
                          {installedPlugin && (
                            <div className="mt-3 pt-3 border-t border-border space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-text-muted">
                                  {installedPlugin.enabled
                                    ? t('skills.pluginAppliedInRuntime')
                                    : t('skills.pluginDisabled')}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() =>
                                      handleSetPluginEnabled(
                                        installedPlugin,
                                        !installedPlugin.enabled
                                      )
                                    }
                                    disabled={pluginActionKey !== null}
                                    className={`px-3 py-1.5 rounded-md text-xs ${
                                      installedPlugin.enabled
                                        ? 'bg-warning/10 text-warning hover:bg-warning/20'
                                        : 'bg-success/10 text-success hover:bg-success/20'
                                    } disabled:opacity-50`}
                                  >
                                    {installedPlugin.enabled
                                      ? t('skills.pluginDisable')
                                      : t('skills.pluginEnable')}
                                  </button>
                                  <button
                                    onClick={() => handleUninstallPlugin(installedPlugin)}
                                    disabled={pluginActionKey !== null}
                                    className="px-3 py-1.5 rounded-md text-xs bg-error/10 text-error hover:bg-error/20 disabled:opacity-50"
                                  >
                                    {t('skills.pluginManageUninstall')}
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {componentEntries.map((component) => {
                                  const enabled = installedPlugin.componentsEnabled[component];
                                  return (
                                    <div
                                      key={`${installedPlugin.pluginId}:${component}`}
                                      className="flex items-center justify-between gap-2"
                                    >
                                      <div className="text-xs text-text-secondary">
                                        <span className="font-medium">{component}</span>
                                        <span className="text-text-muted">
                                          {' '}
                                          ({plugin.componentCounts[component]})
                                        </span>
                                      </div>
                                      <button
                                        onClick={() =>
                                          handleSetComponentEnabled(
                                            installedPlugin,
                                            component,
                                            !enabled
                                          )
                                        }
                                        disabled={pluginActionKey !== null}
                                        className={`px-2 py-1 rounded text-xs ${
                                          enabled
                                            ? 'bg-success/10 text-success hover:bg-success/20'
                                            : 'bg-surface text-text-muted hover:bg-surface-active'
                                        } disabled:opacity-50`}
                                      >
                                        {enabled
                                          ? t('skills.pluginDisable')
                                          : t('skills.pluginEnable')}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {pluginToastMessage && (
        <div className="fixed right-6 bottom-6 z-[80] max-w-md rounded-lg border border-success/30 bg-surface px-4 py-3 shadow-elevated">
          <div className="flex items-start gap-2 text-success text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{pluginToastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  onToggleEnabled,
  onDelete,
  isLoading,
}: {
  skill: Skill;
  onToggleEnabled: () => void;
  onDelete: (() => void) | null;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const isBuiltin = skill.type === 'builtin';

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`w-3 h-3 rounded-full ${skill.enabled ? 'bg-success' : 'bg-text-muted'}`}
            />
            <h3 className="font-medium text-text-primary">{skill.name}</h3>
            <span
              className={`px-2 py-0.5 text-xs rounded ${
                isBuiltin
                  ? 'bg-accent/10 text-accent'
                  : skill.type === 'mcp'
                    ? 'bg-mcp/10 text-mcp'
                    : 'bg-success/10 text-success'
              }`}
            >
              {skill.type.toUpperCase()}
            </span>
          </div>
          {skill.description && (
            <p className="text-sm text-text-muted ml-6 line-clamp-2">{skill.description}</p>
          )}
          {skill.compatibility && (
            <p className="text-xs text-text-muted ml-6 mt-2">
              {t('skills.compatibilityLabel', { defaultValue: '兼容性' })}: {skill.compatibility}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            disabled={isLoading}
            className={`p-2 rounded-lg transition-colors ${
              skill.enabled
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-surface-muted text-text-muted hover:bg-surface-active'
            }`}
            title={skill.enabled ? t('common.disable') : t('common.enable')}
          >
            {skill.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
              title={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
