#!/usr/bin/env python3
"""Generate 35 demo files across 5 themes for CUA desktop organization demo.

Themes (7 files each = 35 total):
  1. Japan Trip — photos, flight booking, itinerary, budget, phrases, checklist
  2. Work Dashboard — wireframe, React code, SQL, notes, metrics, API mock, review
  3. ML Course — curves, confusion matrix, PyTorch, homework, lecture, log, config
  4. Moving — room photos, floor plan, comparison, todo, expenses, inventory
  5. Fitness — gym/meal photos, progress chart, log, meal plan, tracker, routine
"""
import os, sys, random, math, urllib.request
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
PREFIX = "demo_"

def get_font(size):
    for name in ["arial.ttf", "Arial.ttf", "segoeui.ttf", "calibri.ttf"]:
        try: return ImageFont.truetype(name, size)
        except (OSError, IOError): pass
    return ImageFont.load_default()

# ── PIL image generators ─────────────────────────────────────────────────────

def make_flight_booking(path):
    img = Image.new("RGB", (600, 480), "#FFFFFF")
    d = ImageDraw.Draw(img)
    t, b, s = get_font(22), get_font(15), get_font(12)
    d.rectangle([0, 0, 600, 55], fill="#003366")
    d.text((15, 14), "FLIGHT BOOKING CONFIRMATION", fill="white", font=t)
    y = 75
    for lbl, val in [("Airline:", "All Nippon Airways (ANA)"),
                      ("Route:", "SFO -> NRT (San Francisco -> Tokyo Narita)"),
                      ("Date:", "April 12, 2026  Departure 11:35 AM"),
                      ("Passenger:", "Alex Chen"), ("Confirmation:", "ANA-8834921"),
                      ("Class:", "Economy  Seat 24A (Window)"),
                      ("Baggage:", "2 checked bags included")]:
        d.text((25, y), lbl, fill="#666", font=s)
        d.text((150, y), val, fill="black", font=b); y += 38
    d.line([(20, y), (580, y)], fill="#CCC", width=2)
    d.text((25, y+12), "Status: CONFIRMED", fill="#006600", font=t)
    d.text((160, 450), "All Nippon Airways Co., Ltd.", fill="#999", font=s)
    img.save(path, quality=92)

def make_dashboard_wireframe(path):
    img = Image.new("RGB", (800, 600), "#EAECEE")
    d = ImageDraw.Draw(img)
    hd, b, s = get_font(16), get_font(13), get_font(10)
    d.rectangle([0, 0, 155, 600], fill="#2C3E50")
    d.text((15, 12), "ACME Corp", fill="#ECF0F1", font=hd)
    for i, lbl in enumerate(["Dashboard", "Analytics", "Users", "Settings"]):
        y = 55 + i * 38
        if i == 0: d.rectangle([0, y-3, 155, y+28], fill="#34495E")
        d.text((18, y), lbl, fill="white", font=b)
    for i, (lbl, val) in enumerate([("DAU","24,531"),("Revenue","$142K"),("Conv.","3.2%")]):
        x = 175 + i * 200
        d.rectangle([x, 18, x+180, 85], outline="#BDC3C7", width=2, fill="white")
        d.text((x+8, 24), lbl, fill="#7F8C8D", font=s)
        d.text((x+8, 48), val, fill="#2C3E50", font=get_font(20))
    titles = ["Revenue by Region","User Growth","Conversion Funnel","Traffic Sources"]
    for r in range(2):
        for c in range(2):
            x, y = 175 + c * 305, 105 + r * 248
            d.rectangle([x, y, x+285, y+228], outline="#BDC3C7", width=2, fill="white")
            d.text((x+8, y+6), titles[r*2+c], fill="#7F8C8D", font=s)
            for j in range(5):
                bx, bh = x+25+j*50, random.randint(40, 150)
                d.rectangle([bx, y+205-bh, bx+35, y+205], fill="#D5DBDB", outline="#AEB6BF")
    img.save(path, quality=92)

