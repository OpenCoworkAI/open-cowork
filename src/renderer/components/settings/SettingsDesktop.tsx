import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  Download,
  FlaskConical,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import { SettingsContentSection } from './shared';
import type { DesktopAccessMode } from '../../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type AgentDesktopBinarySource =
  | 'env-override'
  | 'bundled'
  | 'user-data-cache'
  | 'path'
  | 'not-found';

type AgentDesktopInstallState = 'installed' | 'manual' | 'available' | 'unavailable';

interface DesktopStatus {
  mode: DesktopAccessMode;
  platform: string;
  binaryFound: boolean;
  binaryPath?: string;
  version?: string;
  permissions?: {
    accessibility?: { state: string };
    automation?: { state: string };
    screen_recording?: { state: string };
  };
  error?: string;
  binarySource?: AgentDesktopBinarySource;
  binarySha256?: string;
  installState?: AgentDesktopInstallState;
  availableVersion?: string;
  installable?: boolean;
  /**
   * O modo `native` (camada FFI, Fase 5) está implementado?
   *
   * Vem do registro canônico no processo principal. A UI deriva de aqui a
   * decisão de renderizar `native` como opção selecionável ou como item
   * desabilitado — a regra de reserva não é replicada no renderer.
   */
  nativeModeImplemented?: boolean;
}

/**
 * Chave de i18n da origem do binário.
 *
 * A origem é a informação que dá **confiança**: um binário instalado pela
 * app tem digest conferido; um binário vindo do PATH ou de override por
 * variável de ambiente é de origem desconhecida.
 */
const SOURCE_LABEL_KEY: Record<AgentDesktopBinarySource, string> = {
  'env-override': 'desktop.sourceEnvOverride',
  bundled: 'desktop.sourceBundled',
  'user-data-cache': 'desktop.sourceInstalled',
  path: 'desktop.sourcePath',
  'not-found': 'desktop.sourceNotFound',
};

const MODE_OPTIONS: { value: DesktopAccessMode; icon: typeof Monitor }[] = [
  { value: 'off', icon: CircleSlash },
  { value: 'mcp', icon: Monitor },
  { value: 'mcp+skill', icon: Monitor },
];

/**
 * O modo `native` é **reservado** para a camada FFI (Fase 5).
 *
 * Enquanto o processo principal reportar `nativeModeImplemented: false`, a
 * opção é renderizada como item **indisponível** (sem `onClick`, esmaecida,
 * com aviso) — e não como botão selecionável. A regra de reserva em si vive
 * no registro canônico `src/main/desktop/desktop-access-modes.ts`; o renderer
 * só consome o veredito.
 */

/**
 * Limitacoes conhecidas do capability, exibidas no fim do painel.
 *
 * Sao fatos verificados em campo, nao estimativas: o binario nao e
 * distribuido pelo app, o modo nativo (FFI) nao existe e sessoes remotas
 * via RDP nao sao observaveis a partir do host.
 */
const LIMITATION_KEYS = ['limitBinary', 'limitNative', 'limitRdp'] as const;

/**
 * Estado de uma permissão, mapeado para a classe visual.
 *
 * `granted` → ok; `denied` → erro; `not_required` → neutro;
 * qualquer outro valor (inclusive ausente) → **desconhecido**, nunca "ok".
 */
function permissionTone(state?: string): 'ok' | 'error' | 'neutral' | 'unknown' {
  if (!state) return 'unknown';
  if (state === 'granted') return 'ok';
  if (state === 'denied') return 'error';
  if (state === 'not_required') return 'neutral';
  return 'unknown';
}

const TONE_CLASS: Record<string, string> = {
  ok: 'text-success',
  error: 'text-error',
  neutral: 'text-text-muted',
  unknown: 'text-text-muted',
};

