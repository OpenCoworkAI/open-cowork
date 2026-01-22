import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Skill } from '../../renderer/types';
import type { DatabaseInstance } from '../db/database';
import { log, logError } from '../utils/logger';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface SkillConfig {
  name: string;
  description?: string;
  type: 'mcp' | 'custom';
  mcp?: McpServerConfig;
  enabled?: boolean;
}

/**
 * SkillsManager - Manages skill loading and MCP server lifecycle
 * 
 * Skills loading priority:
 * 1. Project-level: <project>/.skills/ or <project>/skills/
 * 2. Global: <userData>/claude/skills/ (includes ~/.claude/skills read-only)
 * 3. Built-in skills
 */
export class SkillsManager {
  private db: DatabaseInstance;
  private loadedSkills: Map<string, Skill> = new Map();
  private runningServers: Map<string, { process: any; skill: Skill }> = new Map();

  constructor(db: DatabaseInstance) {
    this.db = db;
    this.loadBuiltinSkills();
  }

  /**
   * Load built-in skills
   */
  private loadBuiltinSkills(): void {
    // Load skills from .claude/skills directory (like pdf, xlsx, docx, pptx)
    const builtinSkillsPath = this.getBuiltinSkillsPath();
    if (builtinSkillsPath) {
      try {
        const skillDirs = fs.readdirSync(builtinSkillsPath);

        for (const dir of skillDirs) {
          const skillPath = path.join(builtinSkillsPath, dir);
          const stat = fs.statSync(skillPath);

          if (!stat.isDirectory()) continue;

          // Look for SKILL.md
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (!fs.existsSync(skillMdPath)) continue;

          // Parse metadata
          const metadata = this.getSkillMetadata(skillPath);
          if (!metadata) continue;

          const skill: Skill = {
            id: `builtin-${dir}`,
            name: metadata.name,
            description: metadata.description,
            type: 'builtin',
            enabled: true,
            createdAt: Date.now(),
          };

          this.loadedSkills.set(skill.id, skill);
          log(`Loaded built-in skill: ${skill.name}`);
        }
      } catch (error) {
        logError('Failed to load built-in skills from .claude/skills:', error);
      }
    }
  }

