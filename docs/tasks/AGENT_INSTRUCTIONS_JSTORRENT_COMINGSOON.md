# Agent Instructions: JSTorrent Coming Soon Landing Page

## Overview

Create 3-4 stylistic variations of a "coming soon" landing page for JSTorrent, a BitTorrent client being rebuilt for ChromeOS and desktop. The pages should be static HTML files (no build step required) placed in the `website/` folder of the monorepo.

**Output files:** `website/comingsoon1.html`, `website/comingsoon2.html`, `website/comingsoon3.html`, etc.

**Live URL:** These will be accessible at `https://new.jstorrent.com/comingsoon1.html`, etc.

---

## Required Content

### Primary Elements (must include all)

1. **JSTorrent Logo** - Use `public/cook/JSTorrent/jstorrent-logo.png` (427×150) or the icon `js-512.png`

2. **Headline** - Something like:
   - "JSTorrent is getting a fresh start"
   - "A modern BitTorrent client for ChromeOS"
   - "JSTorrent 2025"
   
3. **Subheadline/Description** - Brief explanation:
   - "Chrome Apps are being retired by Google. We're building something better."
   - "The BitTorrent client you know, rebuilt from the ground up."

4. **Email Signup Form** (Buttondown):
```html
<form
  action="https://buttondown.com/api/emails/embed-subscribe/jstorrent"
  method="post"
  class="embeddable-buttondown-form"
>
  <input type="email" name="email" placeholder="you@example.com" required />
  <button type="submit">Notify Me</button>
</form>
```
Note: Remove the "Powered by Buttondown" link or make it very subtle.

5. **Community Links** - Three buttons/links:
   - **GitHub**: https://github.com/kzahel/jstorrent (icon: GitHub logo)
   - **Discord**: https://discord.gg/Cnwfwawxvf (icon: Discord logo)  
   - **Discussions**: https://github.com/kzahel/jstorrent/discussions (can combine with GitHub or separate)

6. **Footer** - Simple, maybe just "© 2025 JSTorrent" or link to legacy app

---

## Image Assets Reference

All assets are in `website/public/cook/`. Reference them as `/cook/...` in HTML.

### Logo Files (use these)
| File | Dimensions | Description |
|------|------------|-------------|
| `JSTorrent/jstorrent-logo.png` | 427×150 | Full horizontal logo - icon + "JSTorrent" text. **Best for header.** |
| `JSTorrent/js-mini-logo.png` | 198×50 | Smaller horizontal logo |
| `JSTorrent/js-512.png` | 512×512 | Large square icon only (the layered cube). **Good for hero/centered layouts.** |
| `JSTorrent/js-256.png` | 256×256 | Medium square icon |
| `JSTorrent/js-128.png` | 128×128 | Standard icon size |

### Background/Banner Files (optional, for inspiration or use)
| File | Dimensions | Description |
|------|------------|-------------|
| `Webstore/JS/js-webstore-marquee.png` | 1400×560 | Light gray-blue background with subtle chevron wave pattern, centered logo. Clean, professional. |
| `BG/gplus-jstorrent-bg01.jpg` | 2120×1192 | Nature photo (waterfall/mountains) with chevron overlay and cube icon. More dramatic. |
| `Archive/js-bg01.png` - `js-bg05.png` | 2120×1192 | Various background designs |

### Icon Design Details
The cube icon has **5 horizontal layers** in isometric perspective:
- **Top 3 layers:** Light blue → Medium blue → Dark blue (gradient, representing water/data)
- **Bottom 2 layers:** Tan/beige → Dark brown (representing earth/foundation)

This evokes both "torrent" (water) and geological layers (data pieces).

---

## Brand Colors

Extract these from the logo/assets:

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Blue | `#4A90D9` | "JS" text, top of cube, buttons, links |
| Medium Blue | `#2980B9` | Hover states, accents |
| Dark Blue | `#1E5A8A` | Darker accents |
| Tan/Beige | `#B8956E` | Secondary accent (from cube) |
| Brown | `#6B5344` | Footer, subtle elements |
| Dark Gray | `#4A4A4A` | Body text, "Torrent" text |
| Light Gray-Blue | `#E8EEF4` | Backgrounds |
| White | `#FFFFFF` | Card backgrounds, text on dark |

---

## Style Variations to Create

### Variation 1: Clean & Minimal
- White or very light gray background
- Centered layout
- Logo at top, headline, description, email form, then community links as icon buttons
- Lots of whitespace
- Modern sans-serif font (system fonts or Google Fonts: Inter, Roboto, or similar)

### Variation 2: Dark Mode / Developer-Focused
- Dark background (`#1a1a2e` or similar)
- Light text
- Maybe subtle grid or code-like pattern in background
- Emphasize the GitHub link more prominently
- Monospace font for headline or accents (JetBrains Mono, Fira Code)

