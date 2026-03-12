import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './store';
import { useIPC } from './hooks/useIPC';
import { useWindowSize } from './hooks/useWindowSize';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { WelcomeView } from './components/WelcomeView';
import { PermissionDialog } from './components/PermissionDialog';
import { ContextPanel } from './components/ContextPanel';
import { ConfigModal } from './components/ConfigModal';
import { SettingsPanel } from './components/SettingsPanel';
import { Titlebar } from './components/Titlebar';
import { SandboxSetupDialog } from './components/SandboxSetupDialog';
import { SandboxSyncToast } from './components/SandboxSyncToast';
import { OnboardingModal } from './components/OnboardingModal';
import { GlobalNoticeToast } from './components/GlobalNoticeToast';
import type { AppConfig } from './types';
import type { GlobalNoticeAction } from './store';

// Check if running in Electron
const isElectronEnv = typeof window !== 'undefined' && window.electronAPI !== undefined;

function App() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const pendingPermission = useAppStore((s) => s.pendingPermission);
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
  const showOnboardingModal = useAppStore((s) => s.showOnboardingModal);
  const setShowConfigModal = useAppStore((s) => s.setShowConfigModal);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const clearGlobalNotice = useAppStore((s) => s.clearGlobalNotice);
  const setSandboxSetupComplete = useAppStore((s) => s.setSandboxSetupComplete);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setContextPanelCollapsed = useAppStore((s) => s.setContextPanelCollapsed);
  const setWorkEnvironment = useAppStore((s) => s.setWorkEnvironment);
  const setShowOnboardingModal = useAppStore((s) => s.setShowOnboardingModal);
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

  // Check onboarding state
  useEffect(() => {
    if (!isConfigured || !isElectronEnv) return;

    window.electronAPI.onboarding.getWorkEnvironment().then((env) => {
      if (env === null) {
        setShowOnboardingModal(true);
      } else {
        setWorkEnvironment(env);
      }
    });
  }, [isConfigured, setShowOnboardingModal, setWorkEnvironment]);

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
            <SettingsPanel onClose={() => setShowSettings(false)} />
          ) : activeSessionId ? (
            <ChatView />
          ) : (
            <WelcomeView />
          )}
        </main>

        {/* Context Panel - only show when in session and not in settings */}
        {activeSessionId && !showSettings && <ContextPanel />}
      </div>
      
      {/* Permission Dialog */}
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}
      
      {/* Config Modal */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={handleConfigClose}
        onSave={handleConfigSave}
        initialConfig={appConfig}
        isFirstRun={!isConfigured}
      />
      
      {/* Sandbox Setup Dialog */}
      {showSandboxSetup && (
        <SandboxSetupDialog 
          progress={sandboxSetupProgress}
          onComplete={handleSandboxSetupComplete}
        />
      )}
      
      {/* Sandbox Sync Toast */}
      <SandboxSyncToast status={sandboxSyncStatus} />

      {/* Onboarding Modal */}
      {showOnboardingModal && (
        <OnboardingModal onComplete={() => setShowOnboardingModal(false)} />
      )}

      <GlobalNoticeToast
        notice={globalNotice}
        onDismiss={clearGlobalNotice}
        onAction={handleGlobalNoticeAction}
      />
    </div>
  );
}

export default App;
