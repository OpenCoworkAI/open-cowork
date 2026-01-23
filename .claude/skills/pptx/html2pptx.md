# HTML to PowerPoint Guide

Convert HTML slides to PowerPoint presentations with accurate positioning using the `html2pptx.js` library.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Creating HTML Slides](#creating-html-slides)
3. [Using the @ant/html2pptx Library](#using-the-html2pptx-library)
4. [Using PptxGenJS](#using-pptxgenjs)

---

## ⚠️ Prerequisites Check

Extract the html2pptx library next to your script before proceeding:

```bash
# Extract the library to a html2pptx subdirectory
mkdir -p html2pptx && tar -xzf skills/pptx/html2pptx.tgz -C html2pptx
```

This creates a `html2pptx/` directory with the library files and CLI binaries. Then use `require("./html2pptx")` in your script.

---

### Design Philosophy

**CRITICAL**: Before writing any code, commit to a BOLD aesthetic direction that serves the content and audience. PowerPoint presentations are experienced in moments - make those moments memorable.

**Remember: Claude is capable of extraordinary creative work.** Don't hold back. Show what can truly be created when thinking outside the box and committing fully to a distinctive vision. These are not "just slides" - they're opportunities for visual storytelling.

#### Think First: Purpose and Differentiation

- **What problem does this solve?** Who is the audience and what do they need to remember?
- **What's the one unforgettable thing?** Not "professional slides" but something specific - a color choice, a spatial pattern, a typographic voice, a striking visual diagram
- **Pick an aesthetic tone**: Here are some examples. You don't need to pick one of these exactly, but use these as inspiration for the kind of exceptional work Claude is capable of:
  - **Brutally minimal**: Maximum whitespace, one element per slide, precision typography
  - **Editorial/magazine**: Multi-column layouts, dramatic type scale, photojournalistic feel
  - **Retro-futuristic**: Geometric shapes, bold colors, space-age optimism
  - **Luxury/refined**: Muted metallics, serif elegance, generous breathing room
  - **Industrial/utilitarian**: Monospace fonts, grid structures, no-nonsense clarity
  - **Art deco/geometric**: Strong lines, symmetry, decorative patterns, gold accents
  - **Organic/natural**: Earthy tones, flowing shapes, textured backgrounds
  - **Brutalist/raw**: Harsh contrasts, exposed structure, intentional roughness
- **Context matters**: A healthcare startup pitch looks different from a quarterly finance review, which looks different from a design portfolio showcase

#### Taking Aesthetic Risks

**CRITICAL: Every presentation must make at least ONE bold, unexpected design choice.** Safe, predictable designs are forgettable. Push boundaries.

**Risk-taking examples** (every presentation should have something distinctive about it):
- **Extreme typography**: 120pt headlines, rotated text at 90°, all-caps with 20px letter-spacing, mixing serif headers with sans-serif body
- **Unexpected colors**: Burgundy and gold instead of blue, coral and teal, black backgrounds with bright accents, monochrome with single pop color
- **Spatial surprises**: Asymmetric 30/70 splits, diagonal section dividers, overlapping shapes, text positioned at slide edges, breaking the grid
- **Visual personality**: Thick single-side borders (15px), L-shaped corner accents, geometric patterns as backgrounds, color blocking 50% of the slide
- **Layout boldness**: Full-bleed color backgrounds, sidebar layouts, magazine-style multi-column, floating text boxes over shapes

**What makes presentations forgettable** (NEVER do this):
- Generic "AI slop" aesthetics: default gradients, centered everything, no distinctive choices
- Timid, evenly-distributed color palettes with no hierarchy or dominance
- Cookie-cutter designs that could work for any topic
- Converging on the same safe choices across all presentations

**Requirements**:

- ✅ State your content-informed design approach BEFORE writing code
- ✅ Use web-safe fonts only (see Critical Text Rules section for complete list)
- ✅ Create clear visual hierarchy through size, weight, and color
- ✅ Ensure readability: strong contrast, appropriately sized text, clean alignment
- ✅ Be consistent: repeat patterns, spacing, and visual language across slides

#### Spacing, Sizing, and Information Density

**Master these ratios to create balanced, readable layouts that maximize content without crowding.**

##### The 4px Base Unit System

Use multiples of 4px for all spacing decisions. This creates visual rhythm:
- **4px** - Tight: between related lines of text
- **8px** - Compact: between elements within a group
- **12px** - Standard: between distinct content blocks
- **16px** - Comfortable: section padding
- **20px** - Generous: major separations, slide margins

**Apply consistently**: If gaps between cards are 12px, gaps between all cards should be 12px. Inconsistent spacing looks unfinished.

##### Font Size Hierarchy for Dense Slides

When packing information, use this aggressive scale:
```
Title:           32-40px (one size, prominent)
Section headers: 13-15px (small but bold)
Body text:       11-13px (readable at this size)
Supporting text: 10-11px (fine print, lists)
Footnotes:       10px (minimal footprint)
```

**Rule**: Each level should be ~2-3px smaller than the previous. Bigger jumps (e.g., 36px → 11px) work when there's clear visual separation (containers, color).

##### Container Padding Rules

Match padding to content density:
```
Dense information boxes:  12-14px padding
Standard content cards:   14-16px padding
Spacious hero sections:   20-24px padding
```

**Internal margin pattern**: For text within containers:
```css
margin: 0 0 4px 0;   /* Tight: lines within a paragraph */
margin: 0 0 6px 0;   /* Compact: list items */
margin: 0 0 8px 0;   /* Standard: between paragraphs */
margin: 0 0 10px 0;  /* Separated: section header to content */
```

##### Gap vs Padding Decision Tree

- **Gap** (between siblings): Use for spacing between cards, columns, list items
- **Padding** (inside containers): Use for breathing room within a box

```html
<!-- Correct: gap for sibling spacing -->
<div class="col" style="gap: 12px;">
  <div style="padding: 14px;">Box 1</div>
  <div style="padding: 14px;">Box 2</div>
</div>

<!-- Wrong: margin on children instead of gap on parent -->
<div class="col">
  <div style="margin-bottom: 12px; padding: 14px;">Box 1</div>
  <div style="padding: 14px;">Box 2</div>
</div>
```

##### Responsive-ish Widths

Use percentage widths for columns, fixed widths for consistent elements:

```html
<!-- Columns: percentage (adapt to container) -->
<div style="width: 35%;">Sidebar</div>
<div style="width: 65%;">Main</div>

<!-- Accent bars: fixed (always same visual weight; don't overuse these!) -->
<div style="width: 12px; height: 100%;">Accent</div>

<!-- Padding/margins: fixed (consistent breathing room) -->
<div style="padding: 20px 32px;">Content</div>
```

##### Common Spacing Mistakes

**Too much space**:
- 24px+ gaps between every element (looks sparse, wastes real estate)
- 20px+ padding in every container (content floats in empty space)

**Too little space**:
- 4px gaps between unrelated items (everything bleeds together)
- 8px padding in complex containers (text touches edges)

**Inconsistent**:
- 12px gap here, 16px there, 10px elsewhere (looks unfinished)
- Different padding on similar containers (breaks visual pattern)

**The fix**: Pick your spacing scale (4, 8, 12, 16, 20) and stick to it religiously.

#### Typography and Content Design

**IMPORTANT: Font constraints**: Use web-safe fonts only (see Critical Text Rules section for complete list). PowerPoint requires universally available fonts for reliable rendering.

**Within this constraint, make distinctive choices**:
- **Size contrast is your power tool**: Extreme size differences (72pt headers vs 14pt body) create hierarchy and impact
- **Weight and spacing**: Use bold strategically. Add letter-spacing to all-caps headers for sophistication
- **Serif vs sans-serif**: Mix thoughtfully - serif for warmth/tradition, sans-serif for modern clarity
- **Monospace for technical**: Use Courier New for code, data, or technical content to signal precision
- **Consistency matters**: Pick 2-3 typefaces maximum and vary them through size, weight, and spacing

**Content brevity - this is a presentation, not a report**:
- Paragraphs should be 1 sentence, _maybe_ 2
- Restrict yourself to 3-5 bullet points per list
- Cards should support short statements/fragments, maybe one complete sentence if it's short

**Visual hierarchy through typography**:
- Generally no more than 2-3 text sizes per slide (complex slides with charts may use 4)
- If you need additional distinction beyond size, use weight (bold) or opacity

**Slide layout zones** (for 960×540px canvas):

The slide is divided into distinct zones with buffer spacing:

1. **Title zone** (top 100px, y=0 to y=100):
   - Reserved exclusively for the slide title (`<h1>`)
   - The title **TEXT BOX** MUST span full width with 20px padding on left and right (920px wide)
   - **CRITICAL**: Wrap the h1 in a div with explicit width to force full-width text box:
     ```html
     <div style="width: 920px; margin: 0 20px;">
       <h1>Title Text</h1>
     </div>
     ```
   - Setting width directly on h1 does NOT work - the text box will shrink to fit content
   - NEVER place titles in narrow text boxes - this causes text wrapping issues
   - The title establishes the slide's visual anchor

2. **Buffer after title** (10px, y=100 to y=110):
   - Empty space to separate title from content
   - No content should start immediately under the title

3. **Content zone** (380px, y=110 to y=490):
   - Main content area for text, charts, images, cards
   - Use 20-40px left/right margins for breathing room
   - **CRITICAL**: Cards, boxes, and other containers must be **horizontally aligned** - they must start at the same y-position (same height from top)
   - Ensure visual balance and consistent spacing between elements

4. **Buffer before footnote** (10px, y=490 to y=500):
   - Empty space to separate content from footnotes
   - Ensures content doesn't crowd the bottom edge

5. **Footnote zone** (bottom 40px, y=500 to y=540):
   - Reserved ONLY for footnotes, sources, or disclaimers
   - Footnotes must use **10pt font size** (small, unobtrusive, left-aligned)
   - No other content allowed in this zone
   - Keep footnotes brief

**Example structure**:
```html
<body class="col bg-surface" style="width: 960px; height: 540px; position: relative;">
  <!-- Title zone: use fit class to shrink to content height -->
  <div style="width: 920px; margin: 0 20px; padding-top: 20px;" class="fit">
    <h1 style="margin: 0;">Slide Title</h1>
    <p class="text-muted-foreground" style="margin-top: 4px;">Optional subtitle</p>
  </div>

  <!-- Content zone: fill-height takes remaining space -->
  <div class="row gap-lg fill-height" style="padding: 10px 20px;">
    <div class="col" style="width: 45%;"><!-- Left column content --></div>
    <div class="col" style="width: 55%;"><!-- Right column content --></div>
  </div>

  <!-- Footnote zone: absolute positioning for fixed bottom placement -->
  <p style="position: absolute; bottom: 8px; left: 20px; font-size: 10pt; color: #666; margin: 0;">
    Source: Data from Q4 2024 report
  </p>
</body>
```

**IMPORTANT**:
- Use `class="col"` on body to enable flexbox layout
- Use `class="fit"` on title container to shrink to content height
- Use `class="fill-height"` on content to expand into remaining space
- Only use `position: absolute` for footnotes (fixed bottom placement)
- This prevents layering issues where content appears on top of titles

#### Color & Theme

**Commit to a cohesive, bold aesthetic.** Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Every presentation should have a distinct color personality.

**Core principles**:
- **Dominance over equality**: One color should clearly dominate (60-70% of visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Create atmosphere**: Don't default to solid white backgrounds. Use color blocking, gradient backgrounds, tinted surfaces, or dramatic contrast (dark slides with bright text) to create depth and mood.
- **Context-specific choices**: The palette should feel designed for THIS topic. If someone could swap your colors into a completely different presentation and it would still "work," you haven't made specific enough choices.

**NEVER use generic AI aesthetics**:
- Cliched color schemes (blue gradients on white, purple-to-pink gradients)
- Safe corporate blues without intentional reasoning
- Overused teals, greys, and muted "professional" tones

**Create visual depth**:
- **Gradient backgrounds**: Use `linear-gradient()` or `radial-gradient()` on slide backgrounds for atmosphere
- **Color blocking**: 40-60% of a slide in solid color creates visual punctuation
- **Layered transparencies**: Overlapping shapes with opacity create depth
- **Dramatic shadows**: Bold drop shadows on cards or text boxes add dimension
- **Tinted surfaces**: Off-white, cream, charcoal instead of pure white/black

**Build cohesion**: Your 3-5 colors should feel intentionally paired - either through shared undertones (all warm or all cool), similar saturation levels, or deliberate high contrast. The palette should feel like it was designed by someone with a point of view.

#### Maintaining Visual Interest

**Create rhythm and variety across your deck**:

- **Vary slide layouts**: Don't use the same layout for every slide
- **Strategic use of visuals**: Icons, image placeholders, charts, geometric shapes - but each should serve a purpose, not decorate
- **Spatial surprise**: Break expectations occasionally - a diagonal element, an asymmetric split, overlapping shapes
- **Typography variation**: Alternate between text-heavy and minimal slides. Use size contrast for impact
- **Color blocking**: Dedicate 40-60% of occasional slides to solid color blocks for visual punctuation
- **White space as a tool**: Generous negative space makes key slides breathe and content stand out

#### Visual Elements: Icons, Diagrams, and Illustrations

**CRITICAL**: Visuals should COMMUNICATE, not decorate. Every icon, diagram, or illustration must serve a purpose - clarifying concepts, showing relationships, or adding meaningful emphasis. Generic decoration is worse than no visuals at all.

##### When to Use Visuals

**Icons work best for**:
- **Quick recognition**: Represent concepts at a glance (settings gear, user profile, warning triangle)
- **List enhancement**: Add visual anchors to bullet points or feature lists (max 4-6 items)
- **Navigation cues**: Guide attention to key sections or actions
- **Category markers**: Distinguish between types of content on a slide
- **Status indicators**: Show state (complete, in-progress, error)

**Diagrams work best for**:
- **Process flows**: Sequential steps, workflows, pipelines
- **Relationships**: Hierarchies, networks, dependencies, comparisons
- **Architecture**: System components, data flows, integrations
- **Timelines**: Chronological sequences, project phases, milestones
- **Comparisons**: Before/after, option A vs B, feature matrices

**Illustrations/Images work best for**:
- **Emotional impact**: When you need to evoke feeling, not just convey information
- **Concrete examples**: Showing actual products, places, or people
- **Complex concepts**: Abstract ideas that benefit from metaphorical visualization
- **Brand storytelling**: Establishing tone and personality

##### Icon Usage Patterns

**DO**:
- Use a **consistent icon set** throughout (don't mix styles - all outline OR all filled, all same weight)
- Keep icons **small and supporting** (24-48px typical, 64px max for emphasis)
- Choose icons that are **immediately recognizable** for your audience
- Use **color strategically** - monochrome icons with one accent color for emphasis
- Align icons with text baselines or center them in cards
- Use react-icons library for consistent, high-quality SVG icons

**DON'T**:
- Use icons as pure decoration without meaning
- Mix icon styles (outline + filled, different weights, different visual languages)
- Make icons compete with text for attention (keep them subordinate)
- Use obscure or ambiguous icons that require explanation
- Overcrowd slides with too many icons (3-5 per slide maximum)
- Use clipart-style or cartoonish icons in professional contexts

##### Diagram Design Principles

**Clarity over complexity**:
- Each diagram should convey ONE main idea
- Remove unnecessary elements (every line, box, arrow must earn its place)
- Use visual hierarchy: primary elements larger/bolder, secondary elements subdued
- Limit to 5-7 main elements per diagram (cognitive load limit)

**Flow and direction**:
- Left-to-right for sequential processes (Western reading pattern)
- Top-to-bottom for hierarchies
- Center-outward for radial/hub-spoke relationships
- Use arrows sparingly - direction should be obvious from layout

**Visual consistency**:
- Same shape for same type of element (all rectangles for steps, all circles for milestones)
- Consistent spacing between elements
- Uniform line weights and colors
- Clear grouping through proximity and enclosure

**Common Diagram Types**:
1. **Flowchart** - Decision trees, process steps
   - Rectangles for actions, diamonds for decisions
   - Arrows show direction, color-code paths

2. **Hierarchy/Org Chart** - Reporting structures, taxonomies
   - Top-down with clear levels
   - Use consistent box sizes per level

3. **Timeline** - Milestones, project phases
   - Horizontal with clear date markers
   - Highlight current position or key moments

4. **Comparison Matrix** - Feature comparisons, option evaluation
   - Clear labels, consistent formatting
   - Use checkmarks/X or color coding

5. **Cycle Diagram** - Iterative processes, feedback loops
   - Circular arrangement with directional flow
   - Equal spacing, consistent element sizes

6. **Hub and Spoke** - Central concept with related elements
   - Central element emphasized (larger, bolder)
   - Radial symmetry for balance

7. **Funnel** - Conversion processes, filtering
   - Wide at top, narrow at bottom
   - Labels show quantities or stages

##### Building Diagrams in HTML

Create diagrams using positioned divs with borders, backgrounds, and text:

```html
<!-- Simple 3-step process flow -->
<div class="row items-center gap-md" style="padding: 20px;">
  <!-- Step 1 -->
  <div class="col items-center" style="width: 200px;">
    <div class="rounded p-4" style="background: var(--color-primary); color: white; width: 100%;">
      <p class="text-lg bold text-center" style="margin: 0;">1. Research</p>
    </div>
  </div>

  <!-- Arrow -->
  <div style="font-size: 24px; color: var(--color-muted-foreground);">→</div>

  <!-- Step 2 -->
  <div class="col items-center" style="width: 200px;">
    <div class="rounded p-4" style="background: var(--color-primary); color: white; width: 100%;">
      <p class="text-lg bold text-center" style="margin: 0;">2. Design</p>
    </div>
  </div>

  <!-- Arrow -->
  <div style="font-size: 24px; color: var(--color-muted-foreground);">→</div>

  <!-- Step 3 -->
  <div class="col items-center" style="width: 200px;">
    <div class="rounded p-4" style="background: var(--color-primary); color: white; width: 100%;">
      <p class="text-lg bold text-center" style="margin: 0;">3. Build</p>
    </div>
  </div>
</div>
```

```html
<!-- Metric cards with icons -->
<div class="row gap-lg" style="padding: 20px;">
  <div class="col items-center p-6 rounded" style="background: var(--color-surface); flex: 1;">
    <!-- Icon placeholder - use react-icons SVG -->
    <div style="width: 48px; height: 48px; margin-bottom: 12px;">
      <!-- Insert SVG icon here -->
    </div>
    <p class="text-3xl bold" style="margin: 0; color: var(--color-primary);">45%</p>
    <p class="text-muted-foreground" style="margin: 4px 0 0 0;">Growth Rate</p>
  </div>

  <div class="col items-center p-6 rounded" style="background: var(--color-surface); flex: 1;">
    <div style="width: 48px; height: 48px; margin-bottom: 12px;">
      <!-- Insert SVG icon here -->
    </div>
    <p class="text-3xl bold" style="margin: 0; color: var(--color-primary);">1.2M</p>
    <p class="text-muted-foreground" style="margin: 4px 0 0 0;">Active Users</p>
  </div>
</div>
```

**WARNING SIGNS your visual isn't working**:
- You need to explain what the icon means
- The diagram requires more than 5 seconds to parse
- You're adding a visual because "the slide looks empty"
- The visual could be swapped into any other presentation
- Elements overlap or crowd each other

#### Anti-Patterns: What NEVER to Do
Avoid these patterns that create forgettable presentations:

**Typography failures**:
- Using default type sizes with no distinctive scale, weight, or spacing choices
- Multiple font families on one slide (mixing 3+ typefaces = chaos)
- Centered body text (center headlines only; left-align paragraphs and lists)
- Insufficient size contrast (18pt header with 16pt body is nearly invisible)

**Color failures**:
- Default gradients that appear in generic templates (particularly purple/blue)
- Evenly distributing 5+ colors across slides with no hierarchy or dominance
- Low contrast combinations (light gray text on white, dark blue on black)
- Off-brand colors when brand identity is specified

**Layout failures**:
- Centered alignment for everything (static, boring, no flow)
- Cramming too much content per slide (more than 5 bullets, paragraphs over 2 sentences)
- Inconsistent spacing and alignment across slides (looks unfinished)
- Using the same exact layout for every single slide (monotonous)

**Visual detail failures**:
- Generic clipart-style icons that could apply to anything
- Decorative elements that don't serve the aesthetic direction
- Half-committed design (one fancy slide, rest are defaults)
- Copying the exact same design as your previous presentation (vary your choices)

**Remember**: Professional doesn't mean generic. Commit to intentional choices that serve your audience and content.

### Layout Tips

**To create slides with charts or tables:**

- **Two-column layout (PREFERRED)**: Use a header spanning the full width, then two columns below - text/bullets in one column and the featured content in the other. This provides better balance and makes charts/tables more readable. Use unequal column widths (e.g., 40%/60% split) to optimize space for each content type.
- **Full-slide layout**: Let the featured content (chart/table) take up the entire slide for maximum impact and readability
- **NEVER vertically stack**: Do not place charts/tables below text in a single column - this causes poor readability and layout issues

## Creating HTML Slides

Every HTML slide must include proper body dimensions:

- **16:9** (automatically applied): `width: 960px; height: 540px`
- **4:3**: `width: 960px; height: 720px`
- **16:10**: `width: 960px; height: 600px`

### How to write CSS

**MANDATORY - READ ENTIRE FILE**: Read [`css.md`](css.md) (~400 lines) completely from start to finish. **NEVER set any range limits when reading this file.** Read the full file content for detailed guidance on CSS structure before writing any HTML.

Slides are automatically provided with a global stylesheet which is injected when the HTML is rendered. Guidelines for styles:

- Override CSS variables (using the `:root` selector) to customize colors, typography, and spacing for your slides
- Use the classes from [`css.md`](css.md) when creating your slides. Reference the examples provided in that guide.

### Supported Elements

#### Block Elements

- `<div>`, `<section>`, `<header>`, `<footer>`, `<main>`, `<article>`, `<nav>`, `<aside>` - Container elements with bg/border support (supports gradients and background images)

#### Text Elements

- `<p>` - Paragraphs with styling
- `<h1>`-`<h6>` - Headings with styling

#### Lists

- `<ul>`, `<ol>` - Lists (never use manual bullets •, -, \*)

#### Inline Formatting

- `<b>`, `<strong>` - Bold text
- `<i>`, `<em>` - Italic text
- `<u>` - Underlined text
- `<br>` - Line breaks

#### Media

- `<img>` - Images

#### Special Features

- `class="placeholder"` - Reserved space for charts (returns `{ id, x, y, w, h }`)
  - Automatically styled with muted background and dashed border
  - Stretches to fill available container space
  - Provides visual indication during development
- `data-balance` attribute - Auto-balance text line lengths for better typography. `<h1>` and `<h2>` elements are automatically balanced without needing the `data-balance` attribute.

### Critical Text Rules

**IMPORTANT**: These rules must be followed to safely convert HTML to PowerPoint.

**ALL text MUST be inside `<p>`, `<h1>`-`<h6>`, `<ul>`, or `<ol>` tags:**

- ✅ Correct: `<div><p>Text here</p></div>`
- ❌ Wrong: `<div>Text here</div>` - **Text will NOT appear in PowerPoint**
- Text in `<div>` without a text tag is silently ignored

**NEVER use manual bullet symbols (•, -, \*, etc.)** - Use `<ul>` or `<ol>` lists instead

**Use `row` and `col` classes INSTEAD of flexbox:**

- ✅ Correct: `<div class="row"><p>Text here</p></div>`
- ❌ Wrong: `<div style="display: flex;"><p>Text here</p></div>`

**ONLY use web-safe fonts that are universally available:**

- ✅ Web-safe fonts: `Arial`, `Helvetica`, `Times New Roman`, `Georgia`, `Courier New`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Impact`
- ❌ Wrong: `'Segoe UI'`, `'SF Pro'`, `'Roboto'`, custom fonts - **May cause rendering issues**

**NEVER use `white-space: nowrap` on titles or text:**

- PowerPoint does NOT respect this CSS property
- Text will wrap based on the container width, regardless of `nowrap` setting
- Instead of using `nowrap`, ensure the text box is wide enough to fit the text naturally
- For titles: ALWAYS use full-width text boxes (920px with 20px padding on each side) so titles fit on one line without needing `nowrap`

### Shape Styling (block elements only)

**IMPORTANT: Backgrounds, borders, and shadows only work on block elements, NOT on text elements (`<p>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`)**

- **Backgrounds**: CSS `background` or `background-color` or `background-image`
  - `background: var(--color-surface);`
  - `background: linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-primary-dark) 100%);`
  - `background: radial-gradient(circle, var(--color-accent-light) 0%, var(--color-accent-dark) 100%);`
  - `background: url(path/to/image.png)`
- **Borders**
  - Supports uniform borders: `border: 1px solid var(--color-border)`
  - Supports partial borders: `border-left`, `border-right`, `border-top`, `border-bottom`
- **Border radius**
  - `rounded` CSS class applies the default border-radius
  - `pill` CSS class applies maximum border-radius to create pill-shaped elements
    - When height and width are equal, this creates a circle
- **Box shadows**
  - Supports outer shadows only
    - PowerPoint does not support inset shadows
  - `box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.3);`

### Icons

Icons can be included using either inline SVG or SVG files, which are automatically converted to images in PowerPoint.

#### How to use react-icons

```javascript
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const { FaHome } = require("react-icons/fa");

// Generate SVG string from react-icon
function renderIconSvg(IconComponent, color, size = "48") {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color: color, size: size })
  );
}

