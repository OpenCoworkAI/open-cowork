"""
CUA Helper — Python-based screenshot & input automation for Windows.
Avoids PowerShell AMSI/AV blocking. Uses pyautogui + subprocess for reliability.

Commands:
  screenshot [--width W] [--height H]   Take and output base64 PNG screenshot
  screen_info                            Print "width height" of primary monitor
  click <x> <y> [left|right]            Click at screen coordinates
  double_click <x> <y>                  Double-click at screen coordinates
  right_click <x> <y>                   Right-click at screen coordinates
  key_press <key> [mod1 mod2 ...]       Press key with modifiers (NO Win key!)
  type_text <text_file_path>            Type text via clipboard paste
  scroll <x> <y> <direction> [amount]   Scroll at position
  launch_app <app_name>                 Open app via Start-Process (safe, no Win key)
  wake_display                          Prevent display sleep
"""

import sys
import os
import base64
import io
import time
import subprocess


def cmd_screenshot(args):
    import mss
    from PIL import Image, ImageDraw, ImageFont

    width = 1280
    height = 800
    grid = True  # Add coordinate grid overlay
    i = 0
    while i < len(args):
        if args[i] == '--width' and i + 1 < len(args):
            width = int(args[i + 1]); i += 2
        elif args[i] == '--height' and i + 1 < len(args):
            height = int(args[i + 1]); i += 2
        elif args[i] == '--no-grid':
            grid = False; i += 1
        else:
            i += 1

    with mss.mss() as sct:
        monitor = sct.monitors[1]
        img = sct.grab(monitor)
        pil_img = Image.frombytes('RGB', img.size, img.bgra, 'raw', 'BGRX')

    pil_img = pil_img.resize((width, height), Image.LANCZOS)

    # Draw coordinate grid overlay (8x6 grid, cyan with low opacity)
    if grid:
        draw = ImageDraw.Draw(pil_img)
        grid_x = width // 8   # 160px for 1280
        grid_y = height // 6  # ~133px for 800

        # Draw vertical lines with x labels
        for ix in range(1, 8):
            x = ix * grid_x
            draw.line([(x, 0), (x, height)], fill=(0, 200, 200, 60), width=1)
            draw.text((x + 2, 2), str(x), fill=(0, 180, 180))

        # Draw horizontal lines with y labels
        for iy in range(1, 6):
            y = iy * grid_y
            draw.line([(0, y), (width, y)], fill=(0, 200, 200, 60), width=1)
            draw.text((2, y + 2), str(y), fill=(0, 180, 180))

        # Corner labels
        draw.text((2, 2), "0,0", fill=(0, 180, 180))
        draw.text((width - 70, height - 15), f"{width},{height}", fill=(0, 180, 180))

    buf = io.BytesIO()
    pil_img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    sys.stdout.write(b64)
    sys.stdout.flush()


def cmd_screen_info(args):
    import mss
    with mss.mss() as sct:
        m = sct.monitors[1]
        print(f"{m['width']} {m['height']}")


def cmd_click(args):
    import pyautogui
    if len(args) < 2:
        print("Usage: click <x> <y> [left|right]", file=sys.stderr)
        sys.exit(1)
    x = int(args[0])
    y = int(args[1])
    button = args[2] if len(args) > 2 else 'left'
    pyautogui.moveTo(x, y, duration=0.05)
    pyautogui.click(x, y, button=button)
    print("OK")


def cmd_double_click(args):
    import pyautogui
    if len(args) < 2:
        print("Usage: double_click <x> <y>", file=sys.stderr)
        sys.exit(1)
    x, y = int(args[0]), int(args[1])
    pyautogui.moveTo(x, y, duration=0.05)
    pyautogui.doubleClick(x, y)
    print("OK")


def cmd_right_click(args):
    import pyautogui
    if len(args) < 2:
        print("Usage: right_click <x> <y>", file=sys.stderr)
        sys.exit(1)
    x, y = int(args[0]), int(args[1])
    pyautogui.moveTo(x, y, duration=0.05)
    pyautogui.rightClick(x, y)
    print("OK")


def cmd_key_press(args):
    """Press a key with optional modifiers.
    IMPORTANT: pyautogui cannot reliably simulate the Windows key on Win11.
    The 'win' modifier is BLOCKED here to prevent accidental screen locking.
    Use launch_app command instead to open applications.
    """
    import pyautogui
    if len(args) < 1:
        print("Usage: key_press <key> [mod1 mod2 ...]", file=sys.stderr)
        sys.exit(1)

    key = args[0].lower()
    modifiers = [m.lower() for m in args[1:]]

    # SAFETY: Block Win key to prevent accidental lock screen
    if 'win' in modifiers or 'cmd' in modifiers or 'meta' in modifiers:
        print("ERROR: Win key is blocked (can lock screen on Win11). Use launch_app to open apps.", file=sys.stderr)
        print("BLOCKED")
        return

    key_map = {
        'enter': 'enter', 'return': 'enter', 'tab': 'tab',
        'escape': 'escape', 'esc': 'escape',
        'backspace': 'backspace', 'delete': 'delete', 'space': 'space',
        'up': 'up', 'down': 'down', 'left': 'left', 'right': 'right',
        'home': 'home', 'end': 'end', 'pageup': 'pageup', 'pagedown': 'pagedown',
        'f1': 'f1', 'f2': 'f2', 'f3': 'f3', 'f4': 'f4', 'f5': 'f5',
        'f6': 'f6', 'f7': 'f7', 'f8': 'f8', 'f9': 'f9', 'f10': 'f10',
        'f11': 'f11', 'f12': 'f12',
    }
    mod_map = {
        'ctrl': 'ctrl', 'control': 'ctrl',
        'alt': 'alt',
        'shift': 'shift',
    }

    actual_key = key_map.get(key, key)
    actual_mods = [mod_map.get(m, m) for m in modifiers]

    if actual_mods:
        pyautogui.hotkey(*actual_mods, actual_key)
    else:
        pyautogui.press(actual_key)
    print("OK")


