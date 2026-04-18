# Contributing to Open Cowork

Thank you for your interest in contributing! Open Cowork is an open-source desktop AI agent app built with Electron, React, and TypeScript. This guide covers everything you need to get started.

---

## Development Setup

**Requirements**

- Node.js 22 (matches CI)
- npm 10+
- macOS or Windows

**Install**

```bash
git clone https://github.com/OpenCoworkAI/open-cowork.git
cd open-cowork
npm install        # also runs postinstall: downloads Node binaries + rebuilds native modules
```

**Common commands**

| Command            | Purpose                            |
| ------------------ | ---------------------------------- |
| `npm run dev`      | Start dev server (Vite + Electron) |
| `npm run lint`     | ESLint over `src/**/*.{ts,tsx}`    |
| `npm run format`   | Prettier write                     |
| `npx tsc --noEmit` | Type-check without emitting        |
| `npm run test`     | Run Vitest                         |
| `npm run build`    | Full production build              |

---

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── claude/              # AI execution (agent-runner, model resolution, auth)
│   ├── config/              # electron-store, API keys, presets
│   ├── mcp/                 # MCP server lifecycle (stdio / SSE / Streamable HTTP)
│   ├── session/             # Session CRUD, chat history
│   ├── tools/               # Tool execution dispatch
│   ├── db/                  # SQLite schema and migrations
│   ├── sandbox/             # Lima (macOS) / WSL2 (Windows) isolation
│   ├── skills/              # Skill discovery and hot-reload
│   ├── remote/              # Feishu/Lark bot integration
│   └── schedule/            # Cron-like scheduled tasks
└── renderer/                # React frontend
    ├── components/          # UI components
    ├── hooks/               # Custom React hooks
    ├── store/               # Zustand state
    ├── i18n/                # i18next localization
    └── styles/              # Tailwind + global CSS
```

Test files live in `src/` alongside their source, or under `tests/` at the root, mirroring the source path (e.g. `src/main/mcp/foo.ts` → `src/tests/mcp/foo.test.ts`).

---

## Code Style

- **TypeScript strict mode** — no implicit `any`
- **ESLint + Prettier** — 2-space indent; run `npm run lint` and `npm run format` before pushing
- **React functional components** with hooks only — no class components
- **Tailwind CSS** for all styling — no CSS modules, no inline style objects unless unavoidable
- **Icons** — use `lucide-react`; do not add other icon libraries

---

## Git Workflow

**Branch naming**

```
main            — stable releases
dev             — integration branch (target for most PRs)
feature/<name>  — new features
fix/<name>      — bug fixes
```

**Conventional Commits** are enforced by commitlint + husky on every commit.

```
<type>(<scope>): <short summary>
```

Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `chore`, `ci`, `style`, `revert`, `release`, `merge`

Header max length: **100 characters**

Examples:

```
feat(mcp): add Streamable HTTP transport support
fix(sandbox): handle WSL2 path with spaces
docs: update README setup instructions
test(session): add unit tests for session-manager
```

Scope is optional but encouraged.

---

## Pull Request Guidelines

1. **Target `dev`** for all feature/fix PRs; target `main` only for releases.
2. **Tests are required** for every `feat` and `fix` PR — see [Testing](#testing).
3. **Single component file limit**: keep individual component files under 500 lines. Split large components into smaller sub-components.
4. **No `any`**: use `unknown` + type guards instead. `catch (e: unknown)` is correct; `catch (e: any)` will be rejected in review.
5. **CI must be green**: the PR must pass lint (`npm run lint`), type-check (`npx tsc --noEmit`), and tests (`npx vitest run`) before merge.
6. Keep changes minimal and focused — avoid unrelated refactors in the same PR.

---

## Dependency Management

Open Cowork uses **Dependabot** (`.github/dependabot.yml`) to keep dependencies current. To avoid PR pile-up and reduce risk, we follow a tiered strategy:

### Tiers

| Tier                 | Scope                            | Merge policy                                                                         |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| **Auto-merge**       | GitHub Actions (all versions)    | CI green → merge immediately. CI actions are grouped into a single PR.               |
| **Auto-merge**       | Dev-dependencies (patch + minor) | CI green → merge immediately. Grouped into a single PR per week.                     |
| **Quick review**     | Production dependencies (patch)  | Skim changelog, merge if CI green. Grouped into a single PR per week.                |
| **Manual review**    | Production dependencies (minor)  | Read changelog, check for behavioral changes, then merge. Grouped into a single PR.  |
| **Dedicated branch** | Any dependency (major)           | Create a migration branch, test thoroughly, update code if needed. Never auto-merge. |

### Critical dependencies (always manual review)

These packages are deeply integrated — any update (including patch) should be tested locally before merge:

- `electron` — major upgrades need a dedicated migration branch; skip Dependabot for major versions
- `@mariozechner/pi-coding-agent` — core AI SDK; read release notes carefully
- `better-sqlite3` — native module; rebuild required, test on both platforms
- `vite` / `@vitejs/plugin-react` — build toolchain; verify `npm run build` succeeds

### Weekly workflow

1. **Monday**: Dependabot opens grouped PRs
2. **Within the week**: maintainer reviews and merges per tier policy
3. **Friday**: any remaining patch/minor PRs should be merged or closed with reason
4. **Major upgrades**: file an issue, plan the migration, merge when ready

### Adding new dependencies

Before adding a dependency:

1. **Check license** — must be MIT, Apache-2.0, BSD, or ISC. No GPL/AGPL/SSPL.
2. **Check size** — run `npx pkg-size <package>` or check bundlephobia. Avoid bloating the installer.
3. **Check maintenance** — prefer packages with recent commits, multiple maintainers, and >1K weekly downloads.
4. **Prefer built-in** — use Node.js built-ins or existing dependencies before adding new ones.
5. **Document why** — add a comment in the PR description explaining why this dependency is needed and what alternatives were considered.

---

## Testing

Open Cowork uses **Vitest**.

**File placement**

Place test files next to their source or under a mirrored path:

```
src/main/mcp/mcp-manager.ts      →  src/tests/mcp/mcp-manager.test.ts
src/main/session/session-manager.ts  →  src/tests/session/session-manager.test.ts
```

Both `src/**/*.{test,spec}.ts` and `tests/**/*.{test,spec}.ts` are picked up automatically.

**Run tests**

```bash
npm run test               # watch mode
npx vitest run             # single run (used in CI)
npx vitest run --coverage  # with v8 coverage report
```

Coverage reports are written to `coverage/` (html, json, text).

---

## i18n

All user-visible strings must go through **i18next** — never hard-code display text.

```tsx
// Good
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
return <button>{t('settings.save')}</button>;

// Bad
return <button>Save</button>;
```

Translation files live in `src/renderer/i18n/`. Add keys to both `en` and `zh` locales when introducing new UI text.

---

## Reporting Issues

**Bug reports** — use the GitHub issue template and include:

- Open Cowork version
- Operating system (macOS / Windows + version)
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs (from DevTools console or the in-app log viewer)

**Feature requests** — open a GitHub Discussion or issue with:

- The problem you are trying to solve
- Your proposed solution or behavior
- Any alternatives you considered

For questions or informal discussion, open a GitHub Discussion rather than an issue.
