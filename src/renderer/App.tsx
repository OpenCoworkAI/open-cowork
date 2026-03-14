import { Suspense, lazy, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './store';
import { useIPC } from './hooks/useIPC';
import { useWindowSize } from './hooks/useWindowSize';
import { Sidebar } from './components/Sidebar';
import { WelcomeView } from './components/WelcomeView';
import { PermissionDialog } from './components/PermissionDialog';
import { SudoPasswordDialog } from './components/SudoPasswordDialog';
import { Titlebar } from './components/Titlebar';
import { SandboxSetupDialog } from './components/SandboxSetupDialog';
import { SandboxSyncToast } from './components/SandboxSyncToast';
import { GlobalNoticeToast } from './components/GlobalNoticeToast';
import type { AppConfig } from './types';
import type { GlobalNoticeAction } from './store';

// Check if running in Electron
const isElectronEnv = typeof window !== 'undefined' && window.electronAPI !== undefined;

const ChatView = lazy(() => import('./components/ChatView').then((module) => ({ default: module.ChatView })));
const ContextPanel = lazy(() => import('./components/ContextPanel').then((module) => ({ default: module.ContextPanel })));
const ConfigModal = lazy(() => import('./components/ConfigModal').then((module) => ({ default: module.ConfigModal })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel })));

function MainPanelFallback() {
  return (
    <div className="flex-1 min-h-0 bg-background px-6 py-6">
      <div className="h-full rounded-[1.75rem] border border-border-subtle bg-background/70" />
    </div>
  );
}

function ContextPanelFallback() {
  return <div className="hidden xl:block w-[340px] shrink-0 border-l border-border-subtle bg-background/60" aria-hidden="true" />;
}

function App() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const pendingPermission = useAppStore((s) => s.pendingPermission);
  const pendingSudoPassword = useAppStore((s) => s.pendingSudoPassword);
  const settings = useAppStore((s) => s.settings);
  const showConfigModal = useAppStore((s) => s.showConfigModal);
  const showSettings = useAppStore((s) => s.showSettings);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const appConfig = useAppStore((s) => s.appConfig);
  const globalNotice = useAppStore((s) => s.globalNotice);
  const sandboxSetupProgress = useAppStore((s) => s.sandboxSetupProgress);
  const isSandboxSetupComplete = useAppStore((s) => s.isSandboxSetupComplete);
  const sandboxSyncStatus = useAppStore((s) => s.sandboxSyncStatus);
  const setShowConfigModal = useAppStore((s) => s.setShowConfigModal);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const clearGlobalNotice = useAppStore((s) => s.clearGlobalNotice);
  const setSandboxSetupComplete = useAppStore((s) => s.setSandboxSetupComplete);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setContextPanelCollapsed = useAppStore((s) => s.setContextPanelCollapsed);
  const { listSessions, isElectron } = useIPC();
  const { width } = useWindowSize();
  const initialized = useRef(false);
  const sidebarBeforeSettings = useRef(false);

  useEffect(() => {
    // Only run once on mount
    if (initialized.current) return;
    initialized.current = true;

    if (isElectron) {
      listSessions();
    }
  }, []); // Empty deps - run once

  // Apply theme to document root
  useEffect(() => {
    if (settings.theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [settings.theme]);

  // Auto-collapse panels based on window width
  useEffect(() => {
    setContextPanelCollapsed(width < 1100);
    setSidebarCollapsed(width < 800);
  }, [width, setContextPanelCollapsed, setSidebarCollapsed]);

  // Auto-collapse sidebar when Settings is open, restore on close
  useEffect(() => {
    if (showSettings) {
      sidebarBeforeSettings.current = !sidebarCollapsed;
      setSidebarCollapsed(true);
    } else if (sidebarBeforeSettings.current) {
      setSidebarCollapsed(false);
      sidebarBeforeSettings.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // Handle config save
  const handleConfigSave = useCallback(async (newConfig: Partial<AppConfig>) => {
    if (!isElectronEnv) {
      console.log('[App] Browser mode - config save simulated');
      return;
    }
    
    const result = await window.electronAPI.config.save(newConfig);
    if (result.success) {
      setIsConfigured(Boolean(result.config?.isConfigured));
      setAppConfig(result.config);
    }
  }, [setIsConfigured, setAppConfig]);

  // Handle config modal close
  const handleConfigClose = useCallback(() => {
    setShowConfigModal(false);
  }, [setShowConfigModal]);

  // Handle sandbox setup complete
  const handleSandboxSetupComplete = useCallback(() => {
    setSandboxSetupComplete(true);
  }, [setSandboxSetupComplete]);

  const handleGlobalNoticeAction = useCallback((action: GlobalNoticeAction) => {
    if (action === 'open_api_settings') {
      setShowConfigModal(true);
    }
    clearGlobalNotice();
  }, [clearGlobalNotice, setShowConfigModal]);

  // Determine if we should show the sandbox setup dialog
  // Show if there's progress and setup is not complete
  const showSandboxSetup = sandboxSetupProgress && !isSandboxSetupComplete;

  return (
    <div className="h-full w-full min-h-0 flex flex-col overflow-hidden bg-background">
      {/* Titlebar - draggable region */}
      <Titlebar />
      
      {/* Main Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />
        
        {/* Main Content Area */}
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
          {showSettings ? (
            <Suspense fallback={<MainPanelFallback />}>
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </Suspense>
          ) : activeSessionId ? (
            <Suspense fallback={<MainPanelFallback />}>
              <ChatView />
            </Suspense>
          ) : (
            <WelcomeView />
          )}
        </main>

        {/* Context Panel - only show when in session and not in settings */}
        {activeSessionId && !showSettings && (
          <Suspense fallback={<ContextPanelFallback />}>
            <ContextPanel />
          </Suspense>
        )}
      </div>
      
      {/* Permission Dialog */}
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}

      {/* Sudo Password Dialog */}
      {pendingSudoPassword && <SudoPasswordDialog request={pendingSudoPassword} />}
      
      {/* Config Modal */}
      <Suspense fallback={null}>
        <ConfigModal
          isOpen={showConfigModal}
          onClose={handleConfigClose}
          onSave={handleConfigSave}
          initialConfig={appConfig}
          isFirstRun={!isConfigured}
        />
      </Suspense>
      
      {/* Sandbox Setup Dialog */}
      {showSandboxSetup && (
        <SandboxSetupDialog 
          progress={sandboxSetupProgress}
          onComplete={handleSandboxSetupComplete}
        />
      )}
      
      {/* Sandbox Sync Toast */}
      <SandboxSyncToast status={sandboxSyncStatus} />

      <GlobalNoticeToast
        notice={globalNotice}
        onDismiss={clearGlobalNotice}
        onAction={handleGlobalNoticeAction}
      />
    </div>
  );
}

export default App;