// Get SVG markup
const homeIconSvg = renderIconSvg(FaHome, "#4472c4", "48");

// Use in HTML template (inline SVG)
// <div style="width: 48px; height: 48px;">${homeIconSvg}</div>
```

### Example Slide HTML

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Slide with title, context, and full bleed placeholder</title>
    <style>
      /* Shared CSS variable overrides */
      :root {
        --color-primary: #00a4fc;
        --color-primary-foreground: #ffffff;
      }
    </style>
  </head>
  <body class="row items-fill-width gap-lg">
    <div class="p-8 pe-0">
      <h1>Slide title</h1>
      <p class="text-2xl text-muted-foreground">Subtitle or context</p>
    </div>
    <div class="placeholder w-3/5 fit"></div>
  </body>
</html>
```

## Using the html2pptx Library

### Installation & Setup

**Important**: Extract the html2pptx library next to your script before using. See the **Prerequisites Check** section at the top of this document.

**When running scripts, set NODE_PATH for global packages like pptxgenjs:**

```sh
NODE_PATH="$(npm root -g)" node your-script.js 2>&1
```

### Dependencies

These libraries have been globally installed and are available to use:

- `pptxgenjs`
- `playwright`

### ⚠️ IMPORTANT: How To Use html2pptx

**Common errors:**

