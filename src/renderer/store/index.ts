import { create } from 'zustand';
import type { Session, Message, TraceStep, PermissionRequest, UserQuestionRequest, Settings, AppConfig, SandboxSetupProgress, SandboxSyncStatus, ContainerInfo, PullProgress, VMStatus, ImageDownloadProgress, BackendStatus, VMBootstrapProgress, VMHealthEvent, VMHealthSummary, GuestProvisionProgress, CareerProfile, NaviLab, CareerTrack } from '../types';
import { applySessionUpdate } from '../utils/session-update';

interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  
  // Messages
  messagesBySession: Record<string, Message[]>;
  partialMessagesBySession: Record<string, string>;
  pendingTurnsBySession: Record<string, string[]>;
  activeTurnsBySession: Record<string, { stepId: string; userMessageId: string } | null>;
  
  // Trace steps
  traceStepsBySession: Record<string, TraceStep[]>;
  
  // UI state
  isLoading: boolean;
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;
  
  // Permission
  pendingPermission: PermissionRequest | null;
  
  // User Question (AskUserQuestion)
  pendingQuestion: UserQuestionRequest | null;
  
  // Settings
  settings: Settings;
  
  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  
  // Working directory
  workingDir: string | null;
  
  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;
  
  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;

  // CareerBox state
  activeView: 'chat' | 'careerbox' | 'vm' | 'cowork-desktop';
  careerboxStatus: ContainerInfo | null;
  careerboxDockerAvailable: boolean;
  careerboxPullProgress: PullProgress | null;
  careerboxHealthy: boolean;

  // VM state
  vmBackendStatus: BackendStatus | null;
  vmList: VMStatus[];
  vmImageDownloadProgress: ImageDownloadProgress | null;
  vmCreateWizardOpen: boolean;
  vmBootstrapProgress: VMBootstrapProgress | null;
  vmHealthEvents: VMHealthEvent[];
  vmHealthSummaries: VMHealthSummary[];
  vmProvisionProgress: GuestProvisionProgress | null;

  // Cowork Desktop state
  activeCoworkVM: { id: string; name: string; state: string } | null;
  coworkVNCUrl: string | null;
  coworkComputerUseEnabled: boolean;

  // Onboarding state
  showOnboardingModal: boolean;
  workEnvironment: 'real-machine' | 'vm' | null;

  // Coeadapt / Cora state
  coraChatOpen: boolean;
  coeadaptConnected: boolean;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  
  addMessage: (sessionId: string, message: Message) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setPartialMessage: (sessionId: string, partial: string) => void;
  clearPartialMessage: (sessionId: string) => void;
  activateNextTurn: (sessionId: string, stepId: string) => void;
  updateActiveTurnStep: (sessionId: string, stepId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  clearQueuedMessages: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;
  
  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  setTraceSteps: (sessionId: string, steps: TraceStep[]) => void;
  
  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  
  setPendingPermission: (permission: PermissionRequest | null) => void;
  setPendingQuestion: (question: UserQuestionRequest | null) => void;
  
  updateSettings: (updates: Partial<Settings>) => void;
  
  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  
  // Working directory actions
  setWorkingDir: (path: string | null) => void;
  
  // Sandbox setup actions
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;
  
  // Sandbox sync actions
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;

  // CareerBox actions
  setActiveView: (view: 'chat' | 'careerbox' | 'vm' | 'cowork-desktop') => void;
  setCareerboxStatus: (status: ContainerInfo | null) => void;
  setCareerboxDockerAvailable: (available: boolean) => void;
  setCareerboxPullProgress: (progress: PullProgress | null) => void;
  setCareerboxHealthy: (healthy: boolean) => void;

  // VM actions
  setVmBackendStatus: (status: BackendStatus | null) => void;
  setVmList: (vms: VMStatus[]) => void;
  setVmImageDownloadProgress: (progress: ImageDownloadProgress | null) => void;
  setVmCreateWizardOpen: (open: boolean) => void;
  setVmBootstrapProgress: (progress: VMBootstrapProgress | null) => void;
  handleVmHealthEvent: (event: VMHealthEvent) => void;
  setVmHealthSummaries: (summaries: VMHealthSummary[]) => void;
  setVmProvisionProgress: (progress: GuestProvisionProgress | null) => void;

  // Cowork Desktop actions
  setActiveCoworkVM: (vm: { id: string; name: string; state: string } | null) => void;
  setCoworkVNCUrl: (url: string | null) => void;
  setCoworkComputerUseEnabled: (enabled: boolean) => void;

  // Onboarding actions
  setShowOnboardingModal: (show: boolean) => void;
  setWorkEnvironment: (env: 'real-machine' | 'vm' | null) => void;

  // Coeadapt / Cora actions
  setCoraChatOpen: (open: boolean) => void;
  setCoeadaptConnected: (connected: boolean) => void;

  // Navi Labs state
  showCareerBox: boolean;
  careerProfile: CareerProfile;
  naviLabs: NaviLab[];
  activeTrackFilter: CareerTrack | 'all';

  // Navi Labs actions
  setShowCareerBox: (show: boolean) => void;
  updateCareerProfile: (updates: Partial<CareerProfile>) => void;
  setNaviLabs: (labs: NaviLab[]) => void;
  updateLabStatus: (labId: string, status: NaviLab['status']) => void;
  completeLab: (labId: string) => void;
  setActiveTrackFilter: (track: CareerTrack | 'all') => void;
}

