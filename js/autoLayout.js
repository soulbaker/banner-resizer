// Compute initial placement for one layer on one target canvas, using its role rules.
// Returns { x, y, scaleX, scaleY, rotation, visible, opacity } in canvas-native pixel coords.
// x,y is the CENTER of the layer (we use center-origin images in Konva).
function computePlacement(layer, master, target) {
  const rule = ROLE_RULES[layer.role] || ROLE_RULES.other;
  const W = target.w, H = target.h;
  const iw = layer.image.naturalWidth;
  const ih = layer.image.naturalHeight;
  const aspect = iw / ih;

  let w, h;
  if (rule.mode === "cover") {
    const scale = Math.max(W / iw, H / ih);
    w = iw * scale;
    h = ih * scale;
  } else {
    const minSide = Math.min(W, H);
    const longest = rule.sizeFrac * minSide;
    if (aspect >= 1) { w = longest;        h = longest / aspect; }
    else             { h = longest;        w = longest * aspect; }
  }

  const padX = (rule.padding || 0) * W;
  const padY = (rule.padding || 0) * H;

  let cx, cy;
  switch (rule.anchor) {
    case "top-left":       cx = padX + w / 2;       cy = padY + h / 2;       break;
    case "top-center":     cx = W / 2;              cy = padY + h / 2;       break;
    case "top-right":      cx = W - padX - w / 2;   cy = padY + h / 2;       break;
    case "bottom-left":    cx = padX + w / 2;       cy = H - padY - h / 2;   break;
    case "bottom-center":  cx = W / 2;              cy = H - padY - h / 2;   break;
    case "bottom-right":   cx = W - padX - w / 2;   cy = H - padY - h / 2;   break;
    case "center":
    default:               cx = W / 2;              cy = H / 2;              break;
  }

  return {
    x: cx,
    y: cy,
    scaleX: w / iw,
    scaleY: h / ih,
    rotation: 0,
    visible: true,
    opacity: 1
  };
}

// Build the full z-ordered layout for a target canvas.
// Backgrounds always sit at the bottom; everything else keeps its upload order.
function buildLayout(layers, master, target) {
  const ordered = [...layers].sort((a, b) => {
    const aBg = a.role === "background" ? 0 : 1;
    const bBg = b.role === "background" ? 0 : 1;
    if (aBg !== bBg) return aBg - bBg;
    return a.order - b.order;
  });
  return ordered.map((l, i) => Object.assign(
    { layerId: l.id, z: i },
    computePlacement(l, master, target)
  ));
}