- **LIBRARY NOT EXTRACTED**: Extract the tarball first with `mkdir -p html2pptx && tar -xzf skills/public/pptx/html2pptx.tgz -C html2pptx`
  - ✅ Correct: `require("./html2pptx")`
  - ❌ Wrong: `require("@ant/html2pptx")` - Use relative path, not package name
- DO NOT call `pptx.addSlide()` directly, `html2pptx` creates a slide for you
- `html2pptx` accepts an `htmlFilePath` and a `pptx` presentation object
  - If you pass the wrong arguments, your script will throw errors or time out

**Your script MUST follow the following example.**

```javascript
const pptxgen = require("pptxgenjs");
const { html2pptx } = require("./html2pptx");

// Create a new pptx presentation
const pptx = new pptxgen();
pptx.layout = "LAYOUT_16x9"; // Must match HTML body dimensions

// Add an HTML-only slide
await html2pptx("slide1.html", pptx);

// Add a slide with a chart placeholder
const { slide, placeholders } = await html2pptx("slide2.html", pptx);
slide.addChart(pptx.charts.LINE, chartData, placeholders[0]);

// Save the presentation
await pptx.writeFile("output.pptx");
```

### API Reference

#### Function Signature

```javascript
await html2pptx(htmlFilePath, pptxPresentation, options);
```

