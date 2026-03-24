#!/usr/bin/env python3
"""Generate realistic test files for CUA desktop organization demo.

Creates a mix of:
- REAL PHOTOS from Pexels (food, nature, animals, architecture)
- PIL-generated images (receipts, charts)
- TEXT FILES with varied content (code, meeting notes, recipes, resumes)

All with GENERIC filenames so the model must READ content to classify.

10 Categories (~30 files):
  1. Food photos (3) - real photos from Pexels
  2. Nature/Landscape (3) - real photos from Pexels
  3. Animals (3) - real photos from Pexels
  4. Architecture (3) - real photos from Pexels
  5. Receipts (3) - PIL-generated receipt images
  6. Charts/Data (3) - PIL-generated chart images
  7. Code files (3) - .py/.js source code
  8. Meeting notes (3) - .txt meeting minutes
  9. Recipes (2) - .txt cooking recipes
  10. Job/Resume (2) - .txt resume/cover letter
"""

import os
import sys
import random
import math
import urllib.request
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


# ── Download real photos from Pexels ─────────────────────────────────────────

PEXELS_PHOTOS = {
    # Food (3)
    "food_0": "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800",
    "food_1": "https://images.pexels.com/photos/1099680/pexels-photo-1099680.jpeg?auto=compress&cs=tinysrgb&w=800",
    "food_2": "https://images.pexels.com/photos/376464/pexels-photo-376464.jpeg?auto=compress&cs=tinysrgb&w=800",
    # Nature/Landscape (3)
    "nature_0": "https://images.pexels.com/photos/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&w=800",
    "nature_1": "https://images.pexels.com/photos/1287145/pexels-photo-1287145.jpeg?auto=compress&cs=tinysrgb&w=800",
    "nature_2": "https://images.pexels.com/photos/572897/pexels-photo-572897.jpeg?auto=compress&cs=tinysrgb&w=800",
    # Animals (3)
    "animals_0": "https://images.pexels.com/photos/45201/kitty-cat-kitten-pet-45201.jpeg?auto=compress&cs=tinysrgb&w=800",
    "animals_1": "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=800",
    "animals_2": "https://images.pexels.com/photos/56866/garden-rose-red-pink-56866.jpeg?auto=compress&cs=tinysrgb&w=800",
    # Architecture (3)
    "architecture_0": "https://images.pexels.com/photos/1838640/pexels-photo-1838640.jpeg?auto=compress&cs=tinysrgb&w=800",
    "architecture_1": "https://images.pexels.com/photos/2404843/pexels-photo-2404843.jpeg?auto=compress&cs=tinysrgb&w=800",
    "architecture_2": "https://images.pexels.com/photos/2539462/pexels-photo-2539462.jpeg?auto=compress&cs=tinysrgb&w=800",
}

def download_photo(key, filepath):
    """Download a photo from Pexels. Returns True on success."""
    url = PEXELS_PHOTOS.get(key)
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=15).read()
        with open(filepath, 'wb') as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"  WARNING: Failed to download {key}: {e}", file=sys.stderr)
        return False


# ── PIL-generated images ─────────────────────────────────────────────────────

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
        draw.text((40,y), "TOTAL", fill="black", font=bold)
        draw.text((280,y), "$69.60", fill="black", font=bold)
    img.save(path, quality=90)


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
            x, y = 120 + i * 120, 500 - int((v/3500)*400)
            pts.append((x, y))
            draw.text((x-10, 510), m, fill="black", font=font)
        for i in range(len(pts)-1):
            draw.line([pts[i], pts[i+1]], fill="#3498DB", width=3)
        for x, y in pts:
            draw.ellipse([x-5, y-5, x+5, y+5], fill="#2980B9")
    img.save(path, quality=90)


# ── Text file content ────────────────────────────────────────────────────────

