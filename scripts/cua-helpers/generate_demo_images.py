#!/usr/bin/env python3
"""Generate realistic test images for CUA desktop organization demo.

Creates images with GENERIC filenames (IMG_xxxx, DSC_xxxx, Screenshot_xxxx)
so the CUA model must LOOK AT the image content to classify them.

8 Categories (30 images total):
  1. Food (4) - pasta, sushi, cake, salad
  2. Nature/Landscape (4) - sunset mountains, beach, forest, starry night
  3. Charts/Data (3) - bar, pie, line
  4. Receipts (3) - grocery, coffee, restaurant
  5. Animals/Pets (4) - cat, dog, fish, bird
  6. Architecture (4) - house, skyscraper, bridge, church
  7. Sports (4) - soccer, basketball, swimming, tennis
  8. Vehicles (4) - car, airplane, sailboat, train
"""

import os
import sys
import random
import math
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
PREFIX = "demo_"

def get_font(size):
    for name in ["arial.ttf", "Arial.ttf", "segoeui.ttf", "calibri.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            pass
    return ImageFont.load_default()


# ── Category 1: Food ─────────────────────────────────────────────────────────

def make_food_photo(path, variant=0):
    img = Image.new("RGB", (800, 600), "#F5E6D3")
    draw = ImageDraw.Draw(img)

    if variant == 0:  # Pasta
        draw.ellipse([150, 80, 650, 520], fill="#FFFFFF", outline="#DDD", width=3)
        for _ in range(20):
            x, y = random.randint(220, 580), random.randint(160, 440)
            draw.arc([x-40, y-20, x+40, y+20], random.randint(0,180), random.randint(180,360), fill="#E8C547", width=2)
        draw.ellipse([300, 220, 500, 380], fill="#C0392B")
        for _ in range(5):
            x, y = random.randint(280, 520), random.randint(200, 400)
            draw.ellipse([x, y, x+25, y+15], fill="#27AE60")
        draw.rectangle([660, 200, 670, 500], fill="#C0C0C0")
    elif variant == 1:  # Sushi
        draw.rectangle([100, 150, 700, 450], fill="#2C3E50")
        for i in range(6):
            x = 150 + i * 90
            c = ["#FF6B6B","#FFA07A","#FF4500","#E74C3C","#FF6347"][i % 5]
            draw.ellipse([x, 220, x+70, 280], fill=c)
            draw.ellipse([x+5, 225, x+65, 275], fill="#FFFFFF")
            draw.rectangle([x+15, 240, x+55, 260], fill=c)
        draw.line([600,130,720,480], fill="#8B4513", width=3)
        draw.line([610,130,730,480], fill="#8B4513", width=3)
    elif variant == 2:  # Cake
        draw.rectangle([200, 200, 600, 500], fill="#F4A460")
        draw.rectangle([200, 200, 600, 260], fill="#FFFFFF")
        draw.rectangle([200, 300, 600, 310], fill="#FFFFFF")
        for x in range(230, 580, 60):
            draw.ellipse([x, 180, x+30, 210], fill="#FF0000")
            draw.polygon([(x+10,175),(x+15,165),(x+20,175)], fill="#228B22")
        for x in [300, 400, 500]:
            draw.rectangle([x, 150, x+8, 200], fill="#FFD700")
            draw.ellipse([x-3, 140, x+11, 155], fill="#FF6600")
    else:  # Salad bowl
        draw.ellipse([100, 100, 700, 550], fill="#8B4513", outline="#654321", width=4)
        draw.ellipse([120, 120, 680, 530], fill="#2E8B57")
        # Vegetables
        for _ in range(8):
            x, y = random.randint(180, 620), random.randint(180, 470)
            draw.ellipse([x, y, x+40, y+25], fill="#FF6347")  # tomato
        for _ in range(6):
            x, y = random.randint(180, 620), random.randint(180, 470)
            draw.ellipse([x, y, x+20, y+20], fill="#FFD700")  # corn
        for _ in range(5):
            x, y = random.randint(180, 620), random.randint(180, 470)
            draw.rectangle([x, y, x+35, y+8], fill="#F0E68C")  # cheese
    img.save(path, quality=90)


# ── Category 2: Nature/Landscape ─────────────────────────────────────────────

def make_nature_photo(path, variant=0):
    img = Image.new("RGB", (800, 600))
    draw = ImageDraw.Draw(img)

    if variant == 0:  # Sunset mountains
        for y in range(300):
            draw.line([(0,y),(800,y)], fill=(int(255-y*0.3), int(100+y*0.2), int(50+y*0.5)))
        draw.ellipse([320, 120, 480, 280], fill="#FFD700")
        draw.polygon([(0,400),(200,250),(400,380),(600,220),(800,350),(800,600),(0,600)], fill="#2C3E50")
        draw.polygon([(100,450),(350,280),(550,400),(800,300),(800,600),(0,600)], fill="#34495E")
    elif variant == 1:  # Beach
        for y in range(250):
            draw.line([(0,y),(800,y)], fill=(135, 206, min(255, int(200+y*0.2))))
        for y in range(250, 450):
            draw.line([(0,y),(800,y)], fill=(0, int(80+(y-250)*0.2), min(255, int(150+100+(y-250)*0.3))))
        draw.rectangle([0, 450, 800, 600], fill="#F4D03F")
        draw.rectangle([650, 300, 665, 500], fill="#8B4513")
        draw.ellipse([580, 250, 730, 330], fill="#228B22")
    elif variant == 2:  # Forest
        for y in range(600):
            draw.line([(0,y),(800,y)], fill=(20, 60+max(0,int(80-y*0.05)), 20))
        for x in range(50, 800, 120):
            draw.rectangle([x, 100, x+random.randint(15,25), 600], fill="#5D4037")
        for x in range(0, 800, 60):
            for y in range(0, 250, 40):
                r = random.randint(25, 35)
                draw.ellipse([x-r, y-r, x+r, y+r], fill=(random.randint(20,60), random.randint(100,180), random.randint(20,50)))
    else:  # Starry night
        img = Image.new("RGB", (800, 600), "#0C1445")
        draw = ImageDraw.Draw(img)
        for _ in range(200):
            x, y = random.randint(0,800), random.randint(0,400)
            s = random.randint(1, 3)
            draw.ellipse([x, y, x+s, y+s], fill="white")
        draw.ellipse([600, 60, 700, 160], fill="#FFE4B5")  # Moon
        draw.ellipse([580, 50, 680, 150], fill="#0C1445")  # Crescent shadow
        # Horizon
        draw.polygon([(0,420),(200,380),(400,400),(600,370),(800,390),(800,600),(0,600)], fill="#1a1a2e")
    img.save(path, quality=90)


# ── Category 3: Charts ───────────────────────────────────────────────────────

def make_chart_image(path, variant=0):
    img = Image.new("RGB", (800, 600), "#FFFFFF")
    draw = ImageDraw.Draw(img)
    font, title_font = get_font(16), get_font(22)

    if variant == 0:  # Bar chart
        draw.text((250, 20), "Quarterly Revenue 2025", fill="black", font=title_font)
        for i, (l, v, c) in enumerate(zip(["Q1","Q2","Q3","Q4"], [42,58,51,67],
                                           ["#3498DB","#2ECC71","#E74C3C","#F39C12"])):
            x = 120 + i * 160
            h = int(v / 70 * 380)
            draw.rectangle([x, 500-h, x+100, 500], fill=c)
            draw.text((x+30, 510), l, fill="black", font=font)
            draw.text((x+25, 490-h), f"${v}K", fill="black", font=font)
        draw.line([(100,500),(780,500)], fill="black", width=2)
        draw.line([(100,50),(100,500)], fill="black", width=2)
    elif variant == 1:  # Pie chart
        draw.text((250, 20), "Market Share Analysis", fill="black", font=title_font)
        cx, cy, r = 400, 320, 180
        start = 0
        for name, pct, color in [("Product A",35,"#3498DB"),("Product B",25,"#2ECC71"),
                                  ("Product C",20,"#E74C3C"),("Others",20,"#95A5A6")]:
            end = start + pct * 3.6
            draw.pieslice([cx-r, cy-r, cx+r, cy+r], start, end, fill=color, outline="white", width=2)
            mid = (start + end) / 2
            lx = cx + int((r+40) * math.cos(math.radians(mid)))
            ly = cy + int((r+40) * math.sin(math.radians(mid)))
            draw.text((lx-30, ly-8), f"{name} {pct}%", fill="black", font=font)
            start = end
    else:  # Line chart
        draw.text((200, 20), "Monthly Active Users (2025)", fill="black", font=title_font)
        draw.line([(80,500),(750,500)], fill="black", width=2)
        draw.line([(80,50),(80,500)], fill="black", width=2)
        pts = []
        for i, (m, v) in enumerate(zip(["Jan","Feb","Mar","Apr","May","Jun"], [1200,1450,1800,2100,2800,3200])):
            x = 120 + i * 120
            y = 500 - int((v/3500)*400)
            pts.append((x, y))
            draw.text((x-10, 510), m, fill="black", font=font)
        for i in range(len(pts)-1):
            draw.line([pts[i], pts[i+1]], fill="#3498DB", width=3)
        for x, y in pts:
            draw.ellipse([x-5, y-5, x+5, y+5], fill="#2980B9")
    img.save(path, quality=90)


# ── Category 4: Receipts ─────────────────────────────────────────────────────

def make_receipt_image(path, variant=0):
    img = Image.new("RGB", (400, 700), "#FFFEF5")
    draw = ImageDraw.Draw(img)
    font, bold = get_font(14), get_font(18)

    if variant == 0:  # Grocery
        y = 30
        draw.text((120, y), "WHOLE FOODS MARKET", fill="black", font=bold); y += 30
        draw.text((130, y), "San Francisco, CA", fill="gray", font=font); y += 25
        draw.line([(30,y),(370,y)], fill="gray"); y += 15
        for item, price in [("Organic Bananas","2.49"),("Avocado 3pk","5.99"),("Almond Milk","4.29"),
                             ("Sourdough Bread","5.49"),("Chicken Breast","12.99"),("Mixed Greens","4.99"),
                             ("Greek Yogurt","6.49"),("Olive Oil","11.99")]:
            draw.text((40,y), item, fill="black", font=font)
            draw.text((300,y), f"${price}", fill="black", font=font); y += 22
        draw.line([(30,y),(370,y)], fill="gray"); y += 10
        draw.text((40,y), "TOTAL", fill="black", font=bold)
        draw.text((285,y), "$59.44", fill="black", font=bold)
    elif variant == 1:  # Coffee
        y = 30
        draw.text((100, y), "STARBUCKS COFFEE", fill="#00704A", font=bold); y += 30
        draw.text((110, y), "Market Street Store", fill="gray", font=font); y += 25
        draw.line([(30,y),(370,y)], fill="gray"); y += 15
        for item, price in [("Caramel Macchiato Venti","6.45"),("Blueberry Muffin","3.95"),("Iced Latte Grande","5.75")]:
            draw.text((40,y), item, fill="black", font=font)
            draw.text((300,y), f"${price}", fill="black", font=font); y += 22
        draw.line([(30,y),(370,y)], fill="gray"); y += 10
        draw.text((40,y), "TOTAL", fill="black", font=bold)
        draw.text((285,y), "$16.15", fill="black", font=bold)
    else:  # Restaurant
        y = 30
        draw.text((100, y), "THE ITALIAN PLACE", fill="#8B0000", font=bold); y += 30
        draw.text((110, y), "Downtown, NYC", fill="gray", font=font); y += 25
        draw.line([(30,y),(370,y)], fill="gray"); y += 15
        for item, price in [("Margherita Pizza","18.00"),("Caesar Salad","12.00"),
                             ("Tiramisu","9.50"),("Red Wine Glass","14.00"),("Espresso","4.50")]:
            draw.text((40,y), item, fill="black", font=font)
            draw.text((300,y), f"${price}", fill="black", font=font); y += 22
        draw.line([(30,y),(370,y)], fill="gray"); y += 10
        draw.text((40,y), "SUBTOTAL", fill="black", font=bold)
        draw.text((280,y), "$58.00", fill="black", font=bold); y += 25
        draw.text((40,y), "TIP 20%", fill="gray", font=font)
        draw.text((290,y), "$11.60", fill="gray", font=font); y += 25
        draw.text((40,y), "TOTAL", fill="black", font=bold)
        draw.text((280,y), "$69.60", fill="black", font=bold)
    img.save(path, quality=90)


# ── Category 5: Animals ──────────────────────────────────────────────────────

def make_animal_photo(path, variant=0):
    if variant == 0:  # Cat
        img = Image.new("RGB", (800, 600), "#F0E6D2")
        draw = ImageDraw.Draw(img)
        # Body
        draw.ellipse([250, 250, 550, 500], fill="#FF8C00")
        # Head
        draw.ellipse([300, 150, 500, 350], fill="#FF8C00")
        # Ears
        draw.polygon([(310, 180), (330, 100), (370, 170)], fill="#FF8C00")
        draw.polygon([(430, 170), (470, 100), (490, 180)], fill="#FF8C00")
        draw.polygon([(320, 170), (335, 115), (360, 165)], fill="#FFB6C1")
        draw.polygon([(440, 165), (465, 115), (480, 170)], fill="#FFB6C1")
        # Eyes
        draw.ellipse([340, 220, 380, 260], fill="#2ECC71")
        draw.ellipse([420, 220, 460, 260], fill="#2ECC71")
        draw.ellipse([355, 230, 370, 250], fill="black")
        draw.ellipse([435, 230, 450, 250], fill="black")
        # Nose
        draw.polygon([(390, 280), (400, 290), (410, 280)], fill="#FF69B4")
        # Whiskers
        for dy in [275, 285, 295]:
            draw.line([(280, dy), (370, dy)], fill="#333", width=1)
            draw.line([(430, dy), (520, dy)], fill="#333", width=1)
        # Tail
        draw.arc([500, 300, 650, 500], 200, 360, fill="#FF8C00", width=8)
    elif variant == 1:  # Dog
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        # Green ground
        draw.rectangle([0, 400, 800, 600], fill="#228B22")
        # Body
        draw.ellipse([250, 250, 580, 480], fill="#D2691E")
        # Head
        draw.ellipse([200, 150, 400, 350], fill="#D2691E")
        # Ears (floppy)
        draw.ellipse([180, 170, 250, 320], fill="#8B4513")
        draw.ellipse([360, 170, 430, 320], fill="#8B4513")
        # Eyes
        draw.ellipse([260, 220, 300, 260], fill="white")
        draw.ellipse([330, 220, 370, 260], fill="white")
        draw.ellipse([270, 230, 290, 250], fill="black")
        draw.ellipse([340, 230, 360, 250], fill="black")
        # Nose
        draw.ellipse([290, 270, 330, 300], fill="black")
        # Tongue
        draw.ellipse([295, 300, 325, 350], fill="#FF69B4")
        # Tail
        draw.arc([520, 200, 680, 400], 220, 340, fill="#D2691E", width=10)
        # Legs
        for x in [300, 350, 430, 480]:
            draw.rectangle([x, 430, x+30, 520], fill="#D2691E")
    elif variant == 2:  # Fish (aquarium)
        img = Image.new("RGB", (800, 600), "#006994")
        draw = ImageDraw.Draw(img)
        # Sand bottom
        draw.rectangle([0, 480, 800, 600], fill="#F4D03F")
        # Seaweed
        for x in [100, 300, 600, 700]:
            for seg in range(5):
                y = 480 - seg * 60
                draw.ellipse([x-10, y-30, x+20, y+10], fill="#228B22")
        # Fish 1 (big orange)
        draw.ellipse([250, 200, 500, 350], fill="#FF6347")
        draw.polygon([(480, 275), (550, 220), (550, 330)], fill="#FF6347")  # tail
        draw.ellipse([290, 240, 320, 270], fill="white")
        draw.ellipse([300, 248, 315, 262], fill="black")
        # Fish 2 (small blue)
        draw.ellipse([550, 300, 680, 380], fill="#4169E1")
        draw.polygon([(660, 340), (710, 310), (710, 370)], fill="#4169E1")
        draw.ellipse([570, 325, 590, 345], fill="white")
        draw.ellipse([575, 330, 587, 340], fill="black")
        # Bubbles
        for _ in range(10):
            x, y = random.randint(200, 700), random.randint(50, 400)
            r = random.randint(5, 15)
            draw.ellipse([x, y, x+r, y+r], outline="white", width=1)
    else:  # Bird
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        # Clouds
        for cx, cy in [(200, 80), (500, 120), (650, 60)]:
            for dx in range(-40, 50, 20):
                draw.ellipse([cx+dx, cy-15, cx+dx+50, cy+25], fill="white")
        # Branch
        draw.rectangle([100, 350, 700, 370], fill="#8B4513")
        # Bird body
        draw.ellipse([320, 240, 500, 380], fill="#E74C3C")
        # Head
        draw.ellipse([250, 200, 380, 320], fill="#E74C3C")
        # Eye
        draw.ellipse([280, 240, 310, 270], fill="white")
        draw.ellipse([288, 248, 304, 262], fill="black")
        # Beak
        draw.polygon([(250, 265), (210, 260), (250, 280)], fill="#FFD700")
        # Wing
        draw.ellipse([370, 260, 520, 350], fill="#C0392B")
        # Tail
        draw.polygon([(480, 300), (560, 260), (560, 340)], fill="#C0392B")
        # Legs
        draw.line([(380, 375), (380, 420), (360, 440)], fill="#333", width=2)
        draw.line([(380, 420), (400, 440)], fill="#333", width=2)
        draw.line([(430, 375), (430, 420), (410, 440)], fill="#333", width=2)
        draw.line([(430, 420), (450, 440)], fill="#333", width=2)
    img.save(path, quality=90)


# ── Category 6: Architecture ─────────────────────────────────────────────────

def make_architecture_photo(path, variant=0):
    if variant == 0:  # House
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 400, 800, 600], fill="#228B22")  # grass
        # House body
        draw.rectangle([200, 250, 600, 500], fill="#F5DEB3")
        # Roof
        draw.polygon([(150, 250), (400, 100), (650, 250)], fill="#8B0000")
        # Door
        draw.rectangle([350, 350, 450, 500], fill="#8B4513")
        draw.ellipse([430, 415, 445, 430], fill="#FFD700")  # knob
        # Windows
        draw.rectangle([240, 300, 320, 380], fill="#ADD8E6", outline="#333", width=2)
        draw.line([(280, 300), (280, 380)], fill="#333", width=2)
        draw.line([(240, 340), (320, 340)], fill="#333", width=2)
        draw.rectangle([480, 300, 560, 380], fill="#ADD8E6", outline="#333", width=2)
        draw.line([(520, 300), (520, 380)], fill="#333", width=2)
        draw.line([(480, 340), (560, 340)], fill="#333", width=2)
        # Chimney
        draw.rectangle([500, 120, 540, 200], fill="#A0522D")
    elif variant == 1:  # Skyscraper
        img = Image.new("RGB", (800, 600), "#1a1a2e")
        draw = ImageDraw.Draw(img)
        # Stars
        for _ in range(50):
            x, y = random.randint(0,800), random.randint(0,300)
            draw.point((x, y), fill="white")
        # Buildings
        buildings = [(50,200,180,600,"#2C3E50"), (180,150,310,600,"#34495E"),
                     (310,100,460,600,"#2C3E50"), (460,180,590,600,"#34495E"),
                     (590,220,720,600,"#2C3E50")]
        for x1, y1, x2, y2, c in buildings:
            draw.rectangle([x1, y1, x2, y2], fill=c)
            # Windows
            for wy in range(y1+20, y2-20, 30):
                for wx in range(x1+15, x2-15, 25):
                    color = "#FFD700" if random.random() > 0.3 else "#333"
                    draw.rectangle([wx, wy, wx+12, wy+15], fill=color)
    elif variant == 2:  # Bridge
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        # Water
        draw.rectangle([0, 380, 800, 600], fill="#4682B4")
        # Bridge deck
        draw.rectangle([0, 320, 800, 360], fill="#808080")
        # Towers
        draw.rectangle([200, 150, 240, 360], fill="#A9A9A9")
        draw.rectangle([560, 150, 600, 360], fill="#A9A9A9")
        # Cables
        for x in range(0, 800, 40):
            if x < 220:
                draw.line([(220, 150), (x, 320)], fill="#333", width=1)
            elif x > 580:
                draw.line([(580, 150), (x, 320)], fill="#333", width=1)
            else:
                mid = 400
                tower = 220 if x < mid else 580
                draw.line([(tower, 150), (x, 320)], fill="#333", width=1)
        # Main cable arc
        pts = [(0, 320)]
        for x in range(0, 801, 20):
            if x <= 220:
                y = 320 - (x/220) * 170
            elif x <= 580:
                progress = (x - 220) / 360
                y = 150 + abs(progress - 0.5) * 2 * 100
            else:
                y = 320 - ((800-x)/220) * 170
            pts.append((x, int(y)))
        for i in range(len(pts)-1):
            draw.line([pts[i], pts[i+1]], fill="#333", width=3)
    else:  # Church
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 450, 800, 600], fill="#228B22")
        # Main body
        draw.rectangle([200, 250, 600, 530], fill="#F5F5DC")
        # Tower/steeple
        draw.rectangle([340, 100, 460, 250], fill="#F5F5DC")
        draw.polygon([(330, 100), (400, 20), (470, 100)], fill="#696969")
        # Cross
        draw.rectangle([392, 25, 408, 70], fill="#FFD700")
        draw.rectangle([380, 35, 420, 50], fill="#FFD700")
        # Rose window
        draw.ellipse([350, 120, 450, 220], fill="#4169E1", outline="#333", width=2)
        # Door
        draw.rectangle([360, 380, 440, 530], fill="#8B4513")
        draw.arc([360, 350, 440, 410], 180, 0, fill="#8B4513", width=30)
        # Side windows
        for x in [240, 520]:
            draw.rectangle([x, 320, x+60, 420], fill="#ADD8E6", outline="#333", width=2)
            draw.arc([x, 300, x+60, 340], 180, 0, fill="#ADD8E6", width=20)
    img.save(path, quality=90)