const defaultSettings: Settings = {
  theme: 'light',
  defaultTools: [
    'askuserquestion',
    'todowrite',
    'todoread',
    'webfetch',
    'websearch',
    'read',
    'write',
    'edit',
    'list_directory',
    'glob',
    'grep',
  ],
  permissionRules: [
    { tool: 'read', action: 'allow' },
    { tool: 'glob', action: 'allow' },
    { tool: 'grep', action: 'allow' },
    { tool: 'write', action: 'ask' },
    { tool: 'edit', action: 'ask' },
    { tool: 'bash', action: 'ask' },
  ],
  globalSkillsPath: '',
  memoryStrategy: 'auto',
  maxContextTokens: 180000,
};

const defaultCareerProfile: CareerProfile = {
  targetRole: '',
  currentLevel: 'beginner',
  selectedTracks: [],
  completedLabs: [],
  totalXP: 0,
};

const initialNaviLabs: NaviLab[] = [
  // GenAI Track
  {
    id: 'genai-prompt-eng',
    title: 'Prompt Engineering Masterclass',
    description: 'Learn advanced prompting techniques for LLMs — chain-of-thought, few-shot, system prompts, and structured outputs.',
    track: 'genai',
    difficulty: 'beginner',
    status: 'available',
    estimatedMinutes: 30,
    xpReward: 150,
    skills: ['Prompt Engineering', 'LLM APIs', 'ChatGPT', 'Claude'],
    demandScore: 95,
    naviPrompt: 'Start an interactive prompt engineering lab. Walk me through chain-of-thought prompting, few-shot examples, system prompt design, and structured output formatting. Include hands-on exercises where I write prompts and you evaluate them, then score my work.',
    prerequisites: [],
  },
  {
    id: 'genai-rag-pipeline',
    title: 'Build a RAG Pipeline',
    description: 'Build a Retrieval-Augmented Generation pipeline with embeddings, vector stores, and contextual answer generation.',
    track: 'genai',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 45,
    xpReward: 250,
    skills: ['RAG', 'Embeddings', 'Vector Databases', 'LangChain'],
    demandScore: 92,
    naviPrompt: 'Create an interactive RAG pipeline lab. Guide me through: 1) Document chunking strategies, 2) Generating embeddings, 3) Setting up a vector store, 4) Building retrieval logic, 5) Connecting to an LLM for answer generation. Provide code scaffolds and have me fill in key sections.',
    prerequisites: ['genai-prompt-eng'],
  },
  {
    id: 'genai-agents',
    title: 'AI Agent Architectures',
    description: 'Design and build autonomous AI agents with tool use, planning, memory, and multi-step reasoning.',
    track: 'genai',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 60,
    xpReward: 400,
    skills: ['AI Agents', 'Tool Use', 'ReAct', 'Multi-Agent Systems'],
    demandScore: 97,
    naviPrompt: 'Run an advanced AI agent architecture lab. Cover: 1) ReAct pattern implementation, 2) Tool registration and calling, 3) Agent memory and state management, 4) Multi-agent orchestration, 5) Error handling and guardrails. Have me implement a working agent step by step.',
    prerequisites: ['genai-rag-pipeline'],
  },
  {
    id: 'genai-fine-tuning',
    title: 'Model Fine-Tuning Workshop',
    description: 'Fine-tune open-source LLMs with LoRA, QLoRA, and PEFT techniques on custom datasets.',
    track: 'genai',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 60,
    xpReward: 400,
    skills: ['Fine-Tuning', 'LoRA', 'Hugging Face', 'PyTorch'],
    demandScore: 88,
    naviPrompt: 'Run a model fine-tuning workshop. Walk me through: 1) Preparing a training dataset, 2) Setting up LoRA/QLoRA configuration, 3) Training loop with Hugging Face Trainer, 4) Evaluation metrics, 5) Model merging and deployment. Include code exercises throughout.',
    prerequisites: ['genai-prompt-eng'],
  },

  // Full-Stack Track
  {
    id: 'fs-react-patterns',
    title: 'Modern React Patterns',
    description: 'Master React Server Components, Suspense, hooks composition, and performance optimization patterns.',
    track: 'fullstack',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 40,
    xpReward: 200,
    skills: ['React', 'TypeScript', 'Next.js', 'Server Components'],
    demandScore: 90,
    naviPrompt: 'Start an interactive React patterns lab. Cover: 1) Custom hooks composition, 2) Server Components vs Client Components, 3) Suspense boundaries for data loading, 4) Performance with useMemo/useCallback/React.memo, 5) State management patterns. Include coding exercises for each pattern.',
    prerequisites: [],
  },
  {
    id: 'fs-api-design',
    title: 'API Design & REST/GraphQL',
    description: 'Design production-ready APIs with REST best practices, GraphQL schemas, authentication, and rate limiting.',
    track: 'fullstack',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 45,
    xpReward: 250,
    skills: ['REST APIs', 'GraphQL', 'Node.js', 'Authentication'],
    demandScore: 85,
    naviPrompt: 'Start an API design lab. Walk me through: 1) RESTful resource design, 2) GraphQL schema and resolver patterns, 3) JWT authentication flow, 4) Rate limiting and caching strategies, 5) API versioning. Have me design and implement endpoints step by step.',
    prerequisites: [],
  },
  {
    id: 'fs-system-design',
    title: 'Full-Stack System Design',
    description: 'Design scalable web architectures — load balancing, caching layers, database selection, and microservices.',
    track: 'fullstack',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 50,
    xpReward: 350,
    skills: ['System Design', 'Microservices', 'Caching', 'Load Balancing'],
    demandScore: 88,
    naviPrompt: 'Run a system design interview-style lab. Present me with a real-world system (e.g., URL shortener, chat app, or e-commerce platform). Guide me through: 1) Requirements gathering, 2) High-level architecture, 3) Database schema, 4) API design, 5) Scaling strategies. Evaluate my answers at each step.',
    prerequisites: ['fs-api-design'],
  },

  // Cloud & DevOps Track
  {
    id: 'cloud-docker-k8s',
    title: 'Docker & Kubernetes Essentials',
    description: 'Containerize applications with Docker, orchestrate with Kubernetes, and set up production deployments.',
    track: 'cloud-devops',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 45,
    xpReward: 250,
    skills: ['Docker', 'Kubernetes', 'Container Orchestration', 'YAML'],
    demandScore: 91,
    naviPrompt: 'Start a Docker & Kubernetes lab. Guide me through: 1) Writing multi-stage Dockerfiles, 2) Docker Compose for local dev, 3) Kubernetes Pod/Deployment/Service specs, 4) ConfigMaps and Secrets, 5) Rolling updates and health checks. Include YAML exercises for each concept.',
    prerequisites: [],
  },
  {
    id: 'cloud-cicd',
    title: 'CI/CD Pipeline Mastery',
    description: 'Build automated CI/CD pipelines with GitHub Actions, testing gates, deployment strategies, and monitoring.',
    track: 'cloud-devops',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 40,
    xpReward: 200,
    skills: ['GitHub Actions', 'CI/CD', 'Testing', 'Deployment'],
    demandScore: 87,
    naviPrompt: 'Run a CI/CD pipeline lab. Walk me through: 1) GitHub Actions workflow syntax, 2) Build and test stages, 3) Deployment strategies (blue-green, canary), 4) Environment secrets management, 5) Monitoring and rollback. Have me write pipeline YAML from scratch.',
    prerequisites: [],
  },
  {
    id: 'cloud-iac',
    title: 'Infrastructure as Code with Terraform',
    description: 'Provision cloud infrastructure with Terraform — modules, state management, and multi-cloud patterns.',
    track: 'cloud-devops',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 50,
    xpReward: 350,
    skills: ['Terraform', 'AWS', 'IaC', 'Cloud Architecture'],
    demandScore: 89,
    naviPrompt: 'Start a Terraform IaC lab. Guide me through: 1) HCL syntax and providers, 2) Resource definitions for compute/network/storage, 3) Terraform modules and reuse, 4) State management and backends, 5) Multi-environment deployments. Include HCL coding exercises.',
    prerequisites: ['cloud-docker-k8s'],
  },

  // AI/ML Track
  {
    id: 'aiml-python-ds',
    title: 'Python for Data Science',
    description: 'Master NumPy, Pandas, and Matplotlib for data manipulation, analysis, and visualization.',
    track: 'ai-ml',
    difficulty: 'beginner',
    status: 'available',
    estimatedMinutes: 35,
    xpReward: 150,
    skills: ['Python', 'NumPy', 'Pandas', 'Data Visualization'],
    demandScore: 82,
    naviPrompt: 'Start a Python data science lab. Cover: 1) NumPy array operations and broadcasting, 2) Pandas DataFrames — filtering, grouping, joining, 3) Matplotlib/Seaborn visualization, 4) Data cleaning techniques, 5) Exploratory data analysis workflow. Include dataset exercises.',
    prerequisites: [],
  },
  {
    id: 'aiml-ml-fundamentals',
    title: 'ML Model Training Pipeline',
    description: 'Build end-to-end ML pipelines — feature engineering, model selection, training, evaluation, and deployment.',
    track: 'ai-ml',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 50,
    xpReward: 300,
    skills: ['Scikit-learn', 'Feature Engineering', 'Model Evaluation', 'MLOps'],
    demandScore: 86,
    naviPrompt: 'Run an ML pipeline lab. Walk me through: 1) Feature engineering and preprocessing, 2) Model selection (classification/regression), 3) Cross-validation and hyperparameter tuning, 4) Evaluation metrics and interpretation, 5) Model serialization and serving. Include coding exercises with sample data.',
    prerequisites: ['aiml-python-ds'],
  },

  // Data Engineering Track
  {
    id: 'de-sql-advanced',
    title: 'Advanced SQL & Query Optimization',
    description: 'Master window functions, CTEs, query plans, indexing strategies, and database performance tuning.',
    track: 'data-engineering',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 40,
    xpReward: 200,
    skills: ['SQL', 'PostgreSQL', 'Query Optimization', 'Indexing'],
    demandScore: 84,
    naviPrompt: 'Start an advanced SQL lab. Cover: 1) Window functions (ROW_NUMBER, RANK, LAG, LEAD), 2) Common Table Expressions and recursive CTEs, 3) Query execution plans and EXPLAIN ANALYZE, 4) Indexing strategies (B-tree, GIN, partial), 5) Performance tuning patterns. Include SQL exercises with increasing difficulty.',
    prerequisites: [],
  },
  {
    id: 'de-streaming',
    title: 'Real-Time Data Streaming',
    description: 'Build streaming data pipelines with Kafka, event-driven architectures, and real-time processing.',
    track: 'data-engineering',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 50,
    xpReward: 350,
    skills: ['Apache Kafka', 'Stream Processing', 'Event-Driven Architecture'],
    demandScore: 83,
    naviPrompt: 'Run a data streaming lab. Guide me through: 1) Kafka producers and consumers, 2) Topic partitioning and replication, 3) Stream processing with transforms, 4) Event-driven architecture patterns, 5) Exactly-once delivery semantics. Include architecture design exercises.',
    prerequisites: ['de-sql-advanced'],
  },

  // Cybersecurity Track
  {
    id: 'sec-web-security',
    title: 'Web Application Security',
    description: 'Identify and prevent OWASP Top 10 vulnerabilities — XSS, CSRF, injection, and secure coding practices.',
    track: 'cybersecurity',
    difficulty: 'intermediate',
    status: 'available',
    estimatedMinutes: 45,
    xpReward: 250,
    skills: ['OWASP', 'XSS Prevention', 'SQL Injection', 'Secure Coding'],
    demandScore: 86,
    naviPrompt: 'Start a web security lab. Walk me through the OWASP Top 10: 1) SQL Injection detection and prevention, 2) Cross-Site Scripting (XSS) types and mitigations, 3) CSRF protection patterns, 4) Authentication vulnerabilities, 5) Secure headers and CSP. Include vulnerable code snippets for me to fix.',
    prerequisites: [],
  },
  {
    id: 'sec-cloud-security',
    title: 'Cloud Security & Zero Trust',
    description: 'Implement cloud security controls — IAM policies, network segmentation, encryption, and zero-trust architecture.',
    track: 'cybersecurity',
    difficulty: 'advanced',
    status: 'available',
    estimatedMinutes: 50,
    xpReward: 350,
    skills: ['Cloud Security', 'IAM', 'Zero Trust', 'Encryption'],
    demandScore: 90,
    naviPrompt: 'Run a cloud security lab. Cover: 1) IAM least-privilege policies, 2) Network segmentation and VPC design, 3) Encryption at rest and in transit, 4) Zero-trust architecture principles, 5) Security monitoring and incident response. Include policy writing exercises.',
    prerequisites: ['sec-web-security'],
  },
];

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  partialMessagesBySession: {},
  pendingTurnsBySession: {},
  activeTurnsBySession: {},
  traceStepsBySession: {},
  isLoading: false,
  sidebarCollapsed: false,
  contextPanelCollapsed: false,
  pendingPermission: null,
  pendingQuestion: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  activeView: 'chat',
  careerboxStatus: null,
  careerboxDockerAvailable: false,
  careerboxPullProgress: null,
  careerboxHealthy: false,
  vmBackendStatus: null,
  vmList: [],
  vmImageDownloadProgress: null,
  vmCreateWizardOpen: false,
  vmBootstrapProgress: null,
  vmHealthEvents: [],
  vmHealthSummaries: [],
  vmProvisionProgress: null,
  activeCoworkVM: null,
  coworkVNCUrl: null,
  coworkComputerUseEnabled: false,
  showOnboardingModal: false,
  workEnvironment: null,
  coraChatOpen: false,
  coeadaptConnected: false,

  // Session actions
  setSessions: (sessions) => set({ sessions }),
  
  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      messagesBySession: { ...state.messagesBySession, [session.id]: [] },
      partialMessagesBySession: { ...state.partialMessagesBySession, [session.id]: '' },
      pendingTurnsBySession: { ...state.pendingTurnsBySession, [session.id]: [] },
      activeTurnsBySession: { ...state.activeTurnsBySession, [session.id]: null },
      traceStepsBySession: { ...state.traceStepsBySession, [session.id]: [] },
    })),
  
  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: applySessionUpdate(state.sessions, sessionId, updates),
    })),
  
  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...restMessages } = state.messagesBySession;
      const { [sessionId]: __partials, ...restPartials } = state.partialMessagesBySession;
      const { [sessionId]: __pending, ...restPendingTurns } = state.pendingTurnsBySession;
      const { [sessionId]: __active, ...restActiveTurns } = state.activeTurnsBySession;
      const { [sessionId]: __traces, ...restTraces } = state.traceStepsBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messagesBySession: restMessages,
        partialMessagesBySession: restPartials,
        pendingTurnsBySession: restPendingTurns,
        activeTurnsBySession: restActiveTurns,
        traceStepsBySession: restTraces,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),
  
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  
  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let updatedMessages = messages;
      let updatedPendingTurns = state.pendingTurnsBySession;

      if (message.role === 'user') {
        updatedMessages = [...messages, message];
        const pending = [...(state.pendingTurnsBySession[sessionId] || []), message.id];
        updatedPendingTurns = {
          ...state.pendingTurnsBySession,
          [sessionId]: pending,
        };
      } else {
        const activeTurn = state.activeTurnsBySession[sessionId];
        if (activeTurn?.userMessageId) {
          const anchorIndex = messages.findIndex((item) => item.id === activeTurn.userMessageId);
          if (anchorIndex >= 0) {
            let insertIndex = anchorIndex + 1;
            while (insertIndex < messages.length) {
              if (messages[insertIndex].role === 'user') break;
              insertIndex += 1;
            }
            updatedMessages = [
              ...messages.slice(0, insertIndex),
              message,
              ...messages.slice(insertIndex),
            ];
          } else {
            updatedMessages = [...messages, message];
          }
        } else {
          updatedMessages = [...messages, message];
        }
      }

      const shouldClearPartial = message.role === 'assistant';
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
        pendingTurnsBySession: updatedPendingTurns,
        partialMessagesBySession: shouldClearPartial
          ? {
            ...state.partialMessagesBySession,
            [sessionId]: '',
          }
          : state.partialMessagesBySession,
      };
    }),
  
  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: messages,
      },
    })),
  
  setPartialMessage: (sessionId, partial) =>
    set((state) => ({
      partialMessagesBySession: {
        ...state.partialMessagesBySession,
        [sessionId]: (state.partialMessagesBySession[sessionId] || '') + partial,
      },
    })),
  
  clearPartialMessage: (sessionId) =>
    set((state) => ({
      partialMessagesBySession: {
        ...state.partialMessagesBySession,
        [sessionId]: '',
      },
    })),

  activateNextTurn: (sessionId, stepId) =>
    set((state) => {
      const pending = state.pendingTurnsBySession[sessionId] || [];
      if (pending.length === 0) {
        return {
          activeTurnsBySession: {
            ...state.activeTurnsBySession,
            [sessionId]: null,
          },
        };
      }

      const [nextMessageId, ...rest] = pending;
      const messages = state.messagesBySession[sessionId] || [];
      const updatedMessages = messages.map((message) =>
        message.id === nextMessageId ? { ...message, localStatus: undefined } : message
      );

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
        pendingTurnsBySession: {
          ...state.pendingTurnsBySession,
          [sessionId]: rest,
        },
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: { stepId, userMessageId: nextMessageId },
        },
      };
    }),

  updateActiveTurnStep: (sessionId, stepId) =>
    set((state) => {
      const activeTurn = state.activeTurnsBySession[sessionId];
      if (!activeTurn || activeTurn.stepId === stepId) return {};
      return {
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: { ...activeTurn, stepId },
        },
      };
    }),

  clearActiveTurn: (sessionId, stepId) =>
    set((state) => {
      const activeTurn = state.activeTurnsBySession[sessionId];
      if (!activeTurn) return {};
      if (stepId && activeTurn.stepId !== stepId) return {};
      return {
        activeTurnsBySession: {
          ...state.activeTurnsBySession,
          [sessionId]: null,
        },
      };
    }),

  clearPendingTurns: (sessionId) =>
    set((state) => ({
      pendingTurnsBySession: {
        ...state.pendingTurnsBySession,
        [sessionId]: [],
      },
    })),

  clearQueuedMessages: (sessionId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let hasQueued = false;
      const updatedMessages = messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: undefined };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
      };
    }),

  cancelQueuedMessages: (sessionId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      let hasQueued = false;
      const updatedMessages = messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: 'cancelled' as const };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: updatedMessages,
        },
      };
    }),
  
  // Trace actions
  addTraceStep: (sessionId, step) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: [...(state.traceStepsBySession[sessionId] || []), step],
      },
    })),
  
  updateTraceStep: (sessionId, stepId, updates) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: (state.traceStepsBySession[sessionId] || []).map((step) =>
          step.id === stepId ? { ...step, ...updates } : step
        ),
      },
    })),

  setTraceSteps: (sessionId, steps) =>
    set((state) => ({
      traceStepsBySession: {
        ...state.traceStepsBySession,
        [sessionId]: steps,
      },
    })),
  
  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleContextPanel: () => set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),
  
  // Permission actions
  setPendingPermission: (permission) => set({ pendingPermission: permission }),
  
  // Question actions (AskUserQuestion)
  setPendingQuestion: (question) => set({ pendingQuestion: question }),
  
  // Settings actions
  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  
  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  
  // Working directory actions
  setWorkingDir: (path) => set({ workingDir: path }),
  
  // Sandbox setup actions
  setSandboxSetupProgress: (progress) => set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) => set({ isSandboxSetupComplete: complete }),
  
  // Sandbox sync actions
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),

  // CareerBox actions
  setActiveView: (view) => set({ activeView: view }),
  setCareerboxStatus: (status) => set({ careerboxStatus: status }),
  setCareerboxDockerAvailable: (available) => set({ careerboxDockerAvailable: available }),
  setCareerboxPullProgress: (progress) => set({ careerboxPullProgress: progress }),
  setCareerboxHealthy: (healthy) => set({ careerboxHealthy: healthy }),

  // VM actions
  setVmBackendStatus: (status) => set({ vmBackendStatus: status }),
  setVmList: (vms) => set({ vmList: vms }),
  setVmImageDownloadProgress: (progress) => set({ vmImageDownloadProgress: progress }),
  setVmCreateWizardOpen: (open) => set({ vmCreateWizardOpen: open }),
  setVmBootstrapProgress: (progress) => set({ vmBootstrapProgress: progress }),
  handleVmHealthEvent: (event) => set((state) => ({
    vmHealthEvents: [...state.vmHealthEvents.slice(-49), event],
    vmList: state.vmList.map((vm) =>
      vm.id === event.vmId ? { ...vm, state: event.currentState } : vm
    ),
  })),
  setVmHealthSummaries: (summaries) => set({ vmHealthSummaries: summaries }),
  setVmProvisionProgress: (progress: GuestProvisionProgress | null) => set({ vmProvisionProgress: progress }),

  // Cowork Desktop actions
  setActiveCoworkVM: (vm) => set({ activeCoworkVM: vm }),
  setCoworkVNCUrl: (url) => set({ coworkVNCUrl: url }),
  setCoworkComputerUseEnabled: (enabled) => set({ coworkComputerUseEnabled: enabled }),

  // Onboarding actions
  setShowOnboardingModal: (show) => set({ showOnboardingModal: show }),
  setWorkEnvironment: (env) => set({ workEnvironment: env }),

  // Coeadapt / Cora actions
  setCoraChatOpen: (open) => set({ coraChatOpen: open }),
  setCoeadaptConnected: (connected) => set({ coeadaptConnected: connected }),

  // Navi Labs state
  showCareerBox: false,
  careerProfile: defaultCareerProfile,
  naviLabs: initialNaviLabs,
  activeTrackFilter: 'all',

  // Navi Labs actions
  setShowCareerBox: (show) => set({ showCareerBox: show }),
  updateCareerProfile: (updates) =>
    set((state) => ({
      careerProfile: { ...state.careerProfile, ...updates },
    })),
  setNaviLabs: (labs) => set({ naviLabs: labs }),
  updateLabStatus: (labId, status) =>
    set((state) => ({
      naviLabs: state.naviLabs.map((lab) =>
        lab.id === labId ? { ...lab, status } : lab
      ),
    })),
  completeLab: (labId) =>
    set((state) => {
      const lab = state.naviLabs.find((l) => l.id === labId);
      if (!lab) return {};
      return {
        naviLabs: state.naviLabs.map((l) =>
          l.id === labId ? { ...l, status: 'completed' as const } : l
        ),
        careerProfile: {
          ...state.careerProfile,
          completedLabs: [...state.careerProfile.completedLabs, labId],
          totalXP: state.careerProfile.totalXP + lab.xpReward,
        },
      };
    }),
  setActiveTrackFilter: (track) => set({ activeTrackFilter: track }),
}));
