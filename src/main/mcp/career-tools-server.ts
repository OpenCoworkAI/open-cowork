/**
 * Career Tools MCP Server
 *
 * Bridges Coeadapt career data as MCP tools so the AI agent can interact
 * with career plans, tasks, goals, habits, jobs, skills, and market data.
 *
 * Auth: Uses device token stored by DeviceTokenStore.
 * The token is passed via COEADAPT_DEVICE_TOKEN env var.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeMCPLog } from './mcp-logger';

const API_BASE = process.env.COEADAPT_API_URL || 'https://api.coeadapt.com';
const DEVICE_TOKEN = process.env.COEADAPT_DEVICE_TOKEN || '';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (DEVICE_TOKEN) {
    headers['Authorization'] = `Bearer ${DEVICE_TOKEN}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  writeMCPLog(`[CareerTools] ${method} ${path}`);
  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: 'career-tools', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Plans & Tasks
    {
      name: 'career_get_plans',
      description: 'Get the user\'s career plans from Coeadapt',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_get_plan',
      description: 'Get a specific career plan by ID',
      inputSchema: {
        type: 'object',
        properties: { planId: { type: 'string', description: 'Plan ID' } },
        required: ['planId'],
      },
    },
    {
      name: 'career_get_tasks',
      description: 'Get the user\'s career tasks. Optionally filter by plan ID.',
      inputSchema: {
        type: 'object',
        properties: { planId: { type: 'string', description: 'Optional plan ID to filter tasks' } },
      },
    },
    {
      name: 'career_get_task',
      description: 'Get a specific task by ID',
      inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string', description: 'Task ID' } },
        required: ['taskId'],
      },
    },
    {
      name: 'career_update_task',
      description: 'Update a career task (status, title, description, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status' },
          title: { type: 'string', description: 'New title' },
          description: { type: 'string', description: 'New description' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'career_submit_evidence',
      description: 'Submit evidence/proof of completion for a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
          type: { type: 'string', description: 'Evidence type (e.g., "link", "text", "file")' },
          content: { type: 'string', description: 'Evidence content or description' },
          url: { type: 'string', description: 'Optional URL for the evidence' },
        },
        required: ['taskId', 'type', 'content'],
      },
    },
    // Goals
    {
      name: 'career_get_goals',
      description: 'Get the user\'s career goals',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_create_goal',
      description: 'Create a new career goal',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Goal title' },
          description: { type: 'string', description: 'Goal description' },
          targetDate: { type: 'string', description: 'Target date (ISO 8601)' },
        },
        required: ['title'],
      },
    },
    {
      name: 'career_update_goal',
      description: 'Update an existing career goal',
      inputSchema: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'Goal ID' },
          title: { type: 'string' },
          description: { type: 'string' },
          progress: { type: 'number', description: '0-100' },
          status: { type: 'string' },
        },
        required: ['goalId'],
      },
    },
    // Habits
    {
      name: 'career_get_habits',
      description: 'Get the user\'s habits and today\'s checklist',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_complete_habit',
      description: 'Mark a habit as completed for today',
      inputSchema: {
        type: 'object',
        properties: { habitId: { type: 'string', description: 'Habit ID' } },
        required: ['habitId'],
      },
    },
    {
      name: 'career_get_habit_stats',
      description: 'Get habit statistics and streaks overview',
      inputSchema: { type: 'object', properties: {} },
    },
    // Jobs
    {
      name: 'career_discover_jobs',
      description: 'Discover new job opportunities matching the user\'s profile',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_get_bookmarked_jobs',
      description: 'Get user\'s bookmarked/saved jobs',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_bookmark_job',
      description: 'Bookmark a job for later review',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string', description: 'Job ID' } },
        required: ['jobId'],
      },
    },
    // Skills & Portfolio
    {
      name: 'career_get_skills',
      description: 'Get the user\'s verified skills',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_get_portfolio',
      description: 'Get the user\'s portfolio items',
      inputSchema: { type: 'object', properties: {} },
    },
    // Market Intelligence
    {
      name: 'career_get_market_fit',
      description: 'Get market fit analysis showing strengths, gaps, and recommendations',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'career_get_skill_deltas',
      description: 'Get skill gap analysis showing current vs. required skill levels',
      inputSchema: { type: 'object', properties: {} },
    },
    // Account
    {
      name: 'career_get_notifications',
      description: 'Get user\'s career-related notifications',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// ─── Tool execution ─────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!DEVICE_TOKEN) {
    return err('Coeadapt device token not configured. Sign in via Clerk first.');
  }

  try {
    switch (name) {
      // Plans & Tasks
      case 'career_get_plans':
        return ok(await apiRequest('GET', '/api/plans/me'));

      case 'career_get_plan':
        return ok(await apiRequest('GET', `/api/plans/${args?.planId}`));

      case 'career_get_tasks':
        if (args?.planId) {
          return ok(await apiRequest('GET', `/api/plans/${args.planId}/tasks`));
        }
        return ok(await apiRequest('GET', '/api/tasks/me'));

      case 'career_get_task':
        return ok(await apiRequest('GET', `/api/tasks/${args?.taskId}`));

      case 'career_update_task': {
        const { taskId, ...updates } = args as Record<string, unknown>;
        return ok(await apiRequest('PUT', `/api/tasks/${taskId}`, updates));
      }

      case 'career_submit_evidence':
        return ok(await apiRequest('POST', `/api/tasks/${args?.taskId}/evidence`, {
          type: args?.type,
          content: args?.content,
          url: args?.url,
        }));

      // Goals
      case 'career_get_goals':
        return ok(await apiRequest('GET', '/api/goals/me'));

      case 'career_create_goal':
        return ok(await apiRequest('POST', '/api/goals', {
          title: args?.title,
          description: args?.description,
          targetDate: args?.targetDate,
        }));

      case 'career_update_goal': {
        const { goalId, ...goalUpdates } = args as Record<string, unknown>;
        return ok(await apiRequest('PATCH', `/api/goals/${goalId}`, goalUpdates));
      }

      // Habits
      case 'career_get_habits':
        return ok(await apiRequest('GET', '/api/habits/today'));

      case 'career_complete_habit':
        return ok(await apiRequest('POST', `/api/habits/${args?.habitId}/complete`));

      case 'career_get_habit_stats':
        return ok(await apiRequest('GET', '/api/habits/stats/overview'));

      // Jobs
      case 'career_discover_jobs':
        return ok(await apiRequest('GET', '/api/jobs/discover'));

      case 'career_get_bookmarked_jobs':
        return ok(await apiRequest('GET', '/api/jobs/bookmarks/me'));

      case 'career_bookmark_job':
        return ok(await apiRequest('POST', `/api/jobs/${args?.jobId}/bookmark`));

      // Skills & Portfolio
      case 'career_get_skills':
        return ok(await apiRequest('GET', '/api/skills/verified'));

      case 'career_get_portfolio':
        return ok(await apiRequest('GET', '/api/portfolio/items'));

      // Market Intelligence
      case 'career_get_market_fit':
        return ok(await apiRequest('GET', '/api/radar/market-fit'));

      case 'career_get_skill_deltas':
        return ok(await apiRequest('GET', '/api/radar/skill-deltas'));

      // Account
      case 'career_get_notifications':
        return ok(await apiRequest('GET', '/api/notifications/me'));

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeMCPLog(`[CareerTools] Error in ${name}: ${message}`);
    return err(message);
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

async function main() {
  writeMCPLog('[CareerTools] Starting Career Tools MCP Server...');
  writeMCPLog(`[CareerTools] API Base: ${API_BASE}`);
  writeMCPLog(`[CareerTools] Device Token: ${DEVICE_TOKEN ? 'configured' : 'NOT configured'}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  writeMCPLog('[CareerTools] Career Tools MCP Server running');
}

main().catch((error) => {
  writeMCPLog(`[CareerTools] Fatal error: ${error}`);
  process.exit(1);
});
