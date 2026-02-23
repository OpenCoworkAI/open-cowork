/**
 * OpenClaw Standalone Server
 *
 * When OpenClaw runs outside the Coeadapt desktop app, this server
 * provides the entry point. It exposes the agent via MCP (Model Context
 * Protocol) so it can be consumed by any MCP-compatible client.
 *
 * Usage:
 *   COEADAPT_API_URL=https://api.coeadapt.com \
 *   COEADAPT_DEVICE_TOKEN=<token> \
 *   OPENCLAW_WORKSPACE=~/.openclaw/workspace \
 *   node dist/openclaw/server/index.js
 */

import { OpenClawAgent } from '../agent';
import { OpenClawEnvironment } from '../environment';
import { PlatformConnectSkill } from '../skills/platform-connect';
import { CareerDevSkill } from '../skills/career-dev';
import type { OpenClawConfig } from '../types';

const API_BASE = process.env.COEADAPT_API_URL || 'https://api.coeadapt.com';
const TOKEN = process.env.COEADAPT_DEVICE_TOKEN || '';
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || `${process.env.HOME || process.env.USERPROFILE}/.openclaw/workspace`;

async function main(): Promise<void> {
  console.log('[OpenClaw] Starting standalone server...');
  console.log(`[OpenClaw] API: ${API_BASE}`);
  console.log(`[OpenClaw] Workspace: ${WORKSPACE}`);
  console.log(`[OpenClaw] Token: ${TOKEN ? 'configured' : 'NOT configured'}`);

  // Build config
  const config: OpenClawConfig = {
    standalone: true,
    apiBase: API_BASE,
    platformToken: TOKEN || undefined,
    workspacePath: WORKSPACE,
    enabledSkills: ['openclaw-career-dev', 'openclaw-platform-connect'],
  };

  // Initialize environment
  const environment = new OpenClawEnvironment(WORKSPACE);
  await environment.initialize();

  // Initialize skills
  const platformSkill = new PlatformConnectSkill(API_BASE, TOKEN);
  const careerSkill = new CareerDevSkill();

  // Connect to platform if token available
  if (TOKEN) {
    const connection = await platformSkill.connect();
    console.log(`[OpenClaw] Platform: ${connection.status}`);
  }

  // Create agent
  const agent = new OpenClawAgent(config);
  await agent.initialize();

  console.log('[OpenClaw] Agent ready. Awaiting connections...');

  // In standalone mode, the agent listens for MCP connections via stdio
  // This will be wired up to the MCP SDK transport layer
}

main().catch((error) => {
  console.error(`[OpenClaw] Fatal: ${error}`);
  process.exit(1);
});