#### Parameters

- `htmlFilePath` (string): Path to HTML file (absolute or relative)
- `pptxPresentation` (pptxgen): PptxGenJS presentation instance with layout already set
- `options` (object, optional):
  - `tmpDir` (string): Temporary directory for generated files (default: `process.env.TMPDIR || '/tmp'`)

#### Returns

```javascript
{
    slide: pptxgenSlide,           // The created/updated slide
    placeholders: [                 // Array of placeholder positions
        { id: string, x: number, y: number, w: number, h: number },
        ...
    ]
}
```

### Validation

The library automatically validates and collects all errors before throwing:

1. **HTML dimensions must match presentation layout** - Reports dimension mismatches
2. **Content must not overflow body** - Reports overflow with exact measurements
3. **Text element styling** - Reports backgrounds/borders/shadows on text elements (only allowed on block elements)

**All validation errors are collected and reported together** in a single error message, allowing you to fix all issues at once instead of one at a time.

### Working with Placeholders

```javascript
const { slide, placeholders } = await html2pptx("slide.html", pptx);

// Use first placeholder
slide.addChart(pptx.charts.BAR, data, placeholders[0]);

// Find by ID
const chartArea = placeholders.find((p) => p.id === "chart-area");
slide.addChart(pptx.charts.LINE, data, chartArea);
```

