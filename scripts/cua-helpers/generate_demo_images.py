#!/usr/bin/env python3
"""Generate realistic test images for CUA desktop organization demo.

Creates images with GENERIC filenames (IMG_xxxx, DSC_xxxx, Screenshot_xxxx)
so the CUA model must LOOK AT the image content to classify them.

Categories:
  1. Food photos (warm colors, plated food illustrations)
  2. Nature/travel photos (landscapes, sky gradients)
  3. Work charts (bar charts, pie charts)
  4. Receipts/finance (text-heavy, monochrome)
  5. Screenshots/UI (app-like layouts)
"""

import os
import sys
import random
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
PREFIX = "demo_"

# Try to get a decent font
def get_font(size):
    for name in ["arial.ttf", "Arial.ttf", "segoeui.ttf", "calibri.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            pass
    return ImageFont.load_default()


def make_food_photo(path, variant=0):
    """Generate a food-like image: warm colors, plate shape, food items."""
    img = Image.new("RGB", (800, 600), "#F5E6D3")  # warm cream background
    draw = ImageDraw.Draw(img)

    if variant == 0:
        # Pasta dish
        draw.ellipse([150, 80, 650, 520], fill="#FFFFFF", outline="#DDD", width=3)
        # Spaghetti
        for i in range(20):
            x = random.randint(220, 580)
            y = random.randint(160, 440)
            draw.arc([x - 40, y - 20, x + 40, y + 20], random.randint(0, 180),
                     random.randint(180, 360), fill="#E8C547", width=2)
        # Sauce
        draw.ellipse([300, 220, 500, 380], fill="#C0392B")
        # Basil leaves
        for _ in range(5):
            x, y = random.randint(280, 520), random.randint(200, 400)
            draw.ellipse([x, y, x + 25, y + 15], fill="#27AE60")
        # Fork
        draw.rectangle([660, 200, 670, 500], fill="#C0C0C0")
    elif variant == 1:
        # Sushi plate
        draw.rectangle([100, 150, 700, 450], fill="#2C3E50")  # dark plate
        colors = ["#FF6B6B", "#FFA07A", "#FF4500", "#E74C3C", "#FF6347"]
        for i in range(6):
            x = 150 + i * 90
            draw.ellipse([x, 220, x + 70, 280], fill=colors[i % len(colors)])
            draw.ellipse([x + 5, 225, x + 65, 275], fill="#FFFFFF")
            draw.rectangle([x + 15, 240, x + 55, 260], fill=colors[i % len(colors)])
        # Chopsticks
        draw.line([600, 130, 720, 480], fill="#8B4513", width=3)
        draw.line([610, 130, 730, 480], fill="#8B4513", width=3)
        # Soy sauce dish
        draw.ellipse([600, 350, 680, 420], fill="#1A1A1A")
    else:
        # Cake
        draw.rectangle([200, 200, 600, 500], fill="#F4A460")  # cake body
        draw.rectangle([200, 200, 600, 260], fill="#FFFFFF")  # frosting
        draw.rectangle([200, 300, 600, 310], fill="#FFFFFF")  # middle frosting
        # Strawberries on top
        for x in range(230, 580, 60):
            draw.ellipse([x, 180, x + 30, 210], fill="#FF0000")
            draw.polygon([(x + 10, 175), (x + 15, 165), (x + 20, 175)], fill="#228B22")
        # Candles
        for x in [300, 400, 500]:
            draw.rectangle([x, 150, x + 8, 200], fill="#FFD700")
            draw.ellipse([x - 3, 140, x + 11, 155], fill="#FF6600")

    img.save(path, quality=90)


def make_nature_photo(path, variant=0):
    """Generate a nature/landscape-like image."""
    img = Image.new("RGB", (800, 600))
    draw = ImageDraw.Draw(img)

    if variant == 0:
        # Sunset over mountains
        for y in range(300):
            r = int(255 - y * 0.3)
            g = int(100 + y * 0.2)
            b = int(50 + y * 0.5)
            draw.line([(0, y), (800, y)], fill=(r, g, b))
        # Sun
        draw.ellipse([320, 120, 480, 280], fill="#FFD700")
        # Mountains
        draw.polygon([(0, 400), (200, 250), (400, 380), (600, 220), (800, 350), (800, 600), (0, 600)],
                     fill="#2C3E50")
        draw.polygon([(100, 450), (350, 280), (550, 400), (800, 300), (800, 600), (0, 600)],
                     fill="#34495E")
    elif variant == 1:
        # Ocean/beach
        # Sky
        for y in range(250):
            b = int(200 + y * 0.2)
            draw.line([(0, y), (800, y)], fill=(135, 206, min(255, b)))
        # Ocean
        for y in range(250, 450):
            b = int(100 + (y - 250) * 0.3)
            draw.line([(0, y), (800, y)], fill=(0, int(80 + (y - 250) * 0.2), min(255, 150 + b)))
        # Beach
        draw.rectangle([0, 450, 800, 600], fill="#F4D03F")
        # Waves
        for y in range(260, 440, 30):
            for x in range(0, 800, 80):
                draw.arc([x, y - 10, x + 60, y + 10], 0, 180, fill="white", width=2)
        # Palm tree
        draw.rectangle([650, 300, 665, 500], fill="#8B4513")
        draw.ellipse([580, 250, 730, 330], fill="#228B22")
    else:
        # Forest
        # Sky through trees
        for y in range(600):
            g = max(0, int(80 - y * 0.05))
            draw.line([(0, y), (800, y)], fill=(20, 60 + g, 20))
        # Tree trunks
        for x in range(50, 800, 120):
            w = random.randint(15, 25)
            draw.rectangle([x, 100, x + w, 600], fill="#5D4037")
        # Canopy
        for x in range(0, 800, 60):
            for y in range(0, 250, 40):
                r = random.randint(25, 35)
                draw.ellipse([x - r, y - r, x + r, y + r],
                             fill=(random.randint(20, 60), random.randint(100, 180), random.randint(20, 50)))
        # Sunbeams
        for _ in range(5):
            x = random.randint(100, 700)
            draw.line([(x, 0), (x + 30, 300)], fill=(255, 255, 200, 30), width=8)

    img.save(path, quality=90)


def make_chart_image(path, variant=0):
    """Generate a business chart image."""
    img = Image.new("RGB", (800, 600), "#FFFFFF")
    draw = ImageDraw.Draw(img)
    font = get_font(16)
    title_font = get_font(22)

    if variant == 0:
        # Bar chart - quarterly revenue
        draw.text((250, 20), "Quarterly Revenue 2025", fill="black", font=title_font)
        labels = ["Q1", "Q2", "Q3", "Q4"]
        values = [42, 58, 51, 67]
        colors = ["#3498DB", "#2ECC71", "#E74C3C", "#F39C12"]
        max_h = 380
        bar_w = 100
        for i, (label, val) in enumerate(zip(labels, values)):
            x = 120 + i * 160
            h = int(val / 70 * max_h)
            draw.rectangle([x, 500 - h, x + bar_w, 500], fill=colors[i])
            draw.text((x + 30, 510), label, fill="black", font=font)
            draw.text((x + 25, 490 - h), f"${val}K", fill="black", font=font)
        # Axes
        draw.line([(100, 500), (780, 500)], fill="black", width=2)
        draw.line([(100, 50), (100, 500)], fill="black", width=2)
    elif variant == 1:
        # Pie chart - market share
        draw.text((250, 20), "Market Share Analysis", fill="black", font=title_font)
        # Simple pie segments (drawn as colored wedges)
        import math
        cx, cy, r = 400, 320, 180
        segments = [("Product A", 35, "#3498DB"), ("Product B", 25, "#2ECC71"),
                    ("Product C", 20, "#E74C3C"), ("Others", 20, "#95A5A6")]
        start = 0
        for name, pct, color in segments:
            end = start + pct * 3.6
            draw.pieslice([cx - r, cy - r, cx + r, cy + r], start, end, fill=color, outline="white", width=2)
            # Label
            mid = (start + end) / 2
            lx = cx + int((r + 40) * math.cos(math.radians(mid)))
            ly = cy + int((r + 40) * math.sin(math.radians(mid)))
            draw.text((lx - 30, ly - 8), f"{name} {pct}%", fill="black", font=font)
            start = end
    else:
        # Line chart - user growth
        draw.text((200, 20), "Monthly Active Users (2025)", fill="black", font=title_font)
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        values = [1200, 1450, 1800, 2100, 2800, 3200]
        # Axes
        draw.line([(80, 500), (750, 500)], fill="black", width=2)
        draw.line([(80, 50), (80, 500)], fill="black", width=2)
        # Plot
        points = []
        for i, (m, v) in enumerate(zip(months, values)):
            x = 120 + i * 120
            y = 500 - int((v / 3500) * 400)
            points.append((x, y))
            draw.text((x - 10, 510), m, fill="black", font=font)
        # Lines
        for i in range(len(points) - 1):
            draw.line([points[i], points[i + 1]], fill="#3498DB", width=3)
        # Dots
        for x, y in points:
            draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill="#2980B9")

    img.save(path, quality=90)


