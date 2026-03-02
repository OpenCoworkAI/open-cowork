/**
 * Skillception MCP Server
 *
 * Exposes the Skillception skill-tree engine as MCP tools so the AI agent
 * can query, update, and manage the user's skill graph.
 *
 * Persistence: reads/writes a JSON file whose path is provided via
 * NAVI_SKILL_TREE_PATH env var (defaults to ~/.navi/skill-tree.json).
 *
 * Auth: none (local-only, runs as a child process of the desktop app).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeMCPLog } from './mcp-logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Config ──────────────────────────────────────────────────────────────────

const SKILL_TREE_PATH =
  process.env.NAVI_SKILL_TREE_PATH ||
  path.join(os.homedir(), '.navi', 'skill-tree.json');

const DEFAULT_THRESHOLD = 60;
const DECAY_DAYS = 90;
const MS_PER_DAY = 86_400_000;

// ─── Types (mirrored from openclaw/types to keep the MCP server self-contained) ─

interface Prerequisite {
  skillId: string;
  minLevel: number;
}

interface SkillEvidence {
  id: string;
  type: 'task-completion' | 'project' | 'certification' | 'peer-review' | 'self-assessment' | 'artifact';
  title: string;
  description?: string;
  url?: string;
  points: number;
  verifiedBy?: string;
  createdAt: number;
}

interface SkillActivity {
  id: string;
  title: string;
  type: 'learn' | 'practice' | 'build' | 'teach' | 'assess';
  estimatedMinutes: number;
  points: number;
  url?: string;
  completed: boolean;
  completedAt?: number;
}

type SkillCategory =
  | 'technical'
  | 'communication'
  | 'leadership'
  | 'problem-solving'
  | 'domain'
  | 'meta'
  | 'execution'
  | 'collaboration';

interface SkillNode {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  level: number;
  prerequisites: Prerequisite[];
  evidence: SkillEvidence[];
  verified: boolean;
  unlocks: string[];
  threshold: number;
  activities: SkillActivity[];
  createdAt: number;
  updatedAt: number;
}

interface SkillTree {
  userId: string;
  nodes: SkillNode[];
  lastSynced?: number;
  version: number;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadTree(): SkillTree {
  try {
    if (fs.existsSync(SKILL_TREE_PATH)) {
      const raw = fs.readFileSync(SKILL_TREE_PATH, 'utf-8');
      return JSON.parse(raw) as SkillTree;
    }
  } catch (e) {
    writeMCPLog(`[Skillception] Failed to load tree: ${e}`);
  }
  return { userId: 'local', nodes: [], version: 1 };
}

function saveTree(tree: SkillTree): void {
  try {
    const dir = path.dirname(SKILL_TREE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SKILL_TREE_PATH, JSON.stringify(tree, null, 2));
  } catch (e) {
    writeMCPLog(`[Skillception] Failed to save tree: ${e}`);
  }
}

// ─── Engine helpers ──────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUnlocked(tree: SkillTree, skillId: string): boolean {
  const node = tree.nodes.find(n => n.id === skillId);
  if (!node) return false;
  if (node.prerequisites.length === 0) return true;
  return node.prerequisites.every(prereq => {
    const parent = tree.nodes.find(n => n.id === prereq.skillId);
    return parent !== undefined && parent.level >= prereq.minLevel;
  });
}

function countDownstream(tree: SkillTree, nodeId: string, visited: Set<string>): number {
  if (visited.has(nodeId)) return 0;
  visited.add(nodeId);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return 0;
  let count = 0;
  for (const childId of node.unlocks) {
    count += 1 + countDownstream(tree, childId, visited);
  }
  return count;
}

function statusLabel(level: number): string {
  if (level === 0) return 'locked';
  if (level <= 20) return 'aware';
  if (level <= 40) return 'beginner';
  if (level <= 60) return 'practitioner';
  if (level <= 80) return 'proficient';
  if (level <= 95) return 'advanced';
  return 'master';
}

// ─── Response helpers ────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

// ─── Server setup ────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'skillception', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Tree queries ───────────────────────────────────────────────────
    {
      name: 'skill_get_tree',
      description:
        "Get the user's full skill tree. Returns all nodes with levels, prerequisites, and unlock status.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'skill_get_node',
      description: 'Get a single skill node by ID, including evidence and activities.',
      inputSchema: {
        type: 'object',
        properties: { skillId: { type: 'string', description: 'Skill node ID (slug)' } },
        required: ['skillId'],
      },
    },
    {
      name: 'skill_search',
      description: 'Search skills by name or category.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to match against skill name or description' },
          category: {
            type: 'string',
            description: 'Filter by category',
            enum: ['technical', 'communication', 'leadership', 'problem-solving', 'domain', 'meta', 'execution', 'collaboration'],
          },
        },
      },
    },

    // ── Tree mutations ─────────────────────────────────────────────────
    {
      name: 'skill_add',
      description:
        'Add a new skill node to the tree. Automatically wires prerequisite → unlock edges.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name' },
          description: { type: 'string', description: 'What this skill is about' },
          category: {
            type: 'string',
            enum: ['technical', 'communication', 'leadership', 'problem-solving', 'domain', 'meta', 'execution', 'collaboration'],
          },
          prerequisites: {
            type: 'array',
            description: 'Array of {skillId, minLevel} prerequisite edges',
            items: {
              type: 'object',
              properties: {
                skillId: { type: 'string' },
                minLevel: { type: 'number' },
              },
              required: ['skillId', 'minLevel'],
            },
          },
          threshold: { type: 'number', description: 'Level needed to unlock downstream skills (default 60)' },
        },
        required: ['name', 'description', 'category'],
      },
    },
    {
      name: 'skill_remove',
      description: 'Remove a skill node and clean up all prerequisite/unlock edges.',
      inputSchema: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
    },
    {
      name: 'skill_set_level',
      description: 'Directly set a skill level (0-100). Use skill_add_evidence for normal progress.',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          level: { type: 'number', description: '0-100' },
        },
        required: ['skillId', 'level'],
      },
    },

    // ── Evidence & activities ──────────────────────────────────────────
    {
      name: 'skill_add_evidence',
      description:
        'Record evidence for a skill. Automatically increases skill level by the evidence points.',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          type: {
            type: 'string',
            enum: ['task-completion', 'project', 'certification', 'peer-review', 'self-assessment', 'artifact'],
          },
          title: { type: 'string', description: 'Brief description of the evidence' },
          points: { type: 'number', description: 'Points to add to skill level' },
          description: { type: 'string', description: 'Detailed description (optional)' },
          url: { type: 'string', description: 'URL to evidence (optional)' },
        },
        required: ['skillId', 'type', 'title', 'points'],
      },
    },
    {
      name: 'skill_add_activities',
      description: 'Add suggested learning/practice activities to a skill.',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                type: { type: 'string', enum: ['learn', 'practice', 'build', 'teach', 'assess'] },
                estimatedMinutes: { type: 'number' },
                points: { type: 'number' },
                url: { type: 'string' },
              },
              required: ['title', 'type', 'estimatedMinutes', 'points'],
            },
          },
        },
        required: ['skillId', 'activities'],
      },
    },
    {
      name: 'skill_complete_activity',
      description: 'Mark an activity as completed. Awards points to the skill automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          activityId: { type: 'string' },
        },
        required: ['skillId', 'activityId'],
      },
    },

    // ── Graph queries ──────────────────────────────────────────────────
    {
      name: 'skill_get_blocked',
      description: 'Get all skills that are currently blocked by unmet prerequisites.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'skill_get_almost_unlocked',
      description: 'Get skills that are close to being unlocked (prerequisites nearly met).',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', description: 'Points within unlock (default 10)' },
        },
      },
    },
    {
      name: 'skill_get_high_impact',
      description:
        'Get the foundational skills with the most downstream unlocks. Focus on these for maximum impact.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
      },
    },
    {
      name: 'skill_check_unlocks',
      description:
        'Check which new skills became unlocked after a level change on the given skill.',
      inputSchema: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId'],
      },
    },
    {
      name: 'skill_get_decaying',
      description: 'Get skills that haven\'t been practiced in 90+ days and may be decaying.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Readiness ──────────────────────────────────────────────────────
    {
      name: 'skill_assess_readiness',
      description:
        'Assess how ready the user is for a target role based on required skills.',
      inputSchema: {
        type: 'object',
        properties: {
          targetRole: { type: 'string', description: 'The role to assess readiness for' },
          requiredSkillIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of skill IDs required for the role',
          },
        },
        required: ['targetRole', 'requiredSkillIds'],
      },
    },
  ],
}));

// ─── Tool execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tree = loadTree();

  try {
    switch (name) {
      // ── Tree queries ─────────────────────────────────────────────────
      case 'skill_get_tree': {
        const summary = tree.nodes.map(n => ({
          id: n.id,
          name: n.name,
          level: n.level,
          category: n.category,
          status: isUnlocked(tree, n.id) ? statusLabel(n.level) : 'locked',
          prerequisiteCount: n.prerequisites.length,
          unlocksCount: n.unlocks.length,
          evidenceCount: n.evidence.length,
        }));
        return ok({
          nodeCount: tree.nodes.length,
          version: tree.version,
          nodes: summary,
        });
      }

      case 'skill_get_node': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);
        return ok({
          ...node,
          status: isUnlocked(tree, node.id) ? statusLabel(node.level) : 'locked',
          isUnlocked: isUnlocked(tree, node.id),
        });
      }

      case 'skill_search': {
        const query = (args?.query as string || '').toLowerCase();
        const category = args?.category as string | undefined;
        const results = tree.nodes.filter(n => {
          const matchesQuery = !query ||
            n.name.toLowerCase().includes(query) ||
            n.description.toLowerCase().includes(query);
          const matchesCategory = !category || n.category === category;
          return matchesQuery && matchesCategory;
        });
        return ok(results.map(n => ({
          id: n.id,
          name: n.name,
          level: n.level,
          category: n.category,
          status: isUnlocked(tree, n.id) ? statusLabel(n.level) : 'locked',
        })));
      }

      // ── Tree mutations ───────────────────────────────────────────────
      case 'skill_add': {
        const skillName = args?.name as string;
        if (!skillName) return err('name is required');
        const id = slugify(skillName);
        if (tree.nodes.find(n => n.id === id)) return err(`Skill already exists: ${id}`);

        const prerequisites = (args?.prerequisites as Prerequisite[] | undefined) || [];
        const node: SkillNode = {
          id,
          name: skillName,
          description: (args?.description as string) || '',
          category: (args?.category as SkillCategory) || 'technical',
          level: 0,
          prerequisites,
          evidence: [],
          verified: false,
          unlocks: [],
          threshold: (args?.threshold as number) || DEFAULT_THRESHOLD,
          activities: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Wire reverse edges
        for (const prereq of prerequisites) {
          const parent = tree.nodes.find(n => n.id === prereq.skillId);
          if (parent && !parent.unlocks.includes(id)) {
            parent.unlocks.push(id);
          }
        }

        tree.nodes.push(node);
        tree.version++;
        saveTree(tree);
        return ok({ added: node, treeVersion: tree.version });
      }

      case 'skill_remove': {
        const skillId = args?.skillId as string;
        const existed = tree.nodes.some(n => n.id === skillId);
        if (!existed) return err(`Skill not found: ${skillId}`);

        tree.nodes = tree.nodes.filter(n => n.id !== skillId);
        for (const node of tree.nodes) {
          node.prerequisites = node.prerequisites.filter(p => p.skillId !== skillId);
          node.unlocks = node.unlocks.filter(id => id !== skillId);
        }
        tree.version++;
        saveTree(tree);
        return ok({ removed: skillId, treeVersion: tree.version });
      }

      case 'skill_set_level': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);
        node.level = Math.max(0, Math.min(100, args?.level as number));
        node.updatedAt = Date.now();
        tree.version++;
        saveTree(tree);

        // Check unlocks
        const newlyUnlocked: string[] = [];
        for (const childId of node.unlocks) {
          if (isUnlocked(tree, childId)) {
            const child = tree.nodes.find(n => n.id === childId);
            if (child && child.level === 0) newlyUnlocked.push(childId);
          }
        }

        return ok({
          skill: node.id,
          level: node.level,
          status: statusLabel(node.level),
          newlyUnlocked,
        });
      }

      // ── Evidence & activities ────────────────────────────────────────
      case 'skill_add_evidence': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);

        const evidence: SkillEvidence = {
          id: `ev-${uid()}`,
          type: args?.type as SkillEvidence['type'],
          title: args?.title as string,
          description: args?.description as string | undefined,
          url: args?.url as string | undefined,
          points: args?.points as number,
          createdAt: Date.now(),
        };

        node.evidence.push(evidence);
        node.level = Math.min(100, node.level + evidence.points);
        node.updatedAt = Date.now();
        tree.version++;
        saveTree(tree);

        // Check unlocks
        const newlyUnlocked: string[] = [];
        for (const childId of node.unlocks) {
          if (isUnlocked(tree, childId)) {
            const child = tree.nodes.find(n => n.id === childId);
            if (child && child.level === 0) newlyUnlocked.push(childId);
          }
        }

        return ok({
          skill: node.id,
          level: node.level,
          status: statusLabel(node.level),
          evidenceAdded: evidence.id,
          newlyUnlocked,
        });
      }

      case 'skill_add_activities': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);

        const activities = (args?.activities as Array<Omit<SkillActivity, 'id' | 'completed' | 'completedAt'>>) || [];
        const added: string[] = [];
        for (const act of activities) {
          const id = `act-${uid()}`;
          node.activities.push({ ...act, id, completed: false });
          added.push(id);
        }

        node.updatedAt = Date.now();
        tree.version++;
        saveTree(tree);
        return ok({ skill: node.id, activitiesAdded: added });
      }

      case 'skill_complete_activity': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);

        const activity = node.activities.find(a => a.id === args?.activityId);
        if (!activity) return err(`Activity not found: ${args?.activityId}`);
        if (activity.completed) return ok({ skill: node.id, activity: activity.id, alreadyCompleted: true });

        activity.completed = true;
        activity.completedAt = Date.now();

        // Award points
        const evidence: SkillEvidence = {
          id: `ev-${uid()}`,
          type: 'task-completion',
          title: activity.title,
          points: activity.points,
          createdAt: Date.now(),
        };
        node.evidence.push(evidence);
        node.level = Math.min(100, node.level + activity.points);
        node.updatedAt = Date.now();
        tree.version++;
        saveTree(tree);

        return ok({
          skill: node.id,
          level: node.level,
          status: statusLabel(node.level),
          activityCompleted: activity.id,
          pointsAwarded: activity.points,
        });
      }

      // ── Graph queries ────────────────────────────────────────────────
      case 'skill_get_blocked': {
        const blocked = tree.nodes
          .filter(n => !isUnlocked(tree, n.id) && n.level === 0)
          .map(n => {
            const blockedBy = n.prerequisites.filter(p => {
              const parent = tree.nodes.find(pn => pn.id === p.skillId);
              return !parent || parent.level < p.minLevel;
            });
            return {
              id: n.id,
              name: n.name,
              blockedBy: blockedBy.map(p => {
                const parent = tree.nodes.find(pn => pn.id === p.skillId);
                return {
                  skillId: p.skillId,
                  skillName: parent?.name || p.skillId,
                  currentLevel: parent?.level || 0,
                  requiredLevel: p.minLevel,
                };
              }),
            };
          });
        return ok(blocked);
      }

      case 'skill_get_almost_unlocked': {
        const threshold = (args?.threshold as number) || 10;
        const almost = tree.nodes.filter(n => {
          if (isUnlocked(tree, n.id)) return false;
          if (n.prerequisites.length === 0) return false;
          return n.prerequisites.every(p => {
            const parent = tree.nodes.find(pn => pn.id === p.skillId);
            if (!parent) return false;
            return parent.level >= p.minLevel - threshold;
          });
        });
        return ok(almost.map(n => ({
          id: n.id,
          name: n.name,
          prerequisites: n.prerequisites.map(p => {
            const parent = tree.nodes.find(pn => pn.id === p.skillId);
            return {
              skillId: p.skillId,
              skillName: parent?.name || p.skillId,
              currentLevel: parent?.level || 0,
              requiredLevel: p.minLevel,
              gap: p.minLevel - (parent?.level || 0),
            };
          }),
        })));
      }

      case 'skill_get_high_impact': {
        const limit = (args?.limit as number) || 5;
        const impacts = tree.nodes
          .filter(n => n.level < n.threshold)
          .map(n => ({
            id: n.id,
            name: n.name,
            level: n.level,
            threshold: n.threshold,
            downstream: countDownstream(tree, n.id, new Set()),
          }))
          .sort((a, b) => b.downstream - a.downstream)
          .slice(0, limit);
        return ok(impacts);
      }

      case 'skill_check_unlocks': {
        const node = tree.nodes.find(n => n.id === args?.skillId);
        if (!node) return err(`Skill not found: ${args?.skillId}`);

        const newlyUnlocked = node.unlocks
          .filter(childId => {
            const child = tree.nodes.find(n => n.id === childId);
            return child && child.level === 0 && isUnlocked(tree, childId);
          })
          .map(childId => {
            const child = tree.nodes.find(n => n.id === childId)!;
            return { id: child.id, name: child.name };
          });
        return ok({ skill: node.id, newlyUnlocked });
      }

      case 'skill_get_decaying': {
        const cutoff = Date.now() - DECAY_DAYS * MS_PER_DAY;
        const decaying = tree.nodes
          .filter(n => {
            if (n.level === 0) return false;
            const lastActive = Math.max(
              n.updatedAt,
              ...n.evidence.map(e => e.createdAt),
              ...n.activities.filter(a => a.completedAt).map(a => a.completedAt!),
            );
            return lastActive < cutoff;
          })
          .map(n => ({
            id: n.id,
            name: n.name,
            level: n.level,
            lastUpdated: new Date(n.updatedAt).toISOString(),
            daysSinceActivity: Math.floor((Date.now() - n.updatedAt) / MS_PER_DAY),
          }));
        return ok(decaying);
      }

      // ── Readiness ────────────────────────────────────────────────────
      case 'skill_assess_readiness': {
        const targetRole = args?.targetRole as string;
        const requiredIds = (args?.requiredSkillIds as string[]) || [];
        const ready: string[] = [];
        const inProgress: string[] = [];
        const blocked: Array<{ skill: string; blockedBy: string }> = [];

        for (const id of requiredIds) {
          const node = tree.nodes.find(n => n.id === id);
          if (!node) {
            blocked.push({ skill: id, blockedBy: 'Skill not in tree yet' });
            continue;
          }
          if (node.level >= node.threshold) {
            ready.push(node.name);
          } else if (isUnlocked(tree, id) && node.level > 0) {
            inProgress.push(node.name);
          } else {
            const unmet = node.prerequisites
              .filter(p => {
                const parent = tree.nodes.find(pn => pn.id === p.skillId);
                return !parent || parent.level < p.minLevel;
              })
              .map(p => {
                const parent = tree.nodes.find(pn => pn.id === p.skillId);
                return `${parent?.name || p.skillId} (need ${p.minLevel}, have ${parent?.level || 0})`;
              });
            blocked.push({ skill: node.name, blockedBy: unmet.join(', ') || 'No prerequisites met' });
          }
        }

        const total = requiredIds.length || 1;
        const score = Math.round((ready.length / total) * 100);

        return ok({ targetRole, score, ready, inProgress, blocked });
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeMCPLog(`[Skillception] Error in ${name}: ${message}`);
    return err(message);
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

async function main() {
  writeMCPLog('[Skillception] Starting Skillception MCP Server...');
  writeMCPLog(`[Skillception] Skill tree path: ${SKILL_TREE_PATH}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  writeMCPLog('[Skillception] Skillception MCP Server running');
}

main().catch((error) => {
  writeMCPLog(`[Skillception] Fatal error: ${error}`);
  process.exit(1);
});