  /**
   * Get the built-in skills directory path
   */
  private getBuiltinSkillsPath(): string {
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

    const possiblePaths = [
      // Development
      path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
      // Production (unpacked)
      path.join(unpackedPath, '.claude', 'skills'),
      // Fallback
      path.join(appPath, '.claude', 'skills'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return '';
  }

  private getGlobalSkillsPath(): string {
    return path.join(app.getPath('userData'), 'claude', 'skills');
  }

  private getUserSkillsPath(): string {
    return path.join(app.getPath('home'), '.claude', 'skills');
  }

  private async importUserSkills(globalSkillsPath: string): Promise<void> {
    const userSkillsPath = this.getUserSkillsPath();
    if (!fs.existsSync(userSkillsPath)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(userSkillsPath, entry.name);
      const targetPath = path.join(globalSkillsPath, entry.name);

      if (fs.existsSync(targetPath)) {
        continue;
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch (err) {
        try {
          await this.copyDirectory(sourcePath, targetPath);
        } catch (copyErr) {
          logError(`Failed to import user skill from ${sourcePath}:`, copyErr);
        }
      }
    }
  }

  /**
   * Load skills from a project directory
   */
  async loadProjectSkills(projectPath: string): Promise<Skill[]> {
    const skills: Skill[] = [];
    
    // Check for .skills/ or skills/ directory
    const skillsDirs = [
      path.join(projectPath, '.skills'),
      path.join(projectPath, 'skills'),
    ];

    for (const skillsDir of skillsDirs) {
      if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
        const loadedSkills = await this.loadSkillsFromDirectory(skillsDir, 'project');
        skills.push(...loadedSkills);
      }
    }

    return skills;
  }

  /**
   * Load global skills from user config directory
   */
  async loadGlobalSkills(): Promise<Skill[]> {
    // Use app-specific skills directory to avoid conflicts with user settings
    const globalSkillsPath = this.getGlobalSkillsPath();

    if (!fs.existsSync(globalSkillsPath)) {
      fs.mkdirSync(globalSkillsPath, { recursive: true });
    }

    await this.importUserSkills(globalSkillsPath);

    return this.loadSkillsFromDirectory(globalSkillsPath, 'global');
  }

  /**
   * Load skills from a directory
   */
  private async loadSkillsFromDirectory(
    dir: string,
    source: 'project' | 'global'
  ): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = fs.readdirSync(dir);

      for (const entry of entries) {
        const entryPath = path.join(dir, entry);
        const stat = fs.statSync(entryPath);

        // Check if it's a directory with SKILL.md
        if (stat.isDirectory()) {
          const skillMdPath = path.join(entryPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            // Parse metadata from SKILL.md
            const metadata = this.getSkillMetadata(entryPath);
            if (!metadata) continue;

            const skill: Skill = {
              id: `${source}-${entry}`,
              name: metadata.name,
              description: metadata.description,
              type: 'custom',
              enabled: true,
              createdAt: Date.now(),
            };

            skills.push(skill);
            this.loadedSkills.set(skill.id, skill);
            log(`Loaded ${source} skill: ${skill.name}`);
          }
        }
        // Also support legacy .json config files
        else if (entry.endsWith('.json')) {
          try {
            const content = fs.readFileSync(entryPath, 'utf-8');
            const config: SkillConfig = JSON.parse(content);

            const skill: Skill = {
              id: `${source}-${path.basename(entry, '.json')}`,
              name: config.name,
              description: config.description,
              type: config.type === 'mcp' ? 'mcp' : 'custom',
              enabled: config.enabled !== false,
              config: config.mcp ? { mcp: config.mcp } : undefined,
              createdAt: Date.now(),
            };

            skills.push(skill);
            this.loadedSkills.set(skill.id, skill);
          } catch (error) {
            logError(`Failed to load skill from ${entryPath}:`, error);
          }
        }
      }
    } catch (error) {
      logError(`Failed to read skills directory ${dir}:`, error);
    }

    return skills;
  }

  /**
   * Get all active skills for a session
   */
  async getActiveSkills(_sessionId: string, projectPath?: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    // 1. Add built-in skills
    for (const skill of this.loadedSkills.values()) {
      if (skill.type === 'builtin' && skill.enabled) {
        skills.push(skill);
      }
    }

    // 2. Add global skills
    const globalSkills = await this.loadGlobalSkills();
    skills.push(...globalSkills.filter(s => s.enabled));

    // 3. Add project skills (highest priority, can override)
    if (projectPath) {
      const projectSkills = await this.loadProjectSkills(projectPath);
      
      // Project skills can override global/builtin by name
      for (const projectSkill of projectSkills) {
        if (!projectSkill.enabled) continue;
        
        const existingIndex = skills.findIndex(s => s.name === projectSkill.name);
        if (existingIndex >= 0) {
          skills[existingIndex] = projectSkill;
        } else {
          skills.push(projectSkill);
        }
      }
    }

    return skills;
  }

  /**
   * Start an MCP server for a skill
   */
  async startMcpServer(skill: Skill): Promise<void> {
    if (skill.type !== 'mcp' || !skill.config?.mcp) {
      throw new Error('Skill is not an MCP skill');
    }

    if (this.runningServers.has(skill.id)) {
      log(`MCP server for ${skill.name} is already running`);
      return;
    }

    // TODO: Implement actual MCP server startup
    // const { spawn } = await import('child_process');
    // const mcpConfig = skill.config.mcp as McpServerConfig;
    // 
    // const proc = spawn(mcpConfig.command, mcpConfig.args || [], {
    //   env: { ...process.env, ...mcpConfig.env },
    // });
    // 
    // this.runningServers.set(skill.id, { process: proc, skill });

    log(`MCP server started for skill: ${skill.name}`);
  }

