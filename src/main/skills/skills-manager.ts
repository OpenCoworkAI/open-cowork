import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Skill } from '../../renderer/types';
import type { InMemoryDatabase } from '../db/database';

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
 * 2. Global: ~/.open-cowork/skills/
 * 3. Built-in skills
 */
export class SkillsManager {
  private db: InMemoryDatabase;
  private loadedSkills: Map<string, Skill> = new Map();
  private runningServers: Map<string, { process: any; skill: Skill }> = new Map();

  constructor(db: InMemoryDatabase) {
    this.db = db;
    this.loadBuiltinSkills();
  }

  /**
   * Load built-in skills
   */
  private loadBuiltinSkills(): void {
    const builtinSkills: Skill[] = [
      {
        id: 'builtin-filesystem',
        name: 'File System',
        description: 'Read, write, edit, and search files',
        type: 'builtin',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'builtin-shell',
        name: 'Shell',
        description: 'Execute shell commands',
        type: 'builtin',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'builtin-search',
        name: 'Search',
        description: 'Search files and content with glob and grep',
        type: 'builtin',
        enabled: true,
        createdAt: Date.now(),
      },
    ];

    for (const skill of builtinSkills) {
      this.loadedSkills.set(skill.id, skill);
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
    const globalSkillsPath = path.join(app.getPath('home'), '.open-cowork', 'skills');
    
    if (!fs.existsSync(globalSkillsPath)) {
      fs.mkdirSync(globalSkillsPath, { recursive: true });
    }

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
      const files = fs.readdirSync(dir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(dir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const config: SkillConfig = JSON.parse(content);

          const skill: Skill = {
            id: `${source}-${path.basename(file, '.json')}`,
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
          console.error(`Failed to load skill from ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to read skills directory ${dir}:`, error);
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
      console.log(`MCP server for ${skill.name} is already running`);
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

    console.log(`MCP server started for skill: ${skill.name}`);
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
    console.log(`MCP server stopped for skill: ${server.skill.name}`);
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
}

