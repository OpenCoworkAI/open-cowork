# Open Cowork x Coeadapt Integration — Launch Master Plan

**Version:** 1.0
**Date:** 2026-02-25
**Status:** In Development
**Branch:** `claude/launch-coeadapt-integration-b0UCa`

---

## 1. Executive Summary

This master plan outlines the strategy for integrating **Open Cowork** (an open-source AI agent desktop application) with **Coeadapt** (an AI-powered career development and human capital platform). The integration creates a powerful bridge between Open Cowork's sandboxed AI agent capabilities and Coeadapt's career transformation tools — enabling users to leverage AI agents for career development, skill-building, portfolio creation, and job search workflows directly from their desktop.

### Value Proposition

| For Coeadapt Users | For Open Cowork Users |
|---|---|
| Desktop AI agent that generates career documents (resumes, cover letters, portfolios) | New career-focused skill set and channel connector |
| AI-powered interview prep with document generation (PPTX, DOCX) | Seamless access to Coeadapt's career intelligence |
| Automated skill gap analysis with actionable file outputs | Integration with a growing career platform ecosystem |
| Navi AI copilot accessible from desktop context | Remote control from Coeadapt web dashboard |

---

## 2. Architecture Overview

### 2.1 Integration Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    COEADAPT WEB PLATFORM                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Navi AI  │  │  Career Box  │  │  User Dashboard / ATS  │ │
│  └────┬─────┘  └──────┬───────┘  └───────────┬────────────┘ │
│       │               │                      │               │
│       └───────────────┼──────────────────────┘               │
│                       │                                      │
│              ┌────────▼────────┐                             │
│              │  Coeadapt API   │                             │
│              │  (REST / WS)    │                             │
│              └────────┬────────┘                             │
└───────────────────────┼─────────────────────────────────────┘
                        │
              ┌─────────▼──────────┐
              │   INTEGRATION      │
              │   LAYER            │
              │  ┌──────────────┐  │
              │  │ Coeadapt     │  │
              │  │ Channel      │  │
              │  │ Connector    │  │
              │  └──────────────┘  │
              │  ┌──────────────┐  │
              │  │ Coeadapt     │  │
              │  │ API Client   │  │
              │  └──────────────┘  │
              │  ┌──────────────┐  │
              │  │ Career       │  │
              │  │ Skills       │  │
              │  └──────────────┘  │
              └─────────┬──────────┘
                        │
┌───────────────────────┼─────────────────────────────────────┐
│                OPEN COWORK DESKTOP APP                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Agent      │  │ Skills     │  │  Remote Gateway        │ │
│  │ Runner     │  │ Manager    │  │  (WebSocket + Channels)│ │
│  └────────────┘  └────────────┘  └────────────────────────┘ │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Sandbox    │  │ MCP        │  │  Renderer / UI         │ │
│  │ (WSL/Lima) │  │ Servers    │  │  (React + Tailwind)    │ │
│  └────────────┘  └────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Integration Components

| Component | Location | Purpose |
|---|---|---|
| **Coeadapt Channel** | `src/main/remote/channels/coeadapt/` | Remote channel connector for bi-directional messaging |
| **Coeadapt API Client** | `src/main/remote/channels/coeadapt/coeadapt-api.ts` | REST/WebSocket client for Coeadapt platform APIs |
| **Career Skills** | `.claude/skills/coeadapt-career/` | Built-in skill for career document generation |
| **Channel Config Types** | `src/main/remote/types.ts` | TypeScript type definitions for Coeadapt channel |
| **UI Config Panel** | `src/renderer/components/` | Configuration UI for Coeadapt connection settings |

---

## 3. Implementation Phases

### Phase 1: Foundation (Current Sprint)
> Establish the core integration infrastructure

- [x] Research Coeadapt platform capabilities and tech stack
- [x] Analyze Open Cowork architecture (channels, skills, plugins)
- [ ] Define Coeadapt channel type in remote types system
- [ ] Implement Coeadapt API client stub
- [ ] Create Coeadapt channel connector (extends ChannelBase)
- [ ] Wire into RemoteManager
- [ ] Create career skill (SKILL.md)
- [ ] Add Coeadapt to configuration UI