export function SettingsDesktop() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<DesktopAccessMode>('off');
  const [physicalInput, setPhysicalInput] = useState(false);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isElectron) return null;
    setIsChecking(true);
    try {
      const next = await window.electronAPI.desktop.getStatus();
      setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        const cfg = await window.electronAPI.config.get();
        if (cancelled) return;
        setMode((cfg.desktopAccessMode ?? 'off') as DesktopAccessMode);
        setPhysicalInput(cfg.desktopPhysicalInputEnabled ?? false);
        await refreshStatus();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  async function persist(next: Partial<{ desktopAccessMode: DesktopAccessMode; desktopPhysicalInputEnabled: boolean }>) {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await window.electronAPI.config.save(next);
      setSuccess(t('desktop.saved'));
      // O status depende do binário e das permissões, não do modo — mas a
      // permissão física exibida pode mudar, então relemos.
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function changeMode(next: DesktopAccessMode) {
    if (next === mode) return;
    setMode(next);
    await persist({ desktopAccessMode: next });
  }

  async function togglePhysicalInput(next: boolean) {
    setPhysicalInput(next);
    await persist({ desktopPhysicalInputEnabled: next });
  }

  /**
   * Instala (ou reinstala) o binário oficial sob demanda.
   *
   * O download, a verificação de SHA-256 e a extração acontecem no processo
   * principal — a renderer só pede e mostra o resultado. A falha é declarada
   * com o código estruturado, sem "deixar como se tivesse dado certo".
   */
  async function installBinary() {
    if (!isElectron) return;
    setIsInstalling(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.desktop.install();
      if (!result.ok) {
        setError(result.error ?? t('desktop.installFailed'));
        await refreshStatus();
        return;
      }
      if (result.status) setStatus(result.status);
      setSuccess(
        result.alreadyInstalled
          ? t('desktop.installAlreadyCurrent')
          : t('desktop.installSuccess')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInstalling(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  const permissionRows: { key: string; labelKey: string; state?: string }[] = [
    { key: 'accessibility', labelKey: 'desktop.permissionAccessibility', state: status?.permissions?.accessibility?.state },
    { key: 'automation', labelKey: 'desktop.permissionAutomation', state: status?.permissions?.automation?.state },
    { key: 'screen_recording', labelKey: 'desktop.permissionScreenRecording', state: status?.permissions?.screen_recording?.state },
  ];

  return (
    <div className="space-y-1">
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-sm text-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/30 text-sm text-success">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/*
       * O capability está validado, mas a feature ainda NÃO está pronta para
       * uso geral: o binário não é distribuído pelo app e o modo nativo (FFI)
       * não existe. Declarar isso na própria tela evita que uma aba de
       * Configurações pareça um recurso de produto já disponível.
       */}
      <div className="flex items-start gap-3 p-3.5 rounded-lg border border-warning/30 bg-warning/10">
        <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">
            {t('desktop.experimentalTitle')}
          </p>
          <p className="text-xs leading-5 text-text-muted">
            {t('desktop.experimentalNotice')}
          </p>
        </div>
      </div>

      <SettingsContentSection
        title={t('desktop.modeTitle')}
        description={t('desktop.modeDescription')}
      >
        <div className="space-y-2">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void changeMode(option.value)}
                disabled={isSaving}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all disabled:opacity-60 ${
                  selected
                    ? 'border-accent bg-accent/10'
                    : 'border-border-muted hover:border-accent/50'
                }`}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-text-primary">
                    {t(`desktop.mode_${option.value.replace('+', '_')}`)}
                  </span>
                  <span className="block text-xs leading-5 text-text-muted">
                    {t(`desktop.mode_${option.value.replace('+', '_')}Desc`)}
                  </span>
                </span>
              </button>
            );
          })}

          {/*
           * `native` existe no contrato, mas depende da camada FFI (Fase 5).
           * Enquanto o main reportar que não está implementado, ele aparece
           * como indisponível — oferecer um modo que não funciona seria
           * enganoso.
           */}
          {status?.nativeModeImplemented ? (
            <button
              type="button"
              onClick={() => void changeMode('native')}
              disabled={isSaving}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all disabled:opacity-60 ${
                mode === 'native'
                  ? 'border-accent bg-accent/10'
                  : 'border-border-muted hover:border-accent/50'
              }`}
            >
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" />
              <span className="space-y-1">
                <span className="block text-sm font-medium text-text-primary">
                  {t('desktop.mode_native')}
                </span>
                <span className="block text-xs leading-5 text-text-muted">
                  {t('desktop.mode_nativeDesc')}
                </span>
              </span>
            </button>
          ) : (
            <div className="w-full flex items-start gap-3 p-3 rounded-lg border border-border-muted opacity-60">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" />
              <span className="space-y-1">
                <span className="block text-sm font-medium text-text-primary">
                  {t('desktop.mode_native')}
                </span>
                <span className="block text-xs leading-5 text-text-muted">
                  {t('desktop.mode_nativeDesc')}
                </span>
              </span>
            </div>
          )}
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('desktop.physicalTitle')}
        description={t('desktop.physicalDescription')}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={physicalInput}
            disabled={isSaving || mode === 'off'}
            onChange={(e) => void togglePhysicalInput(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[var(--accent)] disabled:opacity-50"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-text-primary">
              {t('desktop.physicalLabel')}
            </span>
            <span className="block text-xs leading-5 text-text-muted">
              {t('desktop.physicalHint')}
            </span>
          </span>
        </label>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('desktop.statusTitle')}
        description={t('desktop.statusDescription')}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-text-primary">
                {status?.binaryFound ? t('desktop.binaryFound') : t('desktop.binaryMissing')}
              </p>
              {status?.version && (
                <p className="text-xs text-text-muted">
                  {t('desktop.version')} {status.version}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={isChecking}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-muted text-xs text-text-secondary hover:border-accent/50 hover:text-text-primary transition-all disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              {t('desktop.checkNow')}
            </button>
          </div>

          {status?.error && (
            <p className="text-xs text-error">{status.error}</p>
          )}

          {/* Procedência do binário: de onde veio e qual o digest conferido. */}
          {status?.binarySource && (
            <div className="space-y-1 rounded-lg border border-border-muted p-3">
              <p className="text-xs font-medium text-text-secondary">
                {t('desktop.sourceTitle')}
              </p>
              <p className="text-xs text-text-muted">
                {t(SOURCE_LABEL_KEY[status.binarySource])}
              </p>
              {status.binarySha256 && (
                <p className="text-xs text-text-muted break-all">
                  {t('desktop.binarySha256')}{' '}
                  <code className="font-mono">{status.binarySha256}</code>
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {permissionRows.map((row) => {
              const tone = permissionTone(row.state);
              return (
                <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{t(row.labelKey)}</span>
                  <span className={`font-medium ${TONE_CLASS[tone]}`}>
                    {row.state ?? t('desktop.permissionUnknown')}
                  </span>
                </div>
              );
            })}
          </div>

          {/*
           * Distribuição sob demanda: quando existe build oficial para a
           * plataforma, o app baixa e verifica o binário por conta própria.
           * Sem build oficial, a falha é declarada — nunca uma tela vazia.
           */}
          {status?.installable && !status?.binaryFound && (
            <div className="space-y-2">
              <p className="text-xs leading-5 text-text-muted">{t('desktop.installHint')}</p>
              <button
                type="button"
                onClick={() => void installBinary()}
                disabled={isInstalling}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-accent text-xs text-accent hover:bg-accent/10 transition-all disabled:opacity-60"
              >
                {isInstalling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {isInstalling ? t('desktop.installing') : t('desktop.installAction')}
              </button>
            </div>
          )}

          {!status?.binaryFound && !status?.installable && (
            <p className="text-xs leading-5 text-text-muted">{t('desktop.binaryMissingHint')}</p>
          )}
        </div>
      </SettingsContentSection>

      <SettingsContentSection
        title={t('desktop.limitationsTitle')}
        description={t('desktop.limitationsDescription')}
      >
        <ul className="space-y-2">
          {LIMITATION_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2 text-xs leading-5 text-text-muted">
              <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
              <span>{t(`desktop.${key}`)}</span>
            </li>
          ))}
        </ul>
      </SettingsContentSection>
    </div>
  );
}
