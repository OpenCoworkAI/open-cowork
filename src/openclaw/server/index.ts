/**
 * Navi Standalone Server
 *
 * When Navi runs outside the Coeadapt desktop app, this server
 * provides the entry point. It exposes the agent via MCP (Model Context
 * Protocol) so it can be consumed by any MCP-compatible client.
 *
 * Listens on TCP port (NAVI_MCP_PORT, default 9599) for JSON-RPC connections
 * from the host Coeadapt app via NAT port forwarding.
 *
 * Usage:
 *   COEADAPT_API_URL=https://api.coeadapt.com \
 *   COEADAPT_DEVICE_TOKEN=<token> \
 *   NAVI_WORKSPACE=~/.navi/workspace \
 *   NAVI_MCP_PORT=9599 \
 *   node dist/openclaw/server/index.js
 */

import * as net from 'net';
import { NaviAgent } from '../agent';
import { OpenClawEnvironment } from '../environment';
import { PlatformConnectSkill } from '../skills/platform-connect';
import { CareerDevSkill } from '../skills/career-dev';
import { SkillceptionSkill } from '../skills/skillception';
import type { OpenClawConfig } from '../types';

const API_BASE = process.env.COEADAPT_API_URL || 'https://api.coeadapt.com';
const TOKEN = process.env.COEADAPT_DEVICE_TOKEN || '';
const WORKSPACE = process.env.NAVI_WORKSPACE
  || process.env.OPENCLAW_WORKSPACE
  || `${process.env.HOME || process.env.USERPROFILE}/.navi/workspace`;
const MCP_PORT = parseInt(process.env.NAVI_MCP_PORT || '9599', 10);

// ── JSON-RPC message handler ──────────────────────────────────────

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function makeResponse(id: number, result: unknown): string {
  return JSON.stringify({ id, result }) + '\n';
}

function makeErrorResponse(id: number, code: number, message: string): string {
  return JSON.stringify({ id, error: { code, message } }) + '\n';
}

async function handleMessage(
  raw: string,
  socket: net.Socket,
  agent: NaviAgent,
  _platformSkill: PlatformConnectSkill,
): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(raw);
  } catch {
    socket.write(makeErrorResponse(0, -32700, 'Parse error'));
    return;
  }

  const { id, method, params } = request;

  try {
    switch (method) {
      case 'ping':
        socket.write(makeResponse(id, { status: 'ok', agent: 'navi', version: '1.0.0' }));
        break;

      case 'process':
        if (!params?.message) {
          socket.write(makeErrorResponse(id, -32602, 'Missing params.message'));
          return;
        }
        const result = await agent.process(String(params.message));
        socket.write(makeResponse(id, { response: result }));
        break;

      case 'listSkills':
        socket.write(makeResponse(id, {
          skills: ['navi-career-dev', 'navi-platform-connect', 'navi-skillception'],
        }));
        break;

      case 'getStatus':
        socket.write(makeResponse(id, {
          agent: 'navi',
          platform: TOKEN ? 'connected' : 'disconnected',
          workspace: WORKSPACE,
          skills: ['navi-career-dev', 'navi-platform-connect', 'navi-skillception'],
        }));
        break;

      default:
        socket.write(makeErrorResponse(id, -32601, `Method not found: ${method}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Navi] Error handling ${method}:`, msg);
    socket.write(makeErrorResponse(id, -32000, msg));
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Navi] Starting standalone server...');
  console.log(`[Navi] API: ${API_BASE}`);
  console.log(`[Navi] Workspace: ${WORKSPACE}`);
  console.log(`[Navi] Token: ${TOKEN ? 'configured' : 'NOT configured'}`);
  console.log(`[Navi] MCP Port: ${MCP_PORT}`);

  // Build config
  const config: OpenClawConfig = {
    standalone: true,
    apiBase: API_BASE,
    platformToken: TOKEN || undefined,
    workspacePath: WORKSPACE,
    enabledSkills: [
      'navi-career-dev',
      'navi-platform-connect',
      'navi-skillception',
    ],
  };

  // Initialize environment
  const environment = new OpenClawEnvironment(WORKSPACE);
  await environment.initialize();

  // Initialize skills
  const platformSkill = new PlatformConnectSkill(API_BASE, TOKEN);
  void CareerDevSkill;
  void SkillceptionSkill;

  // Connect to platform if token available
  if (TOKEN) {
    const connection = await platformSkill.connect();
    console.log(`[Navi] Platform: ${connection.status}`);
  }

  // Create agent
  const agent = new NaviAgent(config);
  await agent.initialize();

  console.log('[Navi] Agent ready. Skillception engine loaded.');

  // Start TCP server for MCP connections from host
  const server = net.createServer((socket) => {
    console.log('[Navi] MCP client connected from', socket.remoteAddress);

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          handleMessage(line.trim(), socket, agent, platformSkill);
        }
      }
    });

    socket.on('close', () => {
      console.log('[Navi] MCP client disconnected');
    });

    socket.on('error', (err) => {
      console.error('[Navi] Socket error:', err.message);
    });
  });

  server.listen(MCP_PORT, '0.0.0.0', () => {
    console.log(`[Navi] MCP TCP server listening on 0.0.0.0:${MCP_PORT}`);
  });

  server.on('error', (err) => {
    console.error('[Navi] Server error:', err.message);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(`[Navi] Fatal: ${error}`);
  process.exit(1);
});