### Complete Example

```javascript
const pptxgen = require("pptxgenjs");
const { html2pptx } = require("./html2pptx");

async function createPresentation() {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Your Name";
  pptx.title = "My Presentation";

  // Slide 1: Title
  const { slide: slide1 } = await html2pptx("slides/title.html", pptx);

  // Slide 2: Content with chart
  const { slide: slide2, placeholders } = await html2pptx(
    "slides/data.html",
    pptx
  );

  const chartData = [
    {
      name: "Sales",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      values: [4500, 5500, 6200, 7100],
    },
  ];

  slide2.addChart(pptx.charts.BAR, chartData, {
    ...placeholders[0],
    showTitle: true,
    title: "Quarterly Sales",
    showCatAxisTitle: true,
    catAxisTitle: "Quarter",
    showValAxisTitle: true,
    valAxisTitle: "Sales ($000s)",
  });

  // Save
  await pptx.writeFile({ fileName: "presentation.pptx" });
  console.log("Presentation created successfully!");
}

createPresentation().catch(console.error);
```

**Run with:**

```sh
NODE_PATH="$(npm root -g)" node create-presentation.js 2>&1
```

## Using PptxGenJS

After converting HTML to slides with `html2pptx`, you'll use PptxGenJS to add dynamic content like charts, images, and additional elements.

