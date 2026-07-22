import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { SudoPasswordRequest } from '../types';
import { Shield, X, Play } from 'lucide-react';
import { Button, Input, DialogOverlay, DialogPanel } from './ui';

interface SudoPasswordDialogProps {
  request: SudoPasswordRequest;
}

export function SudoPasswordDialog({ request }: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const { respondToSudoPassword } = useIPC();
  // Use ref so the password never lives in React state / re-render cycle
  const passwordRef = useRef<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Capture ref values for safe use in cleanup
    const inputEl = inputRef.current;
    // Clear the password from memory when the dialog unmounts
    return () => {
      passwordRef.current = '';
      if (inputEl) {
        inputEl.value = '';
      }
    };
  }, []);

  const handleSubmit = () => {
    const pwd = passwordRef.current;
    if (!pwd) return;
    respondToSudoPassword(request.toolUseId, pwd);
    // Wipe immediately after sending
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleCancel = () => {
    respondToSudoPassword(request.toolUseId, null);
    passwordRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
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
    <DialogOverlay closeOnScrim={false}>
      <DialogPanel size="sm" className="max-w-md p-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning/10">
            <Shield className="w-6 h-6 text-warning" />
          </div>

          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">{t('sudo.title')}</h2>
            <p className="text-sm text-text-secondary mt-1">{t('sudo.description')}</p>
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
          <Input
            ref={inputRef}
            type="password"
            onChange={(e) => {
              passwordRef.current = e.target.value;
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('sudo.passwordPlaceholder')}
            autoComplete="new-password"
          />
        </div>

        {/* Warning */}
        <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-xl">
          <p className="text-xs text-warning">{t('sudo.warning')}</p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <Button variant="secondary" className="flex-1" onClick={handleCancel}>
            <X className="w-4 h-4" />
            {t('sudo.cancel')}
          </Button>

          <Button variant="primary" className="flex-1" onClick={handleSubmit}>
            <Play className="w-4 h-4" />
            {t('sudo.execute')}
          </Button>
        </div>
      </DialogPanel>
    </DialogOverlay>
  );
}
