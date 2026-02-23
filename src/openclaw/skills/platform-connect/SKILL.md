---
name: openclaw-platform-connect
description: "OpenClaw platform connection skill — bridges the agent to the Coeadapt career platform for syncing plans, tasks, goals, habits, jobs, skills, portfolio, and market intelligence. Enables OpenClaw to operate as a connected career agent."
---

# OpenClaw: Platform Connect

## Purpose

This skill connects OpenClaw to the Coeadapt career platform, turning the agent into a fully connected career co-worker. It syncs the user's career data bidirectionally — pulling context from the platform to inform conversations and pushing agent-generated artifacts back.

## Connection Model

OpenClaw connects to the platform via the Coeadapt API:
- **Authentication**: Device token (Clerk-based auth flow)
- **Sync**: Real-time for active sessions, periodic background sync
- **Offline**: Graceful degradation — works with cached data when disconnected

## Platform Capabilities

When connected, OpenClaw gains access to:

### Plans & Tasks
- Read the user's career plans and associated tasks
- Create new tasks and update task status
- Submit evidence of task completion
- Track plan progress over time

### Goals
- Sync career goals between local and platform
- Update goal progress from agent-observed activity
- Create goals from conversation context

### Habits
- Pull today's habit checklist
- Mark habits complete through conversation
- Access streak and consistency stats

### Jobs
- Discover job opportunities matching the user's profile
- Manage bookmarked/saved jobs
- Pull job details for interview prep and cover letter generation

### Skills & Portfolio
- Access verified skills inventory
- Sync portfolio items
- Map skills to market requirements

### Market Intelligence
- Pull market fit analysis
- Access skill delta reports (current vs. required)
- Get salary benchmarks and trend data

### Notifications
- Surface career-relevant notifications in conversation
- Act on notifications (e.g., "You have a task due tomorrow")

## Sync Strategy

1. **Session Start**: Pull fresh profile, active plans, today's habits
2. **On Demand**: Fetch specific data when the user asks or a skill needs it
3. **Session End**: Push any locally created artifacts, goal updates, habit completions
4. **Background**: Periodic sync every 15 minutes during active sessions

## Error Handling

- **Auth expired**: Prompt user to re-authenticate via the platform
- **API down**: Fall back to cached data, queue writes for retry
- **Partial failure**: Log and continue — never block the conversation for a sync error