### ⚠️ Critical Rules

#### Colors

- **NEVER use `#` prefix** with hex colors in PptxGenJS - causes file corruption
- ✅ Correct: `color: "FF0000"`, `fill: { color: "0066CC" }`
- ❌ Wrong: `color: "#FF0000"` (breaks document)

### Adding Images

Always calculate aspect ratios from actual image dimensions:

```javascript
// Get image dimensions: identify image.png | grep -o '[0-9]* x [0-9]*'
const imgWidth = 1860,
  imgHeight = 1519; // From actual file
const aspectRatio = imgWidth / imgHeight;

const h = 3; // Max height
const w = h * aspectRatio;
const x = (10 - w) / 2; // Center on 16:9 slide

slide.addImage({ path: "chart.png", x, y: 1.5, w, h });
```

### Adding Text

```javascript
// Rich text with formatting
slide.addText(
  [
    { text: "Bold ", options: { bold: true } },
    { text: "Italic ", options: { italic: true } },
    { text: "Normal" },
  ],
  {
    x: 1,
    y: 2,
    w: 8,
    h: 1,
  }
);
```

### Adding Shapes

```javascript
// Rectangle
slide.addShape(pptx.shapes.RECTANGLE, {
  x: 1,
  y: 1,
  w: 3,
  h: 2,
  fill: { color: "4472C4" },
  line: { color: "000000", width: 2 },
});

// Circle
slide.addShape(pptx.shapes.OVAL, {
  x: 5,
  y: 1,
  w: 2,
  h: 2,
  fill: { color: "ED7D31" },
});

// Rounded rectangle
slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 1,
  y: 4,
  w: 3,
  h: 1.5,
  fill: { color: "70AD47" },
  rectRadius: 0.2,
});
```

