import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './store';
import { useIPC } from './hooks/useIPC';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { WelcomeView } from './components/WelcomeView';
import { PermissionDialog } from './components/PermissionDialog';
import { ContextPanel } from './components/ContextPanel';
import { ConfigModal } from './components/ConfigModal';
import type { AppConfig } from './types';

// Check if running in Electron
const isElectronEnv = typeof window !== 'undefined' && window.electronAPI !== undefined;

function App() {
  const { 
    activeSessionId, 
    pendingPermission,
    settings,
    showConfigModal,
    isConfigured,
    appConfig,
    setShowConfigModal,
    setIsConfigured,
    setAppConfig,
  } = useAppStore();
  const { listSessions, isElectron } = useIPC();
  const initialized = useRef(false);

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

  // Handle config save
  const handleConfigSave = useCallback(async (newConfig: Partial<AppConfig>) => {
    if (!isElectronEnv) {
      console.log('[App] Browser mode - config save simulated');
      return;
    }
    
    const result = await window.electronAPI.config.save(newConfig);
    if (result.success) {
      setIsConfigured(true);
      setAppConfig(result.config);
    }
  }, [setIsConfigured, setAppConfig]);

  // Handle config modal close
  const handleConfigClose = useCallback(() => {
    // Only allow closing if already configured
    if (isConfigured) {
      setShowConfigModal(false);
    }
  }, [isConfigured, setShowConfigModal]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        {activeSessionId ? <ChatView /> : <WelcomeView />}
      </main>

      {/* Context Panel - only show when in session */}
      {activeSessionId && <ContextPanel />}
      
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
      
      {/* AskUserQuestion is now rendered inline in MessageCard */}
    </div>
  );
}

export default App;
