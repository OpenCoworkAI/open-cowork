import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string): string => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

/**
 * Regression guard for the macOS sandbox-detection bug.
 *
 * In the packaged macOS app, GUI processes inherit a stripped launchd PATH that
 * excludes /opt/homebrew/bin and /usr/local/bin. The sandbox/Lima detection
 * (`which limactl`) runs at startup and from the `sandbox.checkLima` IPC, so it
 * must run AFTER the login-shell PATH has been restored — otherwise Lima is
 * reported as unavailable even when it is installed. The PATH enrichment used to
 * run only before the first `createCodingTools()` call (an agent task), which is
 * too late for the sandbox detection.
 */
describe('PATH enrichment is wired into app startup, before sandbox detection', () => {
  const agentRunner = read('src/main/claude/agent-runner.ts');
  const indexTs = read('src/main/index.ts');

  it('exports enrichProcessPathForBuild so the startup path can reuse it', () => {
    expect(agentRunner).toMatch(/export\s+async\s+function\s+enrichProcessPathForBuild/);
  });

  it('keeps the enrichment idempotent so repeated calls are safe', () => {
    expect(agentRunner).toContain('let pathEnriched = false;');
    expect(agentRunner).toContain('if (pathEnriched) return;');
  });

  it('imports the enrichment into the main entrypoint', () => {
    expect(indexTs).toMatch(
      /import\s*\{\s*enrichProcessPathForBuild\s*\}\s*from\s*['"]\.\/claude\/agent-runner['"]/
    );
  });

  it('awaits the enrichment during the whenReady startup sequence', () => {
    const readyIdx = indexTs.indexOf('.whenReady()');
    const enrichIdx = indexTs.indexOf('await enrichProcessPathForBuild()');
    expect(readyIdx).toBeGreaterThan(-1);
    expect(enrichIdx).toBeGreaterThan(-1);
    // The enrichment must be invoked from the startup sequence, not only from
    // the lazy agent-task path, so it precedes any Lima detection.
    expect(enrichIdx).toBeGreaterThan(readyIdx);
  });
});
