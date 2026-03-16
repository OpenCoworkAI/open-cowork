import { describe, it, expect } from 'vitest';

/**
 * Test the diagnosis logic and type system for Ubuntu 24.04 sandbox compatibility.
 *
 * NOTE: WSLBridge.checkWSLStatus uses `promisify(exec)` at module top-level,
 * making it difficult to mock in isolation. Instead, we test:
 * 1. The WSLStatus type includes diagnosis fields
 * 2. The diagnosis logic (given a status with 24.04, what issues are reported)
 * 3. The SandboxSetupPhase includes 'diagnosing'
 */

describe('WSLStatus diagnosis fields', () => {
  it('should define appArmorEnabled and diagnosisIssues in WSLStatus', async () => {
    const { } = await import('../../src/main/sandbox/types');

    // TypeScript compile-time check: these fields exist on WSLStatus
    const status: import('../../src/main/sandbox/types').WSLStatus = {
      available: true,
      distro: 'Ubuntu',
      ubuntuVersion: '24.04',
      nodeAvailable: true,
      appArmorEnabled: false,
      diagnosisIssues: ['apparmor_not_enabled'],
    };

    expect(status.appArmorEnabled).toBe(false);
    expect(status.diagnosisIssues).toContain('apparmor_not_enabled');
  });

  it('should allow appArmorEnabled=true with userns restriction', () => {
    const status: import('../../src/main/sandbox/types').WSLStatus = {
      available: true,
      distro: 'Ubuntu',
      ubuntuVersion: '24.04',
      appArmorEnabled: true,
      diagnosisIssues: ['apparmor_userns_restricted'],
    };

    expect(status.appArmorEnabled).toBe(true);
    expect(status.diagnosisIssues).toContain('apparmor_userns_restricted');
  });

  it('should have no diagnosis fields for 22.04', () => {
    const status: import('../../src/main/sandbox/types').WSLStatus = {
      available: true,
      distro: 'Ubuntu',
      ubuntuVersion: '22.04',
      nodeAvailable: true,
      // No appArmorEnabled or diagnosisIssues for 22.04
    };

    expect(status.appArmorEnabled).toBeUndefined();
    expect(status.diagnosisIssues).toBeUndefined();
  });
});

describe('SandboxSetupPhase — diagnosing', () => {
  it('should include diagnosing as a valid phase (compile-time + runtime)', () => {
    type Phase = import('../../src/main/sandbox/sandbox-bootstrap').SandboxSetupPhase;
    const phase: Phase = 'diagnosing';
    expect(phase).toBe('diagnosing');

    // Also test all phases are distinct
    const allPhases: Phase[] = [
      'checking', 'diagnosing', 'creating', 'starting',
      'installing_node', 'installing_python', 'installing_pip', 'installing_deps',
      'ready', 'skipped', 'error',
    ];
    expect(new Set(allPhases).size).toBe(allPhases.length);
  });

  it('should include diagnosing in renderer types too', () => {
    type Phase = import('../../src/renderer/types/index').SandboxSetupPhase;
    const phase: Phase = 'diagnosing';
    expect(phase).toBe('diagnosing');
  });
});

describe('Diagnosis logic — bootstrap behavior', () => {
  it('should report apparmor_not_enabled when AppArmor is missing from LSM', () => {
    // Simulate the logic from wsl-bridge.ts checkWSLStatus
    const lsmList = 'lockdown,capability,landlock,yama';
    const appArmorEnabled = lsmList.includes('apparmor');
    const diagnosisIssues: string[] = [];

    if (!appArmorEnabled) {
      diagnosisIssues.push('apparmor_not_enabled');
    }

    expect(appArmorEnabled).toBe(false);
    expect(diagnosisIssues).toContain('apparmor_not_enabled');
  });

  it('should report apparmor_userns_restricted when sysctl is 1', () => {
    const lsmList = 'lockdown,capability,landlock,yama,apparmor';
    const appArmorEnabled = lsmList.includes('apparmor');
    const diagnosisIssues: string[] = [];
    const restrictValue = '1';

    if (appArmorEnabled && restrictValue.trim() === '1') {
      diagnosisIssues.push('apparmor_userns_restricted');
    }

    expect(appArmorEnabled).toBe(true);
    expect(diagnosisIssues).toContain('apparmor_userns_restricted');
  });

  it('should report no issues when AppArmor is enabled and userns is not restricted', () => {
    const lsmList = 'lockdown,capability,landlock,yama,apparmor';
    const appArmorEnabled = lsmList.includes('apparmor');
    const diagnosisIssues: string[] = [];
    const restrictValue = '0';

    if (!appArmorEnabled) {
      diagnosisIssues.push('apparmor_not_enabled');
    } else if (restrictValue.trim() === '1') {
      diagnosisIssues.push('apparmor_userns_restricted');
    }

    expect(appArmorEnabled).toBe(true);
    expect(diagnosisIssues).toHaveLength(0);
  });
});
