# CUA Harness Iteration Log

## Summary (50% → 75% in 4 rounds)

| Round | Score | Key Change | Key Insight |
|-------|-------|-----------|-------------|
| 0 | 10/20 (50%) | Baseline | 70% failures = focus loss |
| 1 | 15/24 (63%) | Aggressive cleanup + focus_window | Kill stale apps helps |
| 2 | **18/24 (75%)** | Settings URIs + Ctrl+S hint | Remove generic "settings" = +3 |
| 3 | 12/24 (50%) | Title-bar click after launch | **DON'T click after launch_app** |
| 4 | **18/24 (75%)** | Remove click, restore R2 | Recovery confirmed |

## Effective Patterns (proven across rounds)
1. **minimize_all before tasks** — eliminates residual window interference
2. **Specific settings URIs** — `settings-display` >> navigating sidebar
3. **Type full calculator expressions** — `type "25*16="` >> clicking buttons
4. **launch_app for focus recovery** — more reliable than Alt+Tab
5. **Newline support in type** — `\\n` in text for multi-line content
6. **PowerShell for file ops** — `mkdir` >> Explorer GUI for folder creation
7. **NO click after launch_app** — clicking center/title causes focus corruption
8. **Reject generic "settings"** — force model to use specific page names
9. **Common shortcuts in prompt** — Ctrl+S, Ctrl+H, Ctrl+L, Alt+A

## Remaining Failures (6/24)
| Task | Root Cause | Fix Strategy |
|------|-----------|-------------|
| settings-wifi | ~~Validator bug~~ Fixed R5 | Accept SSID names |
| settings-display | Model uses PowerShell instead of settings-display | Model can't map "Display" → settings-display |
| edge-web-search | Edge loses focus during Ctrl+L+type | Edge UWP focus issue |
| notepad-meeting-agenda | Long text focus loss to Settings/PowerShell | Type stability |
| notepad-csv | Gets stuck trying to save (unnecessary) | Model strategy |
| powershell-disk-space | PowerShell window disappears | Focus recovery |

## Anti-Patterns (proven harmful)
1. **Clicking after launch_app** — even title-bar click (y=3-5%) causes R3-level regression
2. **Adding too many rules to system prompt** — changes affect ALL tasks non-deterministically
3. **"Take screenshot to verify" instruction** — wastes 1 step per task, reduces budget