### Variation 3: Brand-Heavy (Chevron Pattern)
- Use the chevron/wave pattern from the webstore marquee as a subtle CSS background
- The pattern is diagonal chevrons/arrows pointing right, semi-transparent
- Light blue-gray base color
- More visual interest while staying on-brand

### Variation 4 (Optional): Legacy-Inspired
- Look at the current https://jstorrent.com for inspiration
- Similar structure but modernized
- Could include a brief "What's new" or feature preview section

---

## Technical Requirements

1. **Static HTML only** - No build step, no Vite, no React. Just HTML + inline CSS or a `<style>` block.

2. **Responsive** - Must look good on mobile (375px) through desktop (1440px+). Use CSS flexbox/grid.

3. **Meta tags** - Include proper `<head>` with:
```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JSTorrent - Coming Soon</title>
<meta name="description" content="JSTorrent is being rebuilt for ChromeOS and desktop. Join the waitlist.">

<!-- Open Graph for social sharing -->
<meta property="og:title" content="JSTorrent - Coming Soon">
<meta property="og:description" content="A modern BitTorrent client for ChromeOS. Join the waitlist.">
<meta property="og:image" content="/cook/JSTorrent/js-512.png">
<meta property="og:url" content="https://new.jstorrent.com/comingsoon.html">
<meta property="og:type" content="website">

<!-- Favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/cook/JSTorrent/js-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/cook/JSTorrent/js-16.png">
```

4. **Accessibility** - Proper labels on form inputs, sufficient color contrast, semantic HTML.

5. **No external tracking** - Don't add analytics or third-party scripts.

---

## Content Copy Suggestions

**Headlines (pick one per variation):**
- "JSTorrent is coming back"
- "A fresh start for JSTorrent"
- "JSTorrent 2025"
- "The torrent client for ChromeOS, rebuilt"

**Subheadlines:**
- "Chrome Apps are going away. We're not."
- "10+ years of JSTorrent, rebuilt from the ground up."
- "Modern. Fast. Still just works."

**Email CTA:**
- "Get notified when we launch"
- "Join the waitlist"
- "Be the first to know"

**Community section header:**
- "Join the community"
- "Follow development"
- "Get involved"

---

## File Structure

```
website/
├── public/
│   └── cook/
│       ├── JSTorrent/
│       │   ├── jstorrent-logo.png    (427×150)
│       │   ├── js-512.png            (512×512)
│       │   ├── js-256.png            (256×256)
│       │   ├── js-128.png            (128×128)
│       │   ├── js-48.png             (48×48)
│       │   ├── js-32.png             (32×32)
│       │   └── js-16.png             (16×16)
│       ├── Webstore/JS/
│       │   └── js-webstore-marquee.png  (1400×560)
│       └── BG/
│           └── gplus-jstorrent-bg01.jpg (2120×1192)
├── comingsoon1.html   ← CREATE THIS
├── comingsoon2.html   ← CREATE THIS
├── comingsoon3.html   ← CREATE THIS
└── (other existing files)
```

---

## Example Structure (Variation 1)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- meta tags as specified above -->
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      background: #f8fafc;
      color: #1a1a2e;
    }
    .container { max-width: 540px; text-align: center; }
    .logo { width: 120px; margin-bottom: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #666; margin-bottom: 2rem; }
    /* ... form styles, button styles, link styles ... */
  </style>
</head>
<body>
  <div class="container">
    <img src="/cook/JSTorrent/js-512.png" alt="JSTorrent" class="logo">
    <h1>JSTorrent is coming back</h1>
    <p class="subtitle">Chrome Apps are going away. We're building something better.</p>
    
    <form action="https://buttondown.com/api/emails/embed-subscribe/jstorrent" method="post">
      <input type="email" name="email" placeholder="you@example.com" required>
      <button type="submit">Notify Me</button>
    </form>
    
    <div class="links">
      <a href="https://github.com/kzahel/jstorrent">GitHub</a>
      <a href="https://discord.gg/Cnwfwawxvf">Discord</a>
      <a href="https://github.com/kzahel/jstorrent/discussions">Discussions</a>
    </div>
  </div>
  
  <footer>© 2025 JSTorrent</footer>
</body>
</html>
```

---

## Checklist Before Finishing

- [ ] All 3-4 variations created and saved in `website/` folder
- [ ] Each variation looks good on mobile (test at 375px width)
- [ ] Email form submits to correct Buttondown URL
- [ ] All three community links work (GitHub, Discord, Discussions)
- [ ] Images load correctly (paths start with `/cook/...`)
- [ ] Favicon set
- [ ] OG meta tags included for social sharing
- [ ] No JavaScript errors in console
- [ ] Reasonable loading performance (no huge unoptimized images in HTML)

---

## Notes

- The website folder may have Vite/build tooling set up, but ignore it. Just create static HTML files.
- Keep file sizes reasonable - the marquee and background images are large, so if using them, consider them as CSS backgrounds rather than `<img>` tags, or don't use them.
- The chevron pattern from the marquee could be recreated in CSS if desired (repeating diagonal lines).