  /**
   * Stop an MCP server
   */
  async stopMcpServer(skillId: string): Promise<void> {
    const server = this.runningServers.get(skillId);
    if (!server) {
      return;
    }

    // TODO: Implement graceful shutdown
    // server.process.kill();

    this.runningServers.delete(skillId);
    log(`MCP server stopped for skill: ${server.skill.name}`);
  }

  /**
   * Stop all running MCP servers
   */
  async stopAllServers(): Promise<void> {
    for (const skillId of this.runningServers.keys()) {
      await this.stopMcpServer(skillId);
    }
  }

  /**
   * Enable or disable a skill
   */
  setSkillEnabled(skillId: string, enabled: boolean): void {
    const skill = this.loadedSkills.get(skillId);
    if (skill) {
      skill.enabled = enabled;
      
      // Stop server if disabling an MCP skill
      if (!enabled && skill.type === 'mcp') {
        this.stopMcpServer(skillId);
      }
    }
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Save skill to database
   */
  saveSkill(skill: Skill): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO skills (id, name, description, type, enabled, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      skill.id,
      skill.name,
      skill.description || null,
      skill.type,
      skill.enabled ? 1 : 0,
      skill.config ? JSON.stringify(skill.config) : null,
      skill.createdAt
    );
  }

  /**
   * Delete a skill
   */
  deleteSkill(skillId: string): void {
    // Can't delete built-in skills
    const skill = this.loadedSkills.get(skillId);
    if (skill?.type === 'builtin') {
      throw new Error('Cannot delete built-in skills');
    }

    this.stopMcpServer(skillId);
    this.loadedSkills.delete(skillId);

    const stmt = this.db.prepare('DELETE FROM skills WHERE id = ?');
    stmt.run(skillId);
  }

  /**
   * List all skills with optional filters
   */
  async listSkills(filter?: { type?: 'builtin' | 'mcp' | 'custom'; enabled?: boolean }): Promise<Skill[]> {
    // Load global skills first to ensure they're in loadedSkills
    await this.loadGlobalSkills();

    let skills = Array.from(this.loadedSkills.values());

    if (filter) {
      if (filter.type !== undefined) {
        skills = skills.filter(s => s.type === filter.type);
      }
      if (filter.enabled !== undefined) {
        skills = skills.filter(s => s.enabled === filter.enabled);
      }
    }

    return skills;
  }

  /**
   * Validate skill folder structure and SKILL.md
   */
  async validateSkillFolder(skillPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if path exists
    if (!fs.existsSync(skillPath)) {
      return { valid: false, errors: ['Path does not exist'] };
    }

    // Check if it's a directory
    const stat = fs.statSync(skillPath);
    if (!stat.isDirectory()) {
      return { valid: false, errors: ['Path is not a directory'] };
    }

    // Check for SKILL.md
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return { valid: false, errors: ['SKILL.md not found'] };
    }