TEXT_FILES = {
    # Code files (3) — model should read to see it's source code
    "code_0": {
        "name": f"{PREFIX}draft_v2.py",
        "content": '''import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

def train_model(data_path):
    df = pd.read_csv(data_path)
    X = df.drop('target', axis=1)
    y = df['target']
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
    model = RandomForestClassifier(n_estimators=100)
    model.fit(X_train, y_train)
    print(f"Accuracy: {model.score(X_test, y_test):.2f}")
    return model

if __name__ == "__main__":
    train_model("dataset.csv")
'''
    },
    "code_1": {
        "name": f"{PREFIX}untitled3.js",
        "content": '''const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'dev-secret';

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // TODO: validate against database
  if (username === 'admin' && password === 'password') {
    const token = jwt.sign({ user: username }, SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.listen(3000, () => console.log('Server running on port 3000'));
'''
    },
    "code_2": {
        "name": f"{PREFIX}backup_old.py",
        "content": '''import torch
import torch.nn as nn

class TransformerBlock(nn.Module):
    def __init__(self, d_model=512, nhead=8, dim_ff=2048, dropout=0.1):
        super().__init__()
        self.attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout)
        self.ff = nn.Sequential(
            nn.Linear(d_model, dim_ff), nn.ReLU(), nn.Linear(dim_ff, d_model))
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        attn_out, _ = self.attn(x, x, x)
        x = self.norm1(x + self.dropout(attn_out))
        ff_out = self.ff(x)
        x = self.norm2(x + self.dropout(ff_out))
        return x

model = TransformerBlock()
print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")
'''
    },

    # Meeting notes (3)
    "meeting_0": {
        "name": f"{PREFIX}notes_monday.txt",
        "content": '''Team Standup - Monday March 18, 2026
=====================================
Attendees: Alice, Bob, Carlos, Diana

Alice:
- Done: Fixed authentication bug (#342)
- Blocked: Waiting on API keys from infrastructure team
- Today: Start working on user profile page

Bob:
- Done: Code review for PR #156
- Today: Database migration for new schema
- Note: Will be OOO Thursday for dentist

Carlos:
- Done: Updated CI/CD pipeline, 30% faster builds
- Today: Set up staging environment for QA
- Risk: Staging server disk space running low (87%)

Diana:
- Done: Completed design mockups for settings page
- Today: User testing sessions (3 scheduled)
- FYI: Design system v2 ready for review

Action Items:
- Alice: Follow up with infra team on API keys
- Carlos: Request disk space increase for staging
- All: Review design system v2 by Wednesday
'''
    },
    "meeting_1": {
        "name": f"{PREFIX}sync_notes_0315.txt",
        "content": '''Sprint Retrospective - March 15, 2026
======================================
Sprint 23 | 2 weeks | Team Velocity: 42 points

What went well:
- Shipped 3 major features on time
- Zero production incidents this sprint
- New team member (Eva) onboarded smoothly
- Automated test coverage increased to 78%

What could be improved:
- PR review cycle still averaging 2.5 days (target: 1 day)
- Too many meetings on Wednesdays (5 hours!)
- Flaky test in payment module needs attention
- Documentation lagging behind implementation

Action items for next sprint:
1. Implement PR review SLA: 24 hours max
2. Move 2 Wednesday meetings to async updates
3. Fix payment test flakiness (assign: Bob)
4. Doc day: last Friday of sprint dedicated to docs
'''
    },
    "meeting_2": {
        "name": f"{PREFIX}allhands_feb.txt",
        "content": '''All-Hands Meeting Notes - February 28, 2026
============================================
Presenter: CEO Sarah Johnson

Company Updates:
- Series B funding closed: $45M led by Sequoia
- Headcount growing from 85 to 120 by Q3
- New office in Austin opening June 1

Product:
- MAU reached 500K (up 40% QoQ)
- Enterprise tier launching April 15
- Mobile app beta starting May 1

Engineering:
- Platform migration to Kubernetes: 60% complete
- New ML pipeline shipping Q2
- Hiring: 8 engineers, 2 ML researchers, 3 designers

Q&A Highlights:
- Remote work policy: 3 days office, 2 days remote
- Annual conference: September in SF
- Stock option refresh: HR will send details next week
'''
    },

    # Recipes (2)
    "recipe_0": {
        "name": f"{PREFIX}from_mom.txt",
        "content": '''Mom's Chicken Tikka Masala
==========================
Serves: 4 | Prep: 20 min | Cook: 40 min

Marinade:
- 1 lb chicken thighs, cubed
- 1 cup yogurt
- 2 tsp garam masala
- 1 tsp turmeric
- 1 tsp cumin
- Salt and pepper

Sauce:
- 2 tbsp butter + 1 tbsp oil
- 1 large onion, diced
- 4 cloves garlic, minced
- 1 inch ginger, grated
- 1 can (14 oz) crushed tomatoes
- 1 cup heavy cream
- 2 tsp garam masala
- 1 tsp paprika
- Fresh cilantro for garnish

Instructions:
1. Marinate chicken at least 2 hours (overnight is best)
2. Grill or broil chicken until charred, set aside
3. Saute onion in butter+oil until golden (8 min)
4. Add garlic, ginger - cook 1 min
5. Add tomatoes, spices - simmer 15 min
6. Stir in cream, add chicken - simmer 10 min
7. Garnish with cilantro, serve with naan and rice

Dad says: "Don't skip the overnight marinade!"
'''
    },
    "recipe_1": {
        "name": f"{PREFIX}to_try_later.txt",
        "content": '''Japanese Fluffy Pancakes (Souffle Pancakes)
============================================
Makes: 4 thick pancakes | Time: 30 min

Ingredients:
- 2 egg yolks
- 3 tbsp milk
- 1 tsp vanilla extract
- 1/4 cup cake flour
- 1/2 tsp baking powder
- 3 egg whites
- 2 tbsp sugar
- Pinch of cream of tartar

Instructions:
1. Mix yolks, milk, vanilla in a bowl
2. Sift in flour and baking powder, mix until smooth
3. Beat egg whites with cream of tartar until foamy
4. Gradually add sugar, beat until stiff peaks
5. Fold 1/3 meringue into yolk batter vigorously
6. Gently fold in remaining meringue (don't deflate!)
7. Grease pan on LOWEST heat, use ring molds
8. Pipe batter into molds (3 inches high)
9. Add 2 tbsp water, cover, cook 6-7 min
10. Flip carefully, cover, cook 6-7 more min
11. Remove molds, top with butter, syrup, and fruit

Tips:
- Low heat is KEY - they burn easily
- Don't open lid while cooking
- Serve immediately - they deflate in 5 min!
'''
    },

    # Job/Resume (2)
    "resume_0": {
        "name": f"{PREFIX}latest_draft.txt",
        "content": '''ALEX CHEN
Senior Software Engineer

San Francisco, CA | alex.chen@email.com | github.com/alexchen

EXPERIENCE

Senior Software Engineer | Stripe | 2023-Present
- Led migration of payment processing service to event-driven architecture
- Reduced API latency by 45% through caching layer redesign
- Mentored 3 junior engineers, conducted 50+ technical interviews
- Tech: Python, Go, PostgreSQL, Redis, Kafka, Kubernetes

Software Engineer | Airbnb | 2020-2023
- Built real-time pricing engine processing 10M+ requests/day
- Implemented A/B testing framework used by 15 product teams
- Contributed to open-source ML pipeline (2K+ GitHub stars)
- Tech: Python, Java, React, TensorFlow, AWS

EDUCATION
BS Computer Science, Stanford University, 2020
- GPA: 3.8/4.0, Tau Beta Pi Honor Society

SKILLS
Languages: Python, Go, Java, TypeScript, SQL
Infrastructure: AWS, GCP, Kubernetes, Docker, Terraform
ML: PyTorch, TensorFlow, scikit-learn, Spark ML
'''
    },
    "resume_1": {
        "name": f"{PREFIX}cover_v3_final.txt",
        "content": '''Dear Hiring Manager,

I am writing to express my interest in the Staff Engineer position
at Anthropic. With 6 years of experience building scalable systems
at Stripe and Airbnb, and a deep passion for AI safety, I believe
I would be a strong addition to your infrastructure team.

At Stripe, I led the migration of our core payment processing
service from a monolithic architecture to an event-driven system
using Kafka and Kubernetes. This reduced processing latency by 45%
and improved system reliability from 99.95% to 99.99% uptime.

What excites me most about Anthropic is your commitment to building
AI systems that are safe and beneficial. I have been following your
Constitutional AI research closely and believe my experience in
building reliable, fault-tolerant distributed systems would translate
well to the challenges of deploying large language models safely.

I would welcome the opportunity to discuss how my background in
distributed systems and ML infrastructure could contribute to
Anthropic's mission.

Best regards,
Alex Chen
'''
    },
}


