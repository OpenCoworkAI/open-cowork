import { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Plug,
  Shield,
  Package,
  Clock3,
  Wifi,
  AlertCircle,
  Globe,
  BrainCircuit,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWindowSize } from '../hooks/useWindowSize';
import { Button, IconButton } from './ui';
import { RemoteControlPanel } from './RemoteControlPanel';
import { useAppStore } from '../store';
import { SettingsAPI } from './settings/SettingsAPI';
import { SettingsSandbox } from './settings/SettingsSandbox';
import { SettingsConnectors } from './settings/SettingsConnectors';
import { SettingsSkills } from './settings/SettingsSkills';
import { SettingsSchedule } from './settings/SettingsSchedule';
import { SettingsGeneral } from './settings/SettingsGeneral';
import { SettingsLogs } from './settings/SettingsLogs';
import { SettingsMemory } from './settings/SettingsMemory';

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?:
    | 'api'
    | 'sandbox'
    | 'connectors'
    | 'skills'
    | 'memory'
    | 'schedule'
    | 'remote'
    | 'logs'
    | 'general';
}

type TabId =
  | 'api'
  | 'sandbox'
  | 'connectors'
  | 'skills'
  | 'memory'
  | 'schedule'
  | 'remote'
  | 'logs'
  | 'general';

const VALID_TABS = new Set<TabId>([
  'api',
  'sandbox',
  'connectors',
  'skills',
  'memory',
  'schedule',
  'remote',
  'logs',
  'general',
]);