def make_receipt_image(path, variant=0):
    """Generate a receipt-like image."""
    img = Image.new("RGB", (400, 700), "#FFFEF5")
    draw = ImageDraw.Draw(img)
    font = get_font(14)
    bold_font = get_font(18)

    if variant == 0:
        y = 30
        draw.text((120, y), "WHOLE FOODS MARKET", fill="black", font=bold_font); y += 30
        draw.text((130, y), "San Francisco, CA", fill="gray", font=font); y += 25
        draw.line([(30, y), (370, y)], fill="gray"); y += 15
        items = [("Organic Bananas", "2.49"), ("Avocado 3pk", "5.99"),
                 ("Almond Milk", "4.29"), ("Sourdough Bread", "5.49"),
                 ("Chicken Breast", "12.99"), ("Mixed Greens", "4.99"),
                 ("Greek Yogurt", "6.49"), ("Olive Oil", "11.99")]
        for item, price in items:
            draw.text((40, y), item, fill="black", font=font)
            draw.text((300, y), f"${price}", fill="black", font=font)
            y += 22
        draw.line([(30, y), (370, y)], fill="gray"); y += 10
        draw.text((40, y), "SUBTOTAL", fill="black", font=bold_font)
        draw.text((290, y), "$54.72", fill="black", font=bold_font); y += 25
        draw.text((40, y), "TAX 8.625%", fill="gray", font=font)
        draw.text((300, y), "$4.72", fill="gray", font=font); y += 25
        draw.text((40, y), "TOTAL", fill="black", font=bold_font)
        draw.text((285, y), "$59.44", fill="black", font=bold_font); y += 35
        draw.text((100, y), "VISA **** 4521", fill="gray", font=font)
    else:
        y = 30
        draw.text((100, y), "STARBUCKS COFFEE", fill="#00704A", font=bold_font); y += 30
        draw.text((110, y), "Market Street Store", fill="gray", font=font); y += 25
        draw.line([(30, y), (370, y)], fill="gray"); y += 15
        items = [("Caramel Macchiato Venti", "6.45"), ("Blueberry Muffin", "3.95"),
                 ("Iced Latte Grande", "5.75")]
        for item, price in items:
            draw.text((40, y), item, fill="black", font=font)
            draw.text((300, y), f"${price}", fill="black", font=font)
            y += 22
        draw.line([(30, y), (370, y)], fill="gray"); y += 10
        draw.text((40, y), "TOTAL", fill="black", font=bold_font)
        draw.text((285, y), "$16.15", fill="black", font=bold_font)

    img.save(path, quality=90)


