/**
 * System prompt section builders for the Claude agent.
 * Extracted from agent-runner.ts for modularity.
 */

import type { MCPManager } from '../mcp/mcp-manager';
import { credentialsStore, type UserCredential } from '../credentials/credentials-store';
import { configStore } from '../config/config-store';
import { vmManager } from '../vm/vm-manager';
import { logError } from '../utils/logger';

/**
 * Build MCP tools prompt section describing available MCP tools.
 */
export function getMCPToolsPrompt(mcpManager: MCPManager | undefined): string {
  if (!mcpManager) {
    return '';
  }

  const mcpTools = mcpManager.getTools();
  if (mcpTools.length === 0) {
    return '';
  }

  // Group tools by server
  const toolsByServer = new Map<string, typeof mcpTools>();
  for (const tool of mcpTools) {
    const existing = toolsByServer.get(tool.serverName) || [];
    existing.push(tool);
    toolsByServer.set(tool.serverName, existing);
  }

  const serverSections = Array.from(toolsByServer.entries()).map(([serverName, tools]) => {
    const toolsList = tools.map(tool =>
      `  - **${tool.name}**: ${tool.description}`
    ).join('\n');
    return `**${serverName}** (${tools.length} tools):\n${toolsList}`;
  }).join('\n\n');

  return `
<mcp_tools>
You have access to ${mcpTools.length} MCP (Model Context Protocol) tools from ${toolsByServer.size} connected server(s):

${serverSections}

**How to use MCP tools:**
- MCP tools use the format: \`mcp__<ServerName>__<toolName>\`
- ServerName is case-sensitive and must match exactly (e.g., "Chrome" not "chrome")
- Common Chrome tools: \`mcp__Chrome__navigate\`, \`mcp__Chrome__click\`, \`mcp__Chrome__type\`, \`mcp__Chrome__screenshot\`
- If a tool call fails with "No such tool available", the MCP server may not be connected yet

**Example - Navigate to a URL:**
Use tool \`mcp__Chrome__navigate\` with arguments: { "url": "https://www.google.com" }

**Example - Click an element:**
Use tool \`mcp__Chrome__click\` with arguments: { "selector": "button.submit" }
</mcp_tools>
`;
}

/**
 * Build credentials prompt section with saved user credentials.
 * Credentials are provided directly to the agent for automated login.
 */
export function getCredentialsPrompt(): string {
  try {
    const credentials = credentialsStore.getAll();
    if (credentials.length === 0) {
      return '';
    }

    // Group credentials by type
    const emailCredentials = credentials.filter(c => c.type === 'email');
    const websiteCredentials = credentials.filter(c => c.type === 'website');
    const apiCredentials = credentials.filter(c => c.type === 'api');
    const otherCredentials = credentials.filter(c => c.type === 'other');

    const formatCredential = (c: UserCredential) => {
      const lines = [`- **${c.name}**${c.service ? ` (${c.service})` : ''}`];
      lines.push(`  - Username/Email: \`${c.username}\``);
      lines.push(`  - Password: \`${c.password}\``);
      if (c.url) lines.push(`  - URL: ${c.url}`);
      if (c.notes) lines.push(`  - Notes: ${c.notes}`);
      return lines.join('\n');
    };

    const sections: string[] = [];

    if (emailCredentials.length > 0) {
      sections.push(`**Email Accounts (${emailCredentials.length}):**\n${emailCredentials.map(formatCredential).join('\n\n')}`);
    }
    if (websiteCredentials.length > 0) {
      sections.push(`**Website Accounts (${websiteCredentials.length}):**\n${websiteCredentials.map(formatCredential).join('\n\n')}`);
    }
    if (apiCredentials.length > 0) {
      sections.push(`**API Keys (${apiCredentials.length}):**\n${apiCredentials.map(formatCredential).join('\n\n')}`);
    }
    if (otherCredentials.length > 0) {
      sections.push(`**Other Credentials (${otherCredentials.length}):**\n${otherCredentials.map(formatCredential).join('\n\n')}`);
    }

    return `
<saved_credentials>
The user has saved ${credentials.length} credential(s) for automated login. Use these credentials when the user asks you to access their accounts.

${sections.join('\n\n')}

**IMPORTANT - How to use credentials:**
- Use these credentials directly when logging into websites or services
- For email access (e.g., Gmail), use the Chrome MCP tools to navigate to the login page and enter the credentials
- NEVER display, share, or echo passwords in your responses to the user
- Only use credentials for tasks the user explicitly requests
- If login fails, inform the user but do not expose the password
</saved_credentials>
`;
  } catch (error) {
    logError('[SystemPrompt] Failed to get credentials prompt:', error);
    return '';
  }
}

/**
 * Build workspace mode context for the system prompt.
 * Based on the user's onboarding preference, tells Navi whether to guide the user
 * through actions on their real machine or inside a VM.
 */
export function getVMCoworkPrompt(): string {
  try {
    const workEnvironment = configStore.get('workEnvironment');

    if (workEnvironment === 'real-machine') {
      return `
<workspace_mode>
The user works on their real machine. You CANNOT use computer_use tools.
When the user needs to perform GUI or desktop actions:
1. Break the task into clear, numbered steps
2. Describe exactly what to click, type, or navigate to
3. Include keyboard shortcuts where helpful (e.g. Ctrl+S, Alt+Tab)
4. For multi-step workflows, emit a \`\`\`json:action-steps card with structured steps
5. For simple single-step actions, describe them inline in your response
6. Ask the user to confirm when they've completed each major step
7. Adapt instructions to the user's OS (Windows, macOS, Linux) when possible
</workspace_mode>`;
    }

    if (workEnvironment === 'vm') {
      const activeVMs = vmManager.getActiveCoworkVMs();

      let vmContext = '';
      if (activeVMs.length > 0) {
        const sections = activeVMs.map((vm: { id: string; name: string; state: string }) => {
          return `- **${vm.name}** (${vm.id}): state=${vm.state}`;
        });
        vmContext = `\nActive VM(s):\n${sections.join('\n')}\n`;
      } else {
        vmContext = `\nNo VM is currently running. If the task requires a GUI environment, suggest launching a Cowork Desktop by emitting a \`\`\`json:vm-suggestion card.\n`;
      }

      return `
<workspace_mode>
The user works inside a Virtual Machine. You CANNOT use computer_use tools — you must guide the user with step-by-step instructions instead.
${vmContext}
When the user needs to perform GUI or desktop actions inside the VM:
1. Break the task into clear, numbered steps
2. Describe exactly what to click, type, or navigate to inside the VM
3. Include keyboard shortcuts where helpful
4. For multi-step workflows, emit a \`\`\`json:action-steps card with structured steps
5. For simple single-step actions, describe them inline in your response
6. Ask the user to confirm when they've completed each major step
7. Instructions should target the VM's guest OS (typically Linux)
</workspace_mode>`;
    }

    return `
<workspace_mode>
The user has not yet selected their preferred work environment. If they ask you to perform desktop/GUI actions, ask them whether they'd like to work on their real machine or in a virtual machine.
</workspace_mode>`;
  } catch (error) {
    logError('[SystemPrompt] Failed to get workspace mode prompt:', error);
    return '';
  }
}
