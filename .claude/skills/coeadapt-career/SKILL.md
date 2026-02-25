---
name: coeadapt-career
description: "Career development workflows powered by the Coeadapt platform integration. When Claude needs to help users with: (1) Resume and cover letter generation, (2) Skill gap analysis and career roadmapping, (3) Portfolio case study creation, (4) Interview preparation and practice, (5) Job search and application tracking, or any other career development tasks connected to the Coeadapt platform"
---

# Coeadapt Career Development Skill

## Overview

This skill provides career development workflows that integrate with the **Coeadapt** platform — an AI-powered career transformation system. It enables Open Cowork's AI agent to assist users with career planning, document generation, skill tracking, and job search.

## Capabilities

| Workflow | Description | Output |
|----------|-------------|--------|
| Resume Builder | Generate professional resumes from skill profiles | `.docx` via docx skill |
| Cover Letter Writer | Context-aware cover letters matching job descriptions | `.docx` via docx skill |
| Portfolio Generator | Create case study documents from project data | `.docx` or `.pptx` |
| Interview Coach | Role-specific preparation with practice questions | Text-based Q&A |
| Skill Gap Analyzer | Compare current skills against target roles | Markdown report |
| Career Dashboard | Synthesize career progress into visual reports | `.xlsx` or `.pptx` |
| Job Match Evaluator | Evaluate job listings against user profile | Markdown summary |

## Quick Reference

### Resume Generation

When a user requests a resume or CV:

1. Gather the user's career information from Coeadapt (skills, experience, target role)
2. Select an appropriate resume template based on their career stage
3. Generate the document using the `docx` skill
4. Include sections: Summary, Skills, Experience, Education, Certifications

```
User: "Generate my resume for a Senior Product Manager role"

Steps:
1. Query Coeadapt profile for current skills and experience
2. Match skills to Senior Product Manager requirements
3. Highlight transferable skills and relevant achievements
4. Generate .docx with professional formatting
```

### Cover Letter Generation

When a user needs a cover letter:

1. Get the target job description (from Coeadapt job listing or user input)
2. Pull the user's relevant skills and experience from Coeadapt
3. Draft a tailored cover letter emphasizing skill alignment
4. Generate as `.docx`

### Skill Gap Analysis

When analyzing skill gaps:

1. Get the user's current skill set from Coeadapt
2. Identify the target role requirements
3. Calculate gaps and prioritize by importance
4. Suggest learning resources and timeline
5. Output as a structured markdown report

```markdown
## Skill Gap Analysis: [Current Role] → [Target Role]

### Overall Readiness: X%

### Critical Gaps (High Priority)
- **Skill Name**: Current Level → Required Level
  - Suggested: [Learning resource]
  - Timeline: X weeks

### Moderate Gaps (Medium Priority)
...

### Strengths (Already Qualified)
...
```

### Portfolio Case Study Builder

When creating portfolio items:

1. Gather project details from the user or Coeadapt portfolio
2. Structure as a professional case study:
   - Challenge / Problem Statement
   - Approach / Solution
   - Key Skills Demonstrated
   - Results / Impact (quantified where possible)
3. Generate as `.docx` or `.pptx` depending on user preference

### Interview Preparation

When preparing for interviews:

1. Get the target role from Coeadapt or user input
2. Generate role-specific questions across categories:
   - Behavioral (STAR method prompts)
   - Technical / Domain-specific
   - Situational / Case-based
   - Culture fit
3. Provide sample answers and coaching tips
4. Offer to simulate a mock interview session

### Job Match Evaluation

When evaluating job matches:

1. Retrieve job listings from Coeadapt (or user-provided descriptions)
2. Score each listing against the user's profile:
   - Skill match percentage
   - Experience level fit
   - Location/remote compatibility
   - Salary range alignment
3. Rank and summarize top matches
4. Flag any skill gaps that should be addressed

## Integration Notes

### Data Flow

- **Coeadapt → Open Cowork**: User profiles, skill maps, career roadmaps, job listings, portfolio items arrive as context for the AI agent
- **Open Cowork → Coeadapt**: Generated documents, analysis results, and status updates are sent back to the Coeadapt platform

### Dependencies on Other Skills

This skill works best when combined with:
- `docx` — For resume and cover letter document generation
- `pptx` — For portfolio presentations and career dashboards
- `xlsx` — For career data analysis and tracking spreadsheets
- `pdf` — For reading job descriptions and reference documents

### Privacy Considerations

- Career data is processed locally within the Open Cowork sandbox
- No career information is stored locally without explicit user consent
- All data in transit uses HTTPS/WSS encryption
- Users can disconnect from Coeadapt at any time to revoke data access

## Templates

### Resume Sections (Recommended Order)

1. **Contact Information** — Name, email, phone, LinkedIn, portfolio URL
2. **Professional Summary** — 2-3 sentence career overview tailored to target role
3. **Core Skills** — Categorized skill list with proficiency indicators
4. **Professional Experience** — Reverse chronological, achievement-focused bullets
5. **Education** — Degrees, certifications, relevant coursework
6. **Projects & Portfolio** — Links to case studies (from Coeadapt portfolio)
7. **Additional** — Languages, volunteer work, publications

### Skill Gap Report Format

```
# Career Transition Analysis
## From: [Current Role] → To: [Target Role]

### Readiness Score: [X/100]

### Action Items (Priority Order)
1. [Highest priority skill to develop]
2. [Second priority]
...

### Recommended Timeline: [X months]
### Suggested Learning Path:
- Week 1-4: [Focus area]
- Week 5-8: [Focus area]
...
```