def make_screenshot_image(path, variant=0):
    """Generate a UI screenshot-like image."""
    img = Image.new("RGB", (800, 600), "#F0F0F0")
    draw = ImageDraw.Draw(img)
    font = get_font(14)
    bold_font = get_font(16)

    if variant == 0:
        # Email client UI
        # Title bar
        draw.rectangle([0, 0, 800, 35], fill="#2C3E50")
        draw.text((20, 8), "Inbox — 3 unread", fill="white", font=bold_font)
        draw.ellipse([750, 10, 765, 25], fill="#E74C3C")
        draw.ellipse([770, 10, 785, 25], fill="#F39C12")
        # Sidebar
        draw.rectangle([0, 35, 200, 600], fill="#34495E")
        for i, label in enumerate(["Inbox (3)", "Sent", "Drafts (1)", "Trash", "Spam"]):
            bg = "#2980B9" if i == 0 else "#34495E"
            draw.rectangle([5, 45 + i * 40, 195, 80 + i * 40], fill=bg)
            draw.text((15, 52 + i * 40), label, fill="white", font=font)
        # Email list
        emails = [("Team Standup Notes", "Alice Chen", "10:30 AM", True),
                  ("Q2 Budget Review", "Finance", "9:15 AM", True),
                  ("Lunch tomorrow?", "Bob", "Yesterday", False),
                  ("Deploy v2.1 complete", "CI/CD Bot", "Yesterday", True)]
        for i, (subj, sender, time, unread) in enumerate(emails):
            y = 45 + i * 65
            bg = "#FFFFFF" if unread else "#F8F8F8"
            draw.rectangle([210, y, 790, y + 60], fill=bg, outline="#DDD")
            f = bold_font if unread else font
            draw.text((220, y + 8), subj, fill="black", font=f)
            draw.text((220, y + 30), sender, fill="gray", font=font)
            draw.text((700, y + 8), time, fill="gray", font=font)
    else:
        # Chat app UI
        draw.rectangle([0, 0, 800, 50], fill="#075E54")
        draw.text((70, 12), "Project Team Chat", fill="white", font=bold_font)
        draw.ellipse([15, 10, 45, 40], fill="#25D366")
        # Messages
        messages = [
            (True, "Hey, did you push the fix?", "2:30 PM"),
            (False, "Yes! PR #142 is up for review", "2:31 PM"),
            (True, "Great, I'll take a look", "2:33 PM"),
            (False, "Also updated the docs", "2:34 PM"),
            (True, "Perfect. Ship it! 🚀", "2:35 PM"),
        ]
        y = 70
        for is_left, text, time in messages:
            x = 30 if is_left else 350
            w = min(len(text) * 9, 400)
            color = "#DCF8C6" if not is_left else "#FFFFFF"
            draw.rounded_rectangle([x, y, x + w, y + 45], radius=10, fill=color)
            draw.text((x + 10, y + 8), text, fill="black", font=font)
            draw.text((x + w - 60, y + 28), time, fill="gray", font=get_font(10))
            y += 60

    img.save(path, quality=90)