# ── Category 7: Sports ───────────────────────────────────────────────────────

def make_sports_photo(path, variant=0):
    if variant == 0:  # Soccer field
        img = Image.new("RGB", (800, 600), "#228B22")
        draw = ImageDraw.Draw(img)
        # Field lines
        draw.rectangle([50, 50, 750, 550], outline="white", width=3)
        draw.line([(400, 50), (400, 550)], fill="white", width=3)
        draw.ellipse([330, 230, 470, 370], outline="white", width=3)
        draw.ellipse([395, 295, 405, 305], fill="white")
        # Goal areas
        draw.rectangle([50, 180, 180, 420], outline="white", width=2)
        draw.rectangle([620, 180, 750, 420], outline="white", width=2)
        draw.rectangle([50, 230, 110, 370], outline="white", width=2)
        draw.rectangle([690, 230, 750, 370], outline="white", width=2)
        # Soccer ball
        draw.ellipse([370, 270, 430, 330], fill="white", outline="black", width=2)
        # Pentagon pattern on ball
        draw.polygon([(390, 280), (410, 280), (415, 295), (400, 305), (385, 295)], fill="black")
    elif variant == 1:  # Basketball court
        img = Image.new("RGB", (800, 600), "#CD853F")
        draw = ImageDraw.Draw(img)
        draw.rectangle([40, 40, 760, 560], outline="white", width=3)
        draw.line([(400, 40), (400, 560)], fill="white", width=3)
        draw.ellipse([320, 220, 480, 380], outline="white", width=3)
        # Hoops
        draw.rectangle([40, 200, 130, 400], outline="white", width=2)
        draw.ellipse([60, 260, 130, 340], outline="white", width=2)
        draw.rectangle([670, 200, 760, 400], outline="white", width=2)
        draw.ellipse([670, 260, 740, 340], outline="white", width=2)
        # Three-point arc
        draw.arc([40, 130, 280, 470], 270, 90, fill="white", width=2)
        draw.arc([520, 130, 760, 470], 90, 270, fill="white", width=2)
        # Basketball
        draw.ellipse([380, 280, 420, 320], fill="#FF8C00", outline="black", width=2)
    elif variant == 2:  # Swimming pool
        img = Image.new("RGB", (800, 600), "#006994")
        draw = ImageDraw.Draw(img)
        # Lane lines
        for y in range(80, 520, 70):
            draw.line([(80, y), (720, y)], fill="white", width=1)
        # Lane ropes (red/white alternating)
        for y in range(80, 520, 70):
            for x in range(80, 720, 20):
                c = "#FF0000" if (x // 20) % 2 == 0 else "white"
                draw.ellipse([x, y-3, x+8, y+3], fill=c)
        # Pool edge
        draw.rectangle([60, 50, 740, 550], outline="#DDD", width=8)
        # Starting blocks
        for y in [85, 155, 225, 295, 365, 435, 505]:
            draw.rectangle([60, y-8, 80, y+8], fill="#808080")
        # Swimmer
        draw.ellipse([350, 270, 380, 300], fill="#FFD700")
        draw.line([(365, 300), (365, 340)], fill="#FFD700", width=3)
        draw.line([(350, 310), (380, 310)], fill="#FFD700", width=3)
    else:  # Tennis court
        img = Image.new("RGB", (800, 600), "#2E8B57")
        draw = ImageDraw.Draw(img)
        # Court
        draw.rectangle([100, 80, 700, 520], fill="#4169E1")
        draw.rectangle([100, 80, 700, 520], outline="white", width=3)
        # Net
        draw.line([(100, 300), (700, 300)], fill="white", width=3)
        draw.rectangle([95, 290, 105, 310], fill="#333")
        draw.rectangle([695, 290, 705, 310], fill="#333")
        # Service boxes
        draw.line([(250, 80), (250, 520)], fill="white", width=2)
        draw.line([(550, 80), (550, 520)], fill="white", width=2)
        draw.line([(250, 300), (550, 300)], fill="white", width=2)
        draw.line([(400, 80), (400, 300)], fill="white", width=1)
        draw.line([(400, 300), (400, 520)], fill="white", width=1)
        # Tennis ball
        draw.ellipse([420, 180, 450, 210], fill="#ADFF2F", outline="white", width=1)
    img.save(path, quality=90)


# ── Category 8: Vehicles ─────────────────────────────────────────────────────

def make_vehicle_photo(path, variant=0):
    if variant == 0:  # Car
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 400, 800, 600], fill="#808080")  # road
        draw.line([(0, 440), (800, 440)], fill="#FFD700", width=3)  # center line
        # Car body
        draw.rectangle([200, 300, 600, 420], fill="#E74C3C")
        draw.polygon([(280, 300), (350, 220), (500, 220), (560, 300)], fill="#E74C3C")
        # Windows
        draw.polygon([(295, 295), (355, 225), (410, 225), (410, 295)], fill="#ADD8E6")
        draw.polygon([(420, 295), (420, 225), (490, 225), (545, 295)], fill="#ADD8E6")
        # Wheels
        draw.ellipse([240, 390, 320, 470], fill="#333")
        draw.ellipse([260, 410, 300, 450], fill="#999")
        draw.ellipse([480, 390, 560, 470], fill="#333")
        draw.ellipse([500, 410, 540, 450], fill="#999")
        # Headlights
        draw.rectangle([590, 340, 610, 370], fill="#FFD700")
    elif variant == 1:  # Airplane
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        # Clouds
        for cx, cy in [(100, 100), (500, 150), (700, 80)]:
            for dx in range(-30, 40, 15):
                draw.ellipse([cx+dx, cy-10, cx+dx+40, cy+20], fill="white")
        # Fuselage
        draw.ellipse([150, 260, 650, 340], fill="#C0C0C0")
        draw.polygon([(640, 290), (700, 260), (700, 340)], fill="#C0C0C0")  # nose
        draw.polygon([(150, 290), (100, 250), (100, 340)], fill="#C0C0C0")  # tail
        # Wings
        draw.polygon([(300, 300), (350, 300), (500, 420), (250, 420)], fill="#A9A9A9")
        draw.polygon([(300, 300), (350, 300), (500, 180), (250, 180)], fill="#A9A9A9")
        # Tail fin
        draw.polygon([(120, 260), (160, 260), (160, 180), (110, 200)], fill="#E74C3C")
        # Windows
        for x in range(250, 620, 30):
            draw.ellipse([x, 280, x+12, 295], fill="#ADD8E6")
        # Engine
        draw.ellipse([340, 410, 400, 440], fill="#696969")
    elif variant == 2:  # Sailboat
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        # Water
        for y in range(350, 600):
            draw.line([(0,y),(800,y)], fill=(0, int(80+(y-350)*0.3), min(255, int(140+(y-350)*0.4))))
        # Hull
        draw.polygon([(200, 400), (600, 400), (550, 480), (250, 480)], fill="#8B4513")
        # Mast
        draw.line([(400, 120), (400, 400)], fill="#333", width=4)
        # Main sail
        draw.polygon([(405, 140), (405, 380), (600, 380)], fill="white", outline="#DDD", width=1)
        # Jib sail
        draw.polygon([(395, 140), (395, 350), (220, 350)], fill="#FFFAF0", outline="#DDD", width=1)
        # Flag
        draw.polygon([(400, 120), (400, 140), (440, 130)], fill="#E74C3C")
        # Waves
        for x in range(0, 800, 60):
            draw.arc([x, 345, x+50, 365], 0, 180, fill="white", width=2)
    else:  # Train
        img = Image.new("RGB", (800, 600), "#87CEEB")
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 450, 800, 600], fill="#228B22")
        # Tracks
        draw.rectangle([0, 430, 800, 450], fill="#808080")
        draw.line([(0, 435), (800, 435)], fill="#555", width=2)
        draw.line([(0, 445), (800, 445)], fill="#555", width=2)
        for x in range(0, 800, 30):
            draw.rectangle([x, 430, x+15, 450], fill="#8B4513")
        # Locomotive
        draw.rectangle([80, 300, 300, 430], fill="#E74C3C")
        draw.rectangle([60, 280, 300, 310], fill="#E74C3C")
        draw.rectangle([60, 280, 100, 300], fill="#FFD700")  # headlight
        # Smokestack
        draw.rectangle([120, 230, 160, 300], fill="#333")
        draw.ellipse([110, 210, 170, 240], fill="#696969")
        # Cabin
        draw.rectangle([200, 260, 300, 300], fill="#E74C3C")
        draw.rectangle([220, 265, 280, 295], fill="#ADD8E6")
        # Cars
        for i, color in enumerate(["#3498DB", "#2ECC71", "#F39C12"]):
            x = 320 + i * 160
            draw.rectangle([x, 320, x+140, 430], fill=color)
            draw.rectangle([x+10, 340, x+60, 400], fill="#ADD8E6")
            draw.rectangle([x+70, 340, x+120, 400], fill="#ADD8E6")
        # Wheels
        for x in [100, 200, 260]:
            draw.ellipse([x, 415, x+30, 445], fill="#333")
        for i in range(3):
            for dx in [20, 120]:
                draw.ellipse([320+i*160+dx, 415, 320+i*160+dx+30, 445], fill="#333")
    img.save(path, quality=90)


