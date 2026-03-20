/**
 * @module main/cua/cua-few-shot-examples
 *
 * Concrete few-shot examples for Windows CUA tasks.
 *
 * Research basis: few-shot prompting improves accuracy 8-15% on base models
 * (Brown et al. 2020; Wei et al. 2022 chain-of-thought). For a 9B model doing
 * GUI navigation the gain is larger because the model has no fine-tuned
 * "action grammar" — examples anchor the expected output format.
 *
 * Design principles:
 * - Each example shows: screenshot description → Thought → tool call → result check
 * - Thoughts are kept ≤ 2 sentences (model copies length, shorter = faster)
 * - Coordinates are realistic 1280×720 values (the actual screenshot space)
 * - Tool calls exactly match the ToolDefinition signatures in cua-tools.ts
 * - Cover the 7 core failure modes seen in early Windows testing
 *
 * Usage: append CUA_FEW_SHOT_EXAMPLES to CUA_SYSTEM_PROMPT before injection.
 */

// ─── Individual Example Blocks ───────────────────────────────────────────────

/**
 * Example 1 — Open an app via Windows Search (Win+S → type → click result)
 *
 * Failure mode addressed: model tries to find app icon on desktop instead of
 * using search, wastes 3-5 steps scanning taskbar.
 */
const EXAMPLE_WIN_SEARCH = `
---
## Example 1: Opening an app via Windows Search

**Task**: Open Notepad.

**Screenshot**: The Windows desktop is visible. The taskbar is at the bottom. There is no Notepad window open.

**Thought**: The fastest way to open Notepad is via Windows Search. I will press Win+S to open the search bar, type "notepad", then click the top result.

**Action**:
\`\`\`tool
key_press(key="s", modifiers=["win"])
\`\`\`

**Result**: The Windows Search overlay appeared — a search box is now visible in the center of the screen with placeholder text "Search".

**Action**:
\`\`\`tool
type_text(text="notepad")
\`\`\`

**Result**: The search box shows "notepad" and a result list is visible. "Notepad — App" appears as the first result at approximately (640, 310).

**Action**:
\`\`\`tool
click(x=640, y=310)
\`\`\`

**Result**: The search overlay closed and Notepad opened in a new window. Task complete.
`;

/**
 * Example 2 — Click a specific button in a dialog
 *
 * Failure mode addressed: model clicks the wrong button (e.g., "Cancel"
 * instead of "OK") or clicks at the dialog border instead of the button label.
 */
const EXAMPLE_DIALOG_BUTTON = `
---
## Example 2: Clicking a specific button in a dialog

**Task**: Confirm the "Save changes?" dialog by clicking Save.

**Screenshot**: A modal dialog is overlaid on the screen. The title bar reads "Notepad". The dialog body says "Do you want to save changes to Untitled?". Three buttons are aligned horizontally at the bottom of the dialog: "Save" at approximately (560, 420), "Don't Save" at approximately (660, 420), and "Cancel" at approximately (755, 420).

**Thought**: I can see the "Save" button clearly at (560, 420). I will click it to confirm.

**Action**:
\`\`\`tool
click(x=560, y=420)
\`\`\`

**Result**: The dialog closed. The file was saved (no asterisk in the title bar). Task complete.
`;

/**
 * Example 3 — Type text into a text field (click to focus first, then type)
 *
 * Failure mode addressed: model calls type_text without first clicking the
 * field, so keystrokes go to the wrong element or are lost entirely.
 */
const EXAMPLE_TYPE_INTO_FIELD = `
---
## Example 3: Typing text into a text field

**Task**: Enter "hello world" into the Notepad editor.

**Screenshot**: Notepad is open. The text area is blank and takes up most of the window. The cursor is not visible — the text area does not appear focused.

**Thought**: I must click inside the text area first to focus it, then type. The text area center is around (640, 400).

**Action**:
\`\`\`tool
click(x=640, y=400)
\`\`\`

**Result**: A blinking cursor appeared inside the text area — the field is now focused.

**Action**:
\`\`\`tool
type_text(text="hello world")
\`\`\`

**Result**: The text "hello world" now appears in the Notepad editor. Task complete.
`;

/**
 * Example 4 — Using keyboard shortcuts (Ctrl+S to save, Alt+F4 to close)
 *
 * Failure mode addressed: model attempts to find the File menu and click
 * Save instead of using the shortcut, wasting 3+ steps.
 */
const EXAMPLE_KEYBOARD_SHORTCUTS = `
---
## Example 4: Using keyboard shortcuts

**Task**: Save the current document with Ctrl+S, then close the window with Alt+F4.

**Screenshot**: Notepad is open with the text "hello world" in the editor. The title bar shows "Untitled — Notepad" with an asterisk indicating unsaved changes.

**Thought**: I'll press Ctrl+S to save, then Alt+F4 to close. Both are standard Windows shortcuts that work in any focused window.

**Action**:
\`\`\`tool
key_press(key="s", modifiers=["ctrl"])
\`\`\`

**Result**: The asterisk disappeared from the title bar — the file was saved (a Save As dialog may have appeared; if so, I need to handle it before continuing).

**Screenshot after save**: The title bar now shows "Untitled — Notepad" without an asterisk. No dialog appeared.

**Action**:
\`\`\`tool
key_press(key="f4", modifiers=["alt"])
\`\`\`

**Result**: The Notepad window closed. Task complete.
`;

