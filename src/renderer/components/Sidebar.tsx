import { useState } from 'react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  Trash2,
  Sparkles,
  Moon,
  Sun,
  Settings,
} from 'lucide-react';

export function Sidebar() {
  const { sessions, activeSessionId, settings, setActiveSession, updateSettings, setShowConfigModal, isConfigured } = useAppStore();
  const { deleteSession } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  const handleOpenSettings = () => {
    setShowConfigModal(true);
  };

  const handleNewSession = () => {
    setActiveSession(null);
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  return (
    <div className="w-64 bg-surface border-r border-border flex flex-col">
      {/* Header with App Title and Dark Mode Toggle */}
      <div className="px-4 pt-6 pb-4 border-b border-border flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Cowork</h1>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
          title={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {settings.theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* New Task Button */}
      <div className="p-3">
        <button
          onClick={handleNewSession}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-hover transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <span className="font-medium text-text-primary">New task</span>
        </button>
      </div>
      
      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="space-y-1">
          {sessions.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-sm">
              <p>No tasks yet</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                className={`group relative px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  activeSessionId === session.id
                    ? 'bg-surface-active'
                    : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    session.status === 'running' ? 'bg-accent' :
                    session.status === 'completed' ? 'bg-success' :
                    session.status === 'error' ? 'bg-error' : 'bg-border'
                  }`} />
                  <span className="text-sm text-text-primary truncate flex-1">
                    {session.title}
                  </span>
                </div>
                
                {/* Delete button */}
                {hoveredSession === session.id && (
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-surface-active text-text-muted hover:text-error transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Info text */}
        <p className="text-xs text-text-muted px-3 py-4">
          These tasks run locally and aren't synced across devices.
        </p>
      </div>
      
      {/* User Footer */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-medium">
            U
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">User</p>
            <p className="text-xs text-text-muted">
              {isConfigured ? 'API 已配置' : '未配置 API'}
            </p>
          </div>
          <button
            onClick={handleOpenSettings}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="API 设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