# ── Create/Clean ─────────────────────────────────────────────────────────────

def create_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    files = [
        # Food (4)
        (f"{prefix}IMG_4721.jpg", make_food_photo, 0),
        (f"{prefix}IMG_4803.jpg", make_food_photo, 1),
        (f"{prefix}IMG_5102.jpg", make_food_photo, 2),
        (f"{prefix}IMG_5244.jpg", make_food_photo, 3),

        # Nature/Landscape (4)
        (f"{prefix}DSC_0847.jpg", make_nature_photo, 0),
        (f"{prefix}DSC_1203.jpg", make_nature_photo, 1),
        (f"{prefix}DSC_1455.jpg", make_nature_photo, 2),
        (f"{prefix}DSC_1602.jpg", make_nature_photo, 3),

        # Charts (3)
        (f"{prefix}Screenshot_2026-03-15.png", make_chart_image, 0),
        (f"{prefix}Screenshot_2026-03-18.png", make_chart_image, 1),
        (f"{prefix}Screenshot_2026-02-28.png", make_chart_image, 2),

        # Receipts (3)
        (f"{prefix}IMG_20260320_134522.jpg", make_receipt_image, 0),
        (f"{prefix}IMG_20260318_091045.jpg", make_receipt_image, 1),
        (f"{prefix}IMG_20260322_192300.jpg", make_receipt_image, 2),

        # Animals (4)
        (f"{prefix}IMG_6001.jpg", make_animal_photo, 0),
        (f"{prefix}IMG_6042.jpg", make_animal_photo, 1),
        (f"{prefix}IMG_6103.jpg", make_animal_photo, 2),
        (f"{prefix}DSC_2001.jpg", make_animal_photo, 3),

        # Architecture (4)
        (f"{prefix}DSC_3010.jpg", make_architecture_photo, 0),
        (f"{prefix}DSC_3045.jpg", make_architecture_photo, 1),
        (f"{prefix}DSC_3088.jpg", make_architecture_photo, 2),
        (f"{prefix}DSC_3120.jpg", make_architecture_photo, 3),

        # Sports (4)
        (f"{prefix}IMG_7001.jpg", make_sports_photo, 0),
        (f"{prefix}IMG_7055.jpg", make_sports_photo, 1),
        (f"{prefix}IMG_7102.jpg", make_sports_photo, 2),
        (f"{prefix}IMG_7200.jpg", make_sports_photo, 3),

        # Vehicles (4)
        (f"{prefix}IMG_8001.jpg", make_vehicle_photo, 0),
        (f"{prefix}IMG_8034.jpg", make_vehicle_photo, 1),
        (f"{prefix}IMG_8077.jpg", make_vehicle_photo, 2),
        (f"{prefix}IMG_8150.jpg", make_vehicle_photo, 3),
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
    removed = 0
    for f in os.listdir(output_dir):
        if f.startswith(prefix) and (f.endswith(".jpg") or f.endswith(".png")):
            os.remove(os.path.join(output_dir, f))
            removed += 1
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