### Phase 2: Core Integration (Next Sprint)
> Build out the bidirectional communication

- [ ] Implement OAuth2/Clerk authentication flow with Coeadapt
- [ ] Build webhook receiver for Coeadapt events
- [ ] Implement career data sync (skills, roadmaps, portfolios)
- [ ] Add Coeadapt-specific message content types (career cards, skill badges)
- [ ] Create MCP server for Coeadapt tools (skill tracking, job search)

### Phase 3: Career Workflows (Sprint +2)
> Enable high-value career automation workflows

- [ ] Resume/CV generation workflow (DOCX output via existing skill)
- [ ] Portfolio case study builder (pull projects, generate showcase docs)
- [ ] Interview prep agent (role-specific questions, feedback)
- [ ] Skill gap analysis with actionable learning plans
- [ ] Job application tracker integration with Coeadapt ATS

### Phase 4: Launch & Polish (Sprint +3)
> Production readiness and public release

- [ ] End-to-end testing with Coeadapt staging environment
- [ ] Error handling, retry logic, and offline resilience
- [ ] User onboarding flow (first-time Coeadapt connection wizard)
- [ ] Documentation (user guide, API reference)
- [ ] Performance optimization and caching
- [ ] Security audit (credential storage, data in transit)
- [ ] Beta release to Coeadapt user base

---

## 4. Technical Specifications

### 4.1 Coeadapt Channel Type

New channel type added to the existing remote control system alongside Feishu, Telegram, WeChat, etc.

```typescript
// Channel type extension
type ChannelType = 'feishu' | 'wechat' | 'telegram' | 'dingtalk' | 'websocket' | 'coeadapt';

// Coeadapt-specific channel configuration
interface CoeadaptChannelConfig {
  type: 'coeadapt';

  /** Coeadapt platform base URL */
  baseUrl: string;

  /** API key or OAuth token for authentication */
  apiKey?: string;

  /** OAuth2 configuration (via Clerk) */
  oauth?: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
  };

  /** WebSocket endpoint for real-time events */
  wsEndpoint?: string;

  /** Webhook configuration for receiving Coeadapt events */
  webhook?: {
    secret: string;
    events: CoeadaptEventType[];
  };

  /** User mapping configuration */
  userMapping: {
    /** How to identify users across platforms */
    strategy: 'email' | 'coeadapt_id' | 'custom';
  };

  /** Feature flags */
  features: {
    careerSync: boolean;
    jobSearch: boolean;
    interviewPrep: boolean;
    portfolioBuilder: boolean;
    skillTracking: boolean;
  };
}
```

### 4.2 Coeadapt API Client

```typescript
interface CoeadaptAPI {
  // Authentication
  authenticate(credentials: CoeadaptCredentials): Promise<AuthToken>;
  refreshToken(token: string): Promise<AuthToken>;

  // User Profile
  getUserProfile(userId: string): Promise<CoeadaptUserProfile>;
  getSkillsMap(userId: string): Promise<SkillsMap>;
  getCareerRoadmap(userId: string): Promise<CareerRoadmap>;

  // Career Tools
  analyzeSkillGap(currentSkills: string[], targetRole: string): Promise<SkillGapAnalysis>;
  generateCareerPlan(profile: CoeadaptUserProfile): Promise<CareerPlan>;
  searchJobs(criteria: JobSearchCriteria): Promise<JobListing[]>;

  // Portfolio
  getPortfolio(userId: string): Promise<Portfolio>;
  addPortfolioItem(userId: string, item: PortfolioItem): Promise<void>;

  // Events & Messaging
  subscribeToEvents(userId: string, events: CoeadaptEventType[]): Promise<WebSocket>;
  sendMessage(userId: string, message: CoeadaptMessage): Promise<void>;
}
```

### 4.3 Career Skill Definition

The Coeadapt career skill extends Open Cowork's built-in skill system to provide career-focused AI capabilities:

