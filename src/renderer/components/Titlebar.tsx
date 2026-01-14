import { Sparkles, Minimize2, Square, X } from 'lucide-react';

export function Titlebar() {
  return (
    <div className="h-10 bg-background-secondary border-b border-border flex items-center justify-between px-4 titlebar-drag">
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
        <div className="flex items-center gap-1 titlebar-no-drag">
          <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface transition-colors">
            <Minimize2 className="w-3.5 h-3.5 text-text-secondary" />
          </button>
          <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface transition-colors">
            <Square className="w-3 h-3 text-text-secondary" />
          </button>
          <button className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent-red/20 transition-colors group">
            <X className="w-4 h-4 text-text-secondary group-hover:text-accent-red" />
          </button>
        </div>
      )}
    </div>
  );
}

