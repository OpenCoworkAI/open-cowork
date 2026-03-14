# Open Cowork - Browser Extension Progress Tracker

Browser extension companion for the Open Cowork desktop app. Automatically tracks your browser-based work activities, categorizes them for career development insights, and syncs with the Coeadapt web platform.

## Features

- **Automatic Activity Tracking** - Tracks time spent on websites, categorized by career-relevant activities (learning, coding, research, career search, etc.)
- **Focus Score** - Real-time productivity metric based on time in productive categories
- **Career Goals** - Set and track progress toward career development goals
- **Weekly Analytics** - Visual breakdown of your week's activity patterns
- **Desktop App Integration** - Syncs with the Open Cowork Electron desktop app via local HTTP API
- **Coeadapt Integration** - Push progress data to the Coeadapt web app for AI-powered career recommendations
- **Content Engagement Signals** - Detects scroll depth, typing, video playback to measure real engagement
- **Privacy First** - All data stored locally; sync is opt-in

## Architecture

```
browser-extension/
├── manifest.json          # Chrome Extension Manifest V3
├── background.js          # Service worker: tab tracking, idle detection, alarms
├── content.js             # Content script: engagement signal detection
├── lib/
│   ├── categories.js      # URL categorization rules (100+ domain patterns)
│   ├── storage.js         # chrome.storage.local wrapper
│   └── cowork-api.js      # Desktop app & Coeadapt API client
├── popup/
│   ├── popup.html/css/js  # Extension popup UI (today/week/goals tabs)
├── options/
│   ├── options.html/css/js # Settings page (tracking, exclusions, API config)
└── icons/                 # Extension icons
```

## Desktop API Server

The companion API server (`src/main/api/browser-api-server.ts`) runs inside the Electron main process on `127.0.0.1:3777` and provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with sandbox mode info |
| `/api/sessions` | GET/POST | List or create agent sessions |
| `/api/sessions/:id` | GET | Get session details |
| `/api/sessions/:id/messages` | GET | Get session messages |
| `/api/sessions/:id/trace` | GET | Get execution trace steps |
| `/api/sessions/:id/continue` | POST | Continue session with prompt |
| `/api/sessions/:id/stop` | POST | Stop a running session |
| `/api/browser/activities` | GET/POST | Browser activity data |
| `/api/browser/summary` | GET/POST | Daily summary data |
| `/api/workspace` | GET | Current workspace path |
| `/api/sandbox/status` | GET | VM sandbox status (WSL2/Lima) |
| `/api/config` | GET | App configuration (safe fields) |
| `/api/skills` | GET | Available skills |
| `/api/mcp/servers` | GET | Connected MCP servers |
| `/api/events` | GET | SSE stream for real-time events |

## Installation

### From Source (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `browser-extension/` directory

### Desktop App Setup

The browser API server starts automatically with the desktop app. To verify:
- Open the desktop app
- The API server runs on `http://127.0.0.1:3777`
- Test: visit `http://127.0.0.1:3777/api/health` in your browser

## Activity Categories

| Category | Examples |
|----------|----------|
| Learning & Courses | Coursera, Udemy, Codecademy, LeetCode |
| Coding & Development | GitHub, StackOverflow, MDN, VS Code Web |
| Research & Reading | Medium, dev.to, arXiv, Hacker News |
| Communication | Slack, Discord, Teams, Email |
| Career & Job Search | LinkedIn, Indeed, Glassdoor |
| Design & Creative | Figma, Canva, Dribbble |
| Writing & Documentation | Google Docs, Notion, Obsidian |
| Project Management | Jira, Trello, Asana, Linear |

## Coeadapt Integration

When connected to the Coeadapt web app, the extension syncs:
- Activity summaries by category
- Focus scores and trends
- Goal progress data
- Skills development patterns

Configure in Settings > Coeadapt Integration with your API URL and key.
