import React, { useState, useEffect } from 'react';

declare global {
  interface Window {
    electron?: {
      selectDirectory?: () => Promise<string | null>;
      getWorkspacePath?: () => Promise<string | null>;
      setWorkspacePath?: (path: string | null) => Promise<void>;
    };
  }
}

const WorkspaceSettings: React.FC = () => {
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [isSelecting, setIsSelecting] = useState(false);

  useEffect(() => {
    const loadPath = async () => {
      const savedPath = await window.electron?.getWorkspacePath?.();
      if (savedPath) {
        setWorkspacePath(savedPath);
      }
    };
    loadPath();
  }, []);

  const handleBrowse = async () => {
    setIsSelecting(true);
    try {
      const selectedPath = await window.electron?.selectDirectory?.();
      if (selectedPath) {
        setWorkspacePath(selectedPath);
        await window.electron?.setWorkspacePath?.(selectedPath);
      }
    } finally {
      setIsSelecting(false);
    }
  };

  const handleReset = async () => {
    setWorkspacePath('');
    await window.electron?.setWorkspacePath?.(null);
  };

  return (
    <div className="workspace-settings">
      <label className="workspace-settings-label">
        Default Workspace Directory
      </label>
      <div className="workspace-settings-input-group">
        <input
          type="text"
          value={workspacePath}
          readOnly
          placeholder="Using default location"
          className="workspace-settings-input"
        />
        <button
          type="button"
          onClick={handleBrowse}
          disabled={isSelecting}
          className="workspace-settings-button workspace-settings-browse"
        >
          Browse
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={!workspacePath}
          className="workspace-settings-button workspace-settings-reset"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
};

export default WorkspaceSettings;