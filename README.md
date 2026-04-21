# Banner Resizer

Browser-based tool for generating ad-network creatives at every size you need
from one master design. Upload layers, pick the sizes, hit Generate, tweak.
No backend — all processing happens in the browser.

## What it does

- Reads per-layer PNGs exported at the master dimensions (transparent padding
  intact) and detects each layer's position in the master automatically.
- Generates every selected ad-network size (Google AdMob, Meta, Unity,
  IronSource, AppLovin, Moloco, Mintegral).
- Uses a smart layout pipeline: preserve mode for same-aspect targets, reflow
  with inferred anchors + role-based scale caps for different-aspect targets,
  banner mode for thin targets, collision resolution, auto-shrink of
  lower-priority roles.
- Per-canvas editing: drag / scale / rotate / lock / hide, snap-to guides
  (canvas + layer-to-layer), group reflow, per-layer anchor override with
  bulk-apply across all canvases.
- Overlays: safe zones (per network/size), master reference ghost, diagnostic
  grid. All toggled from the top bar.
- Variants: multiple creative variants under one project with independent
  layer sets and canvases; export batches all variants into separate folders.
- Undo/redo (⌘Z / ⌘⇧Z) across every edit.
- Save/load project templates as JSON (images embedded as data URLs).
- Export all or selected canvases as a ZIP of PNGs with a custom filename
  template (`{network}_{w}x{h}_{name}` and friends).

## Running locally

Static site. Serve the folder with anything:

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or use `npx serve`, PHP's built-in server, VS Code's "Live Server" extension —
anything that serves static files. Opening `index.html` straight from disk
usually works too, but a local server sidesteps browser restrictions around
`file://` URLs.

## Deploying

The whole app is plain HTML/CSS/JS with two CDN dependencies (Konva and
JSZip). Drop these files on any static host.

### GitHub Pages

```bash
git init
git add .
git commit -m "Banner Resizer"
git branch -M main
git remote add origin git@github.com:<you>/banner-resizer.git
git push -u origin main
```

Then in the repo's **Settings → Pages**, set the source to `main` / `/ (root)`
and save. Your app will be live at `https://<you>.github.io/banner-resizer/`
within a minute.

### Netlify (drag-and-drop)

1. Visit <https://app.netlify.com/drop>.
2. Drag the project folder onto the page.
3. Done — Netlify gives you a URL.

### Netlify CLI

```bash
npm install -g netlify-cli
netlify deploy --dir=. --prod
```

### Vercel

```bash
npm install -g vercel
vercel --prod
```

Accept the defaults when asked — it's a static site, no framework to
configure.

## File structure

```
index.html          # UI shell
app.css             # styling
js/
  networks.js       # ad-network catalog + safe zones
  roles.js          # layer role definitions + rules
  autoLayout.js     # fallback role-based placement
  smartLayout.js    # bbox analysis + smart reflow pipeline
  app.js            # state, UI wiring, editor, history, export, variants
```

## Typical workflow

1. Designer exports each master layer as a PNG with transparent padding
   (same dimensions as the master, e.g. 1080×1920 with the logo visible only
   in the top-left corner).
2. Drop the PNGs into the **Layers** panel. The tool detects each layer's
   master-relative position automatically.
3. Tag each layer with a role (Background / Logo / CTA / …) — the tool
   guesses from filename but you can correct it. Optionally assign layers to
   a group (CTA + button, for example) so they reflow together.
4. Check the ad-network sizes you want under **Ad Networks**.
5. Hit **Generate**. The preview strip fills with one canvas per size.
6. Click a preview to open it in the editor. Drag / scale / rotate as
   needed; the Snap and Safe Zones toggles help. If a layer is perfect on
   one size, lock it (🔒) so Reset Layout won't disturb it.
7. **Export All** to get a ZIP of PNGs with your chosen filename template.

## Browser requirements

Any modern Chromium / Firefox / Safari. Uses `<canvas>`, `FileReader`, and
`URL.createObjectURL`; nothing exotic.

## License

Add your own. Nothing here bundles restrictive code — Konva (MIT) and JSZip
(MIT or GPLv3) are loaded from public CDNs.
