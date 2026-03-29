/**
 * Runtime preflight check — verifies critical bundled resources exist at startup.
 * Only runs in packaged mode (app.isPackaged === true).
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log, logWarn } from './utils/logger';

export interface PreflightIssue {
  resource: string;
  severity: 'critical' | 'warning';
  message: string;
}

export function runPreflight(): PreflightIssue[] {
  if (!app.isPackaged) return [];

  const issues: PreflightIssue[] = [];
  const resources = process.resourcesPath;
  const platform = process.platform;

  // Check function
  function check(relativePath: string, resource: string, severity: 'critical' | 'warning') {
    const fullPath = path.join(resources, relativePath);
    if (!fs.existsSync(fullPath)) {
      issues.push({ resource, severity, message: `Missing: ${relativePath}` });
    }
  }

  // Critical checks (all platforms)
  check('mcp/gui-operate-server.js', 'MCP Server (GUI)', 'critical');

  // Platform-specific
  if (platform === 'darwin') {
    check('node/bin/node', 'Bundled Node.js', 'critical');
    check('lima-agent/index.js', 'Lima Sandbox Agent', 'warning');
  } else if (platform === 'win32') {
    check('node/node.exe', 'Bundled Node.js', 'critical');
    check('wsl-agent/index.js', 'WSL Sandbox Agent', 'warning');
  } else {
    check('node/bin/node', 'Bundled Node.js', 'critical');
  }

  // Non-critical checks
  check('skills', 'Built-in Skills', 'warning');

  // Log results
  for (const issue of issues) {
    if (issue.severity === 'critical') {
      log(`[Preflight] CRITICAL: ${issue.resource} — ${issue.message}`);
    } else {
      logWarn(`[Preflight] WARNING: ${issue.resource} — ${issue.message}`);
    }
  }

  return issues;
}
