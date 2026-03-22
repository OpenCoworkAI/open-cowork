"""
Prevent auto-lock by simulating periodic input.
Presses F15 (no visible effect) every 4 minutes.
Run in background: pythonw keep-awake.py
Stop: kill the process or Ctrl+C
"""
import time
import pyautogui

pyautogui.FAILSAFE = False
INTERVAL = 240  # seconds (4 min, well under the 15 min lock timeout)

if __name__ == "__main__":
    while True:
        pyautogui.press("f15")
        time.sleep(INTERVAL)
