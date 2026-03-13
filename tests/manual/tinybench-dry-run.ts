/**
 * Quick connectivity test for gui-operate MCP server.
 * Run: npx tsx tests/manual/tinybench-dry-run.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const serverPath = path.join(process.cwd(), 'dist-mcp', 'gui-operate-server.js');
  if (!fs.existsSync(serverPath)) {
    console.error('gui-operate-server.js not found. Run: npm run build:mcp');
    process.exit(1);
  }
  console.log('Connecting to:', serverPath);

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
  });

  const client = new Client(
    { name: 'tinybench-dry-run', version: '0.1.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log('Connected!');

    const { tools } = await client.listTools();
    console.log(`\nFound ${tools.length} tools:`);
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${(tool.description || '').slice(0, 80)}`);
    }

    // Take a screenshot
    console.log('\nTaking screenshot...');
    const result = await client.callTool({
      name: 'screenshot_for_display',
      arguments: {
        display_index: 0,
        force_refresh: true,
        reason: 'TinyBench dry-run connectivity test',
      },
    }) as {
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };

    if (result.isError) {
      const errText = result.content?.find((p) => p.type === 'text')?.text;
      console.error('Screenshot failed:', errText);
      process.exit(1);
    }

    const textPart = result.content?.find((p) => p.type === 'text');
    const imagePart = result.content?.find((p) => p.type === 'image');

    if (textPart?.text) {
      const meta = JSON.parse(textPart.text);
      console.log('Display info:', {
        width: meta.displayInfo?.width,
        height: meta.displayInfo?.height,
        scaleFactor: meta.displayInfo?.scaleFactor,
      });
    }

    if (imagePart?.data) {
      const outPath = path.join(process.cwd(), '.tmp', 'tinybench-dry-run.png');
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await fs.promises.writeFile(outPath, Buffer.from(imagePart.data, 'base64'));
      console.log(`Screenshot saved: ${outPath} (${imagePart.data.length} chars base64)`);
    } else {
      console.error('No image data received!');
    }

    console.log('\nDry-run SUCCESS — gui-operate MCP is working.');
  } finally {
    try { await client.close(); } catch { /* noop */ }
    try { await transport.close(); } catch { /* noop */ }
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
