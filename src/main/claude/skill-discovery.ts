/**
 * Skill scanning and discovery from multiple sources.
 * Extracted from agent-runner.ts for modularity.
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { log, logWarn, logError } from '../utils/logger';

interface DiscoveredSkill {
  name: string;
  description: string;
  skillMdPath: string;
}

/**
 * Get the built-in skills directory (shipped with the app).
 */
export function getBuiltinSkillsPath(): string {
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
    path.join(unpackedPath, '.claude', 'skills'),
    path.join(appPath, '.claude', 'skills'),
    path.join(process.resourcesPath || '', 'skills'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log('[SkillDiscovery] Found built-in skills at:', p);
      return p;
    }
  }

  logWarn('[SkillDiscovery] No built-in skills directory found');
  return '';
}

/**
 * Get the Navi (OpenClaw) agent skills directory.
 * These are the career agent's built-in skills (career-dev, platform-connect, skillception).
 */
export function getNaviSkillsPath(): string {
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', 'src', 'openclaw', 'skills'),
    path.join(unpackedPath, 'src', 'openclaw', 'skills'),
    path.join(appPath, 'src', 'openclaw', 'skills'),
    path.join(unpackedPath, 'openclaw', 'skills'),
    path.join(appPath, 'openclaw', 'skills'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log('[SkillDiscovery] Found Navi skills at:', p);
      return p;
    }
  }

  return '';
}

/**
 * Get the app-specific Claude configuration directory.
 */
export function getAppClaudeDir(): string {
  return path.join(app.getPath('userData'), 'claude');
}

/**
 * Get the user's global Claude skills directory.
 */
export function getUserClaudeSkillsDir(): string {
  return path.join(app.getPath('home'), '.claude', 'skills');
}

/**
 * Copy a directory recursively (synchronous).
 */
export function copyDirectorySync(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(source);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

/**
 * Sync user-installed skills from ~/.claude/skills/ into the app's skills directory.
 * Creates symlinks where possible, falls back to copying.
 */
export function syncUserSkillsToAppDir(appSkillsDir: string): void {
  const userSkillsDir = getUserClaudeSkillsDir();
  if (!fs.existsSync(userSkillsDir)) {
    return;
  }

  const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(userSkillsDir, entry.name);
    const targetPath = path.join(appSkillsDir, entry.name);

    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.lstatSync(targetPath);
        if (!stat.isSymbolicLink()) {
          continue;
        }
        fs.unlinkSync(targetPath);
      } catch {
        continue;
      }
    }

    try {
      fs.symlinkSync(sourcePath, targetPath, 'dir');
    } catch (_err) {
      try {
        copyDirectorySync(sourcePath, targetPath);
      } catch (copyErr) {
        logWarn('[SkillDiscovery] Failed to import user skill:', entry.name, copyErr);
      }
    }
  }
}

/**
 * Read the description from a SKILL.md file's frontmatter.
 */
function readSkillDescription(skillMdPath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);
    if (descMatch) {
      return descMatch[1];
    }
  } catch (_e) { /* ignore */ }
  return fallback;
}

/**
 * Scan a directory for skills (directories containing SKILL.md).
 */
function scanSkillsDir(
  skillsDir: string,
  descriptionPrefix: string,
  existing: DiscoveredSkill[],
  override: boolean,
): void {
  if (!fs.existsSync(skillsDir)) return;

  try {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const description = readSkillDescription(skillMdPath, `${descriptionPrefix} ${dir.name}`);
      const skill: DiscoveredSkill = { name: dir.name, description, skillMdPath };

      const existingIdx = existing.findIndex(s => s.name === dir.name);
      if (existingIdx >= 0 && override) {
        existing[existingIdx] = skill;
      } else if (existingIdx < 0) {
        existing.push(skill);
      }
    }
  } catch (e) {
    logError(`[SkillDiscovery] Error scanning skills in ${skillsDir}:`, e);
  }
}

/**
 * Scan for available skills from all 4 sources and return formatted prompt section.
 */
export function getAvailableSkillsPrompt(workingDir?: string): string {
  const skills: DiscoveredSkill[] = [];

  // 1. Built-in skills (shipped with app)
  const builtinSkillsPath = getBuiltinSkillsPath();
  if (builtinSkillsPath) {
    scanSkillsDir(builtinSkillsPath, 'Skill for', skills, false);
  }

  // 1b. Navi agent skills (career-dev, platform-connect, skillception)
  const naviSkillsPath = getNaviSkillsPath();
  if (naviSkillsPath) {
    scanSkillsDir(naviSkillsPath, 'Navi agent skill:', skills, true);
  }

  // 2. Global skills (app-specific directory)
  const globalSkillsPath = path.join(getAppClaudeDir(), 'skills');
  scanSkillsDir(globalSkillsPath, 'User skill for', skills, true);

  // 3. Project-level skills (in working directory)
  if (workingDir) {
    const projectSkillsPaths = [
      path.join(workingDir, '.claude', 'skills'),
      path.join(workingDir, '.skills'),
      path.join(workingDir, 'skills'),
    ];
    for (const skillsDir of projectSkillsPaths) {
      scanSkillsDir(skillsDir, 'Project skill for', skills, true);
    }
  }

  if (skills.length === 0) {
    return '<available_skills>\nNo skills available.\n</available_skills>';
  }

  const skillsList = skills.map(s =>
    `- **${s.name}**: ${s.description}\n  SKILL.md path: ${s.skillMdPath}`
  ).join('\n');

  return `<available_skills>
The following skills are available. **CRITICAL**: Before starting any task that involves creating or editing files of these types, you MUST first read the corresponding SKILL.md file using the Read tool:

${skillsList}

**How to use skills:**
1. Identify which skill is relevant to your task (e.g., "pptx" for PowerPoint, "docx" for Word, "pdf" for PDF)
2. Use the Read tool to read the SKILL.md file at the path shown above
3. Follow the instructions in the SKILL.md file exactly
4. The skills contain proven workflows that produce high-quality results

**Example**: If the user asks to create a PowerPoint presentation:
\`\`\`
Read the file: ${skills.find(s => s.name === 'pptx')?.skillMdPath || '[pptx skill path]'}
\`\`\`
Then follow the workflow described in that file.
</available_skills>`;
}
