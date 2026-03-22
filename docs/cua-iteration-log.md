# CUA Harness Iteration Log — Final Summary

## Score Progression: 50% → 75% peak, 71-75% stable

| Round | Score | Key Change |
|-------|-------|-----------|
| 0 | 10/20 (50%) | Baseline |
| 1 | 15/24 (63%) | Cleanup + focus_window |
| 2 | **18/24 (75%)** | Settings URIs + Ctrl+S hint |
| 3 | 12/24 (50%) | **REGRESSION: click after launch** |
| 4 | **18/24 (75%)** | Remove click = recovery |
| 5 | 17/24 (71%) | Validator fix, random variance |

## Proven Patterns
1. **minimize_all before tasks** — eliminates residual window interference
2. **Specific settings URIs** — `settings-display` >> generic `settings` + sidebar
3. **Type full calculator expressions** — `type "25*16="` >> clicking buttons
4. **launch_app for focus recovery** — more reliable than Alt+Tab
5. **NO click after launch_app** — clicking center/title causes focus corruption
6. **Reject generic "settings"** — force model to use specific page names
7. **PowerShell for file ops** — `mkdir` >> Explorer GUI
8. **Common shortcuts in prompt** — Ctrl+S, Ctrl+H, Alt+A, Ctrl+L

## Anti-Patterns
1. **Clicking after launch_app** — caused 75%→50% regression
2. **System prompt changes affect ALL tasks** — cascading effects
3. **"Take screenshot to verify" instruction** — wastes step budget

## Variance Analysis
Tasks that flip between pass/fail across runs (unreliable):
- settings-themes (2/4 runs pass)
- calc-chain (3/4 runs pass)
- settings-wifi (2/4 runs pass)
- notepad-find-replace (3/4 runs pass)

Tasks that always pass (17/24 reliable core):
- All Tier 1 except settings-themes: calc-add, calc-multiply, notepad-write, screenshot
- Most Tier 2: notepad-multiline, time-check, notepad-save, calc-sqrt, notepad-timestamp, notepad-draft-email, cross-app-time-note, calc-percentage, notepad-code-snippet
- Some Tier 3: system-create-folder, powershell-system-info

## Remaining Challenges
- **Edge UWP focus** — Edge's multi-process architecture breaks window detection
- **settings-display** — model doesn't connect "Display settings" → `settings-display` app
- **PowerShell disk space** — complex commands + focus loss
- **Random variance** — 4B model sensitivity to screenshot context
