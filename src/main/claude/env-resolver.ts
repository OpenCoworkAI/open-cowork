/**
 * Shell environment resolution and Claude Code path discovery.
 * Extracted from agent-runner.ts for modularity.
 */

import { app } from 'electron';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from '../utils/logger';

// Cache for shell environment (loaded once at startup)
let cachedShellEnv: NodeJS.ProcessEnv | null = null;

/**
 * Summarise environment variables for safe logging (redacts keys/tokens).
 */
export function summarizeEnvForLog(env: NodeJS.ProcessEnv): Record<string, string> {
  const pick = (key: string): string => {
    const value = env[key];
    if (!value) return '(empty/unset)';
    if (key === 'PATH') return `${value.substring(0, 120)}...`;
    if (key.includes('KEY') || key.includes('TOKEN')) return '✓ Set';
    return value;
  };

  return {
    ANTHROPIC_API_KEY: pick('ANTHROPIC_API_KEY'),
    ANTHROPIC_AUTH_TOKEN: pick('ANTHROPIC_AUTH_TOKEN'),
    ANTHROPIC_BASE_URL: pick('ANTHROPIC_BASE_URL'),
    CLAUDE_MODEL: pick('CLAUDE_MODEL'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: pick('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    OPENAI_API_KEY: pick('OPENAI_API_KEY'),
    OPENAI_BASE_URL: pick('OPENAI_BASE_URL'),
    OPENAI_MODEL: pick('OPENAI_MODEL'),
    CLAUDE_CONFIG_DIR: pick('CLAUDE_CONFIG_DIR'),
    PATH: pick('PATH'),
  };
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it.
 */
export function getShellEnvironment(): NodeJS.ProcessEnv {
  const fnStart = Date.now();

  if (cachedShellEnv) {
    log(`[ShellEnv] Returning cached env (0ms)`);
    return cachedShellEnv;
  }

  const platform = process.platform;
  let shellPath = process.env.PATH || '';

  log('[ShellEnv] Original PATH:', shellPath);
  log(`[ShellEnv] Starting shell PATH extraction...`);

  if (platform === 'darwin' || platform === 'linux') {
    try {
      const execStart = Date.now();
      const shellEnvOutput = execSync('/bin/bash -l -c "echo $PATH"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      log(`[ShellEnv] execSync took ${Date.now() - execStart}ms`);

      if (shellEnvOutput) {
        shellPath = shellEnvOutput;
        log('[ShellEnv] Got PATH from login shell:', shellPath);
      }
    } catch (_e) {
      logWarn('[ShellEnv] Failed to get PATH from login shell, using fallback');

      const home = process.env.HOME || '';
      const fallbackPaths = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        `${home}/.nvm/versions/node/*/bin`,
        `${home}/.local/bin`,
        `${home}/.npm-global/bin`,
      ];

      const nvmDir = path.join(home, '.nvm/versions/node');
      if (fs.existsSync(nvmDir)) {
        try {
          const versions = fs.readdirSync(nvmDir);
          for (const version of versions) {
            fallbackPaths.push(path.join(nvmDir, version, 'bin'));
          }
        } catch (_e) { /* ignore */ }
      }

      shellPath = [...fallbackPaths.filter(p => fs.existsSync(p) || p.includes('*')), shellPath].join(':');
    }
  }

  cachedShellEnv = {
    ...process.env,
    PATH: shellPath,
  };

  log(`[ShellEnv] Total getShellEnvironment took ${Date.now() - fnStart}ms`);
  return cachedShellEnv;
}

/**
 * Get current model from environment variables.
 * For OpenRouter, ANTHROPIC_DEFAULT_SONNET_MODEL is the key that controls model selection.
 */
export function getCurrentModel(): string {
  const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4';
  log('[ClaudeAgentRunner] Current model:', model);
  log('[ClaudeAgentRunner] ANTHROPIC_DEFAULT_SONNET_MODEL:', process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '(not set)');
  return model;
}

/**
 * Locate the claude-code CLI executable on the system.
 * Searches bundled paths, npm global, nvm, homebrew, etc.
 */
export function getDefaultClaudeCodePath(): string {
  const fnStart = Date.now();
  const logFnTiming = (label: string) => {
    log(`[ClaudeCodePath] ${label}: ${Date.now() - fnStart}ms`);
  };

  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const isPackaged = app.isPackaged;

  log('[ClaudeAgentRunner] Looking for claude-code...');
  log('[ClaudeAgentRunner] isPackaged:', isPackaged);
  log('[ClaudeAgentRunner] app.getAppPath():', app.getAppPath());
  log('[ClaudeAgentRunner] process.resourcesPath:', process.resourcesPath);
  log('[ClaudeAgentRunner] __dirname:', __dirname);
  log('[ClaudeAgentRunner] process.execPath:', process.execPath);

  // 1. FIRST: Check bundled version in app's node_modules (highest priority)
  const bundledPaths: string[] = [];

  if (isPackaged && process.resourcesPath) {
    bundledPaths.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(process.resourcesPath, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(process.resourcesPath, 'app', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    );
  }

  bundledPaths.push(
    path.join(__dirname, '..', '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(app.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  );

  for (const bundledPath of bundledPaths) {
    log('[ClaudeAgentRunner] Checking:', bundledPath, '- exists:', fs.existsSync(bundledPath));
    if (fs.existsSync(bundledPath)) {
      log('[ClaudeAgentRunner] ✓ Found bundled claude-code at:', bundledPath);
      return bundledPath;
    }
  }

  // 2. Try to find claude using shell with full environment (works with nvm, etc.)
  if (platform !== 'win32') {
    try {
      const claudePath = execSync('/bin/bash -l -c "which claude"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (claudePath && fs.existsSync(claudePath)) {
        log('[ClaudeAgentRunner] Found claude via bash -l:', claudePath);
        return claudePath;
      }
    } catch (_e) {
      log('[ClaudeAgentRunner] bash -l which failed, trying fallbacks');
    }
  }

  // 3. Try npm root -g with shell environment
  logFnTiming('before npm root -g');
  if (platform !== 'win32') {
    try {
      const npmStart = Date.now();
      const npmRoot = execSync('/bin/bash -l -c "npm root -g"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      log(`[ClaudeCodePath] npm root -g took ${Date.now() - npmStart}ms`);

      const cliPath = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cliPath)) {
        log('[ClaudeAgentRunner] Found claude-code via npm root:', cliPath);
        logFnTiming('returning (found via npm root)');
        return cliPath;
      }
    } catch (e) {
      log(`[ClaudeCodePath] npm root -g failed: ${(e as Error).message}`);
    }
  }
  logFnTiming('after npm root -g');

  // 4. Build list of possible system paths based on platform
  const possiblePaths: string[] = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || '';
    possiblePaths.push(
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    );
  } else if (platform === 'darwin') {
    possiblePaths.push(
      '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      path.join(home, 'Library/pnpm/global/5/node_modules/@anthropic-ai/claude-code/cli.js'),
      path.join(home, '.local/share/pnpm/global/5/node_modules/@anthropic-ai/claude-code/cli.js'),
    );

    const nvmDir = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir);
        for (const version of versions) {
          possiblePaths.push(
            path.join(nvmDir, version, 'lib/node_modules/@anthropic-ai/claude-code/cli.js')
          );
        }
      } catch (_e) { /* ignore */ }
    }

    const fnmDir = path.join(home, 'Library/Application Support/fnm/node-versions');
    if (fs.existsSync(fnmDir)) {
      try {
        const versions = fs.readdirSync(fnmDir);
        for (const version of versions) {
          possiblePaths.push(
            path.join(fnmDir, version, 'installation/lib/node_modules/@anthropic-ai/claude-code/cli.js')
          );
        }
      } catch (_e) { /* ignore */ }
    }
  } else {
    possiblePaths.push(
      '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      path.join(home, '.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js'),
    );

    const nvmDir = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir);
        for (const version of versions) {
          possiblePaths.push(
            path.join(nvmDir, version, 'lib/node_modules/@anthropic-ai/claude-code/cli.js')
          );
        }
      } catch (_e) { /* ignore */ }
    }
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log('[ClaudeAgentRunner] Found claude-code at:', p);
      return p;
    }
  }

  logError('[ClaudeAgentRunner] Claude Code not found. Searched paths:', possiblePaths);
  return '';
}

/**
 * Check whether a model+baseUrl combination supports image inputs.
 */
export function supportsImageInputs(model: string | undefined, baseUrl: string | undefined): boolean {
  const modelLower = (model || '').toLowerCase();
  const baseLower = (baseUrl || '').toLowerCase();

  if (baseLower.includes('deepseek')) return false;
  if (baseLower.includes('open.bigmodel.cn')) return false;
  if (!modelLower) return false;

  return (
    modelLower.includes('claude-3') ||
    modelLower.includes('claude-3.5') ||
    modelLower.includes('claude-3-5') ||
    modelLower.includes('claude-4') ||
    modelLower.includes('claude-sonnet') ||
    modelLower.includes('claude-opus') ||
    modelLower.includes('claude-haiku')
  );
}