def cmd_type_text(args):
    import pyperclip
    import pyautogui

    if len(args) < 1:
        print("Usage: type_text <text_file_path>", file=sys.stderr)
        sys.exit(1)

    with open(args[0], 'r', encoding='utf-8') as f:
        text = f.read()

    try:
        saved = pyperclip.paste()
    except Exception:
        saved = ''

    pyperclip.copy(text)
    time.sleep(0.1)
    pyautogui.hotkey('ctrl', 'v')
    time.sleep(0.15)

    if saved:
        try:
            pyperclip.copy(saved)
        except Exception:
            pass
    print("OK")


def cmd_scroll(args):
    import pyautogui
    if len(args) < 3:
        print("Usage: scroll <x> <y> <direction> [amount]", file=sys.stderr)
        sys.exit(1)

    x = int(args[0])
    y = int(args[1])
    direction = args[2].lower()
    amount = int(args[3]) if len(args) > 3 else 3

    pyautogui.moveTo(x, y, duration=0.05)
    if direction == 'up':
        pyautogui.scroll(amount, x, y)
    elif direction == 'down':
        pyautogui.scroll(-amount, x, y)
    elif direction == 'left':
        pyautogui.hscroll(-amount, x, y)
    elif direction == 'right':
        pyautogui.hscroll(amount, x, y)
    else:
        print(f"Invalid direction: {direction}", file=sys.stderr)
        sys.exit(1)
    print("OK")


def cmd_launch_app(args):
    """Launch a Windows application by name or path.
    Uses Start-Process which is safe and doesn't require Win key.

    Common app names: calc, notepad, mspaint, wordpad, explorer,
                      chrome, msedge, code, excel, winword, powerpnt
    """
    if len(args) < 1:
        print("Usage: launch_app <app_name_or_path>", file=sys.stderr)
        sys.exit(1)

    app = args[0]

    # Common app name mappings (use full paths to avoid "Select app" dialogs)
    app_map = {
        'calculator': 'calc.exe',
        'calc': 'calc.exe',
        'notepad': os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'notepad.exe'),
        'paint': 'mspaint.exe',
        'explorer': 'explorer.exe',
        'chrome': 'chrome.exe',
        'edge': 'msedge.exe',
        'settings': 'ms-settings:',
        'settings-display': 'ms-settings:display',
        'settings-personalization': 'ms-settings:personalization',
        'settings-themes': 'ms-settings:themes',
        'file-explorer': 'explorer.exe',
    }

    resolved = app_map.get(app.lower(), app)

    try:
        if resolved.startswith('ms-'):
            subprocess.run(
                ['powershell.exe', '-NoProfile', '-Command', f'Start-Process "{resolved}"'],
                capture_output=True, timeout=10
            )
        else:
            subprocess.run(
                ['powershell.exe', '-NoProfile', '-Command',
                 f'Start-Process "{resolved}"'],
                capture_output=True, timeout=10
            )
        time.sleep(2)  # Wait for app to appear

        # Maximize the foreground window (most reliable - just launched app should be focused)
        import ctypes
        user32 = ctypes.windll.user32
        SW_MAXIMIZE = 3

        # First try: get foreground window directly
        hwnd = user32.GetForegroundWindow()
        if hwnd:
            user32.ShowWindow(hwnd, SW_MAXIMIZE)
        else:
            # Fallback: search by known window titles
            title_map = {
                'calc': ['Calculator', '计算器'],
                'calc.exe': ['Calculator', '计算器'],
                'notepad': ['Untitled', 'Notepad', '记事本', '无标题'],
                'notepad.exe': ['Untitled', 'Notepad', '记事本', '无标题'],
                'mspaint': ['Paint', '画图', 'Untitled - Paint'],
                'mspaint.exe': ['Paint', '画图', 'Untitled - Paint'],
                'explorer': ['File Explorer', '文件资源管理器'],
                'explorer.exe': ['File Explorer', '文件资源管理器'],
            }
            key = os.path.basename(resolved).lower().replace('.exe', '')
            titles = title_map.get(key, title_map.get(resolved.lower(), []))
            for title in titles:
                hwnd = user32.FindWindowW(None, title)
                if hwnd:
                    user32.ShowWindow(hwnd, SW_MAXIMIZE)
                    user32.SetForegroundWindow(hwnd)
                    break
        time.sleep(0.5)

        print("OK")
    except Exception as e:
        print(f"Error launching {app}: {e}", file=sys.stderr)
        print("FAILED")


def cmd_wake_display(args):
    """Prevent display from sleeping during CUA session."""
    import ctypes
    ES_CONTINUOUS = 0x80000000
    ES_DISPLAY_REQUIRED = 0x00000002
    ES_SYSTEM_REQUIRED = 0x00000001
    ctypes.windll.kernel32.SetThreadExecutionState(
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    )
    print("OK")


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        'screenshot': cmd_screenshot,
        'screen_info': cmd_screen_info,
        'click': cmd_click,
        'double_click': cmd_double_click,
        'right_click': cmd_right_click,
        'key_press': cmd_key_press,
        'type_text': cmd_type_text,
        'scroll': cmd_scroll,
        'launch_app': cmd_launch_app,
        'wake_display': cmd_wake_display,
    }

    if cmd not in commands:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(f"Available: {', '.join(commands.keys())}", file=sys.stderr)
        sys.exit(1)

    commands[cmd](args)


if __name__ == '__main__':
    main()
