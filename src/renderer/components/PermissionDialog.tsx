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
  const { respondToPermission } = useIPC();

  const toolDescriptions: Record<string, string> = {
    write: 'Write to files on your system',
    edit: 'Edit existing files on your system',
    bash: 'Execute shell commands',
    webFetch: 'Fetch data from the web',
    webSearch: 'Search the web',
  };

  const isHighRisk = ['bash', 'write', 'edit'].includes(permission.toolName);

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
              Permission Required
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {toolDescriptions[permission.toolName] || `Use the ${permission.toolName} tool`}
            </p>
          </div>
        </div>

        {/* Tool Details */}
        <div className="mt-4 p-4 bg-surface-muted rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-text-primary">Tool:</span>
            <span className="font-mono text-accent text-sm">{permission.toolName}</span>
          </div>
          
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Input:</span>
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
                This action may modify your system. Review carefully.
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
            Deny
          </button>
          
          <button
            onClick={() => respondToPermission(permission.toolUseId, 'allow')}
            className="flex-1 btn btn-primary"
          >
            <Check className="w-4 h-4" />
            Allow
          </button>
        </div>

        {/* Always Allow option */}
        <button
          onClick={() => respondToPermission(permission.toolUseId, 'allow_always')}
          className="w-full mt-2 btn btn-ghost text-sm"
        >
          Always allow this tool
        </button>
      </div>
    </div>
  );
}
