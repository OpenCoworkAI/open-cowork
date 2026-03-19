import { useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle,
  XCircle,
  MinusCircle,
  Circle,
  Stethoscope,
  Globe,
  Cable,
  ShieldCheck,
  KeyRound,
  Cpu,
} from 'lucide-react';
import type {
  DiagnosticResult,
  DiagnosticStep,
  DiagnosticStepName,
  DiagnosticStepStatus,
} from '../types';

interface ApiDiagnosticsPanelProps {
  result: DiagnosticResult | null;
  isRunning: boolean;
  onRunDiagnostics: () => void;
  onRunDeepDiagnostics?: () => void;
  disabled?: boolean;
}

const STEP_NAME_FALLBACKS: Record<string, string> = {
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  auth: 'Auth',
  model: 'Model',
};

const STEP_ICONS: Record<DiagnosticStepName, React.FC<{ className?: string }>> = {
  dns: Globe,
  tcp: Cable,
  tls: ShieldCheck,
  auth: KeyRound,
  model: Cpu,
};

/** Small status badge (checkmark / X / minus) overlaid on the step icon */
function StatusBadge({ status }: { status: DiagnosticStepStatus }) {
  const base = 'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full';
  switch (status) {
    case 'ok':
      return <CheckCircle className={`${base} text-success`} />;
    case 'fail':
      return <XCircle className={`${base} text-error`} />;
    case 'skip':
      return <MinusCircle className={`${base} text-text-muted`} />;
    case 'running':
      return <Loader2 className={`${base} text-accent animate-spin`} />;
    case 'pending':
    default:
      return <Circle className={`${base} text-text-muted opacity-40`} />;
  }
}

/** Color classes for each status */
function statusColors(status: DiagnosticStepStatus) {
  switch (status) {
    case 'ok':
      return {
        border: 'border-success/50',
        bg: 'bg-success/8',
        text: 'text-success',
        iconText: 'text-success',
      };
    case 'fail':
      return {
        border: 'border-error/50',
        bg: 'bg-error/8',
        text: 'text-error',
        iconText: 'text-error',
      };
    case 'skip':
      return {
        border: 'border-border border-dashed',
        bg: 'bg-transparent',
        text: 'text-text-muted',
        iconText: 'text-text-muted',
      };
    case 'running':
      return {
        border: 'border-accent/60',
        bg: 'bg-accent/8',
        text: 'text-accent',
        iconText: 'text-accent',
      };
    case 'pending':
    default:
      return {
        border: 'border-border',
        bg: 'bg-transparent',
        text: 'text-text-muted',
        iconText: 'text-text-muted opacity-40',
      };
  }
}

/** Connector line between steps */
function Connector({
  leftStatus,
  rightStatus,
}: {
  leftStatus: DiagnosticStepStatus;
  rightStatus: DiagnosticStepStatus;
}) {
  // After a failure, connectors become muted
  const isAfterFail = leftStatus === 'fail';
  const isSkipOrPending =
    rightStatus === 'skip' || rightStatus === 'pending' || leftStatus === 'skip';

  let lineClass = 'flex-1 h-px mx-0.5 transition-colors duration-300 ';
  if (isAfterFail) {
    lineClass += 'bg-error/20 border-t border-dashed border-error/30';
  } else if (isSkipOrPending) {
    lineClass += 'border-t border-dashed border-border';
  } else if (leftStatus === 'ok') {
    lineClass += 'bg-success/40';
  } else if (leftStatus === 'running') {
    lineClass += 'bg-accent/30';
  } else {
    lineClass += 'bg-border';
  }

  return <div className={lineClass} />;
}

/** A single pipeline node */
function PipelineNode({ step }: { step: DiagnosticStep }) {
  const { t } = useTranslation();
  const label =
    t(`api.diagnostic.step.${step.name}`, '') || STEP_NAME_FALLBACKS[step.name] || step.name;
  const colors = statusColors(step.status);
  const Icon = STEP_ICONS[step.name] || Globe;

  const isRunning = step.status === 'running';

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      {/* Node card */}
      <div
        className={`
          relative flex flex-col items-center justify-center
          w-14 h-14 rounded-xl border transition-all duration-300
          ${colors.border} ${colors.bg}
          ${isRunning ? 'animate-pulse' : ''}
        `}
      >
        <Icon className={`w-5 h-5 ${colors.iconText}`} />
        <StatusBadge status={step.status} />
      </div>

      {/* Label */}
      <span className={`text-[10px] font-medium leading-tight ${colors.text}`}>{label}</span>

      {/* Latency */}
      {step.latencyMs !== undefined && step.status !== 'pending' ? (
        <span className="text-[10px] text-text-muted leading-tight">{step.latencyMs}ms</span>
      ) : (
        <span className="text-[10px] text-transparent leading-tight select-none">-</span>
      )}
    </div>
  );
}