# ── Main create/clean ────────────────────────────────────────────────────────

def create_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    os.makedirs(output_dir, exist_ok=True)
    created = 0

    # 1. Download real photos from Pexels
    photo_files = {
        "food_0":  f"{prefix}IMG_4721.jpg",
        "food_1":  f"{prefix}IMG_4803.jpg",
        "food_2":  f"{prefix}IMG_5102.jpg",
        "nature_0": f"{prefix}DSC_0847.jpg",
        "nature_1": f"{prefix}DSC_1203.jpg",
        "nature_2": f"{prefix}DSC_1455.jpg",
        "animals_0": f"{prefix}IMG_6001.jpg",
        "animals_1": f"{prefix}IMG_6042.jpg",
        "animals_2": f"{prefix}DSC_2001.jpg",
        "architecture_0": f"{prefix}DSC_3010.jpg",
        "architecture_1": f"{prefix}DSC_3045.jpg",
        "architecture_2": f"{prefix}DSC_3088.jpg",
    }
    print("Downloading real photos from Pexels...")
    for key, filename in photo_files.items():
        path = os.path.join(output_dir, filename)
        if download_photo(key, path):
            created += 1
            print(f"  {filename} OK")
        else:
            print(f"  {filename} FAILED - generating fallback")

    # 2. PIL-generated images
    print("Generating receipts and charts...")
    receipt_files = [
        (f"{prefix}IMG_20260320_134522.jpg", make_receipt_image, 0),
        (f"{prefix}IMG_20260318_091045.jpg", make_receipt_image, 1),
        (f"{prefix}IMG_20260322_192300.jpg", make_receipt_image, 2),
    ]
    chart_files = [
        (f"{prefix}Screenshot_2026-03-15.png", make_chart_image, 0),
        (f"{prefix}Screenshot_2026-03-18.png", make_chart_image, 1),
        (f"{prefix}Screenshot_2026-02-28.png", make_chart_image, 2),
    ]
    for filename, gen, var in receipt_files + chart_files:
        gen(os.path.join(output_dir, filename), var)
        created += 1

    # 3. Text files
    print("Creating text files...")
    for key, info in TEXT_FILES.items():
        path = os.path.join(output_dir, info["name"])
        with open(path, 'w', encoding='utf-8') as f:
            f.write(info["content"])
        created += 1

    print(f"\nCreated {created} files in {output_dir}")
    return created


def clean_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    removed = 0
    exts = ('.jpg', '.png', '.py', '.js', '.txt')
    for f in os.listdir(output_dir):
        if f.startswith(prefix) and f.endswith(exts):
            os.remove(os.path.join(output_dir, f))
            removed += 1
    for d in os.listdir(output_dir):
        dpath = os.path.join(output_dir, d)
        if os.path.isdir(dpath):
            for f in os.listdir(dpath):
                if f.startswith(prefix) and f.endswith(exts):
                    os.remove(os.path.join(dpath, f))
                    removed += 1
            # Remove empty dirs
            try:
                if not os.listdir(dpath):
                    os.rmdir(dpath)
            except:
                pass
    print(f"Removed {removed} demo files")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "create"
    if action == "create":
        create_all()
    elif action == "clean":
        clean_all()
    else:
        print(f"Usage: {sys.argv[0]} [create|clean]")
