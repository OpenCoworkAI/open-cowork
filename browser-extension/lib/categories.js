/**
 * Activity categorization rules for career development tracking.
 * Maps URL patterns and page content signals to career-relevant categories.
 */

export const CATEGORIES = {
  LEARNING: {
    id: 'learning',
    label: 'Learning & Courses',
    color: '#6366f1',
    icon: '📚',
  },
  CODING: {
    id: 'coding',
    label: 'Coding & Development',
    color: '#06b6d4',
    icon: '💻',
  },
  RESEARCH: {
    id: 'research',
    label: 'Research & Reading',
    color: '#8b5cf6',
    icon: '🔍',
  },
  COMMUNICATION: {
    id: 'communication',
    label: 'Communication & Collaboration',
    color: '#f59e0b',
    icon: '💬',
  },
  CAREER: {
    id: 'career',
    label: 'Career & Job Search',
    color: '#10b981',
    icon: '🎯',
  },
  DESIGN: {
    id: 'design',
    label: 'Design & Creative',
    color: '#ec4899',
    icon: '🎨',
  },
  WRITING: {
    id: 'writing',
    label: 'Writing & Documentation',
    color: '#14b8a6',
    icon: '✍️',
  },
  PROJECT_MGMT: {
    id: 'project_mgmt',
    label: 'Project Management',
    color: '#f97316',
    icon: '📋',
  },
  OTHER: {
    id: 'other',
    label: 'Other',
    color: '#6b7280',
    icon: '📄',
  },
};

/**
 * Domain-based categorization rules.
 * Each rule maps a domain pattern to a category.
 */