def create_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    """Create all demo images with generic camera-style filenames."""
    files = [
        # Food photos (3)
        (f"{prefix}IMG_4721.jpg", make_food_photo, 0),
        (f"{prefix}IMG_4803.jpg", make_food_photo, 1),
        (f"{prefix}IMG_5102.jpg", make_food_photo, 2),

        # Nature/travel photos (3)
        (f"{prefix}DSC_0847.jpg", make_nature_photo, 0),
        (f"{prefix}DSC_1203.jpg", make_nature_photo, 1),
        (f"{prefix}DSC_1455.jpg", make_nature_photo, 2),

        # Work charts (3)
        (f"{prefix}Screenshot_2026-03-15.png", make_chart_image, 0),
        (f"{prefix}Screenshot_2026-03-18.png", make_chart_image, 1),
        (f"{prefix}Screenshot_2026-02-28.png", make_chart_image, 2),

        # Receipts (2)
        (f"{prefix}IMG_20260320_134522.jpg", make_receipt_image, 0),
        (f"{prefix}IMG_20260318_091045.jpg", make_receipt_image, 1),

        # UI Screenshots (2)
        (f"{prefix}Screenshot_20260322_103000.png", make_screenshot_image, 0),
        (f"{prefix}Screenshot_20260321_154530.png", make_screenshot_image, 1),
    ]

    os.makedirs(output_dir, exist_ok=True)
    created = 0
    for filename, generator, variant in files:
        filepath = os.path.join(output_dir, filename)
        generator(filepath, variant)
        created += 1

    print(f"Created {created} images in {output_dir}")
    return [f[0] for f in files]


def clean_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    """Remove all generated demo images."""
    removed = 0
    for f in os.listdir(output_dir):
        if f.startswith(prefix) and (f.endswith(".jpg") or f.endswith(".png")):
            os.remove(os.path.join(output_dir, f))
            removed += 1
    # Also check subdirectories
    for d in os.listdir(output_dir):
        dpath = os.path.join(output_dir, d)
        if os.path.isdir(dpath):
            for f in os.listdir(dpath):
                if f.startswith(prefix) and (f.endswith(".jpg") or f.endswith(".png")):
                    os.remove(os.path.join(dpath, f))
                    removed += 1
    print(f"Removed {removed} demo images")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "create"
    if action == "create":
        create_all()
    elif action == "clean":
        clean_all()
    else:
        print(f"Usage: {sys.argv[0]} [create|clean]")
