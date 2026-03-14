import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { SudoPasswordRequest } from '../types';
import { Shield, X, Play } from 'lucide-react';

interface SudoPasswordDialogProps {
  request: SudoPasswordRequest;
}

export function SudoPasswordDialog({ request }: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const { respondToSudoPassword } = useIPC();
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!password) return;
    respondToSudoPassword(request.toolUseId, password);
    setPassword('');
  };

  const handleCancel = () => {
    respondToSudoPassword(request.toolUseId, null);
    setPassword('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="card w-full max-w-md p-6 m-4 shadow-elevated animate-slide-up">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning/10">
            <Shield className="w-6 h-6 text-warning" />
          </div>

          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">
              {t('sudo.title')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {t('sudo.description')}
            </p>
          </div>
        </div>

        {/* Command display */}
        <div className="mt-4 p-4 bg-surface-muted rounded-xl">
          <pre className="text-xs code-block max-h-32 overflow-auto whitespace-pre-wrap break-all">
            {request.command}
          </pre>
        </div>

        {/* Password input */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('sudo.passwordLabel')}
          </label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('sudo.passwordPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            autoComplete="off"
          />
        </div>

        {/* Warning */}
        <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-xl">
          <p className="text-xs text-warning">
            {t('sudo.warning')}
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="flex-1 btn btn-secondary"
          >
            <X className="w-4 h-4" />
            {t('sudo.cancel')}
          </button>

          <button
            onClick={handleSubmit}
            disabled={!password}
            className="flex-1 btn btn-primary disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {t('sudo.execute')}
          </button>
        </div>
      </div>
    </div>
  );
}