/** Error detail card shown below the pipeline */
function FailureDetail({ step }: { step: DiagnosticStep }) {
  const { t } = useTranslation();

  const fixText = (() => {
    if (!step.fix) return '';
    const [key, ...paramParts] = step.fix.split(':');
    const param = paramParts.join(':');
    const i18nKey = `api.diagnostic.fix.${key}`;
    const resolved = t(i18nKey, { host: param, model: param, defaultValue: '' });
    return resolved || step.fix;
  })();

  return (
    <div className="mt-2 rounded-lg bg-error/8 border border-error/20 px-3 py-2 text-xs">
      {step.error && <p className="text-error font-medium">{step.error}</p>}
      {fixText && <p className="mt-1 text-text-secondary">{fixText}</p>}
    </div>
  );
}

const PENDING_STEP_NAMES: DiagnosticStepName[] = ['dns', 'tcp', 'tls', 'auth', 'model'];

export default function ApiDiagnosticsPanel({
  result,
  isRunning,
  onRunDiagnostics,
  onRunDeepDiagnostics,
  disabled = false,
}: ApiDiagnosticsPanelProps) {
  const { t } = useTranslation();
  const showSteps = result !== null;

  const placeholderSteps: DiagnosticStep[] = PENDING_STEP_NAMES.map((name) => ({
    name,
    status: 'pending' as const,
  }));
  const displaySteps = result?.steps ?? (isRunning ? placeholderSteps : []);
  const failedStep = displaySteps.find((s) => s.status === 'fail');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onRunDiagnostics()}
          disabled={disabled || isRunning}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
            bg-accent text-white text-sm font-medium
            hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Stethoscope className="w-4 h-4" />
          )}
          {onRunDeepDiagnostics
            ? t('api.diagnostic.runQuickDiagnostics', 'Quick Diagnose')
            : t('api.diagnostic.runDiagnostics', 'Diagnose Connection')}
        </button>
        {onRunDeepDiagnostics && (
          <button
            type="button"
            onClick={() => onRunDeepDiagnostics()}
            disabled={disabled || isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border
              bg-background text-text-primary text-sm font-medium
              hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            <Cpu className="w-4 h-4" />
            {t('api.diagnostic.runDeepDiagnostics', 'Deep Inference Check')}
          </button>
        )}
      </div>

      {/* Pipeline visualization */}
      {(showSteps || isRunning) && (
        <div className="rounded-xl bg-background border border-border p-4">
          {/* Horizontal pipeline */}
          <div className="flex items-center justify-between gap-0">
            {displaySteps.map((step, i) => (
              <div key={step.name} className="contents">
                <PipelineNode step={step} />
                {i < displaySteps.length - 1 && (
                  <Connector
                    leftStatus={step.status}
                    rightStatus={displaySteps[i + 1].status}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Failure detail */}
          {failedStep && <FailureDetail step={failedStep} />}

          {result?.advisoryText && !isRunning && (
            <div className="mt-3 rounded-lg bg-accent/8 border border-accent/20 px-3 py-2 text-xs text-text-secondary">
              {t(`api.diagnostic.advisory.${result.advisoryCode ?? ''}`, result.advisoryText)}
            </div>
          )}

          {/* Skipped info */}
          {result?.skippedReason && !isRunning && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-text-muted">
              {t('api.diagnostic.skipped', 'Diagnostics skipped: another run is already in progress.')}
            </div>
          )}

          {/* Overall summary */}
          {result && !result.skippedReason && !isRunning && (
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
              <span
                className={result.overallOk ? 'text-success font-medium' : 'text-error font-medium'}
              >
                {result.overallOk
                  ? t('api.diagnostic.overallSuccess', { ms: result.totalLatencyMs })
                  : t('api.diagnostic.overallFail', {
                      step:
                        t(`api.diagnostic.step.${result.failedAt}`, '') ||
                        STEP_NAME_FALLBACKS[result.failedAt ?? ''] ||
                        result.failedAt,
                    })}
              </span>
              <span className="text-text-muted text-xs">{result.totalLatencyMs}ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
