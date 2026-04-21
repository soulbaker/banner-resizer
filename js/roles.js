const ROLES = [
  { id: "background", label: "Background" },
  { id: "main",       label: "Main Imagery" },
  { id: "logo",       label: "Logo" },
  { id: "cta",        label: "CTA" },
  { id: "button",     label: "Button" },
  { id: "appstore",   label: "App Store Badge" },
  { id: "playstore",  label: "Play Store Badge" },
  { id: "other",      label: "Other" }
];

const ROLE_LABELS = ROLES.reduce((m, r) => { m[r.id] = r.label; return m; }, {});

// Default placement rules per role for auto-layout.
//   mode: "cover" fills canvas (background-style), "fit" sizes by sizeFrac of min(W,H)
//   anchor: where the layer's center sits on the canvas
//   sizeFrac: fraction of min(W,H) that the layer's longest side takes
//   padding: fraction of canvas min-dim used as margin from the anchored edge
//   minFrac / maxFrac: clamp the layer's longest visible side to this fraction of target min-dim (reflow only)
//   essentialOnBanner: true keeps this role visible in banner-mode targets; false auto-hides it
const ROLE_RULES = {
  background: { mode: "cover", anchor: "center",         padding: 0,                                                                  essentialOnBanner: true  },
  main:       { mode: "fit",   anchor: "center",         sizeFrac: 0.70, padding: 0.04, minFrac: 0.30, maxFrac: 0.95, essentialOnBanner: false },
  logo:       { mode: "fit",   anchor: "top-left",       sizeFrac: 0.18, padding: 0.04, minFrac: 0.12, maxFrac: 0.35, essentialOnBanner: true  },
  cta:        { mode: "fit",   anchor: "top-center",     sizeFrac: 0.70, padding: 0.06, minFrac: 0.35, maxFrac: 0.95, essentialOnBanner: false },
  button:     { mode: "fit",   anchor: "bottom-center",  sizeFrac: 0.65, padding: 0.08, minFrac: 0.35, maxFrac: 0.85, essentialOnBanner: true  },
  appstore:   { mode: "fit",   anchor: "bottom-left",    sizeFrac: 0.22, padding: 0.04, minFrac: 0.15, maxFrac: 0.40, essentialOnBanner: false },
  playstore:  { mode: "fit",   anchor: "bottom-right",   sizeFrac: 0.22, padding: 0.04, minFrac: 0.15, maxFrac: 0.40, essentialOnBanner: false },
  other:      { mode: "fit",   anchor: "center",         sizeFrac: 0.50, padding: 0.04, minFrac: 0.15, maxFrac: 0.90, essentialOnBanner: false }
};

function isEssentialOnBanner(roleId) {
  return (ROLE_RULES[roleId] || ROLE_RULES.other).essentialOnBanner === true;
}

function guessRoleFromFilename(name) {
  const n = name.toLowerCase();
  if (/(^|[_\-\s.])(bg|background)([_\-\s.]|$)/.test(n)) return "background";
  if (/(^|[_\-\s.])logo([_\-\s.]|$)/.test(n)) return "logo";
  if (/(^|[_\-\s.])(cta|headline|tagline|title|text)([_\-\s.]|$)/.test(n)) return "cta";
  if (/(^|[_\-\s.])(button|btn|install|play|download)([_\-\s.]|$)/.test(n)) return "button";
  if (/(app[\s_\-]*store|appstore|apple|ios)/.test(n)) return "appstore";
  if (/(play[\s_\-]*store|playstore|googleplay|gplay|android)/.test(n)) return "playstore";
  if (/(main|hero|character|imagery|product)/.test(n)) return "main";
  return "other";
}