### Adding Charts

**Required for most charts:** Axis labels using `catAxisTitle` (category) and `valAxisTitle` (value).

**Chart Data Format:**

- Use **single series with all labels** for simple bar/line charts
- Each series creates a separate legend entry
- Labels array defines X-axis values

**Time Series Data - Choose Correct Granularity:**

- **< 30 days**: Use daily grouping (e.g., "10-01", "10-02") - avoid monthly aggregation that creates single-point charts
- **30-365 days**: Use monthly grouping (e.g., "2024-01", "2024-02")
- **> 365 days**: Use yearly grouping (e.g., "2023", "2024")
- **Validate**: Charts with only 1 data point likely indicate incorrect aggregation for the time period

```javascript
const { slide, placeholders } = await html2pptx("slide.html", pptx);

// CORRECT: Single series with all labels
slide.addChart(
  pptx.charts.BAR,
  [
    {
      name: "Sales 2024",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      values: [4500, 5500, 6200, 7100],
    },
  ],
  {
    ...placeholders[0], // Use placeholder position
    barDir: "col", // 'col' = vertical bars, 'bar' = horizontal
    showTitle: true,
    title: "Quarterly Sales",
    showLegend: false, // No legend needed for single series
    // Required axis labels
    showCatAxisTitle: true,
    catAxisTitle: "Quarter",
    showValAxisTitle: true,
    valAxisTitle: "Sales ($000s)",
    // Optional: Control scaling (adjust min based on data range for better visualization)
    valAxisMaxVal: 8000,
    valAxisMinVal: 0, // Use 0 for counts/amounts; for clustered data (e.g., 4500-7100), consider starting closer to min value
    valAxisMajorUnit: 2000, // Control y-axis label spacing to prevent crowding
    catAxisLabelRotate: 45, // Rotate labels if crowded
    dataLabelPosition: "outEnd",
    dataLabelColor: "000000",
    // Use single color for single-series charts
    chartColors: ["4472C4"], // All bars same color
  }
);
```

#### Scatter Chart

**IMPORTANT**: Scatter chart data format is unusual - first series contains X-axis values, subsequent series contain Y-values:

```javascript
// Prepare data
const data1 = [
  { x: 10, y: 20 },
  { x: 15, y: 25 },
  { x: 20, y: 30 },
];
const data2 = [
  { x: 12, y: 18 },
  { x: 18, y: 22 },
];

const allXValues = [...data1.map((d) => d.x), ...data2.map((d) => d.x)];

slide.addChart(
  pptx.charts.SCATTER,
  [
    { name: "X-Axis", values: allXValues }, // First series = X values
    { name: "Series 1", values: data1.map((d) => d.y) }, // Y values only
    { name: "Series 2", values: data2.map((d) => d.y) }, // Y values only
  ],
  {
    x: 1,
    y: 1,
    w: 8,
    h: 4,
    lineSize: 0, // 0 = no connecting lines
    lineDataSymbol: "circle",
    lineDataSymbolSize: 6,
    showCatAxisTitle: true,
    catAxisTitle: "X Axis",
    showValAxisTitle: true,
    valAxisTitle: "Y Axis",
    chartColors: ["4472C4", "ED7D31"],
  }
);
```

#### Line Chart

```javascript
slide.addChart(
  pptx.charts.LINE,
  [
    {
      name: "Temperature",
      labels: ["Jan", "Feb", "Mar", "Apr"],
      values: [32, 35, 42, 55],
    },
  ],
  {
    x: 1,
    y: 1,
    w: 8,
    h: 4,
    lineSize: 4,
    lineSmooth: true,
    // Required axis labels
    showCatAxisTitle: true,
    catAxisTitle: "Month",
    showValAxisTitle: true,
    valAxisTitle: "Temperature (°F)",
    // Optional: Y-axis range (set min based on data range for better visualization)
    valAxisMinVal: 0, // For ranges starting at 0 (counts, percentages, etc.)
    valAxisMaxVal: 60,
    valAxisMajorUnit: 20, // Control y-axis label spacing to prevent crowding (e.g., 10, 20, 25)
    // valAxisMinVal: 30,  // PREFERRED: For data clustered in a range (e.g., 32-55 or ratings 3-5), start axis closer to min value to show variation
    // Optional: Chart colors
    chartColors: ["4472C4", "ED7D31", "A5A5A5"],
  }
);
```

