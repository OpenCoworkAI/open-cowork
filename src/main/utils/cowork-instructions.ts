import type { Session } from '../../renderer/types';
import type { MCPManager, MCPTool } from '../mcp/mcp-manager';

function formatMcpServerSections(tools: MCPTool[]): string {
  const toolsByServer = new Map<string, MCPTool[]>();
  for (const tool of tools) {
    const existing = toolsByServer.get(tool.serverName) || [];
    existing.push(tool);
    toolsByServer.set(tool.serverName, existing);
  }

  return Array.from(toolsByServer.entries())
    .map(([serverName, serverTools]) => {
      const toolsList = serverTools
        .map((tool) => `  - **${tool.name}**: ${tool.description || 'No description provided.'}`)
        .join('\n');
      return `**${serverName}** (${serverTools.length} tools):\n${toolsList}`;
    })
    .join('\n\n');
}

export function buildMcpToolsPrompt(mcpManager?: MCPManager): string {
  if (!mcpManager) return '';

  const mcpTools = mcpManager.getTools();
  if (mcpTools.length === 0) return '';

  const serverSections = formatMcpServerSections(mcpTools);
  const connectedServerCount = new Set(mcpTools.map((tool) => tool.serverName)).size;

  return `
<mcp_tools>
You have access to ${mcpTools.length} MCP (Model Context Protocol) tools from ${connectedServerCount} connected server(s):

${serverSections}

How to use MCP tools:
- MCP tools use the format: \`mcp__<ServerName>__<toolName>\`
- ServerName is case-sensitive and must match exactly
- If a tool call fails with "No such tool available", the MCP server may not be connected yet
</mcp_tools>
`.trim();
}

export function buildOpenAICoworkInstructions(session: Session, mcpManager?: MCPManager): string {
  const sections: string[] = [];
  sections.push('You are Open Cowork, a coding agent. Think step-by-step, call tools when needed, and answer in the user language.');

  const workspacePath = session.cwd || session.mountedPaths?.[0]?.real;
  if (workspacePath) {
    sections.push(`<workspace_info>Your current workspace is: ${workspacePath}</workspace_info>`);
  }

  const mcpPrompt = buildMcpToolsPrompt(mcpManager);
  if (mcpPrompt) {
    sections.push(mcpPrompt);
  }

  sections.push(`<tool_behavior>
AskUserQuestion:
- Use AskUserQuestion for missing requirements before starting multi-step work.
- Do not ask clarification questions directly in assistant text when AskUserQuestion is available.
- If details are not blocking, make a reasonable assumption and proceed.

TodoWrite:
- Use TodoWrite for non-trivial tasks that involve tool calls.
- Keep one item marked as in_progress when actively executing.
- Include a final verification step before completion.

Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (\`mcp__Chrome__*\`) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`);

  sections.push(`<artifact_instructions>
When you produce a final deliverable file, declare it once using this exact block so the app can show it as the final artifact:
\`\`\`artifact
{"path":"/workspace/path/to/file.ext","name":"optional display name","type":"optional type"}
\`\`\`
</artifact_instructions>`);

  return sections.join('\n\n').trim();
}