/**
 * Example 5 — Scrolling to find an element not currently visible
 *
 * Failure mode addressed: model tries to click an element it cannot see,
 * gets an off-screen coordinate, or gives up too early without scrolling.
 */
const EXAMPLE_SCROLL_TO_FIND = `
---
## Example 5: Scrolling to find an element not currently visible

**Task**: Find and click the "Privacy & Security" option in Windows Settings.

**Screenshot**: The Windows Settings app is open. The left sidebar shows: System, Bluetooth & devices, Network & internet, Personalization, Apps, Accounts. "Privacy & Security" is not visible — it must be below the current scroll position.

**Thought**: "Privacy & Security" is not in view. I need to scroll the sidebar down to reveal it. The sidebar is on the left side of the screen, roughly x=130.

**Action**:
\`\`\`tool
scroll(x=130, y=400, direction="down", amount=3)
\`\`\`

**Result**: The sidebar scrolled down. Now visible: Time & language, Gaming, Accessibility, Privacy & Security at approximately (130, 480), Windows Update.

**Action**:
\`\`\`tool
click(x=130, y=480)
\`\`\`

**Result**: The main panel changed to show Privacy & Security settings. Task complete.
`;

/**
 * Example 6 — Handling an unexpected dialog / popup
 *
 * Failure mode addressed: model ignores a blocking dialog and tries to interact
 * with the window behind it, causing all subsequent clicks to miss.
 */
const EXAMPLE_HANDLE_POPUP = `
---
## Example 6: Handling an unexpected dialog or popup

**Task**: Open a file in File Explorer.

**Screenshot**: File Explorer is open showing the Documents folder. A Windows Security Alert dialog has appeared in the foreground: "Windows Defender Firewall has blocked some features of this app." Two buttons are visible: "Allow access" at (560, 500) and "Cancel" at (650, 500).

**Thought**: An unexpected security dialog is blocking the screen. I must dismiss it before I can interact with File Explorer. Since the task does not require network access, I will click "Cancel" to close it safely.

**Action**:
\`\`\`tool
click(x=650, y=500)
\`\`\`

**Result**: The security dialog closed. File Explorer is now the active window and I can continue with the original task.
`;

/**
 * Example 7 — Navigating a settings menu (multi-level: open menu → find item → click)
 *
 * Failure mode addressed: model tries to use keyboard shortcut when the
 * correct path is navigating a hierarchical menu, or misidentifies which
 * submenu item to click.
 */
const EXAMPLE_SETTINGS_MENU = `
---
## Example 7: Navigating a settings menu

**Task**: Change the Windows display scale to 125% via Settings → System → Display.

**Screenshot**: The Windows desktop is visible with no apps open.

**Thought**: I'll open Settings with the Win+I shortcut, then navigate to System → Display.

**Action**:
\`\`\`tool
key_press(key="i", modifiers=["win"])
\`\`\`

**Result**: The Windows Settings app opened. The left sidebar shows navigation categories.

**Action**:
\`\`\`tool
click(x=130, y=150)
\`\`\`
_(clicking "System" in the sidebar, approximately at y=150)_

**Result**: The main panel now shows System settings: Display, Sound, Notifications, Focus, Power & sleep...

**Action**:
\`\`\`tool
click(x=640, y=200)
\`\`\`
_(clicking "Display" in the main panel)_

**Result**: The Display settings page opened. I can see a "Scale" dropdown currently set to "100% (Recommended)".

**Action**:
\`\`\`tool
click(x=780, y=350)
\`\`\`
_(clicking the Scale dropdown)_

**Result**: A dropdown appeared showing scale options: 100%, 125%, 150%, 175%.

**Action**:
\`\`\`tool
click(x=780, y=395)
\`\`\`
_(clicking "125%" in the dropdown list)_

**Result**: The scale dropdown closed and now shows "125%". A notification banner appeared: "Some apps won't respond to scaling changes until you sign out." Task complete.
`;

// ─── Assembled Block ─────────────────────────────────────────────────────────

/**
 * Full few-shot examples block ready for injection into the CUA system prompt.
 *
 * Append this after CUA_SYSTEM_PROMPT and before "## Your Task":
 *
 * ```ts
 * const taskMessage = `${CUA_SYSTEM_PROMPT}\n\n${CUA_FEW_SHOT_EXAMPLES}\n\n## Your Task\n${instruction}\n\nStart by taking a screenshot.`;
 * ```
 *
 * The `---` dividers keep examples visually separated but are inert to the
 * model — they prevent one example's coordinates from bleeding into the next.
 */
export const CUA_FEW_SHOT_EXAMPLES = `## Examples

The following examples demonstrate correct tool usage for common Windows tasks.
Study these carefully — always follow the same pattern: screenshot → analyze → one action → verify.
${EXAMPLE_WIN_SEARCH}${EXAMPLE_DIALOG_BUTTON}${EXAMPLE_TYPE_INTO_FIELD}${EXAMPLE_KEYBOARD_SHORTCUTS}${EXAMPLE_SCROLL_TO_FIND}${EXAMPLE_HANDLE_POPUP}${EXAMPLE_SETTINGS_MENU}`;
