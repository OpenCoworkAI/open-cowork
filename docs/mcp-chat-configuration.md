# Configure MCP connectors in chat

You can ask Open Cowork to list your configured MCP connectors or add a connector
using its documented configuration. Provide the server command and arguments
for a local stdio server, or its HTTP endpoint for SSE / Streamable HTTP. The
agent should ask for missing details rather than inventing an Obsidian server
package or endpoint.

For example, ask it to save this configuration, substituting the real executable
and vault directory from your MCP server's setup instructions:

```json
{
  "name": "My notes",
  "type": "stdio",
  "command": "/path/to/your/mcp-server",
  "args": ["/path/to/your/vault"],
  "enabled": false
}
```

The `mcp_configure` tool uses the normal tool approval flow. New connectors are
disabled unless you explicitly request activation with `enabled: true`. Saving
configuration does not install a package. An enabled connector is started using
the configured command or connected using its URL on the following chat turn;
that command may perform its own setup, such as an explicitly configured `npx`
invocation. Review the supplied command before approving it.

Use `mcp_list` to find an existing connector ID, then include that ID when editing
it. Environment and header credentials omitted from an edit are retained. The
listing and save result omit stored credential values. Saved connectors also
appear in Settings → MCP Connectors. If activation fails, the next turn reports
that it could not connect and permits a later retry; saving does not prove a
working connection.

Background subagents cannot use `mcp_configure`. Tools from a new connector
become available after the next turn refreshes the session's tool registry.
