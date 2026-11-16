# Carry a task across several conversations

For a task that takes several rounds, keep its goal and verified progress in the workspace. Start each round from those records, then have a separate reviewer check the result before accepting it. This is a manual workflow using existing Open Cowork conversations and files; it does not install an external task harness or add an automatic coordinator.

This workflow addresses the documentation suggestion in [issue #329](https://github.com/OpenCoworkAI/open-cowork/issues/329).

## Create a small task record

Create these files in the project workspace, outside Open Cowork's application data and memory storage:

```text
project/
  .task-state/
    goal.md
    progress.json
    resume-prompt.txt
    evidence/
      round-001-tests.txt
    audits/
      round-001.md
```

In `goal.md`, record the requested outcome, numbered acceptance criteria, allowed changes, and decisions that need the user's approval. Make the criteria observable: for example, "a failed upload leaves the previous document available" is easier to check than "uploads are reliable."

Use `progress.json` as a concise index. For example:

```json
{
  "round": 0,
  "maxRounds": 6,
  "maxRoundMinutes": 20,
  "status": "ready",
  "accepted": [],
  "candidate": null,
  "nextStep": "Reproduce acceptance criterion 1 and record the result"
}
```

The operator enforces these limits; these example fields do not configure the app's scheduler or execution limits. Keep credentials and private source data out of records that will be committed or shared. Decide whether the records belong in version control or in the project's local ignore rules.

## Run one bounded round

1. Open a new conversation in the same workspace. Supply `goal.md`, the current progress record, the latest audit, and only the evidence needed for the next step. A fresh conversation can still receive enabled application memory, so explicitly identify the task files as the authority for scope and acceptance.
2. Ask the agent to inspect the relevant current files, complete one concrete step, and stop at the round limit. Use the GUI's existing permission prompts for operations that need approval.
3. Save evidence before changing the progress record: the command or procedure, the relevant revision or artifact, its actual result, and the output file. Mark platform checks or service checks that were not performed as unverified.
4. Record a candidate result and the next proposed step. A candidate is a claim awaiting review; leave the list of accepted criteria unchanged.

For example, a candidate can reference criterion 1, the relevant source files, and `evidence/round-001-tests.txt`. The evidence should include failures as well as successes. A test result from an earlier revision does not validate later changes.

## Review independently before accepting progress

Start a separate conversation for the auditor. Give it the original goal, the candidate changes, and access to the recorded evidence. Ask it to inspect the changes and rerun the relevant checks rather than accepting the worker's summary. Avoid giving the auditor responsibility for implementing the same round; its task is to identify missing evidence and regressions.

Save the audit in `audits/round-001.md` with:

- The exact revision or artifact reviewed.
- A verdict: `accepted`, `changes-required`, or `unverified`.
- Each acceptance criterion checked and the evidence that supports it.
- Any remaining failures, assumptions, and the next useful check.

Only the operator or designated reviewer updates `accepted` after an accepted audit. A second conversation provides another review context; it is not a formal guarantee of correctness. Use human review and real platform or service checks where those are part of the acceptance criteria.

## Resume from explicit state

Save a prompt such as this in `resume-prompt.txt`, then use it at the start of each new round:

```text
Read .task-state/goal.md and .task-state/progress.json, then the latest audit
and the evidence it references. Treat the task records as the authority for
scope. Check the current files before trusting an earlier result.

State the accepted criteria, remaining criteria, and next concrete step.
Work on that step within the recorded round limits. Do not promote a
candidate into accepted progress yourself. Save evidence and a candidate
summary, identify unverified checks, and stop for the independent audit.
If the goal, evidence, or permissions conflict, explain the conflict and stop.
```

Application memory can help recall preferences and past conversations. It does not replace the task record or an audit. Settings → Memory already provides controls to edit or forget core entries and forget a conversation's extracted memory. Forgetting a conversation's memory keeps the conversation itself; it does not edit these workspace task files. Do not edit the application's memory data files to maintain task progress.

## Optional headless inspection

The source checkout supports Electron headless execution after its normal development setup and build have produced `dist-electron/main/index.js`. Configure the active model through the GUI first. From that checkout, an example PowerShell inspection round is:

```powershell
$taskWorkspace = 'C:\work\project'
$taskGoal = Get-Content -LiteralPath "$taskWorkspace\.task-state\goal.md" -Raw
$taskProgress = Get-Content -LiteralPath "$taskWorkspace\.task-state\progress.json" -Raw
$auditPrompt = "Review the following goal and progress record. List missing evidence and the next check. Do not invoke tools.`n`nGOAL:`n$taskGoal`n`nPROGRESS:`n$taskProgress"
npx electron . --headless --mode json --cwd $taskWorkspace --prompt $auditPrompt > "$taskWorkspace\.task-state\evidence\inspection.jsonl" 2> "$taskWorkspace\.task-state\evidence\inspection.log"
```

This example supplies the records as prompt text; it does not verify the underlying files or execute tests. Use a new output filename for each inspection to preserve prior evidence. The CLI flags are implemented in [`headless-io.ts`](../src/main/cli/headless-io.ts), and the lifecycle and permission behavior are wired in [`index.ts`](../src/main/index.ts).

Headless mode denies permission requests by default. `--auto-approve` approves **all** tool calls, including writes, shell commands, and network operations; it is not a read-only or scoped permission policy. Prefer the GUI when the round needs individual approvals. There is no `--permission-policy` flag or standalone `open-cowork` executable command installed by this workflow.

Inspect the JSONL events and artifacts: `session.ended` means the round ended, and a zero process exit code alone does not prove task success. In the current implementation a session that reaches an error state can also reach the single-shot completion path. Read `session.status`, error events, and the relevant check results before accepting progress.

## Stop conditions

Declare completion only when every numbered criterion has an accepted audit for the current artifacts and required platform checks have actually been performed. Otherwise stop and retain a resumable record when:

- The round, time, or spending limit is reached.
- Two consecutive rounds produce no newly verified progress.
- Required access, a decision, or approval is missing.
- Evidence contradicts the accepted state or indicates a regression.

Record why execution stopped, what remains unverified, and the smallest next action. Start another round only after the operator has resolved that condition or explicitly extended the relevant limit.
