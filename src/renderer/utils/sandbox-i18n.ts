import type { TFunction } from 'i18next';
import type { SandboxSetupProgress, SandboxSyncStatus } from '../types';

function translateSetupMessage(t: TFunction, message: string): string {
  const map: Record<string, string> = {
    'Sandbox disabled': 'sandbox.sandboxDisabledMessage',
    'Using native execution mode': 'sandbox.nativeModeMessage',
    'Sandbox setup failed': 'sandbox.setupFailedMessage',
    'Checking WSL2 environment...': 'sandbox.checkingWsl',
    'WSL2 not detected, using native mode': 'sandbox.wslNotDetectedMessage',
    'Installing Node.js...': 'sandbox.installingNode',
    'Node.js installation failed': 'sandbox.nodeInstallFailedMessage',
    'Installing Python...': 'sandbox.installingPython',
    'Installing skill dependencies...': 'sandbox.installingDeps',
    'Installing pip...': 'sandbox.installingPip',
    'WSL2 sandbox ready': 'sandbox.wslReadyMessage',
    'Checking Lima environment...': 'sandbox.checkingLima',
    'Lima not detected, using native mode': 'sandbox.limaNotDetectedMessage',
    'Creating Lima VM...': 'sandbox.creatingLima',
    'Lima VM creation failed': 'sandbox.limaCreateFailedMessage',
    'Starting Lima VM...': 'sandbox.startingLima',
    'Lima VM startup failed': 'sandbox.limaStartFailedMessage',
    'Lima sandbox ready': 'sandbox.limaReadyMessage',
  };
  const key = map[message];
  return key ? t(key) : message;
}

function translateSetupDetail(t: TFunction, detail?: string): string | undefined {
  if (!detail) return undefined;
  const nodeWslMatch = detail.match(/^Installing Node\.js runtime in (.+)$/);
  if (nodeWslMatch) {
    return t('sandbox.setupDetailInstallNodeWslRuntime', { distro: nodeWslMatch[1] });
  }
  const pythonWslMatch = detail.match(/^Installing Python runtime in (.+)$/);
  if (pythonWslMatch) {
    return t('sandbox.setupDetailInstallPythonWslRuntime', { distro: pythonWslMatch[1] });
  }
  const pipWslMatch = detail.match(/^Installing Python package manager in (.+)$/);
  if (pipWslMatch) {
    return t('sandbox.setupDetailInstallPipWslRuntime', { distro: pipWslMatch[1] });
  }
  const map: Record<string, string> = {
    'Using native execution mode (sandbox disabled in settings)':
      'sandbox.setupDetailSandboxDisabled',
    'Linux runs commands directly': 'sandbox.setupDetailLinuxNative',
    'Install WSL2 for better sandbox isolation': 'sandbox.setupDetailInstallWsl',
    'Please install Node.js manually in WSL': 'sandbox.setupDetailInstallNodeWsl',
    'Installing markitdown, pypdf, pdfplumber for PDF/PPTX skills':
      'sandbox.setupDetailInstallDeps',
    'Install Lima for better sandbox isolation (brew install lima)':
      'sandbox.setupDetailInstallLima',
    'First run requires image download, may take a few minutes': 'sandbox.setupDetailCreateLima',
    'VM startup may take a few minutes': 'sandbox.setupDetailStartLima',
    'Installing Node.js runtime in Lima VM': 'sandbox.setupDetailInstallNodeLima',
    'Installing Python runtime in Lima VM': 'sandbox.setupDetailInstallPythonLima',
  };
  const key = map[detail];
  return key ? t(key) : detail;
}

function translateSyncMessage(t: TFunction, message: string): string {
  const map: Record<string, string> = {
    'Syncing files to sandbox...': 'sandbox.syncingFilesMessage',
    'Configuring skills...': 'sandbox.syncingSkillsMessage',
    'Sandbox ready': 'sandbox.syncReadyMessage',
    'Sandbox sync failed': 'sandbox.syncFailedMessage',
  };
  const key = map[message];
  return key ? t(key) : message;
}

function translateSyncDetail(t: TFunction, detail?: string): string | undefined {
  if (!detail) return undefined;
  const map: Record<string, string> = {
    'Copying project files to isolated WSL environment': 'sandbox.syncDetailWsl',
    'Copying project files to isolated Lima environment': 'sandbox.syncDetailLima',
    'Copying built-in skills to sandbox': 'sandbox.syncDetailSkills',
    'Falling back to direct access mode (less secure)': 'sandbox.syncDetailFallback',
  };
  if (/^Synced \d+ files$/.test(detail)) {
    const count = Number(detail.match(/^Synced (\d+) files$/)?.[1] || 0);
    return t('sandbox.syncDetailCompleted', { count });
  }
  const key = map[detail];
  return key ? t(key) : detail;
}

export function getSandboxSetupDisplayText(
  t: TFunction,
  progress: SandboxSetupProgress
): { message: string; detail?: string } {
  return {
    message: translateSetupMessage(t, progress.message),
    detail: translateSetupDetail(t, progress.detail),
  };
}

export function getSandboxSyncDisplayText(
  t: TFunction,
  status: SandboxSyncStatus
): { message: string; detail?: string } {
  return {
    message: translateSyncMessage(t, status.message),
    detail: translateSyncDetail(t, status.detail),
  };
}