- **Resume Builder**: Generate professional resumes from Coeadapt skill profiles
- **Cover Letter Writer**: Context-aware cover letters matching job descriptions
- **Portfolio Generator**: Create case study documents from project data
- **Interview Coach**: Role-specific preparation with practice questions
- **Career Dashboard**: Synthesize career progress into visual reports

### 4.4 Message Flow

```
[Coeadapt Web App]
       │
       │ (1) User triggers action (e.g., "Generate resume")
       ▼
[Coeadapt API / WebSocket]
       │
       │ (2) Event dispatched to Open Cowork channel
       ▼
[CoeadaptChannel.emitMessage()]
       │
       │ (3) Message routed through gateway
       ▼
[MessageRouter → AgentExecutor]
       │
       │ (4) AI agent processes request with career skill context
       ▼
[Agent Runner + Career Skill]
       │
       │ (5) Generates output (e.g., DOCX resume)
       ▼
[CoeadaptChannel.send()]
       │
       │ (6) Response sent back to Coeadapt platform
       ▼
[Coeadapt Web App — User sees result]
```

---

## 5. Security Considerations

| Concern | Mitigation |
|---|---|
| API credential storage | Use Electron's encrypted credential store (existing `credentials-store.ts`) |
| Data in transit | HTTPS/WSS only; TLS 1.3 required |
| OAuth token lifecycle | Auto-refresh with Clerk SDK; revoke on disconnect |
| Sandbox isolation | Career document generation runs in WSL/Lima sandbox |
| User data privacy | No career data cached locally without explicit consent |
| Cross-origin requests | Validate Coeadapt origin on all webhook payloads |

---

## 6. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Connection success rate | > 95% | Successful channel connections / total attempts |
| Message delivery latency | < 2s | Time from Coeadapt event to Open Cowork agent start |
| Document generation time | < 30s | Time from request to generated DOCX/PPTX output |
| User adoption (beta) | 100+ users | Unique Coeadapt users connecting in first month |
| Error rate | < 1% | Failed operations / total operations |

---

## 7. Dependencies & Prerequisites

### From Coeadapt
- [ ] API documentation and access credentials
- [ ] OAuth2/Clerk application registration
- [ ] WebSocket endpoint specification
- [ ] Webhook event catalog
- [ ] Staging environment access for testing
- [ ] Coeadapt user profile schema

### From Open Cowork
- [x] Remote channel system (ChannelBase, RemoteManager)
- [x] Skills system (SkillsManager, SKILL.md format)
- [x] Plugin runtime (V2 plugin system)
- [x] Credential storage (credentials-store.ts)
- [x] Document generation skills (DOCX, PPTX, XLSX, PDF)
- [x] Sandbox execution environment

---

## 8. Team & Ownership

| Role | Responsibility |
|---|---|
| Integration Lead | Architecture, channel connector, API client |
| Frontend Engineer | Configuration UI, onboarding wizard |
| Coeadapt Liaison | API access, webhook setup, testing coordination |
| QA | End-to-end testing, security review |

---

## 9. Timeline

| Phase | Duration | Target Completion |
|---|---|---|
| Phase 1: Foundation | 1 sprint (2 weeks) | March 2026 |
| Phase 2: Core Integration | 1 sprint (2 weeks) | March 2026 |
| Phase 3: Career Workflows | 2 sprints (4 weeks) | April 2026 |
| Phase 4: Launch & Polish | 1 sprint (2 weeks) | May 2026 |
| **Public Launch** | — | **May 2026** |

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Coeadapt API not publicly available yet (beta) | High | High | Build against documented patterns; use mock server for dev |
| Authentication complexity (Clerk + OAuth) | Medium | Medium | Start with API key auth; add OAuth in Phase 2 |
| Platform API changes during beta | Medium | Medium | Version-pin API client; abstract behind interface |
| GCP infrastructure differences | Low | Low | Standard REST/WS protocols; no GCP-specific deps |
| Rate limiting on Coeadapt API | Medium | Low | Implement request queuing and backoff |

---

*This is a living document. Updated as the integration progresses.*
