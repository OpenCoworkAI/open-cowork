import { Sparkles, Minus, Square, X, Copy } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div className="h-10 bg-background-secondary border-b border-border flex items-center justify-between px-4 titlebar-drag shrink-0">
      {/* App Logo & Title */}
      <div className="flex items-center gap-3 titlebar-no-drag">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent-cyan to-accent-purple flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-background" />
        </div>
        <span className="text-sm font-semibold text-text-primary">Open Cowork</span>
        <span className="text-xs text-text-muted bg-surface px-2 py-0.5 rounded-full">Alpha</span>
      </div>
      
      {/* Window Controls (for Windows/Linux - macOS uses native) */}
      {window.electronAPI?.platform !== 'darwin' && (
        <div className="flex items-center titlebar-no-drag">
          <button 
            onClick={handleMinimize}
            className="w-11 h-10 flex items-center justify-center hover:bg-surface transition-colors"
          >
            <Minus className="w-4 h-4 text-text-secondary" />
          </button>
          <button 
            onClick={handleMaximize}
            className="w-11 h-10 flex items-center justify-center hover:bg-surface transition-colors"
          >
            {isMaximized ? (
              <Copy className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
          <button 
            onClick={handleClose}
            className="w-11 h-10 flex items-center justify-center hover:bg-red-500 transition-colors group"
          >
            <X className="w-4 h-4 text-text-secondary group-hover:text-white" />
          </button>
        </div>
      )}
    </div>
  );
}

