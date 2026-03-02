/**
 * VM Management MCP Server
 *
 * Exposes VM lifecycle and health tools to the Navi agent via MCP.
 * Self-contained stdio process — calls VBoxManage CLI directly.
 *
 * Environment variables:
 *   VBOXMANAGE_PATH — absolute path to VBoxManage binary
 *   VM_CONFIG_PATH  — path to electron-store VM config JSON file
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeMCPLog } from './mcp-logger';
import { execFile } from 'child_process';
import * as fs from 'fs';

// ─── Config ──────────────────────────────────────────────────────────────────

const VBOXMANAGE_PATH = process.env.VBOXMANAGE_PATH || 'VBoxManage';
const VM_CONFIG_PATH = process.env.VM_CONFIG_PATH || '';

// ─── Mirrored types (self-contained, no imports from main app) ──────────────

type VMState =
  | 'not_created' | 'powered_off' | 'starting' | 'running'
  | 'paused' | 'saving' | 'saved' | 'stopping' | 'error';

interface VMConfig {
  id: string;
  name: string;
  osImageId: string;
  resources: {
    cpuCount: number;
    memoryMb: number;
    diskSizeGb: number;
    displayMode: string;
    vramMb?: number;
    enableEFI?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  backendType: string;
  backendVmId?: string;
  diskPath?: string;
  notes?: string;
}

interface VMStoreData {
  vms?: VMConfig[];
  defaultResources?: Record<string, unknown>;
}

// ─── Health tracking (in-memory) ─────────────────────────────────────────────

const previousStates = new Map<string, VMState>();
const crashCounts = new Map<string, number>();

// ─── VBoxManage helpers ──────────────────────────────────────────────────────

function vbox(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(VBOXMANAGE_PATH, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function parseMachineReadable(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^([^=]+)="?(.*?)"?\s*$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function mapVBoxState(vboxState: string): VMState {
  const s = (vboxState || '').toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('paused')) return 'paused';
  if (s.includes('saved')) return 'saved';
  if (s.includes('powered off') || s.includes('poweroff')) return 'powered_off';
  if (s.includes('starting')) return 'starting';
  if (s.includes('stopping')) return 'stopping';
  if (s.includes('saving')) return 'saving';
  if (s.includes('aborted') || s.includes('guru')) return 'error';
  return 'powered_off';
}

async function getVMStatus(vmName: string): Promise<{ state: VMState; guestOs?: string; memoryMb?: number }> {
  try {
    const output = await vbox('showvminfo', vmName, '--machinereadable');
    const info = parseMachineReadable(output);
    return {
      state: mapVBoxState(info['VMState'] || ''),
      guestOs: info['ostype'],
      memoryMb: info['memory'] ? parseInt(info['memory']) : undefined,
    };
  } catch {
    return { state: 'error' };
  }
}

// ─── Config persistence ──────────────────────────────────────────────────────

function loadVMConfigs(): VMConfig[] {
  if (!VM_CONFIG_PATH) return [];
  try {
    if (fs.existsSync(VM_CONFIG_PATH)) {
      const raw = fs.readFileSync(VM_CONFIG_PATH, 'utf-8');
      const data = JSON.parse(raw) as VMStoreData;
      return data.vms || [];
    }
  } catch (e) {
    writeMCPLog(`[VM-MCP] Failed to load VM configs: ${e}`);
  }
  return [];
}

function findVM(nameOrId: string): VMConfig | undefined {
  const configs = loadVMConfigs();
  return configs.find(
    (c) => c.name === nameOrId || c.id === nameOrId,
  );
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
  { name: 'vm-management', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ─── Tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'vm_list',
      description: 'List all managed VMs with their current state, resource config, and health info.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'vm_get_status',
      description: 'Get detailed live status of a specific VM including state, OS type, and memory.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_get_health',
      description: 'Get health summary for VMs including crash counts and state tracking.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID (omit for all VMs)' },
        },
      },
    },
    {
      name: 'vm_start',
      description: 'Start a powered-off or saved VM. Opens VirtualBox GUI window by default.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
          gui: { type: 'boolean', description: 'Open GUI window (default true). Set false for headless.' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_stop',
      description: 'Gracefully stop a running VM via ACPI shutdown signal.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_force_stop',
      description: 'Force power off a VM immediately. Use when graceful shutdown fails.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_restart',
      description: 'Restart a VM by stopping it gracefully then starting it again.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
          gui: { type: 'boolean', description: 'Open GUI window after restart (default true)' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_pause',
      description: 'Pause a running VM, freezing its execution.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_resume',
      description: 'Resume a paused VM.',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
    {
      name: 'vm_get_config',
      description: 'Get the resource configuration of a VM (CPU, memory, disk, display mode).',
      inputSchema: {
        type: 'object',
        properties: {
          vmName: { type: 'string', description: 'VM name or ID' },
        },
        required: ['vmName'],
      },
    },
  ],
}));

// ─── Tool execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'vm_list': {
        const configs = loadVMConfigs();
        const results = [];
        for (const config of configs) {
          const status = await getVMStatus(config.name);
          previousStates.set(config.id, status.state);
          results.push({
            id: config.id,
            name: config.name,
            state: status.state,
            guestOs: status.guestOs,
            resources: config.resources,
            crashCount: crashCounts.get(config.id) || 0,
            createdAt: config.createdAt,
          });
        }
        return ok({ vmCount: results.length, vms: results });
      }

      case 'vm_get_status': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        const status = await getVMStatus(vm.name);
        previousStates.set(vm.id, status.state);
        return ok({
          id: vm.id,
          name: vm.name,
          state: status.state,
          guestOs: status.guestOs,
          memoryMb: status.memoryMb,
          resources: vm.resources,
        });
      }

      case 'vm_get_health': {
        const vmName = args?.vmName as string | undefined;
        const configs = vmName ? [findVM(vmName)].filter(Boolean) as VMConfig[] : loadVMConfigs();
        const summaries = [];
        for (const config of configs) {
          const status = await getVMStatus(config.name);
          const prev = previousStates.get(config.id);

          // Track crash if state changed to error/off from running
          if (prev === 'running' && (status.state === 'error' || status.state === 'powered_off')) {
            crashCounts.set(config.id, (crashCounts.get(config.id) || 0) + 1);
          }
          previousStates.set(config.id, status.state);

          summaries.push({
            id: config.id,
            name: config.name,
            state: status.state,
            healthy: status.state !== 'error',
            crashCount: crashCounts.get(config.id) || 0,
          });
        }
        return ok(summaries.length === 1 ? summaries[0] : summaries);
      }

      case 'vm_start': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        const gui = args?.gui !== false;
        const type = gui ? 'gui' : 'headless';
        await vbox('startvm', vm.name, '--type', type);
        previousStates.set(vm.id, 'starting');
        // Reset crash count on manual start
        crashCounts.set(vm.id, 0);
        return ok({ success: true, vm: vm.name, startType: type });
      }

      case 'vm_stop': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        await vbox('controlvm', vm.name, 'acpipowerbutton');
        return ok({ success: true, vm: vm.name, action: 'acpipowerbutton' });
      }

      case 'vm_force_stop': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        await vbox('controlvm', vm.name, 'poweroff');
        previousStates.set(vm.id, 'powered_off');
        return ok({ success: true, vm: vm.name, action: 'poweroff' });
      }

      case 'vm_restart': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        const gui = args?.gui !== false;

        // Stop gracefully first
        try {
          await vbox('controlvm', vm.name, 'acpipowerbutton');
          // Wait a few seconds for shutdown
          await new Promise((r) => setTimeout(r, 5000));
        } catch {
          // Might already be off — force it
          try { await vbox('controlvm', vm.name, 'poweroff'); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Start again
        const type = gui ? 'gui' : 'headless';
        await vbox('startvm', vm.name, '--type', type);
        previousStates.set(vm.id, 'starting');
        crashCounts.set(vm.id, 0);
        return ok({ success: true, vm: vm.name, action: 'restart', startType: type });
      }

      case 'vm_pause': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        await vbox('controlvm', vm.name, 'pause');
        previousStates.set(vm.id, 'paused');
        return ok({ success: true, vm: vm.name, action: 'pause' });
      }

      case 'vm_resume': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        await vbox('controlvm', vm.name, 'resume');
        previousStates.set(vm.id, 'running');
        return ok({ success: true, vm: vm.name, action: 'resume' });
      }

      case 'vm_get_config': {
        const vm = findVM(args?.vmName as string);
        if (!vm) return err(`VM not found: ${args?.vmName}`);
        return ok({
          id: vm.id,
          name: vm.name,
          osImageId: vm.osImageId,
          resources: vm.resources,
          backendType: vm.backendType,
          createdAt: vm.createdAt,
          updatedAt: vm.updatedAt,
        });
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeMCPLog(`[VM-MCP] Error in ${name}: ${message}`);
    return err(message);
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

async function main() {
  writeMCPLog('[VM-MCP] Starting VM Management MCP Server...');
  writeMCPLog(`[VM-MCP] VBoxManage path: ${VBOXMANAGE_PATH}`);
  writeMCPLog(`[VM-MCP] VM config path: ${VM_CONFIG_PATH}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  writeMCPLog('[VM-MCP] VM Management MCP Server running');
}

main().catch((error) => {
  writeMCPLog(`[VM-MCP] Fatal error: ${error}`);
  process.exit(1);
});
