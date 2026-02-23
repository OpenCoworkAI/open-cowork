/**
 * Navi Standalone Server
 *
 * When Navi runs outside the Coeadapt desktop app, this server
 * provides the entry point. It exposes the agent via MCP (Model Context
 * Protocol) so it can be consumed by any MCP-compatible client.
 *
 * Usage:
 *   COEADAPT_API_URL=https://api.coeadapt.com \
 *   COEADAPT_DEVICE_TOKEN=<token> \
 *   NAVI_WORKSPACE=~/.navi/workspace \
 *   node dist/openclaw/server/index.js
 */

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

async function main(): Promise<void> {
  console.log('[Navi] Starting standalone server...');
  console.log(`[Navi] API: ${API_BASE}`);
  console.log(`[Navi] Workspace: ${WORKSPACE}`);
  console.log(`[Navi] Token: ${TOKEN ? 'configured' : 'NOT configured'}`);

  // Build config
  const config: OpenClawConfig = {
    standalone: true,
    apiBase: API_BASE,
    platformToken: TOKEN || undefined,
    workspacePath: WORKSPACE,
    enabledSkills: [
      'openclaw-career-dev',
      'openclaw-platform-connect',
      'navi-skillception',
    ],
  };

  // Initialize environment
  const environment = new OpenClawEnvironment(WORKSPACE);
  await environment.initialize();

  // Initialize skills
  const platformSkill = new PlatformConnectSkill(API_BASE, TOKEN);
  const careerSkill = new CareerDevSkill();
  const skillceptionSkill = new SkillceptionSkill();

  // Connect to platform if token available
  if (TOKEN) {
    const connection = await platformSkill.connect();
    console.log(`[Navi] Platform: ${connection.status}`);
  }

  // Create agent
  const agent = new NaviAgent(config);
  await agent.initialize();

  console.log('[Navi] Agent ready. Skillception engine loaded.');
  console.log('[Navi] Awaiting connections...');

  // In standalone mode, the agent listens for MCP connections via stdio
  // This will be wired up to the MCP SDK transport layer
}

main().catch((error) => {
  console.error(`[Navi] Fatal: ${error}`);
  process.exit(1);
});