const DOMAIN_RULES = [
  // Learning platforms
  { pattern: /coursera\.org/i, category: 'learning' },
  { pattern: /udemy\.com/i, category: 'learning' },
  { pattern: /edx\.org/i, category: 'learning' },
  { pattern: /khanacademy\.org/i, category: 'learning' },
  { pattern: /pluralsight\.com/i, category: 'learning' },
  { pattern: /linkedin\.com\/learning/i, category: 'learning' },
  { pattern: /skillshare\.com/i, category: 'learning' },
  { pattern: /codecademy\.com/i, category: 'learning' },
  { pattern: /freecodecamp\.org/i, category: 'learning' },
  { pattern: /leetcode\.com/i, category: 'learning' },
  { pattern: /hackerrank\.com/i, category: 'learning' },
  { pattern: /brilliant\.org/i, category: 'learning' },
  { pattern: /egghead\.io/i, category: 'learning' },
  { pattern: /frontendmasters\.com/i, category: 'learning' },
  { pattern: /youtube\.com.*(?:tutorial|course|learn|lecture)/i, category: 'learning' },

  // Coding & development
  { pattern: /github\.com/i, category: 'coding' },
  { pattern: /gitlab\.com/i, category: 'coding' },
  { pattern: /bitbucket\.org/i, category: 'coding' },
  { pattern: /stackoverflow\.com/i, category: 'coding' },
  { pattern: /stackexchange\.com/i, category: 'coding' },
  { pattern: /codepen\.io/i, category: 'coding' },
  { pattern: /codesandbox\.io/i, category: 'coding' },
  { pattern: /replit\.com/i, category: 'coding' },
  { pattern: /jsfiddle\.net/i, category: 'coding' },
  { pattern: /npmjs\.com/i, category: 'coding' },
  { pattern: /pypi\.org/i, category: 'coding' },
  { pattern: /crates\.io/i, category: 'coding' },
  { pattern: /developer\./i, category: 'coding' },
  { pattern: /docs\./i, category: 'coding' },
  { pattern: /devdocs\.io/i, category: 'coding' },
  { pattern: /mdn\.mozilla/i, category: 'coding' },
  { pattern: /vercel\.com/i, category: 'coding' },
  { pattern: /netlify\.com/i, category: 'coding' },
  { pattern: /heroku\.com/i, category: 'coding' },
  { pattern: /aws\.amazon\.com/i, category: 'coding' },
  { pattern: /cloud\.google\.com/i, category: 'coding' },
  { pattern: /azure\.microsoft\.com/i, category: 'coding' },

  // Research & reading
  { pattern: /arxiv\.org/i, category: 'research' },
  { pattern: /scholar\.google/i, category: 'research' },
  { pattern: /medium\.com/i, category: 'research' },
  { pattern: /dev\.to/i, category: 'research' },
  { pattern: /hashnode\.dev/i, category: 'research' },
  { pattern: /substack\.com/i, category: 'research' },
  { pattern: /wikipedia\.org/i, category: 'research' },
  { pattern: /news\.ycombinator\.com/i, category: 'research' },
  { pattern: /techcrunch\.com/i, category: 'research' },
  { pattern: /theverge\.com/i, category: 'research' },
  { pattern: /wired\.com/i, category: 'research' },

  // Communication
  { pattern: /slack\.com/i, category: 'communication' },
  { pattern: /discord\.com/i, category: 'communication' },
  { pattern: /teams\.microsoft\.com/i, category: 'communication' },
  { pattern: /zoom\.us/i, category: 'communication' },
  { pattern: /meet\.google\.com/i, category: 'communication' },
  { pattern: /mail\.google\.com/i, category: 'communication' },
  { pattern: /outlook\.live\.com/i, category: 'communication' },
  { pattern: /outlook\.office\.com/i, category: 'communication' },

  // Career & job search
  { pattern: /linkedin\.com(?!\/learning)/i, category: 'career' },
  { pattern: /indeed\.com/i, category: 'career' },
  { pattern: /glassdoor\.com/i, category: 'career' },
  { pattern: /angel\.co/i, category: 'career' },
  { pattern: /wellfound\.com/i, category: 'career' },
  { pattern: /lever\.co/i, category: 'career' },
  { pattern: /greenhouse\.io/i, category: 'career' },
  { pattern: /workday\.com/i, category: 'career' },
  { pattern: /monster\.com/i, category: 'career' },
  { pattern: /ziprecruiter\.com/i, category: 'career' },

  // Design
  { pattern: /figma\.com/i, category: 'design' },
  { pattern: /canva\.com/i, category: 'design' },
  { pattern: /dribbble\.com/i, category: 'design' },
  { pattern: /behance\.net/i, category: 'design' },
  { pattern: /sketch\.com/i, category: 'design' },
  { pattern: /adobe\.com/i, category: 'design' },

  // Writing & docs
  { pattern: /docs\.google\.com/i, category: 'writing' },
  { pattern: /notion\.so/i, category: 'writing' },
  { pattern: /obsidian\.md/i, category: 'writing' },
  { pattern: /grammarly\.com/i, category: 'writing' },
  { pattern: /overleaf\.com/i, category: 'writing' },

  // Project management
  { pattern: /jira\.atlassian/i, category: 'project_mgmt' },
  { pattern: /trello\.com/i, category: 'project_mgmt' },
  { pattern: /asana\.com/i, category: 'project_mgmt' },
  { pattern: /monday\.com/i, category: 'project_mgmt' },
  { pattern: /clickup\.com/i, category: 'project_mgmt' },
  { pattern: /linear\.app/i, category: 'project_mgmt' },
  { pattern: /shortcut\.com/i, category: 'project_mgmt' },
  { pattern: /github\.com.*(?:issues|projects|pull)/i, category: 'project_mgmt' },
];

/**
 * Categorize a URL into a career-relevant activity category.
 * @param {string} url - The URL to categorize
 * @param {string} [title] - Optional page title for additional context
 * @returns {string} Category ID
 */
export function categorizeUrl(url, title = '') {
  const fullContext = `${url} ${title}`.toLowerCase();

  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(fullContext)) {
      return rule.category;
    }
  }

  return 'other';
}

/**
 * Get category info by ID.
 * @param {string} categoryId
 * @returns {object} Category info
 */
export function getCategoryInfo(categoryId) {
  const entry = Object.values(CATEGORIES).find((c) => c.id === categoryId);
  return entry || CATEGORIES.OTHER;
}
