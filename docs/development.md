# Developer Guide

This guide covers everything you need to set up, build, test, and contribute to Open Cowork.

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm** (comes with Node.js)
- **Git**

### Platform-Specific (Optional)

| Platform | Tool | Purpose |
|----------|------|---------|
| Windows | [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install) | Enhanced sandbox isolation |
| macOS | [Lima](https://lima-vm.io/) (`brew install lima`) | Enhanced sandbox isolation |

These are optional — the app works without them using native execution with path restrictions.

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/OpenCoworkAI/open-cowork.git
cd open-cowork

# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild

# Start development server
npm run dev
```

`npm run dev` runs the full development pipeline:
1. Downloads bundled Node.js (`download:node`)
2. Prepares Python runtime (`prepare:python`)
3. Compiles WSL agent TypeScript (`build:wsl-agent`)
4. Compiles Lima agent TypeScript (`build:lima-agent`)
5. Bundles MCP servers with esbuild (`build:mcp`)
6. Starts Vite dev server with Electron hot reload

---

## Build Pipeline

### Development

```bash
npm run dev          # Full dev pipeline + Vite hot reload
```

### Production Build

```bash
npm run build        # Full production build + installer
```

The production build pipeline:

| Step | Script | What It Does |
|------|--------|-------------|
| 1 | `download:node` | Downloads platform-specific Node.js to `resources/node/` |
| 2 | `prepare:gui-tools` | Downloads GUI automation tools (cliclick for macOS) |
| 3 | `prepare:python:all` | Bundles Python runtime with Pillow and PyObjC for all platforms |
| 4 | `build:wsl-agent` | Compiles `src/main/sandbox/wsl-agent/` TypeScript |
| 5 | `build:lima-agent` | Compiles `src/main/sandbox/lima-agent/` TypeScript |
| 6 | `build:mcp` | Bundles MCP servers with esbuild to `dist-mcp/` |
| 7 | `tsc` | TypeScript type checking |
| 8 | `vite build` | Bundles renderer and main process |
| 9 | `electron-builder` | Packages into platform installers |

### Build Outputs

| Platform | Output | Architecture |
|----------|--------|-------------|
| Windows | `.exe` (NSIS installer) | x64 |
| macOS | `.dmg` | arm64, x64 |
| Linux | AppImage | x64 |

### Individual Build Scripts

```bash
npm run build:wsl-agent    # Compile WSL sandbox agent only
npm run build:lima-agent   # Compile Lima sandbox agent only
npm run build:mcp          # Bundle MCP servers only
npm run download:node      # Download bundled Node.js only
npm run prepare:gui-tools  # Download GUI tools only
npm run prepare:python     # Prepare Python for current platform
npm run prepare:python:all # Prepare Python for all platforms
```

---

## Project Structure

```
open-cowork/
├── src/
│   ├── main/                           # Electron Main Process
│   │   ├── index.ts                    # App entry point, IPC handlers
│   │   ├── claude/                     # Claude Agent SDK integration
│   │   │   ├── agent-runner.ts         # Core agent execution engine
│   │   │   ├── claude-env.ts           # Environment variable builder
│   │   │   ├── redaction.ts            # Sensitive text redaction
│   │   │   └── thinking-options.ts     # Extended thinking configuration
│   │   ├── config/                     # Configuration management
│   │   │   ├── config-store.ts         # Persistent settings (electron-store)
│   │   │   └── api-tester.ts           # API connectivity testing
│   │   ├── credentials/               # Credential storage
│   │   ├── db/                         # SQLite database layer
│   │   │   └── database.ts            # Schema, CRUD operations
│   │   ├── docker/                     # Docker/CareerBox integration
│   │   ├── mcp/                        # MCP server management
│   │   │   ├── mcp-manager.ts          # Server connections and tool discovery
│   │   │   ├── mcp-config-store.ts     # YAML-based server config
│   │   │   ├── mcp-logger.ts           # MCP-specific logging
│   │   │   ├── gui-operate-server.ts   # GUI automation MCP server
│   │   │   └── software-dev-server-example.ts
│   │   ├── memory/                     # Context/memory management
│   │   │   └── memory-manager.ts       # Message history, context strategies
│   │   ├── openai/                     # OpenAI-compatible runner
│   │   │   └── responses-runner.ts     # Responses/Chat completions runner
│   │   ├── remote/                     # Remote control system
│   │   │   ├── remote-manager.ts       # Central remote orchestrator
│   │   │   ├── gateway.ts             # HTTP webhook gateway
│   │   │   ├── message-router.ts       # Request routing
│   │   │   ├── tunnel-manager.ts       # Ngrok tunnel management
│   │   │   ├── remote-config-store.ts  # Remote settings persistence
│   │   │   ├── remote-title.ts         # Remote session title generation
│   │   │   ├── channels/              # Channel implementations
│   │   │   │   └── feishu.ts          # Feishu/Lark bot channel
│   │   │   └── types.ts              # Remote type definitions
│   │   ├── sandbox/                    # Execution isolation
│   │   │   ├── sandbox-adapter.ts      # Unified sandbox interface
│   │   │   ├── sandbox-bootstrap.ts    # First-time sandbox setup
│   │   │   ├── sandbox-sync.ts         # WSL file sync
│   │   │   ├── wsl-bridge.ts           # WSL2 command execution
│   │   │   ├── lima-bridge.ts          # Lima VM command execution
│   │   │   ├── lima-sync.ts            # Lima file sync
│   │   │   ├── native-executor.ts      # Fallback native execution
│   │   │   ├── path-guard.ts           # Path restriction enforcement
│   │   │   ├── path-resolver.ts        # Virtual → real path mapping
│   │   │   ├── types.ts               # Sandbox type definitions
│   │   │   ├── wsl-agent/             # Agent running inside WSL VM
│   │   │   └── lima-agent/            # Agent running inside Lima VM
│   │   ├── session/                    # Session management
│   │   │   ├── session-manager.ts      # Session lifecycle orchestration
│   │   │   └── session-title-flow.ts   # Auto title generation
│   │   ├── skills/                     # Plugin/Skill system
│   │   │   ├── plugin-runtime-service.ts  # V2 plugin runtime
│   │   │   ├── plugin-catalog-service.ts  # Plugin catalog browsing
│   │   │   ├── plugin-registry-store.ts   # Plugin state persistence
│   │   │   └── skills-manager.ts       # Legacy skill management
│   │   ├── tools/                      # Tool execution
│   │   │   ├── tool-executor.ts        # Native tool execution
│   │   │   └── sandbox-tool-executor.ts # Sandbox-aware execution
│   │   └── utils/                      # Shared utilities
│   │       ├── logger.ts              # Logging infrastructure
│   │       └── artifact-parser.ts      # Artifact extraction from output
│   ├── preload/                        # Electron preload script
│   │   └── index.ts                   # Context bridge (IPC API)
│   └── renderer/                       # Frontend UI
│       ├── App.tsx                    # Root component
│       ├── main.tsx                   # React entry point
│       ├── components/                # React components
│       │   ├── ChatView.tsx           # Chat interface
│       │   ├── MessageCard.tsx        # Message rendering
│       │   ├── SettingsPanel.tsx      # Settings UI
│       │   ├── ConfigModal.tsx        # API/model configuration
│       │   ├── ContextPanel.tsx       # Workspace/tool info
│       │   ├── TracePanel.tsx         # Agent reasoning trace
│       │   ├── Sidebar.tsx            # Session navigation
│       │   ├── Titlebar.tsx           # Custom window titlebar
│       │   ├── WelcomeView.tsx        # Onboarding screen
│       │   ├── PermissionDialog.tsx   # Tool permission approval
│       │   ├── MCPConnectorsModal.tsx # MCP server management
│       │   ├── CredentialsModal.tsx   # Credential management
│       │   ├── RemoteControlPanel.tsx # Remote control config
│       │   ├── SandboxSetupDialog.tsx # Sandbox initialization
│       │   ├── SandboxSyncToast.tsx   # Sync progress notification
│       │   ├── CareerBoxView.tsx      # CareerBox Docker integration
│       │   ├── CareerCards.tsx        # Career skill UI cards
│       │   ├── LanguageSwitcher.tsx   # i18n language toggle
│       │   └── index.ts              # Component exports
│       ├── hooks/
│       │   └── useIPC.ts             # IPC event handling hook
│       ├── store/
│       │   └── index.ts              # Zustand state store
│       ├── i18n/                      # Internationalization
│       │   ├── locales/en.json       # English translations
│       │   ├── locales/zh.json       # Chinese translations
│       │   └── README.md             # i18n usage guide
│       ├── styles/
│       │   └── globals.css           # Tailwind + custom styles
│       ├── types/
│       │   └── index.ts              # Shared TypeScript types
│       └── utils/                     # Frontend utilities
│           ├── artifact-path.ts       # Artifact path resolution
│           ├── artifact-steps.ts      # Artifact trace helpers
│           ├── file-link.ts           # File link parsing
│           ├── session-update.ts      # State reconciliation
│           └── tool-output-path.ts    # Tool output path handling
├── .claude/
│   ├── settings.local.json           # Claude Code permissions
│   └── skills/                        # Built-in skill definitions
│       ├── career/SKILL.md           # Career coaching skill
│       ├── pptx/SKILL.md            # PowerPoint generation
│       ├── docx/SKILL.md            # Word document processing
│       ├── pdf/SKILL.md             # PDF handling & forms
│       ├── xlsx/SKILL.md            # Excel spreadsheet support
│       └── skill-creator/SKILL.md   # Custom skill creation guide
├── scripts/                           # Build automation
│   ├── bundle-mcp.js                # Bundle MCP servers
│   ├── download-node.js             # Download bundled Node.js
│   ├── prepare-gui-tools.js         # GUI automation tool setup
│   └── prepare-python.js            # Python runtime setup
├── resources/                         # Static assets
│   ├── icon.png / icon.ico / icon.icns  # App icons
│   ├── logo.png                     # App logo
│   ├── entitlements.mac.plist       # macOS entitlements
│   └── node/                        # Bundled Node.js (gitignored)
├── tests/                             # Test files
│   ├── *.test.ts                    # 28 test files
│   └── support/                     # Test harnesses
├── electron-builder.yml               # Packaging configuration
├── vite.config.ts                    # Vite bundler config
├── vitest.config.ts                  # Test runner config
├── tsconfig.json                     # TypeScript config
├── .eslintrc.cjs                     # Linting rules
├── .prettierrc                       # Code formatting
├── .env.example                      # Environment template
└── package.json                      # Dependencies & scripts
```

---

## Code Conventions

### TypeScript

- **Strict mode** enabled (`strict: true` in tsconfig)
- **Target:** ES2022
- **Module:** ESNext
- **JSX:** react-jsx

### Path Aliases

| Alias | Maps To |
|-------|---------|
| `@/` | `src/` |
| `@main/` | `src/main/` |
| `@renderer/` | `src/renderer/` |

### ESLint

- Extends: `eslint:recommended`, `@typescript-eslint/recommended`, `react-hooks/recommended`
- `@typescript-eslint/no-unused-vars`: warn (ignores `_`-prefixed params)
- `@typescript-eslint/no-explicit-any`: warn
- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warn

### Prettier

- Semicolons: yes
- Single quotes: yes
- Tab width: 2
- Trailing commas: es5
- Print width: 100
- Line endings: auto

### Running Linters

```bash
npm run lint     # Run ESLint
npm run format   # Format with Prettier
```

---

## Testing

### Framework

Tests use **Vitest** with the following configuration (`vitest.config.ts`):

- Environment: `node`
- Includes: `src/**/*.{test,spec}.{js,ts}` and `tests/**/*.{test,spec}.{js,ts}`
- Excludes: `node_modules`, `dist`, `dist-electron`, `.claude`
- Mock settings: `mockReset` and `restoreMocks` enabled

### Running Tests

```bash
npm test         # Run all tests
npx vitest run   # Run once (CI mode)
npx vitest       # Watch mode
```

### Coverage

Coverage uses the V8 provider with reporters: text, json, html.

Excluded from coverage:
- `src/renderer/` (UI components)
- `**/*.d.ts` (type declarations)
- `**/*.config.*` (config files)
- `**/mockData` (test fixtures)

### Test File Locations

All tests live in `tests/*.test.ts`. Key test files:

- `agent-runner-plugins.test.ts` — plugin loading in agent runner
- `api-tester.test.ts` — API connectivity testing
- `artifact-parser.test.ts` — artifact extraction
- `plugin-catalog-service.test.ts` — plugin catalog
- `plugin-runtime-service.test.ts` — plugin runtime
- `redaction.test.ts` — sensitive text redaction
- `skills-manager-plugin-install.test.ts` — skill installation

Support harnesses are in `tests/support/`.

---

## Adding a New Feature

### Adding an IPC Event

1. Define the event type in `src/renderer/types/index.ts` (add to `ClientEvent` or `ServerEvent` union)
2. Add the handler in `src/main/index.ts` in the IPC switch statement
3. Expose the method in `src/preload/index.ts` under the appropriate namespace
4. Call it from the renderer via `window.electronAPI.<namespace>.<method>()`

### Creating a Skill

1. Create a directory in `.claude/skills/<skill-name>/`
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: my-skill
   description: "What this skill does..."
   ---
   # Instructions for the agent
   ```
3. The agent will automatically discover it and show it in the system prompt

### Adding an MCP Server Preset

1. Open `src/main/mcp/mcp-config-store.ts`
2. Add a preset entry in the `createFromPreset()` method
3. Define the server config (type, command, args, env)

### Adding a UI Component

1. Create the component in `src/renderer/components/`
2. Use the `useTranslation()` hook for any user-facing text
3. Add translation keys to `src/renderer/i18n/locales/en.json` and `zh.json`
4. Connect to the Zustand store if state management is needed
5. Use the IPC hook (`useIPC.ts`) for backend communication

---

## Internationalization

The app supports English and Chinese via `react-i18next`. See `src/renderer/i18n/README.md` for full usage guide.

Key points:
- Translation files: `src/renderer/i18n/locales/en.json` and `zh.json`
- Use `const { t } = useTranslation()` in components
- Keys are organized by feature: `common.*`, `welcome.*`, `settings.*`, `mcp.*`, `credentials.*`
- Language auto-detected from browser, persisted in localStorage

---

## Packaging & Distribution

### Configuration

Packaging is configured in `electron-builder.yml`:

- **App ID:** `com.coeadapt.app`
- **Product Name:** Coeadapt
- **ASAR unpacked modules:** claude-code, claude-agent-sdk, sharp, better-sqlite3
- **Extra resources:** WSL/Lima agents, MCP servers, bundled Node.js, Python runtime, skills

### Native Module Rebuilding

After `npm install`, rebuild native modules for Electron:

```bash
npm run rebuild   # Rebuilds better-sqlite3 for current Electron version
```

This is required because `better-sqlite3` includes compiled C++ bindings that must match Electron's Node.js version.

---

## Environment Variables

### User-Facing (`.env`)

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_AUTH_TOKEN` | API key for Anthropic/OpenRouter | Yes (or configure in UI) |
| `ANTHROPIC_BASE_URL` | Custom API endpoint | No |
| `CLAUDE_MODEL` | Model to use | No |
| `CLAUDE_CODE_PATH` | Path to claude-code CLI | No |

### Internal (Set by the App)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Set to empty string for OpenRouter compatibility |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model name for OpenRouter |
| `OPENAI_API_KEY` | For OpenAI provider |
| `OPENAI_BASE_URL` | For OpenAI provider |
| `OPENAI_MODEL` | For OpenAI provider |
| `CLAUDE_CONFIG_DIR` | Points to app-specific Claude config directory |
| `COWORK_WORKDIR` | Default working directory |
| `ELECTRON_RUN_AS_NODE` | Set when using Electron as Node.js fallback |
| `OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT` | Disables image output for non-vision models |