    // Parse SKILL.md frontmatter
    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const nameMatch = content.match(/name:\s*["']?([^"'\n]+)["']?/);
      const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);

      if (!nameMatch) {
        errors.push('SKILL.md missing "name" in frontmatter');
      }
      if (!descMatch) {
        errors.push('SKILL.md missing "description" in frontmatter');
      }
    } catch (err) {
      errors.push('Failed to parse SKILL.md');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get skill metadata from SKILL.md file
   */
  getSkillMetadata(skillPath: string): { name: string; description: string } | null {
    const skillMdPath = path.join(skillPath, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const nameMatch = content.match(/name:\s*["']?([^"'\n]+)["']?/);
      const descMatch = content.match(/description:\s*["']?([^"'\n]+)["']?/);

      if (!nameMatch || !descMatch) {
        return null;
      }

      return {
        name: nameMatch[1].trim(),
        description: descMatch[1].trim(),
      };
    } catch (error) {
      logError(`Failed to parse SKILL.md from ${skillPath}:`, error);
      return null;
    }
  }

  /**
   * Copy skill folder to global skills directory
   */
  private async copySkillToGlobal(sourcePath: string, skillName: string): Promise<string> {
    // Use app-specific skills directory to avoid conflicts with user settings
    const globalSkillsPath = this.getGlobalSkillsPath();

    // Ensure global skills directory exists
    if (!fs.existsSync(globalSkillsPath)) {
      fs.mkdirSync(globalSkillsPath, { recursive: true });
    }

    const targetPath = path.join(globalSkillsPath, skillName);

    // Copy directory recursively (caller should handle existing files)
    await this.copyDirectory(sourcePath, targetPath);

    log(`Copied skill from ${sourcePath} to ${targetPath}`);
    return targetPath;
  }

  /**
   * Recursively copy directory
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const files = fs.readdirSync(source);

    for (const file of files) {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /**
   * Install a skill from a directory
   */
  async installSkill(skillPath: string): Promise<Skill> {
    // Validate skill folder
    const validation = await this.validateSkillFolder(skillPath);
    if (!validation.valid) {
      throw new Error(`Invalid skill folder: ${validation.errors.join(', ')}`);
    }

    // Get skill metadata
    const metadata = this.getSkillMetadata(skillPath);
    if (!metadata) {
      throw new Error('Failed to read skill metadata from SKILL.md');
    }

    // Load global skills to check for existing
    await this.loadGlobalSkills();

    // Check if skill with same name already exists in global directory
    // Use app-specific skills directory to avoid conflicts with user settings
    const globalSkillsPath = this.getGlobalSkillsPath();
    const targetPath = path.join(globalSkillsPath, metadata.name);

    if (fs.existsSync(targetPath)) {
      // Find and remove existing skill from loadedSkills
      const existingSkill = Array.from(this.loadedSkills.values()).find(
        s => s.name.toLowerCase() === metadata.name.toLowerCase()
      );
      if (existingSkill) {
        this.loadedSkills.delete(existingSkill.id);
        log(`Removing existing skill: ${existingSkill.name} (${existingSkill.id})`);
      }

      // Delete existing directory
      fs.rmSync(targetPath, { recursive: true, force: true });
      log(`Deleted existing skill directory: ${targetPath}`);
    }

    // Copy skill to global directory
    await this.copySkillToGlobal(skillPath, metadata.name);

    // Create skill object
    const skill: Skill = {
      id: `custom-${Date.now()}`,
      name: metadata.name,
      description: metadata.description,
      type: 'custom',
      enabled: true,
      createdAt: Date.now(),
    };

    // Add to loaded skills
    this.loadedSkills.set(skill.id, skill);

    // Save to database
    this.saveSkill(skill);

    log(`Installed skill: ${skill.name} (${skill.id})`);
    return skill;
  }

  /**
   * Uninstall a skill (delete from filesystem and database)
   */
  async uninstallSkill(skillId: string): Promise<void> {
    const skill = this.loadedSkills.get(skillId);

    if (!skill) {
      throw new Error('Skill not found');
    }

    // Can't delete built-in skills
    if (skill.type === 'builtin') {
      throw new Error('Cannot delete built-in skills');
    }

    // Stop MCP server if running
    await this.stopMcpServer(skillId);

    // Remove from filesystem (only for custom skills in global directory)
    if (skill.type === 'custom') {
      // Use app-specific skills directory to avoid conflicts with user settings
      const globalSkillsPath = this.getGlobalSkillsPath();
      const skillDir = path.join(globalSkillsPath, skill.name);

      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        log(`Deleted skill directory: ${skillDir}`);
      }
    }

    // Remove from loaded skills
    this.loadedSkills.delete(skillId);

    // Delete from database
    const stmt = this.db.prepare('DELETE FROM skills WHERE id = ?');
    stmt.run(skillId);

    log(`Uninstalled skill: ${skill.name} (${skillId})`);
  }
}