#### Pie Chart (No Axis Labels Required)

**CRITICAL**: Pie charts require a **single data series** with all categories in the `labels` array and corresponding values in the `values` array.

```javascript
slide.addChart(
  pptx.charts.PIE,
  [
    {
      name: "Market Share",
      labels: ["Product A", "Product B", "Other"], // All categories in one array
      values: [35, 45, 20], // All values in one array
    },
  ],
  {
    x: 2,
    y: 1,
    w: 6,
    h: 4,
    showPercent: true,
    showLegend: true,
    legendPos: "r", // right
    chartColors: ["4472C4", "ED7D31", "A5A5A5"],
  }
);
```

#### Multiple Data Series

```javascript
slide.addChart(
  pptx.charts.LINE,
  [
    {
      name: "Product A",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      values: [10, 20, 30, 40],
    },
    {
      name: "Product B",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      values: [15, 25, 20, 35],
    },
  ],
  {
    x: 1,
    y: 1,
    w: 8,
    h: 4,
    showCatAxisTitle: true,
    catAxisTitle: "Quarter",
    showValAxisTitle: true,
    valAxisTitle: "Revenue ($M)",
  }
);
```

### Chart Colors

**CRITICAL**: Use hex colors **without** the `#` prefix - including `#` causes file corruption.

**Align chart colors with your chosen design palette**, ensuring sufficient contrast and distinctiveness for data visualization. Adjust colors for:

- Strong contrast between adjacent series
- Readability against slide backgrounds
- Accessibility (avoid red-green only combinations)

```javascript
// Example: Ocean palette-inspired chart colors (adjusted for contrast)
const chartColors = ["16A085", "FF6B9D", "2C3E50", "F39C12", "9B59B6"];

// Single-series chart: Use one color for all bars/points
slide.addChart(
  pptx.charts.BAR,
  [
    {
      name: "Sales",
      labels: ["Q1", "Q2", "Q3", "Q4"],
      values: [4500, 5500, 6200, 7100],
    },
  ],
  {
    ...placeholders[0],
    chartColors: ["16A085"], // All bars same color
    showLegend: false,
  }
);

// Multi-series chart: Each series gets a different color
slide.addChart(
  pptx.charts.LINE,
  [
    { name: "Product A", labels: ["Q1", "Q2", "Q3"], values: [10, 20, 30] },
    { name: "Product B", labels: ["Q1", "Q2", "Q3"], values: [15, 25, 20] },
  ],
  {
    ...placeholders[0],
    chartColors: ["16A085", "FF6B9D"], // One color per series
  }
);
```

### Adding Tables

Tables can be added with basic or advanced formatting:

#### Basic Table

```javascript
slide.addTable(
  [
    ["Header 1", "Header 2", "Header 3"],
    ["Row 1, Col 1", "Row 1, Col 2", "Row 1, Col 3"],
    ["Row 2, Col 1", "Row 2, Col 2", "Row 2, Col 3"],
  ],
  {
    x: 0.5,
    y: 1,
    w: 9,
    h: 3,
    border: { pt: 1, color: "999999" },
    fill: { color: "F1F1F1" },
  }
);
```

#### Table with Custom Formatting

```javascript
const tableData = [
  // Header row with custom styling
  [
    {
      text: "Product",
      options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true },
    },
    {
      text: "Revenue",
      options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true },
    },
    {
      text: "Growth",
      options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true },
    },
  ],
  // Data rows
  ["Product A", "$50M", "+15%"],
  ["Product B", "$35M", "+22%"],
  ["Product C", "$28M", "+8%"],
];

slide.addTable(tableData, {
  x: 1,
  y: 1.5,
  w: 8,
  h: 3,
  colW: [3, 2.5, 2.5], // Column widths
  rowH: [0.5, 0.6, 0.6, 0.6], // Row heights
  border: { pt: 1, color: "CCCCCC" },
  align: "center",
  valign: "middle",
  fontSize: 14,
});
```

#### Table with Merged Cells

```javascript
const mergedTableData = [
  [
    {
      text: "Q1 Results",
      options: {
        colspan: 3,
        fill: { color: "4472C4" },
        color: "FFFFFF",
        bold: true,
      },
    },
  ],
  ["Product", "Sales", "Market Share"],
  ["Product A", "$25M", "35%"],
  ["Product B", "$18M", "25%"],
];

slide.addTable(mergedTableData, {
  x: 1,
  y: 1,
  w: 8,
  h: 2.5,
  colW: [3, 2.5, 2.5],
  border: { pt: 1, color: "DDDDDD" },
});
```

### Table Options

Common table options:

- `x, y, w, h` - Position and size
- `colW` - Array of column widths (in inches)
- `rowH` - Array of row heights (in inches)
- `border` - Border style: `{ pt: 1, color: "999999" }`
- `fill` - Background color (no # prefix)
- `align` - Text alignment: "left", "center", "right"
- `valign` - Vertical alignment: "top", "middle", "bottom"
- `fontSize` - Text size
- `autoPage` - Auto-create new slides if content overflows