export function SettingsPanel({ onClose, initialTab = 'api' }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { width } = useWindowSize();
  const compactSidebar = width < 900;
  // Read settingsTab from store at mount time so external navigation (nav-server)
  // takes effect even before this component mounts.
  const storeTab = useAppStore((s) => s.settingsTab);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const resolvedInitial =
    storeTab && VALID_TABS.has(storeTab as TabId) ? (storeTab as TabId) : initialTab;

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);
  // Track which tabs have been viewed at least once (for lazy loading)
  const [viewedTabs, setViewedTabs] = useState<Set<TabId>>(new Set([resolvedInitial]));
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVersion);
      else if (v) setAppVersion(v);
    } catch {
      /* ignore */
    }
  }, []);

  // Consume the store signal and apply tab in one effect
  useEffect(() => {
    if (storeTab && VALID_TABS.has(storeTab as TabId)) {
      setActiveTab(storeTab as TabId);
      setSettingsTab(null);
    }
  }, [storeTab, setSettingsTab]);

  // Mark tab as viewed when it becomes active
  useEffect(() => {
    if (!viewedTabs.has(activeTab)) {
      setViewedTabs((prev) => new Set([...prev, activeTab]));
    }
  }, [activeTab]);

  const tabs = [
    {
      id: 'api' as TabId,
      label: t('settings.apiSettings'),
      icon: Settings,
      description: t('settings.apiSettingsDesc'),
    },
    {
      id: 'sandbox' as TabId,
      label: t('settings.sandbox'),
      icon: Shield,
      description: t('settings.sandboxDesc'),
    },
    {
      id: 'connectors' as TabId,
      label: t('settings.connectors'),
      icon: Plug,
      description: t('settings.connectorsDesc'),
    },
    {
      id: 'skills' as TabId,
      label: t('settings.skills'),
      icon: Package,
      description: t('settings.skillsDesc'),
    },
    {
      id: 'memory' as TabId,
      label: t('settings.memory'),
      icon: BrainCircuit,
      description: t('settings.memoryDesc'),
    },
    {
      id: 'schedule' as TabId,
      label: t('settings.schedule'),
      icon: Clock3,
      description: t('settings.scheduleDesc'),
    },
    {
      id: 'remote' as TabId,
      label: t('settings.remote', '远程控制'),
      icon: Wifi,
      description: t('settings.remoteDesc', '通过飞书等平台远程使用'),
    },
    {
      id: 'logs' as TabId,
      label: t('settings.logs'),
      icon: AlertCircle,
      description: t('settings.logsDesc'),
    },
    {
      id: 'general' as TabId,
      label: t('settings.general'),
      icon: Globe,
      description: t('settings.generalDesc'),
    },
  ];
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`${compactSidebar ? 'w-14' : 'w-52 lg:w-60'} bg-background-secondary/88 border-r border-border-muted flex flex-col flex-shrink-0`}
      >
        {!compactSidebar && (
          <div className="px-6 pt-6 pb-3">
            <h2 className="text-[1.05rem] font-semibold tracking-[-0.02em] text-text-primary">
              {t('settings.title')}
            </h2>
          </div>
        )}
        {/* Nav rows: single-line, uniform height — descriptions live in the content header */}
        <div className={`flex-1 ${compactSidebar ? 'p-1.5 space-y-1' : 'px-3 py-1 space-y-0.5'}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={compactSidebar ? tab.label : undefined}
              className={`w-full flex items-center ${compactSidebar ? 'justify-center p-2.5' : 'gap-2.5 px-3 h-9'} rounded-lg text-left transition-colors ${
                activeTab === tab.id
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              <tab.icon
                className={`w-4 h-4 flex-shrink-0 ${
                  activeTab === tab.id ? 'text-accent' : 'text-text-muted'
                }`}
              />
              {!compactSidebar && (
                <span
                  className={`text-[13px] truncate ${activeTab === tab.id ? 'font-medium' : ''}`}
                >
                  {tab.label}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={`${compactSidebar ? 'p-1.5' : 'p-3'} border-t border-border-muted`}>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={onClose}
            title={compactSidebar ? t('common.close') : undefined}
          >
            {compactSidebar ? <X className="w-4 h-4" /> : t('common.close')}
          </Button>
          {!compactSidebar && (
            <p className="text-[10px] text-text-muted text-center mt-1.5 select-text">
              v{appVersion}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center justify-between px-4 lg:px-8 py-4 border-b border-border-muted flex-shrink-0 bg-background/88 backdrop-blur-sm">
          <div>
            <h3 className="text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
              {activeTabMeta?.label}
            </h3>
            {activeTabMeta?.description && (
              <p className="mt-0.5 text-sm text-text-muted max-w-[36rem]">
                {activeTabMeta.description}
              </p>
            )}
          </div>
          <IconButton variant="ghost" onClick={onClose}>
            <X className="w-5 h-5 text-text-secondary" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 lg:px-8 lg:py-8">
          <div className="max-w-[860px] w-full min-w-0 mx-auto">
            <div className="">
              <div className={activeTab === 'api' ? '' : 'hidden'}>
                {viewedTabs.has('api') && (
                  <>
                    <SettingsAPI />
                  </>
                )}
              </div>
              <div className={activeTab === 'sandbox' ? '' : 'hidden'}>
                {viewedTabs.has('sandbox') && <SettingsSandbox />}
              </div>
              <div className={activeTab === 'connectors' ? '' : 'hidden'}>
                {viewedTabs.has('connectors') && (
                  <SettingsConnectors isActive={activeTab === 'connectors'} />
                )}
              </div>
              <div className={activeTab === 'skills' ? '' : 'hidden'}>
                {viewedTabs.has('skills') && <SettingsSkills isActive={activeTab === 'skills'} />}
              </div>
              <div className={activeTab === 'memory' ? '' : 'hidden'}>
                {viewedTabs.has('memory') && <SettingsMemory />}
              </div>
              <div className={activeTab === 'schedule' ? '' : 'hidden'}>
                {viewedTabs.has('schedule') && (
                  <SettingsSchedule isActive={activeTab === 'schedule'} />
                )}
              </div>
              <div className={activeTab === 'remote' ? '' : 'hidden'}>
                {viewedTabs.has('remote') && (
                  <RemoteControlPanel isActive={activeTab === 'remote'} />
                )}
              </div>
              <div className={activeTab === 'logs' ? '' : 'hidden'}>
                {viewedTabs.has('logs') && <SettingsLogs isActive={activeTab === 'logs'} />}
              </div>
              <div className={activeTab === 'general' ? '' : 'hidden'}>
                {viewedTabs.has('general') && <SettingsGeneral />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