def make_training_curves(path):
    img = Image.new("RGB", (800, 400), "#FFFFFF")
    d = ImageDraw.Draw(img)
    t, b, s = get_font(15), get_font(11), get_font(9)
    d.text((220, 6), "ResNet-18 on CIFAR-10 Training Curves", fill="black", font=t)
    epochs = list(range(20))
    tl = [2.3-1.8*(1-math.exp(-0.25*e)) for e in epochs]
    vl = [2.3-1.5*(1-math.exp(-0.2*e))+0.05*max(0,e-12) for e in epochs]
    ta = [10+82*(1-math.exp(-0.22*e)) for e in epochs]
    va = [10+75*(1-math.exp(-0.18*e))-1.5*max(0,e-14) for e in epochs]
    for si, (label, series, ymn, ymx) in enumerate([
        ("Loss", [(tl,"#2196F3"),(vl,"#F44336")], 0, 2.5),
        ("Accuracy", [(ta,"#2196F3"),(va,"#F44336")], 0, 100)]):
        ox = 55 + si*400
        bx, by, bw, bh = ox, 40, 320, 310
        d.rectangle([bx, by, bx+bw, by+bh], outline="black")
        d.text((bx+130, by+2), label, fill="black", font=b)
        for data, clr in series:
            pts = [(int(bx+(e/19)*bw), int(by+bh-(data[e]-ymn)/(ymx-ymn)*bh)) for e in epochs]
            for i in range(len(pts)-1): d.line([pts[i], pts[i+1]], fill=clr, width=2)
        d.text((bx+bw//2-12, by+bh+4), "Epoch", fill="black", font=s)
    d.line([(65,365),(85,365)], fill="#2196F3", width=2); d.text((90,360), "Train", fill="black", font=s)
    d.line([(130,365),(150,365)], fill="#F44336", width=2); d.text((155,360), "Val", fill="black", font=s)
    img.save(path, quality=92)

def make_confusion_matrix(path):
    classes = ["airplane","auto","bird","cat","deer","dog","frog","horse","ship","truck"]
    cm = []
    for i in range(10):
        row = []
        for j in range(10):
            if i == j: row.append(random.randint(82, 96))
            elif (i,j) in [(3,5),(5,3),(0,8),(8,0),(1,9),(9,1)]: row.append(random.randint(4,9))
            else: row.append(random.randint(0, 3))
        s = sum(row); row = [int(v/s*100) for v in row]; row[i] += 100-sum(row)
        cm.append(row)
    cell, ml, mt = 42, 75, 45
    w, h = ml+10*cell+25, mt+10*cell+55
    img = Image.new("RGB", (w, h), "#FFFFFF")
    d = ImageDraw.Draw(img)
    hd, sm = get_font(13), get_font(8)
    d.text((ml+70, 8), "Confusion Matrix  CIFAR-10", fill="black", font=hd)
    for i in range(10):
        for j in range(10):
            x0, y0 = ml+j*cell, mt+i*cell; v = cm[i][j]
            c = min(255, int(v*2.8))
            d.rectangle([x0,y0,x0+cell,y0+cell], fill=(255-c,255-c//2,255), outline="#CCC")
            d.text((x0+cell//2-len(str(v))*3, y0+cell//2-5), str(v),
                   fill="black" if v<50 else "white", font=sm)
        d.text((3, mt+i*cell+cell//2-5), classes[i][:5], fill="black", font=sm)
        d.text((ml+i*cell+2, mt+10*cell+4), classes[i][:4], fill="black", font=sm)
    d.text((3, mt+5*cell-5), "True", fill="black", font=hd)
    d.text((ml+3*cell, mt+10*cell+22), "Predicted", fill="black", font=hd)
    img.save(path, quality=92)

def make_floor_plan(path):
    img = Image.new("RGB", (700, 530), "#FFFFFF")
    d = ImageDraw.Draw(img)
    hd, b, s = get_font(13), get_font(10), get_font(8)
    d.text((160, 6), "742 Evergreen Terrace  Unit 4B  (850 sqft)", fill="black", font=hd)
    ox, oy = 50, 35
    d.rectangle([ox, oy, ox+600, oy+460], outline="black", width=3)
    for label, rx, ry, rw, rh in [
        ("Living Room\n15'x12'", ox, oy, 300, 240), ("Kitchen\n10'x12'", ox+300, oy, 300, 195),
        ("Bedroom 1\n12'x11'", ox, oy+240, 245, 220), ("Bedroom 2\n10'x11'", ox+245, oy+240, 205, 220),
        ("Bath\n8'x6'", ox+450, oy+195, 150, 140), ("Closet\n5'x6'", ox+450, oy+335, 150, 125)]:
        d.rectangle([rx, ry, rx+rw, ry+rh], outline="black", width=2)
        lines = label.split("\n")
        d.text((rx+rw//2-28, ry+rh//2-12), lines[0], fill="black", font=b)
        if len(lines) > 1: d.text((rx+rw//2-18, ry+rh//2+6), lines[1], fill="#666", font=s)
    for dx, dy, r, sa, ea in [(ox+215,oy+240,28,270,360),(ox+300,oy+155,24,0,90),
                                (ox+175,oy+460,24,180,270),(ox+375,oy+460,24,180,270),
                                (ox+450,oy+265,20,270,360)]:
        d.arc([dx-r, dy-r, dx+r, dy+r], sa, ea, fill="black", width=1)
    img.save(path, quality=92)

def make_progress_chart(path):
    img = Image.new("RGB", (800, 440), "#FFFFFF")
    d = ImageDraw.Draw(img)
    t, b, s = get_font(15), get_font(11), get_font(9)
    d.text((210, 8), "12-Week Body Recomposition Progress", fill="black", font=t)
    lx, ty, rx, by_ = 65, 45, 730, 380
    d.rectangle([lx, ty, rx, by_], outline="#CCC")
    wks = list(range(1, 13))
    wt = [184,183.2,182.5,181.8,181,180.2,179.8,179.1,178.5,178,177.4,177]
    bf = [21.5,21.2,20.8,20.5,20.1,19.7,19.4,19.0,18.8,18.5,18.3,18.2]
    def wx(w):   return int(lx+(w-1)/11*(rx-lx))
    def wy_w(v): return int(ty+(185-v)/10*(by_-ty))
    def wy_b(v): return int(ty+(22-v)/5*(by_-ty))
    for v in [175,177,179,181,183,185]:
        y=wy_w(v); d.line([(lx,y),(rx,y)], fill="#F0F0F0"); d.text((lx-28,y-5), str(v), fill="#2196F3", font=s)
    for v in [17,18,19,20,21,22]: d.text((rx+4, wy_b(v)-5), f"{v}%", fill="#F44336", font=s)
    for i in range(11):
        d.line([(wx(wks[i]),wy_w(wt[i])),(wx(wks[i+1]),wy_w(wt[i+1]))], fill="#2196F3", width=3)
        d.line([(wx(wks[i]),wy_b(bf[i])),(wx(wks[i+1]),wy_b(bf[i+1]))], fill="#F44336", width=3)
    for i,w in enumerate(wks):
        d.ellipse([wx(w)-4,wy_w(wt[i])-4,wx(w)+4,wy_w(wt[i])+4], fill="#1976D2")
        d.ellipse([wx(w)-4,wy_b(bf[i])-4,wx(w)+4,wy_b(bf[i])+4], fill="#D32F2F")
    for sx in range(lx, rx, 10):
        d.line([(sx,wy_w(177)),(min(sx+5,rx),wy_w(177))], fill="#90CAF9")
        d.line([(sx,wy_b(18)),(min(sx+5,rx),wy_b(18))], fill="#EF9A9A")
    d.text((lx-5,ty-14), "lbs", fill="#2196F3", font=b)
    d.text((rx+2,ty-14), "BF%", fill="#F44336", font=b)
    for w in wks: d.text((wx(w)-6, by_+4), f"W{w}", fill="black", font=s)
    d.line([(lx+15,by_+22),(lx+40,by_+22)], fill="#2196F3", width=3)
    d.text((lx+45,by_+17), "Weight", fill="black", font=s)
    d.line([(lx+100,by_+22),(lx+125,by_+22)], fill="#F44336", width=3)
    d.text((lx+130,by_+17), "Body Fat", fill="black", font=s)
    img.save(path, quality=92)

# ── Pexels downloads ────────────────────────────────────────────────────────

PEXELS_URLS = {
    "japan_shrine": "https://images.pexels.com/photos/161401/fushimi-inari-taisha-shrine-kyoto-japan-temple-161401.jpeg?auto=compress&cs=tinysrgb&w=800",
    "japan_cherry": "https://images.pexels.com/photos/884600/pexels-photo-884600.jpeg?auto=compress&cs=tinysrgb&w=800",
    "apt_room":     "https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg?auto=compress&cs=tinysrgb&w=800",
    "apt_kitchen":  "https://images.pexels.com/photos/2724749/pexels-photo-2724749.jpeg?auto=compress&cs=tinysrgb&w=800",
    "gym":          "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&w=800",
    "meal_prep":    "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800",
}
PEXELS_FILES = {
    "japan_shrine": "IMG_4721.jpg", "japan_cherry": "IMG_4856.jpg",
    "apt_room": "IMG_5102.jpg", "apt_kitchen": "IMG_5118.jpg",
    "gym": "IMG_5234.jpg", "meal_prep": "IMG_5301.jpg",
}

def download_photo(key, filepath):
    url = PEXELS_URLS.get(key)
    if not url: return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=15).read()
        with open(filepath, "wb") as f: f.write(data)
        return True
    except Exception as e:
        print(f"  WARNING: download failed {key}: {e}", file=sys.stderr)
        return False

# ── Text / code / data content ──────────────────────────────────────────────

TEXT_FILES = {
    # ── Theme 1: Japan Trip ──
    "japan_booking": {"name": "screenshot_0315.png", "pil": make_flight_booking},
    "japan_itinerary": {"name": "notes_0318.txt", "content": """\
Tokyo & Kyoto Trip — 5-Day Itinerary
=====================================
Dates: April 12-17, 2026 | Traveler: Alex Chen

Day 1 (Apr 12) — Arrive Tokyo
  Land NRT 3:40 PM, Narita Express to Shinjuku
  Check in Airbnb, evening yakitori at Omoide Yokocho

Day 2 (Apr 13) — Tokyo Highlights
  Morning: Tsukiji Outer Market sushi breakfast
  Afternoon: teamLab Borderless, Odaiba
  Evening: Shibuya crossing + Shibuya Sky observation

Day 3 (Apr 14) — Tokyo Culture
  Meiji Shrine + Harajuku, Akihabara, Shinjuku Gyoen cherry blossoms

Day 4 (Apr 15) — Shinkansen to Kyoto
  JR Pass Nozomi (2h14m), Fushimi Inari full hike, Gion kaiseki dinner

Day 5 (Apr 16) — Kyoto Temples
  Kinkaku-ji, Arashiyama bamboo grove, Nishiki Market souvenirs

Day 6 (Apr 17) — Return via KIX, depart 4:10 PM
"""},
    "japan_budget": {"name": "budget_v2.csv", "content": """\
Category,Item,Cost USD,Notes
Flights,SFO-NRT Round Trip (ANA),1285,Economy window seat
Transport,JR Pass 7-Day,274,Covers Shinkansen + local JR
Transport,Narita Express RT,62,Airport to Shinjuku
Lodging,Tokyo Airbnb 3 nights,390,Shinjuku studio
Lodging,Kyoto Ryokan 2 nights,520,Traditional with onsen
Food,Budget per day x6,480,Estimate 80/day
Activities,teamLab + Shibuya Sky + temples,75,Book online
Shopping,Souvenirs + misc,200,Estimated
Insurance,Travel insurance,89,World Nomads
Total,,3375,Under 3500 budget
"""},
    "japan_phrases": {"name": "phrases.txt", "content": """\
Essential Japanese Phrases for Travel
======================================

GREETINGS: Konnichiwa (Hello) | Arigatou gozaimasu (Thank you)
  Sumimasen (Excuse me) | Ohayou gozaimasu (Good morning)

RESTAURANT: Sumimasen! (call waiter) | Kore o kudasai (This one please)
  Okanjo onegaishimasu (Check please) | Oishii desu! (Delicious!)

DIRECTIONS: ___ wa doko desu ka? (Where is ___?)
  Eki (station) | Migi/Hidari (Right/Left) | Massugu (Straight)

EMERGENCY: Tasukete! (Help!) | Byouin wa doko? (Hospital?)
  Police: 110 | Fire/Ambulance: 119

NUMBERS: 1-ichi 2-ni 3-san 4-yon 5-go 6-roku 7-nana 8-hachi 9-kyuu 10-juu
"""},
    "japan_checklist": {"name": "checklist.md", "content": """\
# Pre-Departure Checklist — Japan Trip

## Documents
- [x] Passport (valid through Oct 2027)
- [x] Flight confirmation (ANA-8834921)
- [x] JR Pass exchange voucher
- [ ] Travel insurance card

## Packing
- [ ] Voltage adapter (Japan Type A, 100V)
- [ ] Portable WiFi (pick up at NRT)
- [ ] Comfortable walking shoes (15K+ steps/day)

## Apps to Install
- [ ] Google Translate (Japanese offline)
- [ ] Suica/PASMO (IC card for trains)
- [ ] Google Maps (Tokyo + Kyoto offline)

## Money
- [ ] Notify bank of travel dates
- [ ] Get 30,000 yen cash (many places cash-only)
"""},

    # ── Theme 2: Work Dashboard Refactor ──
    "dash_wireframe": {"name": "wireframe_02.png", "pil": make_dashboard_wireframe},
    "dash_app": {"name": "app_v3.js", "content": """\
import React, { useState, useEffect } from 'react';
import { Card, Title, BarChart, LineChart } from '@tremor/react';

const API = '/api/v2/dashboard';

export default function AnalyticsDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [range, setRange] = useState('7d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/metrics?range=${range}`)
      .then(r => r.json())
      .then(d => { setMetrics(d); setLoading(false); });
  }, [range]);

  if (loading) return <div className="animate-pulse h-96" />;
  return (
    <div className="p-6 space-y-6">
      <Title>Analytics Dashboard</Title>
      <div className="grid grid-cols-3 gap-4">
        {metrics.kpis.map(k => (
          <Card key={k.name}>
            <p className="text-sm text-gray-500">{k.name}</p>
            <p className="text-2xl font-bold">{k.value}</p>
            <p className={k.delta > 0 ? 'text-green-600' : 'text-red-600'}>
              {k.delta > 0 ? '+' : ''}{k.delta}%</p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Card><Title>Revenue by Region</Title>
          <BarChart data={metrics.revenueByRegion} index="region" categories={["revenue"]} />
        </Card>
        <Card><Title>Daily Active Users</Title>
          <LineChart data={metrics.dauTimeseries} index="date" categories={["dau"]} />
        </Card>
      </div>
    </div>
  );
}
"""},
    "dash_sql": {"name": "query_final.sql", "content": """\
-- Dashboard KPI Queries (PostgreSQL)
-- Used by: /api/v2/dashboard/metrics

-- 1. Daily Active Users (DAU) last 30 days
SELECT date_trunc('day', event_ts) AS day, COUNT(DISTINCT user_id) AS dau
  FROM events WHERE event_ts >= NOW() - INTERVAL '30 days'
  AND event_type IN ('page_view','click','api_call')
  GROUP BY 1 ORDER BY 1;

-- 2. Revenue by Region, current quarter
SELECT r.region_name AS region, SUM(o.total_amount) AS revenue,
       COUNT(DISTINCT o.user_id) AS customers
  FROM orders o JOIN users u ON u.id=o.user_id JOIN regions r ON r.id=u.region_id
  WHERE o.created_at >= date_trunc('quarter', NOW()) AND o.status='completed'
  GROUP BY 1 ORDER BY revenue DESC;

-- 3. Conversion Funnel last 7 days
WITH funnel AS (
  SELECT 'visit' AS step, COUNT(DISTINCT session_id) AS n FROM events WHERE event_ts>=NOW()-'7d'::interval
  UNION ALL SELECT 'signup', COUNT(DISTINCT user_id) FROM signups WHERE created_at>=NOW()-'7d'::interval
  UNION ALL SELECT 'purchase', COUNT(DISTINCT user_id) FROM orders WHERE created_at>=NOW()-'7d'::interval
) SELECT step, n FROM funnel;
"""},
    "dash_meeting": {"name": "meeting_notes_0320.txt", "content": """\
Sprint Planning — Dashboard Refactor
=====================================
Date: March 20, 2026 | Team: Frontend Platform
Attendees: Sarah (PM), James, Priya, Marcus, Lin

CONTEXT: Dashboard loads in 4.2s (target <2s). Bundle 1.8MB.
Migrating class components + Redux to hooks + React Query.

SPRINT GOALS (2 weeks):
1. Migrate KPI cards to React Query (James, 3pts)
2. Lazy-load chart components with dynamic imports (Priya, 5pts)
3. Redis cache for /metrics endpoint, TTL 60s (Marcus, 5pts)
4. Replace Recharts with Tremor — 40% smaller bundle (Lin, 3pts)

RISKS: Tremor lacks funnel chart (may need custom), cache invalidation timing
NEXT SYNC: March 27 (demo — show before/after load times)
"""},
    "dash_metrics": {"name": "metrics_q1.csv", "content": """\
Week,Page Load (ms),API Latency (ms),DAU,Bundle Size (KB),Error Rate (%)
W1 (Jan 6),4200,380,22100,1842,0.8
W3 (Jan 20),3900,360,22800,1790,0.6
W5 (Feb 3),3600,340,23400,1720,0.5
W7 (Feb 17),3200,310,24100,1680,0.4
W9 (Mar 3),2800,280,24500,1600,0.3
W11 (Mar 17),2400,250,24900,1540,0.2
W12 (Mar 24),2200,240,25100,1510,0.2
"""},
    "dash_response": {"name": "response_sample.json", "content": """\
{
  "status": "ok",
  "generated_at": "2026-03-20T14:32:01Z",
  "data": {
    "kpis": [
      {"name": "DAU", "value": "24,531", "delta": 5.2},
      {"name": "Revenue", "value": "$142,380", "delta": 12.8},
      {"name": "Conversion Rate", "value": "3.2%", "delta": -0.3}
    ],
    "revenueByRegion": [
      {"region": "North America", "revenue": 58200},
      {"region": "Europe", "revenue": 41500},
      {"region": "Asia Pacific", "revenue": 28900},
      {"region": "Latin America", "revenue": 13780}
    ],
    "dauTimeseries": [
      {"date": "2026-03-14", "dau": 23800}, {"date": "2026-03-15", "dau": 24100},
      {"date": "2026-03-16", "dau": 21500}, {"date": "2026-03-17", "dau": 24350},
      {"date": "2026-03-18", "dau": 24800}, {"date": "2026-03-20", "dau": 24531}
    ]
  }
}
"""},
    "dash_review": {"name": "review_comments.md", "content": """\
# Code Review — PR #347: Dashboard Hooks Migration
**Reviewer:** Sarah L. | **Author:** James K.

## Comments

### `KPICard.tsx` L24-31
`useQuery` staleTime should be 60s (match pipeline refresh), not 30s.

### `useDashboardMetrics.ts` L15
Missing error boundary. API 500 crashes entire dashboard.
Add `useErrorBoundary: false` and handle gracefully.

### `RevenueChart.tsx` L42
Tremor v3 color API changed: use `colors={["blue-500"]}` not `"blue"`.

### Testing
No integration test for cache invalidation flow. Please add one.

**Verdict: Request Changes** (2 blocking, 1 nit)
"""},

    # ── Theme 3: ML Course ──
    "ml_curves":    {"name": "plot_results.png", "pil": make_training_curves},
    "ml_confusion": {"name": "confusion_mtx.png", "pil": make_confusion_matrix},
    "ml_train": {"name": "train_v2.py", "content": """\
#!/usr/bin/env python3
\"\"\"CS229 HW4 — ResNet-18 on CIFAR-10 (PyTorch).\"\"\"
import torch, torch.nn as nn, torch.optim as optim
import torchvision, torchvision.transforms as T
from torch.utils.data import DataLoader
import csv

BATCH, EPOCHS, LR = 128, 20, 0.01
DEV = 'cuda' if torch.cuda.is_available() else 'cpu'

def get_loaders():
    tr = T.Compose([T.RandomCrop(32,4), T.RandomHorizontalFlip(), T.ToTensor(),
         T.Normalize((0.4914,0.4822,0.4465),(0.247,0.243,0.262))])
    te = T.Compose([T.ToTensor(), T.Normalize((0.4914,0.4822,0.4465),(0.247,0.243,0.262))])
    return (DataLoader(torchvision.datasets.CIFAR10('./data',True,download=True,transform=tr), BATCH, shuffle=True),
            DataLoader(torchvision.datasets.CIFAR10('./data',False,transform=te), BATCH))

def train():
    tl, vl = get_loaders()
    model = torchvision.models.resnet18(num_classes=10).to(DEV)
    crit = nn.CrossEntropyLoss()
    opt = optim.SGD(model.parameters(), lr=LR, momentum=0.9, weight_decay=5e-4)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
    for ep in range(1, EPOCHS+1):
        model.train(); loss_sum, cor, tot = 0, 0, 0
        for X, y in tl:
            X, y = X.to(DEV), y.to(DEV)
            out = model(X); loss = crit(out, y)
            opt.zero_grad(); loss.backward(); opt.step()
            loss_sum += loss.item()*y.size(0); cor += (out.argmax(1)==y).sum().item(); tot += y.size(0)
        model.eval(); vl_sum, vc, vt = 0, 0, 0
        with torch.no_grad():
            for X, y in vl:
                X, y = X.to(DEV), y.to(DEV); out = model(X)
                vl_sum += crit(out,y).item()*y.size(0); vc += (out.argmax(1)==y).sum().item(); vt += y.size(0)
        sched.step()
        print(f'Epoch {ep:02d} train_loss={loss_sum/tot:.4f} val_acc={vc/vt:.4f}')
    torch.save(model.state_dict(), 'resnet18_cifar10.pt')

if __name__ == '__main__': train()
"""},
    "ml_homework": {"name": "homework3.py", "content": """\
#!/usr/bin/env python3
\"\"\"CS229 HW3 — Logistic Regression from Scratch (numpy only).

Q1: Why cross-entropy over MSE for classification?
A1: Stronger gradients when wrong, avoids sigmoid plateau.
Q2: Effect of increasing regularization lambda?
A2: Simpler boundary, less overfit, weights shrink toward zero.
\"\"\"
import numpy as np

def sigmoid(z): return 1.0 / (1.0 + np.exp(-np.clip(z, -500, 500)))

def compute_loss(X, y, w, b, lam=0.01):
    h = sigmoid(X @ w + b)
    ce = -np.mean(y*np.log(h+1e-8) + (1-y)*np.log(1-h+1e-8))
    return ce + (lam/(2*len(y)))*np.sum(w**2)

def train_logistic(X, y, lr=0.1, epochs=500, lam=0.01):
    m, n = X.shape; w, b = np.zeros(n), 0.0
    for ep in range(epochs):
        h = sigmoid(X @ w + b)
        w -= lr * ((1/m)*(X.T @ (h-y)) + (lam/m)*w)
        b -= lr * (1/m)*np.sum(h-y)
        if ep % 100 == 0:
            print(f'  Epoch {ep:4d} loss={compute_loss(X,y,w,b,lam):.4f}')
    return w, b

if __name__ == '__main__':
    np.random.seed(42); X = np.random.randn(200,3)
    y = (X[:,0]+0.5*X[:,1]-X[:,2] > 0).astype(float)
    w, b = train_logistic(X, y)
    print(f'Accuracy: {np.mean((sigmoid(X@w+b)>=0.5)==y):.3f}')
"""},
    "ml_lecture": {"name": "lecture_0312.txt", "content": """\
CS229 — Lecture 18: Convolutional Neural Networks
===================================================
Date: March 12, 2026 | Prof. Andrew Chen

CONVOLUTION: Slide kernel across image, element-wise multiply + sum.
  Key params: kernel size (3x3), stride, padding.
  Each filter learns one feature (edge, corner, texture).

POOLING: Max pooling 2x2 reduces spatial dims by 2x.
  Provides translation invariance, keeps strongest activations.

KEY ARCHITECTURES:
  LeNet-5 (1998): first practical CNN for digits
  AlexNet (2012): ReLU, dropout, ImageNet winner
  VGG-16 (2014): all 3x3 convs, 138M params
  ResNet (2015): skip connections, trains 50-152 layers deep
    Key insight: learn residual F(x) = H(x) - x

HOMEWORK 4 — Due March 26:
  Train ResNet-18 on CIFAR-10, achieve >90% val accuracy
  Must use cosine annealing LR schedule
  Deliverables: script, loss/accuracy plots, confusion matrix
  Bonus: compare with/without augmentation (+5 pts)
"""},
    "ml_dataset": {"name": "dataset_clean.csv", "content": """\
epoch,train_loss,val_loss,train_acc,val_acc,lr
1,2.1847,1.9231,0.2145,0.2890,0.0100
3,1.4218,1.3067,0.4821,0.5312,0.0095
5,1.0124,0.9834,0.6412,0.6589,0.0084
7,0.7645,0.8102,0.7312,0.7245,0.0065
9,0.5934,0.7123,0.7923,0.7689,0.0045
11,0.4712,0.6612,0.8345,0.7945,0.0025
13,0.3856,0.6478,0.8645,0.8067,0.0012
15,0.3234,0.6434,0.8845,0.8112,0.0004
17,0.2945,0.6425,0.8934,0.8128,0.0001
20,0.2856,0.6424,0.8967,0.8131,0.0000
"""},
    "ml_config": {"name": "config.json", "content": """\
{
  "experiment": "CS229_HW4_ResNet18_CIFAR10",
  "model": {"architecture": "resnet18", "num_classes": 10, "pretrained": false},
  "dataset": {"name": "cifar10", "classes": ["airplane","automobile","bird","cat","deer","dog","frog","horse","ship","truck"]},
  "training": {"batch_size": 128, "epochs": 20, "optimizer": "sgd", "lr": 0.01, "momentum": 0.9, "weight_decay": 5e-4, "scheduler": "cosine_annealing"},
  "augmentation": {"random_crop": {"size": 32, "padding": 4}, "horizontal_flip": true, "normalize": {"mean": [0.4914,0.4822,0.4465], "std": [0.247,0.243,0.262]}},
  "hardware": {"device": "cuda", "num_workers": 2}
}
"""},

    # ── Theme 4: Moving / Apartment ──
    "apt_floorplan": {"name": "floorplan_v2.png", "pil": make_floor_plan},
    "apt_comparison": {"name": "comparison.csv", "content": """\
Address,Rent,Sqft,Bed,Commute,Laundry,Parking,Pets,Rating
742 Evergreen Terr 4B,2150,850,2,25 bus,In-unit,Street,Cats OK,4.2
1850 Pacific Ave #12,2400,780,2,15 walk,Basement,Garage $150,No pets,3.8
3301 Mission St #8,1950,720,1,20 BART,In-unit,None,Dogs <25lb,4.0
455 Hyde St #3A,2300,810,2,10 walk,Shared,None,Cats OK,3.5
920 Folsom St #15,2600,900,2,12 bike,In-unit,Garage incl,Any pet,4.5
"""},
    "apt_todo": {"name": "todo_list.txt", "content": """\
Moving Checklist — Apartment Transition
=========================================

8 WEEKS BEFORE:
  [ ] Give 30-day written notice to landlord
  [ ] Start decluttering, get 3 moving quotes
  [ ] Collect boxes (liquor stores have sturdy ones)

4 WEEKS BEFORE:
  [ ] Book movers (Bay Area Movers, $850)
  [ ] USPS mail forwarding, transfer utilities
  [ ] Notify bank, employer, insurance, subscriptions
  [ ] Start packing non-essentials

1 WEEK BEFORE:
  [ ] Pack kitchen, disassemble furniture
  [ ] Confirm movers, clean current place
  [ ] Take photos for deposit return

MOVING DAY:
  [ ] Final walkthrough, supervise movers, hand over keys

AFTER: Unpack essentials, update driver's license, meet neighbors
"""},
    "apt_expenses": {"name": "expenses.json", "content": """\
{
  "move_date": "2026-04-15",
  "to": "742 Evergreen Terrace, Unit 4B",
  "one_time": {
    "security_deposit": 2150, "first_month": 2150, "last_month": 2150,
    "movers": 850, "cleaning": 200, "new_locks": 75,
    "furniture": {"desk": 280, "bookshelf": 120, "curtains": 95}
  },
  "monthly": {
    "rent": 2150, "electricity": 65, "internet": 55,
    "water_trash": 40, "renters_insurance": 18, "total": 2328
  },
  "total_upfront": 8070,
  "notes": "Old deposit refund ~$1800 within 21 days"
}
"""},
    "apt_inventory": {"name": "inventory.md", "content": """\
# Moving Box Inventory

## Kitchen (Boxes 1-6)
- **1**: Plates, bowls, mugs (wrapped) FRAGILE
- **2**: Pots, pans, baking sheets
- **3**: Utensils, knives (in sleeve)
- **4**: Small appliances (toaster, blender, coffee maker)
- **5**: Pantry (spices, canned goods)
- **6**: Glasses + wine glasses (bubble wrap) FRAGILE

## Living Room (7-10)
- **7**: Books (heavy, small box)  **8**: Games, media, cables
- **9**: Pillows, blankets  **10**: Framed photos, wall art FRAGILE

## Bedrooms (11-16)
- **11-12**: Clothes + shoes  **13**: Bedding  **14**: Dresser contents
- **15**: Monitor + peripherals  **16**: Office supplies, files

## Bathroom (17-18)
- **17**: Toiletries, towels  **18**: Medicine, cleaning supplies

**Total: 18 boxes + 3 furniture pieces (disassembled)**
"""},

    # ── Theme 5: Fitness Plan ──
    "fit_progress": {"name": "progress_chart.png", "pil": make_progress_chart},
    "fit_log": {"name": "log_march.csv", "content": """\
Date,Day,Type,Exercise,Sets,Reps,Weight (lbs),Notes
2026-03-01,Sat,Push,Bench Press,4,8,185,Felt strong
2026-03-01,Sat,Push,Incline DB Press,3,10,60,Per hand
2026-03-01,Sat,Push,OHP,3,8,115,
2026-03-01,Sat,Push,Lateral Raises,3,15,20,
2026-03-03,Mon,Pull,Deadlift,4,5,315,PR!
2026-03-03,Mon,Pull,Barbell Rows,4,8,155,
2026-03-03,Mon,Pull,Pull-ups,3,10,BW,
2026-03-03,Mon,Pull,Barbell Curls,3,10,75,
2026-03-05,Wed,Legs,Squat,4,6,265,Depth solid
2026-03-05,Wed,Legs,Romanian DL,3,10,185,
2026-03-05,Wed,Legs,Leg Press,3,12,360,
2026-03-05,Wed,Legs,Calf Raises,4,15,180,
2026-03-07,Fri,Push,Bench Press,4,8,190,+5 lbs
"""},
    "fit_meal": {"name": "meal_plan.txt", "content": """\
Cutting Phase Meal Plan — 12-Week Program
==========================================
Goal: 2200 cal/day | 180g protein, 200g carbs, 75g fat
Start 184 lbs -> Target 177 lbs | -500 cal deficit

MEAL 1 (7AM Pre-workout):
  Oatmeal 1cup + whey scoop + banana = 525 cal, 35g P

MEAL 2 (10AM Post-workout):
  Chicken breast 6oz + brown rice 1cup + broccoli = 545 cal, 61g P

MEAL 3 (1PM):
  Turkey wrap (whole wheat) + Greek yogurt = 510 cal, 57g P

MEAL 4 (4PM):
  Protein shake + almonds 1oz = 325 cal, 34g P

MEAL 5 (7PM):
  Salmon 5oz + sweet potato + mixed greens = 450 cal, 38g P

SUPPLEMENTS: Creatine 5g daily, Fish oil 2 caps, Vit D3 2000IU, Mag 400mg
"""},
    "fit_tracker": {"name": "tracker.json", "content": """\
{
  "program": "12-Week Body Recomposition",
  "start": "2026-01-06",
  "target": {"weight": 177, "bf_pct": 18.0, "bench_1rm": 225},
  "log": [
    {"wk":1,"wt":184.0,"bf":21.5,"bench":195,"squat":255,"dl":305},
    {"wk":3,"wt":182.5,"bf":20.8,"bench":200,"squat":260,"dl":310},
    {"wk":5,"wt":181.0,"bf":20.1,"bench":205,"squat":265,"dl":315},
    {"wk":7,"wt":179.8,"bf":19.4,"bench":210,"squat":270,"dl":320},
    {"wk":9,"wt":178.5,"bf":18.8,"bench":215,"squat":275,"dl":325},
    {"wk":11,"wt":177.4,"bf":18.3,"bench":220,"squat":280,"dl":335},
    {"wk":12,"wt":177.0,"bf":18.2,"bench":220,"squat":280,"dl":335}
  ],
  "notes": "On track. Strength maintained despite deficit. Deload week 13."
}
"""},
    "fit_routine": {"name": "routine.py", "content": """\
#!/usr/bin/env python3
\"\"\"Workout schedule generator — Push/Pull/Legs split.\"\"\"
from datetime import date, timedelta

SPLIT = {
    "Push": [("Bench Press",4,8),("Incline DB Press",3,10),("OHP",3,8),
             ("Cable Flyes",3,12),("Lateral Raises",3,15),("Tricep Pushdowns",3,12)],
    "Pull": [("Deadlift",4,5),("Barbell Rows",4,8),("Pull-ups",3,10),
             ("Face Pulls",3,15),("Barbell Curls",3,10),("Hammer Curls",3,12)],
    "Legs": [("Squat",4,6),("Romanian DL",3,10),("Leg Press",3,12),
             ("Walking Lunges",3,12),("Calf Raises",4,15),("Leg Curls",3,12)],
}
PATTERN = ["Push","Pull","Legs","Rest","Push","Pull","Rest"]

def generate(start=None, weeks=4, overload=2.5):
    start = start or date.today()
    print(f"{'='*50}")
    print(f"  {weeks}-Week PPL Schedule (start {start}, +{overload}%/wk)")
    print(f"{'='*50}")
    for w in range(weeks):
        mult = 1 + (overload/100)*w
        print(f"\\n--- Week {w+1} (x{mult:.2f}) ---")
        for d, dtype in enumerate(PATTERN):
            day = start + timedelta(weeks=w, days=d)
            if dtype == "Rest": print(f"  {day} REST"); continue
            print(f"  {day} {dtype}")
            for name, sets, reps in SPLIT[dtype]:
                print(f"    {name:<20s} {sets}x{reps}")

if __name__ == "__main__": generate()
"""},
}

# ── Create / Clean ───────────────────────────────────────────────────────────

def create_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    os.makedirs(output_dir, exist_ok=True)
    created = 0
    print("Downloading photos from Pexels...")
    for key, basename in PEXELS_FILES.items():
        fpath = os.path.join(output_dir, prefix + basename)
        if download_photo(key, fpath):
            print(f"  {prefix}{basename} OK"); created += 1
        else:
            print(f"  {prefix}{basename} FAILED (skipped)")
    print("Generating files...")
    for key, info in TEXT_FILES.items():
        fname = prefix + info["name"]
        fpath = os.path.join(output_dir, fname)
        if "pil" in info:
            info["pil"](fpath); print(f"  {fname} (PIL)")
        elif "content" in info:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(info["content"])
            print(f"  {fname}")
        created += 1
    print(f"\nCreated {created} files in {output_dir}")
    return created

def clean_all(output_dir=OUTPUT_DIR, prefix=PREFIX):
    exts = (".jpg",".png",".txt",".csv",".json",".py",".js",".sql",".md",".html")
    removed = 0
    for f in os.listdir(output_dir):
        fp = os.path.join(output_dir, f)
        if os.path.isfile(fp) and f.startswith(prefix) and f.endswith(exts):
            os.remove(fp); removed += 1
    for d in os.listdir(output_dir):
        dp = os.path.join(output_dir, d)
        if not os.path.isdir(dp): continue
        for f in os.listdir(dp):
            fp = os.path.join(dp, f)
            if os.path.isfile(fp) and f.startswith(prefix) and f.endswith(exts):
                os.remove(fp); removed += 1
        try:
            if not os.listdir(dp): os.rmdir(dp)
        except OSError: pass
    print(f"Removed {removed} demo files")
    return removed

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "create"
    if action == "create": create_all()
    elif action == "clean": clean_all()
    else: print(f"Usage: {sys.argv[0]} [create|clean]")
