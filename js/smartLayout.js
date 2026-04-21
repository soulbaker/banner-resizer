/* Smart layout
 *
 * Reads each uploaded PNG's transparent bounding box to learn where the visible
 * content sits inside its original canvas. When that original canvas matches the
 * master (explicit or auto-detected), we can place layers with real knowledge
 * of the designer's intent instead of generic role rules.
 *
 * Two placement modes:
 *   - preserve: target aspect ≈ master aspect → uniform scale, exact position
 *   - reflow:   aspects differ → pin layer to the master-edge it was closest to,
 *               scale by target's min-dim to keep layer proportional to canvas
 */

const ALPHA_THRESHOLD = 8;            // pixels at/below this alpha count as transparent
const ASPECT_TOLERANCE = 0.04;        // within 4% → treat as same aspect
const ANCHOR_CENTER_THRESHOLD = 0.18; // edge margin > 18% of min-dim → "centered"

// Scan pixel data for the non-transparent bounding box.
function findContentBBox(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowOff + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h, fullyTransparent: true };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Analyze a freshly-uploaded layer: detect bbox, crop image to content, record original dims.
// Returns a Promise that resolves once the (possibly cropped) image is loaded.
async function analyzeLayer(layer) {
  const img = layer.image;
  const originalW = img.naturalWidth;
  const originalH = img.naturalHeight;
  const bbox = findContentBBox(img);

  layer.originalWidth = originalW;
  layer.originalHeight = originalH;

  const needsCrop = bbox.w < originalW || bbox.h < originalH;
  if (!needsCrop || bbox.fullyTransparent) {
    layer.bboxInOriginal = { x: 0, y: 0, w: originalW, h: originalH };
    layer.wasCropped = false;
    return;
  }

  // Crop to bbox and replace the layer image with the tight version.
  const cropped = document.createElement("canvas");
  cropped.width = bbox.w;
  cropped.height = bbox.h;
  cropped.getContext("2d").drawImage(
    img,
    bbox.x, bbox.y, bbox.w, bbox.h,
    0, 0, bbox.w, bbox.h
  );
  const dataUrl = cropped.toDataURL("image/png");

  await new Promise((resolve, reject) => {
    const newImg = new Image();
    newImg.onload = () => {
      layer.image = newImg;
      layer.bboxInOriginal = { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
      layer.wasCropped = true;
      resolve();
    };
    newImg.onerror = reject;
    newImg.src = dataUrl;
  });
}

// Decide master dimensions: explicit master if uploaded, else most-common original layer size.
function resolveMasterDims(explicitMaster, layers) {
  if (explicitMaster && explicitMaster.width && explicitMaster.height) {
    return { w: explicitMaster.width, h: explicitMaster.height, source: "explicit" };
  }
  if (!layers || layers.length === 0) return null;
  const counts = new Map();
  layers.forEach(l => {
    if (!l.originalWidth) return;
    const key = `${l.originalWidth}x${l.originalHeight}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let best = null, bestN = 0;
  counts.forEach((n, key) => { if (n > bestN) { bestN = n; best = key; } });
  if (!best || bestN < 2) return null; // need at least 2 agreeing layers to infer
  const [w, h] = best.split("x").map(Number);
  return { w, h, source: "detected", supportingCount: bestN };
}

// True if the layer's original canvas matches the master canvas (within a couple pixels).
function layerAlignsToMaster(layer, master) {
  if (!master || !layer.originalWidth) return false;
  return Math.abs(layer.originalWidth - master.w) <= 2
      && Math.abs(layer.originalHeight - master.h) <= 2;
}

// Master-relative position data for an aligned layer. Coordinates are fractions 0..1.
function masterRelative(layer, master) {
  const b = layer.bboxInOriginal;
  return {
    bboxX: b.x / master.w,
    bboxY: b.y / master.h,
    relW:  b.w / master.w,
    relH:  b.h / master.h,
    cx:   (b.x + b.w / 2) / master.w,
    cy:   (b.y + b.h / 2) / master.h,
  };
}

// Convert a named 9-anchor (from user override) into the {h, v, d*} form inferAnchor returns.
// Uses a default small padding so the layer sits inside the canvas edge cleanly.
const OVERRIDE_EDGE_PAD = 0.04; // fraction of target min-dim
function applyAnchorOverride(inferred, override) {
  if (!override || override === "auto") return inferred;
  const map = {
    "top-left":      { h: "start",  v: "start", dLeft: OVERRIDE_EDGE_PAD, dTop: OVERRIDE_EDGE_PAD },
    "top-center":    { h: "center", v: "start", dTop: OVERRIDE_EDGE_PAD },
    "top-right":     { h: "end",    v: "start", dRight: OVERRIDE_EDGE_PAD, dTop: OVERRIDE_EDGE_PAD },
    "middle-left":   { h: "start",  v: "center", dLeft: OVERRIDE_EDGE_PAD },
    "center":        { h: "center", v: "center" },
    "middle-right":  { h: "end",    v: "center", dRight: OVERRIDE_EDGE_PAD },
    "bottom-left":   { h: "start",  v: "end",   dLeft: OVERRIDE_EDGE_PAD, dBottom: OVERRIDE_EDGE_PAD },
    "bottom-center": { h: "center", v: "end",   dBottom: OVERRIDE_EDGE_PAD },
    "bottom-right":  { h: "end",    v: "end",   dRight: OVERRIDE_EDGE_PAD, dBottom: OVERRIDE_EDGE_PAD },
  };
  const m = map[override];
  if (!m) return inferred;
  // Preserve the inferred distances when the override doesn't specify one (center axis).
  return {
    h: m.h, v: m.v,
    dLeft:   m.dLeft   != null ? m.dLeft   : inferred.dLeft,
    dRight:  m.dRight  != null ? m.dRight  : inferred.dRight,
    dTop:    m.dTop    != null ? m.dTop    : inferred.dTop,
    dBottom: m.dBottom != null ? m.dBottom : inferred.dBottom,
  };
}

// Pick a 9-anchor based on which master edges the layer hugged.
// Edge distances are expressed as a fraction of the master's min dimension so
// "close" means visually close regardless of master orientation.
function inferAnchor(mp, master) {
  const masterMin = Math.min(master.w, master.h);
  const dLeft   = (mp.bboxX         * master.w) / masterMin;
  const dRight  = ((1 - mp.bboxX - mp.relW) * master.w) / masterMin;
  const dTop    = (mp.bboxY         * master.h) / masterMin;
  const dBottom = ((1 - mp.bboxY - mp.relH) * master.h) / masterMin;

  // If the layer is roughly equidistant from both edges, treat it as centered on that axis.
  // Otherwise anchor to the closer edge.
  const pickAxis = (dA, dB) => {
    if (Math.abs(dA - dB) < ANCHOR_CENTER_THRESHOLD) return "center";
    return dA <= dB ? "start" : "end";
  };
  return {
    h: pickAxis(dLeft, dRight),          // start=left, end=right, center
    v: pickAxis(dTop, dBottom),          // start=top,  end=bottom, center
    dLeft, dRight, dTop, dBottom
  };
}

// Compute placement for one layer on one target canvas using smart layout.
// Falls back to role-based placement when master info is missing or the layer
// isn't aligned to the master.
// anchorOverride (optional): one of "auto" | "top-left" | "top-center" | "top-right"
//                          | "middle-left" | "center" | "middle-right"
//                          | "bottom-left" | "bottom-center" | "bottom-right"
function computeSmartPlacement(layer, master, target, anchorOverride) {
  if (!master || !layer.bboxInOriginal || !layerAlignsToMaster(layer, master)) {
    return computePlacement(layer, master, target);
  }

  const mp = masterRelative(layer, master);
  const masterAspect = master.w / master.h;
  const targetAspect = target.w / target.h;
  const aspectDiff = Math.abs(targetAspect - masterAspect) / masterAspect;

  // The layer image is already cropped to the bbox, so its natural dims equal the bbox.
  const iw = layer.image.naturalWidth;
  const ih = layer.image.naturalHeight;

  // Preserve mode: same aspect and no explicit override — trust the master placement.
  // If the user set a non-auto anchor override on a same-aspect canvas, fall through
  // to reflow logic so their override is honored.
  const hasOverride = anchorOverride && anchorOverride !== "auto";
  if (aspectDiff < ASPECT_TOLERANCE && !hasOverride) {
    const S = target.w / master.w;
    return {
      x: mp.cx * target.w,
      y: mp.cy * target.h,
      scaleX: S,
      scaleY: S,
      rotation: 0,
      visible: true,
      opacity: 1
    };
  }

  // Reflow mode.
  // Backgrounds: cover the new canvas regardless of their source coverage.
  if (layer.role === "background") {
    const scale = Math.max(target.w / iw, target.h / ih);
    return {
      x: target.w / 2, y: target.h / 2,
      scaleX: scale, scaleY: scale,
      rotation: 0, visible: true, opacity: 1
    };
  }

  // Non-background: scale by the ratio of min-dims so the layer feels equally
  // prominent on the new canvas. Anchor to whichever edge it was pinned to.
  const masterMin = Math.min(master.w, master.h);
  const targetMin = Math.min(target.w, target.h);
  let scale = targetMin / masterMin;

  // Role-based scale clamp: keep layers within readable bounds on extreme-aspect targets.
  const rule = ROLE_RULES[layer.role] || ROLE_RULES.other;
  const longestImg = Math.max(iw, ih);
  if (rule.minFrac != null) {
    const minScale = (rule.minFrac * targetMin) / longestImg;
    if (scale < minScale) scale = minScale;
  }
  if (rule.maxFrac != null) {
    const maxScale = (rule.maxFrac * targetMin) / longestImg;
    if (scale > maxScale) scale = maxScale;
  }

  const scaledW = iw * scale;
  const scaledH = ih * scale;

  // Anchor: either user-overridden for this canvas, or inferred from master position.
  const anchor = inferAnchor(mp, master);
  const effective = applyAnchorOverride(anchor, anchorOverride);
  let cx, cy;

  if (effective.h === "start")      cx = effective.dLeft  * targetMin + scaledW / 2;
  else if (effective.h === "end")   cx = target.w - effective.dRight * targetMin - scaledW / 2;
  else                              cx = target.w / 2;

  if (effective.v === "start")      cy = effective.dTop    * targetMin + scaledH / 2;
  else if (effective.v === "end")   cy = target.h - effective.dBottom * targetMin - scaledH / 2;
  else                              cy = target.h / 2;

  // Keep the layer from clipping off-canvas: clamp center so bbox stays on-canvas.
  cx = Math.min(Math.max(cx, scaledW / 2), target.w - scaledW / 2);
  cy = Math.min(Math.max(cy, scaledH / 2), target.h - scaledH / 2);

  return {
    x: cx, y: cy,
    scaleX: scale, scaleY: scale,
    rotation: 0, visible: true, opacity: 1
  };
}

// ---------------- post-placement passes ----------------

const BANNER_ASPECT_THRESHOLD = 3.0;  // width-to-height ratio beyond this → banner mode
const BANNER_MIN_SHORT_SIDE   = 180;  // short side smaller than this → banner mode
const SAFE_MARGIN_FRAC        = 0.02; // 2% of target min-dim kept clear from edges (non-bg)
const COLLISION_MAX_ITERS     = 12;

function isBannerAspect(target) {
  const aspect = Math.max(target.w, target.h) / Math.min(target.w, target.h);
  const shortSide = Math.min(target.w, target.h);
  return aspect >= BANNER_ASPECT_THRESHOLD || shortSide < BANNER_MIN_SHORT_SIDE;
}

// Push non-background layers inward so they don't hug the canvas edge.
function applySafeMargin(layout, layers, target) {
  const margin = SAFE_MARGIN_FRAC * Math.min(target.w, target.h);
  layout.forEach(entry => {
    const l = layers.find(x => x.id === entry.layerId);
    if (!l || l.role === "background") return;
    const w = l.image.naturalWidth * entry.scaleX;
    const h = l.image.naturalHeight * entry.scaleY;
    entry.x = Math.min(Math.max(entry.x, w / 2 + margin), target.w - w / 2 - margin);
    entry.y = Math.min(Math.max(entry.y, h / 2 + margin), target.h - h / 2 - margin);
  });
}

// Group-aware collision resolution. Layers that share a groupId are treated as
// one rigid "unit" — they move and shrink together. After move-based resolution
// maxes out, an auto-shrink pass kicks in: residual overlaps cause the higher-z
// unit to shrink around its own center until it fits or drops below its role's
// min scale (at which point members auto-hide).
const SHRINK_PASSES = 5;
const SHRINK_FACTOR = 0.88;

// Role priority for collision resolution. Higher = more important = last to shrink.
// Tweak here to change which layer "wins" when two overlap and one must yield.
const ROLE_PRIORITY = {
  background: 999,  // never a shrink victim (won't be picked anyway, excluded from units)
  logo:       80,
  button:     70,
  cta:        70,
  playstore:  50,
  appstore:   50,
  main:       40,
  other:      20,
};

function unitPriority(unit) {
  let max = 0;
  unit.members.forEach(m => {
    const p = ROLE_PRIORITY[m.layer.role] != null ? ROLE_PRIORITY[m.layer.role] : ROLE_PRIORITY.other;
    if (p > max) max = p;
  });
  return max;
}

// When two units overlap and one must shrink, pick the lower-priority role.
// If priorities tie, pick the visually larger one (losing area hurts less).
function pickShrinkVictim(a, b) {
  const pa = unitPriority(a);
  const pb = unitPriority(b);
  if (pa < pb) return a;
  if (pb < pa) return b;
  const ba = unitBox(a), bb = unitBox(b);
  const areaA = Math.max(0, ba.w) * Math.max(0, ba.h);
  const areaB = Math.max(0, bb.w) * Math.max(0, bb.h);
  return areaA >= areaB ? a : b;
}

function buildCollisionUnits(layout, layers) {
  const individuals = [];
  const groupMap = new Map();
  layout.forEach(entry => {
    const l = layers.find(x => x.id === entry.layerId);
    if (!l || l.role === "background" || entry.visible === false) return;
    const m = { entry, layer: l };
    if (l.groupId) {
      if (!groupMap.has(l.groupId)) groupMap.set(l.groupId, []);
      groupMap.get(l.groupId).push(m);
    } else {
      individuals.push({ members: [m], groupId: null });
    }
  });
  const groupUnits = [];
  groupMap.forEach((members, groupId) => groupUnits.push({ members, groupId }));
  const units = [...individuals, ...groupUnits];
  // Priority for "who moves": higher max z → later → more disposable. Sort ascending.
  units.sort((a, b) => {
    const az = Math.max(...a.members.map(m => m.entry.z));
    const bz = Math.max(...b.members.map(m => m.entry.z));
    return az - bz;
  });
  return units;
}

function unitBox(unit) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  unit.members.forEach(m => {
    const w = m.layer.image.naturalWidth  * m.entry.scaleX;
    const h = m.layer.image.naturalHeight * m.entry.scaleY;
    const lx = m.entry.x - w / 2, ly = m.entry.y - h / 2;
    const rx = m.entry.x + w / 2, ry = m.entry.y + h / 2;
    if (lx < x1) x1 = lx;
    if (ly < y1) y1 = ly;
    if (rx > x2) x2 = rx;
    if (ry > y2) y2 = ry;
  });
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

function moveUnit(unit, dx, dy, target) {
  unit.members.forEach(m => {
    m.entry.x += dx;
    m.entry.y += dy;
  });
  // Clamp the unit as a whole inside the canvas.
  const b = unitBox(unit);
  let cx = 0, cy = 0;
  if (b.x1 < 0) cx = -b.x1;
  else if (b.x2 > target.w) cx = target.w - b.x2;
  if (b.y1 < 0) cy = -b.y1;
  else if (b.y2 > target.h) cy = target.h - b.y2;
  if (cx || cy) {
    unit.members.forEach(m => {
      m.entry.x += cx;
      m.entry.y += cy;
    });
  }
}

// Shrink a unit around its own bbox center; if a member drops below its role's
// min allowed scale, flag that member auto-hidden. Returns true if any member
// either shrank or got auto-hidden.
function shrinkUnit(unit, target) {
  // Never shrink a locked unit — user explicitly froze it.
  if (!unitMovable(unit)) return false;
  const b = unitBox(unit);
  const gCx = (b.x1 + b.x2) / 2;
  const gCy = (b.y1 + b.y2) / 2;
  let changed = false;
  unit.members.forEach(m => {
    const rule = ROLE_RULES[m.layer.role] || ROLE_RULES.other;
    const iw = m.layer.image.naturalWidth;
    const ih = m.layer.image.naturalHeight;
    const longest = Math.max(iw, ih);
    const targetMin = Math.min(target.w, target.h);
    const minScale = rule.minFrac != null
      ? (rule.minFrac * targetMin) / longest
      : 0.05;
    const newScale = m.entry.scaleX * SHRINK_FACTOR;
    if (newScale < minScale) {
      if (m.entry.visible !== false) {
        m.entry.visible = false;
        m.entry.autoHidden = true;
        changed = true;
      }
    } else {
      // Shift member position toward the group center so the whole unit tightens evenly.
      m.entry.x = gCx + (m.entry.x - gCx) * SHRINK_FACTOR;
      m.entry.y = gCy + (m.entry.y - gCy) * SHRINK_FACTOR;
      m.entry.scaleX = newScale;
      m.entry.scaleY = newScale;
      changed = true;
    }
  });
  return changed;
}

// A unit is movable only if none of its members are locked on this canvas.
function unitMovable(unit) { return unit.members.every(m => !m.entry.locked); }

function moveCollisionPass(units, target) {
  for (let iter = 0; iter < COLLISION_MAX_ITERS; iter++) {
    let moved = false;
    for (let i = 0; i < units.length; i++) {
      const a = unitBox(units[i]);
      for (let j = i + 1; j < units.length; j++) {
        const b = unitBox(units[j]);
        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        if (ox <= 0 || oy <= 0) continue;
        const aCx = (a.x1 + a.x2) / 2, aCy = (a.y1 + a.y2) / 2;
        const bCx = (b.x1 + b.x2) / 2, bCy = (b.y1 + b.y2) / 2;

        // Prefer to move j (the later/higher-z unit). If j is locked, move i in
        // the opposite direction instead. If both locked, the overlap has to stand.
        let mover, dx = 0, dy = 0, sign = 1;
        if (unitMovable(units[j])) {
          mover = units[j];
          sign = 1;
        } else if (unitMovable(units[i])) {
          mover = units[i];
          sign = -1;
        } else {
          continue; // both locked — can't resolve
        }
        if (oy <= ox) {
          const dir = bCy >= aCy ? 1 : -1;
          dy = sign * dir * (oy + 1);
        } else {
          const dir = bCx >= aCx ? 1 : -1;
          dx = sign * dir * (ox + 1);
        }
        moveUnit(mover, dx, dy, target);
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) return;
  }
}

function findVisibleOverlappingPairs(units) {
  const visible = units.filter(u => u.members.some(m => m.entry.visible !== false));
  const pairs = [];
  for (let i = 0; i < visible.length; i++) {
    const a = unitBox(visible[i]);
    for (let j = i + 1; j < visible.length; j++) {
      const b = unitBox(visible[j]);
      const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (ox > 0 && oy > 0) pairs.push([visible[i], visible[j]]);
    }
  }
  return pairs;
}

function resolveCollisions(layout, layers, target) {
  const units = buildCollisionUnits(layout, layers);
  if (units.length < 2) return;

  moveCollisionPass(units, target);

  // Auto-shrink pass: for pairs still overlapping after move-resolution, shrink
  // the lower-priority / larger unit, then retry the move pass.
  for (let pass = 0; pass < SHRINK_PASSES; pass++) {
    const pairs = findVisibleOverlappingPairs(units);
    if (pairs.length === 0) return;
    const victims = new Set();
    pairs.forEach(([a, b]) => victims.add(pickShrinkVictim(a, b)));
    let shrunkAny = false;
    victims.forEach(u => {
      if (shrinkUnit(u, target)) shrunkAny = true;
    });
    if (!shrunkAny) return;
    moveCollisionPass(units, target);
  }
}

// Banner mode: for wide thin targets (e.g. 320x50) hide non-essential layers
// and lay logo out on the left, button on the right, both vertically centered.
// Returns true if the target matched banner mode.
function applyBannerMode(layout, layers, target) {
  if (!isBannerAspect(target)) return false;

  const w = target.w, h = target.h;
  const padX = Math.max(4, w * 0.02);
  const byRole = {};

  layout.forEach(entry => {
    const l = layers.find(x => x.id === entry.layerId);
    if (!l) return;
    byRole[l.role] = byRole[l.role] || [];
    byRole[l.role].push({ entry, layer: l });
    if (isEssentialOnBanner(l.role)) {
      entry.autoHidden = false;
    } else {
      entry.visible = false;
      entry.autoHidden = true;
    }
  });

  // Background (already placed by cover mode) stays as-is.
  // Logo: left-aligned, vertically centered, ~85% of banner height.
  const logoItem = byRole.logo && byRole.logo[0];
  if (logoItem) {
    const iw = logoItem.layer.image.naturalWidth;
    const ih = logoItem.layer.image.naturalHeight;
    const s = Math.min((h * 0.85) / ih, (w * 0.40) / iw);
    logoItem.entry.scaleX = s;
    logoItem.entry.scaleY = s;
    logoItem.entry.rotation = 0;
    logoItem.entry.visible = true;
    logoItem.entry.autoHidden = false;
    logoItem.entry.x = padX + (iw * s) / 2;
    logoItem.entry.y = h / 2;
  }
  // Button: right-aligned, vertically centered, ~72% of banner height.
  const buttonItem = byRole.button && byRole.button[0];
  if (buttonItem) {
    const iw = buttonItem.layer.image.naturalWidth;
    const ih = buttonItem.layer.image.naturalHeight;
    const s = Math.min((h * 0.72) / ih, (w * 0.45) / iw);
    buttonItem.entry.scaleX = s;
    buttonItem.entry.scaleY = s;
    buttonItem.entry.rotation = 0;
    buttonItem.entry.visible = true;
    buttonItem.entry.autoHidden = false;
    buttonItem.entry.x = w - padX - (iw * s) / 2;
    buttonItem.entry.y = h / 2;
  }
  return true;
}

// Build the full z-ordered layout for a target canvas using smart placement.
// anchorOverrides: { [layerId]: "auto" | "top-left" | ... } — takes precedence over inferred anchors.
// prevLayout (optional): previous layout for this canvas. Used to preserve
//                        user-flagged `userHidden` entries across a Reset.
function buildSmartLayout(layers, master, target, anchorOverrides, prevLayout) {
  anchorOverrides = anchorOverrides || {};
  const prevByLayer = new Map();
  if (prevLayout) prevLayout.forEach(e => prevByLayer.set(e.layerId, e));
  const ordered = [...layers].sort((a, b) => {
    const aBg = a.role === "background" ? 0 : 1;
    const bBg = b.role === "background" ? 0 : 1;
    if (aBg !== bBg) return aBg - bBg;
    return a.order - b.order;
  });

  const masterAspect = master ? master.w / master.h : null;
  const targetAspect = target.w / target.h;
  const sameAspect = masterAspect
    && Math.abs(targetAspect - masterAspect) / masterAspect < ASPECT_TOLERANCE;

  // --- Place layers, grouping members of the same groupId as one unit in reflow mode. ---
  const layout = [];
  let z = 0;
  const seenGroups = new Set();

  for (const layer of ordered) {
    if (layer.groupId && !sameAspect && layer.role !== "background") {
      if (seenGroups.has(layer.groupId)) continue;
      seenGroups.add(layer.groupId);
      const members = ordered.filter(l => l.groupId === layer.groupId && l.role !== "background");
      if (members.length > 1 && master && members.every(m => layerAlignsToMaster(m, master))) {
        const placements = computeGroupPlacement(members, master, target, anchorOverrides);
        placements.forEach(p => {
          layout.push(Object.assign({ layerId: p.layerId, z: z++, autoHidden: false }, p.placement));
        });
        continue;
      }
    }
    layout.push(Object.assign(
      { layerId: layer.id, z: z++, autoHidden: false },
      computeSmartPlacement(layer, master, target, anchorOverrides[layer.id])
    ));
  }

  // Reflow-mode passes: preserve mode trusts the designer's master composition exactly.
  if (!sameAspect) {
    const banner = applyBannerMode(layout, layers, target);
    if (!banner) {
      applySafeMargin(layout, layers, target);
      resolveCollisions(layout, layers, target);
    }
  }

  // Apply post-pass overrides from the previous layout:
  //  - locked entries carry forward position/scale/rotation/visibility unchanged
  //  - userHidden (explicit manual hide) wins over any visibility the passes computed
  layout.forEach(entry => {
    const prev = prevByLayer.get(entry.layerId);
    if (!prev) return;
    if (prev.locked) {
      entry.locked   = true;
      entry.x        = prev.x;
      entry.y        = prev.y;
      entry.scaleX   = prev.scaleX;
      entry.scaleY   = prev.scaleY;
      entry.rotation = prev.rotation || 0;
      entry.visible  = prev.visible !== false;
      entry.opacity  = prev.opacity == null ? 1 : prev.opacity;
      entry.autoHidden = !!prev.autoHidden;
      entry.userHidden = !!prev.userHidden;
      return; // locked wins over all flags below
    }
    if (prev.userHidden) {
      entry.visible = false;
      entry.userHidden = true;
      entry.autoHidden = false;
    }
  });
  return layout;
}

// Place a group of master-aligned layers as one cohesive unit.
// Strategy: use the group's combined master bbox to infer anchor and scale,
// then place each member at its master-relative offset from the group's center.
function computeGroupPlacement(members, master, target, anchorOverrides) {
  anchorOverrides = anchorOverrides || {};
  // Combined group bbox in master-original coordinates.
  let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;
  members.forEach(m => {
    const b = m.bboxInOriginal;
    gx1 = Math.min(gx1, b.x);
    gy1 = Math.min(gy1, b.y);
    gx2 = Math.max(gx2, b.x + b.w);
    gy2 = Math.max(gy2, b.y + b.h);
  });
  const groupMasterCx = (gx1 + gx2) / 2;
  const groupMasterCy = (gy1 + gy2) / 2;
  const groupMasterW  = gx2 - gx1;
  const groupMasterH  = gy2 - gy1;

  // Synthesize a master-relative descriptor for the group so inferAnchor can judge it.
  const groupMp = {
    bboxX: gx1 / master.w,
    bboxY: gy1 / master.h,
    relW:  groupMasterW / master.w,
    relH:  groupMasterH / master.h,
    cx:    groupMasterCx / master.w,
    cy:    groupMasterCy / master.h,
  };

  const masterMin = Math.min(master.w, master.h);
  const targetMin = Math.min(target.w, target.h);

  // Group scale: start from min-dim ratio, then constrain so the group still fits on target.
  let scale = targetMin / masterMin;
  // Make sure the group's bbox at this scale fits inside the target (leaving a small margin).
  const maxGroupW = target.w * 0.92;
  const maxGroupH = target.h * 0.92;
  const scaleW = maxGroupW / groupMasterW;
  const scaleH = maxGroupH / groupMasterH;
  const fitScale = Math.min(scaleW, scaleH);
  if (fitScale < scale) scale = fitScale;

  // Use the first member's override to decide the anchor (groups share one anchor decision).
  const firstOverride = anchorOverrides[members[0].id];
  const inferred = inferAnchor(groupMp, master);
  const anchor = applyAnchorOverride(inferred, firstOverride);

  const scaledGroupW = groupMasterW * scale;
  const scaledGroupH = groupMasterH * scale;

  let gcx, gcy;
  if (anchor.h === "start")      gcx = anchor.dLeft  * targetMin + scaledGroupW / 2;
  else if (anchor.h === "end")   gcx = target.w - anchor.dRight * targetMin - scaledGroupW / 2;
  else                           gcx = target.w / 2;

  if (anchor.v === "start")      gcy = anchor.dTop    * targetMin + scaledGroupH / 2;
  else if (anchor.v === "end")   gcy = target.h - anchor.dBottom * targetMin - scaledGroupH / 2;
  else                           gcy = target.h / 2;

  // Keep the group as a whole inside the canvas.
  gcx = Math.min(Math.max(gcx, scaledGroupW / 2), target.w - scaledGroupW / 2);
  gcy = Math.min(Math.max(gcy, scaledGroupH / 2), target.h - scaledGroupH / 2);

  return members.map(m => {
    // Each member's center in master coords.
    const b = m.bboxInOriginal;
    const memberCx = b.x + b.w / 2;
    const memberCy = b.y + b.h / 2;
    // Offset from the group center in master coords, scaled to target.
    const offX = (memberCx - groupMasterCx) * scale;
    const offY = (memberCy - groupMasterCy) * scale;
    return {
      layerId: m.id,
      placement: {
        x: gcx + offX,
        y: gcy + offY,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        visible: true,
        opacity: 1
      }
    };
  });
}
