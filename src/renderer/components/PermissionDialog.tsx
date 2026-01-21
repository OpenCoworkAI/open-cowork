import { useTranslation } from 'react-i18next';
import { useIPC } from '../hooks/useIPC';
import type { PermissionRequest } from '../types';
import {
  Shield,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';

interface PermissionDialogProps {
  permission: PermissionRequest;
}

export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { t } = useTranslation();
  const { respondToPermission } = useIPC();

  const getToolDescription = (toolName: string): string => {
    const key = `permission.toolDescriptions.${toolName}`;
    const translated = t(key);
    // If translation exists (not the same as key), return it
    if (translated !== key) {
      return translated;
    }
    // Otherwise fallback to default message
    return t('permission.useTool', { toolName });
  };

  const isHighRisk = [
    'bash',
    'write',
    'edit',
    'execute_command',
    'write_file',
    'edit_file',
  ].includes(permission.toolName);

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="card w-full max-w-md p-6 m-4 shadow-elevated animate-slide-up">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isHighRisk ? 'bg-warning/10' : 'bg-accent-muted'
          }`}>
            {isHighRisk ? (
              <AlertTriangle className="w-6 h-6 text-warning" />
            ) : (
              <Shield className="w-6 h-6 text-accent" />
            )}
          </div>
          
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">
              {t('permission.permissionRequired')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {getToolDescription(permission.toolName)}
            </p>
          </div>
        </div>

        {/* Tool Details */}
        <div className="mt-4 p-4 bg-surface-muted rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-text-primary">{t('permission.tool')}</span>
            <span className="font-mono text-accent text-sm">{permission.toolName}</span>
          </div>
          
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{t('permission.input')}</span>
            <pre className="mt-1 text-xs code-block max-h-32 overflow-auto">
              {JSON.stringify(permission.input, null, 2)}
            </pre>
          </div>
        </div>

        {/* Warning */}
        {isHighRisk && (
          <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning">
                {t('permission.warning')}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => respondToPermission(permission.toolUseId, 'deny')}
            className="flex-1 btn btn-secondary"
          >
            <X className="w-4 h-4" />
            {t('permission.deny')}
          </button>
          
          <button
            onClick={() => respondToPermission(permission.toolUseId, 'allow')}
            className="flex-1 btn btn-primary"
          >
            <Check className="w-4 h-4" />
            {t('permission.allow')}
          </button>
        </div>

        {/* Always Allow option */}
        <button
          onClick={() => respondToPermission(permission.toolUseId, 'allow_always')}
          className="w-full mt-2 btn btn-ghost text-sm"
        >
          {t('permission.alwaysAllow')}
        </button>
      </div>
    </div>
  );
}
