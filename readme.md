## Getting Started

### Prerequisites

- Node.js
- npm or pnpm
- Claude Code CLI installed globally: `npm install -g @anthropic-ai/claude-code`

### Environment Variables

Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
```

Then edit `.env` with your API credentials:

```bash
# Required: API authentication
ANTHROPIC_AUTH_TOKEN=your_api_key_here

# Optional: Custom API endpoint (e.g., OpenRouter)
ANTHROPIC_BASE_URL=https://openrouter.ai/api

# Optional: Custom model selection
CLAUDE_MODEL=anthropic/claude-sonnet-4.5
# or
ANTHROPIC_DEFAULT_SONNET_MODEL=anthropic/claude-sonnet-4.5

# Optional: Custom Claude Code CLI path
CLAUDE_CODE_PATH=/path/to/claude-code/cli.js

# Optional: Default working directory
COWORK_WORKDIR=/path/to/default/workspace
```

The `.env` file is automatically loaded when the application starts (via dotenv).

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Building

```bash
# Build for production
npm run build

# Build and package for distribution
npm run build && electron-builder
```

## Project Structure

```
open-cowork/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── claude/           # Claude Agent SDK integration
│   │   │   └── agent-runner.ts   # Main agent runner with SDK
│   │   ├── db/               # Database layer
│   │   ├── sandbox/          # Path resolver & security
│   │   ├── session/          # Session management
│   │   ├── skills/           # Skills system (MCP support)
│   │   └── tools/            # Tool executor
│   │
│   ├── preload/              # Electron preload scripts
│   │
│   └── renderer/             # React frontend
│       ├── components/       # UI components
│       │   ├── ChatView.tsx      # Main chat interface
│       │   ├── MessageCard.tsx   # Message rendering
│       │   ├── Sidebar.tsx       # Session sidebar
│       │   └── WelcomeView.tsx   # Landing page
│       ├── hooks/            # Custom React hooks
│       ├── store/            # Zustand state management
│       ├── styles/           # Global CSS + TailwindCSS
│       └── types/            # TypeScript type definitions
│
├── resources/                # Build resources
└── package.json
```

## Usage

1. **Start a Session**: Enter a prompt on the welcome screen and optionally select a working folder
2. **Chat with Claude**: Send messages and receive AI assistance
3. **Tool Execution**: Claude can read, write, and edit files within the sandboxed workspace
4. **Trace Panel**: View real-time execution traces on the right side panel

## Security

All file operations go through the PathResolver for security validation:

- ✅ Virtual path validation (`/mnt/workspace/...`)
- ✅ Path traversal prevention (blocks `../`)
- ✅ Symlink escape detection
- ✅ Authorization boundary enforcement
- ✅ Command sandbox validation for shell execution

## Configuration

### Skills

Skills can be configured at three levels:

1. **Built-in**: File system, shell, and search tools
2. **Project-level**: Place `.json` config files in `<project>/.skills/` or `<project>/skills/`
3. **Global**: Place config files in `~/.open-cowork/skills/`

### Permission Rules

Default permission rules are set in the store:

```typescript
{
  defaultTools: ['read', 'glob', 'grep'],
  permissionRules: [
    { tool: 'read', action: 'allow' },
    { tool: 'write', action: 'ask' },
    { tool: 'bash', action: 'ask' },
  ]
}
```

## Development

```bash
# Run development server with hot reload
npm run dev

# Lint code
npm run lint

# Format code
npm run format

# Run tests
npm run test
```

## Known Limitations

- MCP server startup/shutdown is not yet fully implemented
- Settings persistence via IPC is pending implementation
- In-memory database (data is not persisted between sessions)

## Roadmap

- [ ] **Multi-API Provider Support** - Currently implemented primarily for OpenRouter. Need to add support for direct Anthropic API and other providers
- [ ] **macOS Testing & Support** - Windows development complete, need to test and verify functionality on macOS
- [ ] **Skills System Enhancement** - Full MCP server integration, custom skill creation (PPT etc.)
- [ ] **Better UI Design** - Make it more like Claude Cowork

## License

MIT
