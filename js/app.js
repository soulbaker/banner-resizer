/* Banner Resizer — MVP
 *
 * State lives in `state`. The app has three logical surfaces:
 *   - left sidebar: uploads + size selection (setup)
 *   - center: active Konva stage for the currently focused size, plus preview strip
 *   - right sidebar: layer list & transform inputs for the selected layer
 */

const state = {
  // "Top-level" fields are always the ACTIVE variant's data. Variants live in `variants`
  // and are swapped in/out via switchVariant(). This keeps the rest of the app ignorant
  // of variants — it still just reads state.layers, state.canvases, etc.
  master: null,             // { image, width, height, name } — optional
  layers: [],               // [{ id, name, image, role, order, groupId? }]
  selectedSizes: [],        // [{ w, h, name, network }]
  canvases: {},             // id -> { id, w, h, name, network, layout, stage?, konvaLayer?, transformer?, nodes?, anchorOverrides?, guideLayer?, presets? }
  activeCanvasId: null,
  selectedLayerId: null,
  nextLayerOrder: 0,
  pendingAsyncEdits: 0,     // while > 0, undo/redo disabled (async uploads in flight)
  variants: {},             // id -> { id, name, master, layers, canvases, selectedSizes, nextLayerOrder }
  activeVariantId: null,
  prefs: {
    snapEnabled:      loadPref("br.snapEnabled",      true),
    showSafeZones:    loadPref("br.showSafeZones",    false),
    showMasterGhost:  loadPref("br.showMasterGhost",  false),
    debugOverlay:     loadPref("br.debugOverlay",     false),
  }
};

// ---------- variants ----------
//
// A variant is an isolated project slot: its own master, layers, canvases, and
// size selection. The currently-active variant's data lives on the top-level
// state.* fields; variants stores the rest. Switching swaps them in/out.
function initVariants() {
  if (Object.keys(state.variants).length === 0) {
    const id = "v_" + Math.random().toString(36).slice(2, 8);
    state.variants[id] = {
      id, name: "Base",
      master: null, layers: [], canvases: {},
      selectedSizes: [], nextLayerOrder: 0,
    };
    state.activeVariantId = id;
  }
}

function saveActiveVariantState() {
  const v = state.variants[state.activeVariantId];
  if (!v) return;
  v.master         = state.master;
  v.layers         = state.layers;
  v.canvases       = state.canvases;
  v.selectedSizes  = state.selectedSizes;
  v.nextLayerOrder = state.nextLayerOrder;
}

function switchVariant(newId) {
  if (newId === state.activeVariantId) return;
  const newVariant = state.variants[newId];
  if (!newVariant) return;
  saveActiveVariantState();

  // Destroy live Konva stages belonging to outgoing variant.
  Object.values(state.canvases).forEach(c => { if (c.stage) c.stage.destroy(); });

  state.activeVariantId = newId;
  state.master         = newVariant.master || null;
  state.layers         = newVariant.layers || [];
  state.canvases       = newVariant.canvases || {};
  state.selectedSizes  = newVariant.selectedSizes || [];
  state.nextLayerOrder = newVariant.nextLayerOrder || 0;
  state.selectedLayerId = null;
  state.activeCanvasId = Object.keys(state.canvases)[0] || null;

  renderUploadLayersList();
  renderMasterPreviewFromState();
  renderDetectedMaster();
  syncNetworkCheckboxesFromState();
  renderPreviews();
  renderActiveCanvas();
  renderVariantPicker();
}

function cloneLayerForVariant(layer) {
  // Shallow clone — image ref is shared via the image cache, other fields are primitives
  // except bboxInOriginal which we copy by hand. groupId stays identical so group
  // relationships survive the clone.
  return {
    ...layer,
    bboxInOriginal: layer.bboxInOriginal ? { ...layer.bboxInOriginal } : null,
  };
}

function cloneCanvasForVariant(c) {
  return {
    id: c.id, w: c.w, h: c.h, name: c.name, network: c.network,
    safeZones: c.safeZones ? JSON.parse(JSON.stringify(c.safeZones)) : null,
    anchorOverrides: { ...(c.anchorOverrides || {}) },
    presets: c.presets ? JSON.parse(JSON.stringify(c.presets)) : undefined,
    layout: c.layout.map(e => ({ ...e })),
  };
}

function duplicateActiveVariant() {
  saveActiveVariantState();
  const src = state.variants[state.activeVariantId];
  if (!src) return;
  const name = prompt("New variant name:", `${src.name} copy`);
  if (!name) return;
  pushHistory();
  const id = "v_" + Math.random().toString(36).slice(2, 8);
  state.variants[id] = {
    id, name,
    master: src.master ? { ...src.master } : null,
    layers: src.layers.map(cloneLayerForVariant),
    canvases: Object.fromEntries(
      Object.entries(src.canvases || {}).map(([k, c]) => [k, cloneCanvasForVariant(c)])
    ),
    selectedSizes: src.selectedSizes.map(s => ({ ...s })),
    nextLayerOrder: src.nextLayerOrder,
  };
  switchVariant(id);
  toast(`Variant "${name}" created`);
}

function renameActiveVariant() {
  const v = state.variants[state.activeVariantId];
  if (!v) return;
  const name = prompt("Variant name:", v.name);
  if (!name) return;
  pushHistory();
  v.name = name;
  renderVariantPicker();
  // Preset preview filenames include variant name — refresh if the export modal is open.
  if (!document.getElementById("export-modal").hidden) updateExportFilenamePreview();
}

function deleteActiveVariant() {
  const ids = Object.keys(state.variants);
  if (ids.length <= 1) { toast("Can't delete the only variant", true); return; }
  const v = state.variants[state.activeVariantId];
  if (!v) return;
  if (!confirm(`Delete variant "${v.name}"? This can't be undone except via undo.`)) return;
  pushHistory();
  delete state.variants[state.activeVariantId];
  const nextId = Object.keys(state.variants)[0];
  state.activeVariantId = nextId;
  // Reload the first remaining variant into top-level.
  const nv = state.variants[nextId];
  state.master         = nv.master || null;
  state.layers         = nv.layers || [];
  state.canvases       = nv.canvases || {};
  state.selectedSizes  = nv.selectedSizes || [];
  state.nextLayerOrder = nv.nextLayerOrder || 0;
  state.selectedLayerId = null;
  state.activeCanvasId = Object.keys(state.canvases)[0] || null;

  renderUploadLayersList();
  renderMasterPreviewFromState();
  renderDetectedMaster();
  syncNetworkCheckboxesFromState();
  renderPreviews();
  renderActiveCanvas();
  renderVariantPicker();
}

function renderVariantPicker() {
  const sel = document.getElementById("variant-select");
  if (!sel) return;
  sel.innerHTML = "";
  Object.values(state.variants).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    if (v.id === state.activeVariantId) opt.selected = true;
    sel.appendChild(opt);
  });
  document.getElementById("btn-variant-delete").disabled = Object.keys(state.variants).length <= 1;
}

// After switching variant, re-reflect state.selectedSizes into the network checkboxes.
function syncNetworkCheckboxesFromState() {
  const pickedKeys = new Set(state.selectedSizes.map(s => `${s.network}|${s.w}x${s.h}|${s.name}`));
  document.querySelectorAll('#networks-list input[type="checkbox"]').forEach(cb => {
    const k = `${cb.dataset.network}|${cb.dataset.w}x${cb.dataset.h}|${cb.dataset.name}`;
    cb.checked = pickedKeys.has(k);
  });
  document.getElementById("sizes-count").textContent =
    `${state.selectedSizes.length} size${state.selectedSizes.length === 1 ? "" : "s"} selected`;
}

// ---------- history (undo/redo) ----------
//
// `past` holds snapshots of state BEFORE each edit. `future` grows on undo so redo
// can replay. Layer and master images are kept in a cache so snapshots themselves
// stay small JSON — only ids + metadata travel through the stack.
const HISTORY_MAX = 60;
const history = { past: [], future: [] };
const imageCache = new Map(); // layerId -> HTMLImageElement
let cachedMasterImage = null;

function rememberImage(layerId, image) { imageCache.set(layerId, image); }
function rememberMasterImage(image)     { cachedMasterImage = image; }

function snapshotState() {
  return {
    layers: state.layers.map(l => ({
      id: l.id, name: l.name, role: l.role, order: l.order,
      groupId: l.groupId || null,
      originalWidth: l.originalWidth, originalHeight: l.originalHeight,
      bboxInOriginal: l.bboxInOriginal ? { ...l.bboxInOriginal } : null,
      wasCropped: !!l.wasCropped,
    })),
    canvases: Object.values(state.canvases).map(c => ({
      id: c.id, w: c.w, h: c.h, name: c.name, network: c.network,
      safeZones: c.safeZones ? JSON.parse(JSON.stringify(c.safeZones)) : null,
      anchorOverrides: { ...(c.anchorOverrides || {}) },
      layout: c.layout.map(e => ({ ...e })),
      presets: c.presets ? JSON.parse(JSON.stringify(c.presets)) : undefined,
    })),
    master: state.master
      ? { width: state.master.width, height: state.master.height, name: state.master.name }
      : null,
    activeCanvasId: state.activeCanvasId,
    selectedLayerId: state.selectedLayerId,
    nextLayerOrder: state.nextLayerOrder,
  };
}

function restoreState(snap) {
  // Tear down existing Konva stages so renderActiveCanvas builds cleanly.
  Object.values(state.canvases).forEach(c => { if (c.stage) c.stage.destroy(); });

  state.layers = snap.layers
    .map(l => {
      const image = imageCache.get(l.id);
      if (!image) return null;
      return { ...l, image };
    })
    .filter(Boolean);

  state.canvases = {};
  snap.canvases.forEach(c => {
    state.canvases[c.id] = {
      ...c,
      layout: c.layout.map(e => ({ ...e })),
      anchorOverrides: { ...(c.anchorOverrides || {}) },
    };
  });

  if (snap.master) {
    state.master = {
      width: snap.master.width,
      height: snap.master.height,
      name: snap.master.name,
      image: cachedMasterImage,
    };
  } else {
    state.master = null;
  }
  state.activeCanvasId = snap.activeCanvasId;
  state.selectedLayerId = snap.selectedLayerId;
  state.nextLayerOrder = snap.nextLayerOrder;

  renderUploadLayersList();
  renderMasterPreviewFromState();
  renderDetectedMaster();
  renderPreviews();
  renderActiveCanvas();
  updateUndoUi();
}

// Rebuild the master-preview DOM from state (used on restore).
function renderMasterPreviewFromState() {
  const preview = document.getElementById("master-preview");
  if (!preview) return;
  preview.innerHTML = "";
  if (state.master && state.master.image) {
    const img = document.createElement("img");
    img.src = state.master.image.src;
    const dims = document.createElement("div");
    dims.className = "muted";
    dims.textContent = `${state.master.width} × ${state.master.height} — ${state.master.name || "master"}`;
    preview.appendChild(img);
    preview.appendChild(dims);
  } else if (state.master) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = `${state.master.width} × ${state.master.height} — ${state.master.name || "master"}`;
    preview.appendChild(div);
  }
}

function pushHistory() {
  history.past.push(snapshotState());
  if (history.past.length > HISTORY_MAX) history.past.shift();
  history.future = [];
  updateUndoUi();
}

function undo() {
  if (state.pendingAsyncEdits > 0) return;
  if (history.past.length === 0) return;
  history.future.push(snapshotState());
  restoreState(history.past.pop());
}

function redo() {
  if (state.pendingAsyncEdits > 0) return;
  if (history.future.length === 0) return;
  history.past.push(snapshotState());
  restoreState(history.future.pop());
}

function updateUndoUi() {
  const u = document.getElementById("btn-undo");
  const r = document.getElementById("btn-redo");
  if (u) u.disabled = state.pendingAsyncEdits > 0 || history.past.length === 0;
  if (r) r.disabled = state.pendingAsyncEdits > 0 || history.future.length === 0;
}

function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ---------- bootstrap ----------
document.addEventListener("DOMContentLoaded", () => {
  initVariants();
  setupMasterUpload();
  setupLayersUpload();
  renderNetworksList();
  setupTopbarActions();
  renderVariantPicker();
  window.addEventListener("resize", () => { if (state.activeCanvasId) renderActiveCanvas(); });
});

// ---------- master file upload ----------
function setupMasterUpload() {
  const zone = document.getElementById("master-drop");
  const input = document.getElementById("input-master");
  document.getElementById("btn-browse-master").addEventListener("click", e => {
    e.stopPropagation();
    input.click();
  });
  zone.addEventListener("click", () => input.click());
  setupDragDrop(zone, files => { if (files[0]) loadMaster(files[0]); });
  input.addEventListener("change", e => {
    if (e.target.files[0]) loadMaster(e.target.files[0]);
    e.target.value = "";
  });
}

function loadMaster(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    pushHistory();
    rememberMasterImage(img);
    state.master = { image: img, width: img.naturalWidth, height: img.naturalHeight, name: file.name };
    const preview = document.getElementById("master-preview");
    preview.innerHTML = "";
    const previewImg = document.createElement("img");
    previewImg.src = url;
    const dims = document.createElement("div");
    dims.className = "muted";
    dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} — ${file.name}`;
    preview.appendChild(previewImg);
    preview.appendChild(dims);
    renderUploadLayersList();
  };
  img.onerror = () => toast("Failed to load master image", true);
  img.src = url;
}

// Show auto-detected master dims in the master-preview area (only when no explicit master uploaded).
function renderDetectedMaster() {
  if (state.master) return;
  const preview = document.getElementById("master-preview");
  preview.innerHTML = "";
  const detected = resolveMasterDims(null, state.layers);
  if (!detected) return;
  const div = document.createElement("div");
  div.className = "muted";
  div.style.marginTop = "8px";
  div.textContent = `Detected master: ${detected.w} × ${detected.h} (from ${detected.supportingCount} layer${detected.supportingCount === 1 ? "" : "s"})`;
  preview.appendChild(div);
}

// ---------- layers upload ----------
function setupLayersUpload() {
  const zone = document.getElementById("layers-drop");
  const input = document.getElementById("input-layers");
  document.getElementById("btn-browse-layers").addEventListener("click", e => {
    e.stopPropagation();
    input.click();
  });
  zone.addEventListener("click", () => input.click());
  setupDragDrop(zone, files => addLayerFiles(Array.from(files)));
  input.addEventListener("change", e => {
    addLayerFiles(Array.from(e.target.files));
    e.target.value = "";
  });
}

function addLayerFiles(files) {
  const imgFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
  if (imgFiles.length === 0) return;
  // One history snapshot for the whole drop (not one per file).
  pushHistory();
  state.pendingAsyncEdits += imgFiles.length;
  updateUndoUi();
  imgFiles.forEach(file => {
    const order = state.nextLayerOrder++;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      const layer = {
        id: uid(),
        name: file.name,
        image: img,
        role: guessRoleFromFilename(file.name),
        order,
        groupId: null,
      };
      try {
        await analyzeLayer(layer);
      } catch (err) {
        console.warn("Layer analysis failed", file.name, err);
      }
      rememberImage(layer.id, layer.image);
      state.layers.push(layer);
      state.layers.sort((a, b) => a.order - b.order);
      renderUploadLayersList();
      renderDetectedMaster();
      state.pendingAsyncEdits--;
      updateUndoUi();
    };
    img.onerror = () => {
      toast(`Failed to load ${file.name}`, true);
      state.pendingAsyncEdits--;
      updateUndoUi();
    };
    img.src = url;
  });
}

function renderUploadLayersList() {
  const ul = document.getElementById("upload-layers-list");
  ul.innerHTML = "";
  const master = resolveMasterDims(state.master, state.layers);
  state.layers.forEach(layer => {
    const li = document.createElement("li");
    const thumb = document.createElement("img");
    thumb.src = layer.image.src;
    const aligned = master && layerAlignsToMaster(layer, master);
    if (aligned) {
      li.classList.add("aligned");
      thumb.title = layer.wasCropped
        ? `Master-aligned · auto-cropped from ${layer.originalWidth}×${layer.originalHeight}`
        : `Master-aligned · ${layer.originalWidth}×${layer.originalHeight}`;
    } else {
      thumb.title = layer.originalWidth
        ? `Raw asset · ${layer.originalWidth}×${layer.originalHeight} (pre-cropped or non-master dims)`
        : "";
    }
    const name = document.createElement("span");
    name.title = layer.name;
    name.textContent = (aligned ? "◆ " : "") + layer.name;
    const select = document.createElement("select");
    ROLES.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.label;
      if (r.id === layer.role) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", e => {
      pushHistory();
      layer.role = e.target.value;
    });

    // Group dropdown: None / existing groups / + New Group.
    const groupSelect = document.createElement("select");
    groupSelect.title = "Layer group — members reflow together as one unit";
    const existingGroups = [...new Set(state.layers.map(l => l.groupId).filter(Boolean))].sort();
    const options = [["", "No group"], ...existingGroups.map(g => [g, `Group ${g}`]), ["__new__", "+ New group"]];
    options.forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      if ((layer.groupId || "") === val) opt.selected = true;
      groupSelect.appendChild(opt);
    });
    groupSelect.addEventListener("change", e => {
      pushHistory();
      if (e.target.value === "__new__") {
        layer.groupId = nextGroupLetter();
      } else {
        layer.groupId = e.target.value || null;
      }
      renderUploadLayersList();
    });
    if (layer.groupId) li.setAttribute("data-group", layer.groupId);

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove layer";
    remove.addEventListener("click", () => removeLayer(layer.id));

    li.appendChild(thumb);
    li.appendChild(name);
    li.appendChild(select);
    li.appendChild(groupSelect);
    li.appendChild(remove);
    ul.appendChild(li);
  });
}

function nextGroupLetter() {
  const used = new Set(state.layers.map(l => l.groupId).filter(Boolean));
  for (let code = 65; code <= 90; code++) { // A..Z
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  return String.fromCharCode(65 + used.size); // fallback
}

function removeLayer(layerId) {
  pushHistory();
  state.layers = state.layers.filter(l => l.id !== layerId);
  Object.values(state.canvases).forEach(c => {
    c.layout = c.layout.filter(e => e.layerId !== layerId);
  });
  if (state.selectedLayerId === layerId) state.selectedLayerId = null;
  renderUploadLayersList();
  renderDetectedMaster();
  renderPreviews();
  renderActiveCanvas();
}

// ---------- ad networks list ----------
function renderNetworksList() {
  const container = document.getElementById("networks-list");
  container.innerHTML = "";
  Object.entries(AD_NETWORKS).forEach(([network, sizes]) => {
    const group = document.createElement("div");
    group.className = "network-group";

    const head = document.createElement("div");
    head.className = "network-head";
    const title = document.createElement("span");
    title.textContent = network;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▸";
    head.appendChild(title);
    head.appendChild(caret);
    head.addEventListener("click", () => {
      const open = group.classList.toggle("open");
      caret.textContent = open ? "▾" : "▸";
    });

    const sizesDiv = document.createElement("div");
    sizesDiv.className = "network-sizes";
    sizes.forEach(s => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.network = network;
      cb.dataset.w = s.w;
      cb.dataset.h = s.h;
      cb.dataset.name = s.name;
      cb.addEventListener("change", updateSelectedSizes);
      const text = document.createElement("span");
      text.innerHTML = `${s.w}×${s.h} <span class="muted">${s.name}</span>`;
      label.appendChild(cb);
      label.appendChild(text);
      sizesDiv.appendChild(label);
    });

    group.appendChild(head);
    group.appendChild(sizesDiv);
    container.appendChild(group);
  });
}

function updateSelectedSizes() {
  const checks = document.querySelectorAll('#networks-list input[type="checkbox"]');
  state.selectedSizes = [];
  checks.forEach(c => {
    if (c.checked) {
      // Look up safeZones from the ad network data.
      const network = c.dataset.network;
      const sizeName = c.dataset.name;
      const w = +c.dataset.w, h = +c.dataset.h;
      const meta = (AD_NETWORKS[network] || []).find(s => s.w === w && s.h === h && s.name === sizeName);
      state.selectedSizes.push({
        w, h, name: sizeName, network,
        safeZones: meta && meta.safeZones ? meta.safeZones : null
      });
    }
  });
  document.getElementById("sizes-count").textContent =
    `${state.selectedSizes.length} size${state.selectedSizes.length === 1 ? "" : "s"} selected`;
}

// ---------- topbar actions ----------
function setupTopbarActions() {
  document.getElementById("btn-generate").addEventListener("click", generateAll);
  document.getElementById("btn-save-template").addEventListener("click", saveTemplate);
  document.getElementById("btn-load-template").addEventListener("click", () =>
    document.getElementById("input-load-template").click()
  );
  document.getElementById("input-load-template").addEventListener("change", e => {
    if (e.target.files[0]) loadTemplate(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btn-export-all").addEventListener("click", openExportModal);
  document.getElementById("btn-export-cancel").addEventListener("click", closeExportModal);
  document.getElementById("btn-export-confirm").addEventListener("click", performExport);

  document.getElementById("variant-select").addEventListener("change", e => switchVariant(e.target.value));
  document.getElementById("btn-variant-new").addEventListener("click", duplicateActiveVariant);
  document.getElementById("btn-variant-rename").addEventListener("click", renameActiveVariant);
  document.getElementById("btn-variant-delete").addEventListener("click", deleteActiveVariant);

  const snapBtn = document.getElementById("btn-toggle-snap");
  const szBtn   = document.getElementById("btn-toggle-safezones");
  const refBtn  = document.getElementById("btn-toggle-ref");
  const syncToggle = (btn, on) => btn.classList.toggle("on", on);
  syncToggle(snapBtn, state.prefs.snapEnabled);
  syncToggle(szBtn,   state.prefs.showSafeZones);
  syncToggle(refBtn,  state.prefs.showMasterGhost);

  snapBtn.addEventListener("click", () => {
    state.prefs.snapEnabled = !state.prefs.snapEnabled;
    savePref("br.snapEnabled", state.prefs.snapEnabled);
    syncToggle(snapBtn, state.prefs.snapEnabled);
  });
  szBtn.addEventListener("click", () => {
    state.prefs.showSafeZones = !state.prefs.showSafeZones;
    savePref("br.showSafeZones", state.prefs.showSafeZones);
    syncToggle(szBtn, state.prefs.showSafeZones);
    if (state.activeCanvasId) renderActiveCanvas();
  });
  refBtn.addEventListener("click", () => {
    state.prefs.showMasterGhost = !state.prefs.showMasterGhost;
    savePref("br.showMasterGhost", state.prefs.showMasterGhost);
    syncToggle(refBtn, state.prefs.showMasterGhost);
    if (state.activeCanvasId) renderActiveCanvas();
  });

  const debugBtn = document.getElementById("btn-toggle-debug");
  syncToggle(debugBtn, state.prefs.debugOverlay);
  debugBtn.addEventListener("click", () => {
    state.prefs.debugOverlay = !state.prefs.debugOverlay;
    savePref("br.debugOverlay", state.prefs.debugOverlay);
    syncToggle(debugBtn, state.prefs.debugOverlay);
    if (state.activeCanvasId) renderActiveCanvas();
  });

  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);

  document.getElementById("btn-reset-canvas").addEventListener("click", resetActiveCanvasLayout);
  document.getElementById("btn-save-preset").addEventListener("click", saveActivePreset);
  document.getElementById("preset-list").addEventListener("change", applyActivePreset);
  document.getElementById("btn-delete-preset").addEventListener("click", deleteActivePreset);

  // Keyboard shortcuts for undo/redo. Skip when typing into form fields so the
  // browser's native input-level undo still works.
  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
    if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); }
  });
}

// ---------- per-canvas presets ----------
//
// A preset captures a canvas's layout (positions / scale / visibility / flags) and
// its anchor-override map. Stored on the canvas itself so templates persist them.
function saveActivePreset() {
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;
  const input = document.getElementById("preset-name");
  const name = (input.value || "").trim();
  if (!name) return toast("Name the preset first", true);
  pushHistory();
  c.presets = c.presets || {};
  c.presets[name] = {
    layout: c.layout.map(e => ({ ...e })),
    anchorOverrides: { ...(c.anchorOverrides || {}) },
  };
  input.value = "";
  renderPresetControls();
  toast(`Preset "${name}" saved`);
}

function applyActivePreset(ev) {
  const name = ev.target.value;
  if (!name) return;
  const c = state.canvases[state.activeCanvasId];
  if (!c || !c.presets || !c.presets[name]) return;
  pushHistory();
  c.layout = c.presets[name].layout.map(e => ({ ...e }));
  c.anchorOverrides = { ...(c.presets[name].anchorOverrides || {}) };
  renderActiveCanvas();
  const el = document.getElementById(`preview-${c.id}`);
  if (el) drawPreviewThumbnail(c, el);
  toast(`Preset "${name}" applied`);
  ev.target.value = "";
}

function deleteActivePreset() {
  const c = state.canvases[state.activeCanvasId];
  if (!c || !c.presets) return;
  const list = document.getElementById("preset-list");
  const name = list.value;
  if (!name) return toast("Pick a preset from the dropdown to delete", true);
  pushHistory();
  delete c.presets[name];
  renderPresetControls();
  toast(`Preset "${name}" deleted`);
}

function renderPresetControls() {
  const nameInput  = document.getElementById("preset-name");
  const saveBtn    = document.getElementById("btn-save-preset");
  const list       = document.getElementById("preset-list");
  const deleteBtn  = document.getElementById("btn-delete-preset");
  if (!nameInput) return;

  const c = state.canvases[state.activeCanvasId];
  const hasCanvas = !!c;
  nameInput.disabled = !hasCanvas;
  saveBtn.disabled   = !hasCanvas;
  list.disabled      = !hasCanvas;
  deleteBtn.disabled = !hasCanvas;

  // Rebuild the list options from c.presets (preserves selection if still present).
  const prevVal = list.value;
  list.innerHTML = `<option value="">Apply preset…</option>`;
  if (hasCanvas && c.presets) {
    Object.keys(c.presets).sort().forEach(k => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      list.appendChild(opt);
    });
    if (prevVal && c.presets[prevVal]) list.value = prevVal;
  }
}

function resetActiveCanvasLayout() {
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;
  pushHistory();
  const detected = resolveMasterDims(state.master, state.layers);
  const master = detected || { w: 1080, h: 1920, source: "fallback" };
  // Pass the existing layout so user-hidden layers stay hidden across the reset.
  c.layout = buildSmartLayout(
    state.layers, master,
    { w: c.w, h: c.h },
    c.anchorOverrides || {},
    c.layout
  );
  renderActiveCanvas();
  const el = document.getElementById(`preview-${c.id}`);
  if (el) drawPreviewThumbnail(c, el);
  toast("Layout reset");
}

// ---------- generate ----------
function generateAll() {
  if (state.layers.length === 0) return toast("Upload at least one layer first", true);
  if (state.selectedSizes.length === 0) return toast("Select at least one ad size", true);
  pushHistory();

  const detected = resolveMasterDims(state.master, state.layers);
  const master = detected || { w: 1080, h: 1920, source: "fallback" };
  const newCanvases = {};

  state.selectedSizes.forEach(size => {
    const id = `${size.network}__${size.w}x${size.h}__${size.name}`;
    const existing = state.canvases[id];
    if (existing) {
      // Preserve the user's manual edits; add any newly-uploaded layers with smart placement.
      const have = new Set(existing.layout.map(e => e.layerId));
      const wasBannerMode = existing.layout.some(e => e.autoHidden);
      const overrides = existing.anchorOverrides || {};
      state.layers.forEach(l => {
        if (!have.has(l.id)) {
          const entry = Object.assign(
            { layerId: l.id, z: existing.layout.length, autoHidden: false },
            computeSmartPlacement(l, master, size, overrides[l.id])
          );
          if (wasBannerMode && !isEssentialOnBanner(l.role)) {
            entry.visible = false;
            entry.autoHidden = true;
          }
          existing.layout.push(entry);
        }
      });
      // Drop layout entries for removed layers.
      const validIds = new Set(state.layers.map(l => l.id));
      existing.layout = existing.layout.filter(e => validIds.has(e.layerId));
      newCanvases[id] = existing;
    } else {
      newCanvases[id] = {
        id, w: size.w, h: size.h, name: size.name, network: size.network,
        safeZones: size.safeZones || null,
        anchorOverrides: {},
        layout: buildSmartLayout(state.layers, master, size, {})
      };
    }
  });

  // Destroy stages for canvases we're dropping.
  Object.keys(state.canvases).forEach(oldId => {
    if (!newCanvases[oldId] && state.canvases[oldId].stage) {
      state.canvases[oldId].stage.destroy();
    }
  });

  state.canvases = newCanvases;
  if (!state.canvases[state.activeCanvasId]) {
    state.activeCanvasId = Object.keys(state.canvases)[0] || null;
  }
  renderPreviews();
  renderActiveCanvas();
  toast(`Generated ${state.selectedSizes.length} canvas${state.selectedSizes.length === 1 ? "" : "es"}`);
}

// ---------- preview strip ----------
function renderPreviews() {
  const container = document.getElementById("canvas-previews");
  container.innerHTML = "";
  Object.values(state.canvases).forEach(c => {
    const tile = document.createElement("div");
    tile.className = "preview-tile" + (c.id === state.activeCanvasId ? " active" : "");
    tile.addEventListener("click", () => {
      state.activeCanvasId = c.id;
      renderActiveCanvas();
      updatePreviewHighlight();
    });

    // Compute preview dimensions (fit within 80×100).
    const MAX_W = 80, MAX_H = 100;
    const ratio = c.w / c.h;
    let tw, th;
    if (ratio >= 1) { tw = MAX_W; th = Math.max(12, Math.round(MAX_W / ratio)); }
    else            { th = MAX_H; tw = Math.max(12, Math.round(MAX_H * ratio)); }

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    canvas.id = `preview-${c.id}`;

    const nameDiv = document.createElement("div");
    nameDiv.className = "size-name";
    nameDiv.textContent = c.network;
    const sizeDiv = document.createElement("div");
    sizeDiv.className = "size-label";
    sizeDiv.textContent = `${c.w}×${c.h}`;

    tile.appendChild(canvas);
    tile.appendChild(nameDiv);
    tile.appendChild(sizeDiv);
    container.appendChild(tile);

    drawPreviewThumbnail(c, canvas);
  });
}

function updatePreviewHighlight() {
  const ids = Object.keys(state.canvases);
  document.querySelectorAll(".preview-tile").forEach((tile, i) => {
    tile.classList.toggle("active", ids[i] === state.activeCanvasId);
  });
}

function drawPreviewThumbnail(canvasState, canvasEl) {
  const ctx = canvasEl.getContext("2d");
  const sx = canvasEl.width / canvasState.w;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.scale(sx, sx);
  const ordered = [...canvasState.layout].sort((a, b) => a.z - b.z);
  ordered.forEach(entry => {
    if (entry.visible === false) return;
    const layer = state.layers.find(l => l.id === entry.layerId);
    if (!layer) return;
    const w = layer.image.naturalWidth * entry.scaleX;
    const h = layer.image.naturalHeight * entry.scaleY;
    ctx.save();
    ctx.globalAlpha = entry.opacity == null ? 1 : entry.opacity;
    ctx.translate(entry.x, entry.y);
    ctx.rotate((entry.rotation || 0) * Math.PI / 180);
    ctx.drawImage(layer.image, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
  ctx.restore();
}

// ---------- active canvas editor ----------
function renderActiveCanvas() {
  const main = document.getElementById("canvas-main");

  // Tear down any existing stage for this or sibling canvases (only one is live at a time).
  Object.values(state.canvases).forEach(c => {
    if (c.stage) { c.stage.destroy(); c.stage = null; c.konvaLayer = null; c.transformer = null; c.nodes = null; }
  });

  main.innerHTML = "";
  const resetBtn = document.getElementById("btn-reset-canvas");
  if (!state.activeCanvasId) {
    main.innerHTML = `<div class="empty-state"><p>Upload layers, pick ad sizes, then hit Generate.</p></div>`;
    document.getElementById("active-canvas-info").innerHTML = `<div class="muted">No canvas selected</div>`;
    if (resetBtn) resetBtn.disabled = true;
    renderPresetControls();
    renderLayerPanel();
    renderTransformPanel();
    return;
  }
  if (resetBtn) resetBtn.disabled = false;
  renderPresetControls();

  const c = state.canvases[state.activeCanvasId];

  // Compute a display scale so the canvas fits in the viewport.
  const padding = 64;
  const availW = Math.max(100, main.clientWidth - padding);
  const availH = Math.max(100, main.clientHeight - padding);
  const scale = Math.min(availW / c.w, availH / c.h, 1);

  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";
  wrap.style.width = (c.w * scale) + "px";
  wrap.style.height = (c.h * scale) + "px";

  const label = document.createElement("div");
  label.className = "canvas-label";
  label.textContent = `${c.network} — ${c.name} — ${c.w}×${c.h}`;
  wrap.appendChild(label);

  const stageDiv = document.createElement("div");
  stageDiv.style.width = "100%";
  stageDiv.style.height = "100%";
  wrap.appendChild(stageDiv);
  main.appendChild(wrap);

  const stage = new Konva.Stage({
    container: stageDiv,
    width: c.w * scale,
    height: c.h * scale,
    scaleX: scale,
    scaleY: scale,
  });
  const kLayer = new Konva.Layer();
  const guideLayer = new Konva.Layer({ listening: false });
  stage.add(kLayer);
  stage.add(guideLayer);
  c.guideLayer = guideLayer;

  // Diagnostic overlay: safe-margin frame + quarter grid. Helps visualize where
  // layers will be nudged and the canvas's alignment hotspots during manual tweaks.
  if (state.prefs.debugOverlay) {
    const margin = 0.02 * Math.min(c.w, c.h);
    guideLayer.add(new Konva.Rect({
      x: margin, y: margin,
      width: c.w - 2 * margin, height: c.h - 2 * margin,
      stroke: "#29d6d6",
      strokeWidth: 1 / scale,
      dash: [4 / scale, 4 / scale],
      listening: false,
    }));
    const gridCommon = {
      stroke: "rgba(41,214,214,0.25)",
      strokeWidth: 1 / scale,
      dash: [3 / scale, 5 / scale],
      listening: false,
    };
    [c.w / 4, c.w / 2, c.w * 3 / 4].forEach(x => {
      guideLayer.add(new Konva.Line({ points: [x, 0, x, c.h], ...gridCommon }));
    });
    [c.h / 4, c.h / 2, c.h * 3 / 4].forEach(y => {
      guideLayer.add(new Konva.Line({ points: [0, y, c.w, y], ...gridCommon }));
    });
  }

  // Master reference ghost: semi-transparent composite of the uploaded master
  // overlaid on top of everything so the designer can compare reflow vs original.
  // Rendered into the guideLayer so it never steals input.
  if (state.prefs.showMasterGhost && state.master && state.master.image) {
    const mImg = state.master.image;
    const mAspect = mImg.naturalWidth / mImg.naturalHeight;
    const tAspect = c.w / c.h;
    // Fit inside the canvas (letterbox for different aspects).
    const ghostScale = tAspect > mAspect ? c.h / mImg.naturalHeight : c.w / mImg.naturalWidth;
    const gw = mImg.naturalWidth * ghostScale;
    const gh = mImg.naturalHeight * ghostScale;
    const gx = (c.w - gw) / 2;
    const gy = (c.h - gh) / 2;
    guideLayer.add(new Konva.Image({
      image: mImg,
      x: gx, y: gy, width: gw, height: gh,
      opacity: 0.22,
      listening: false,
    }));
    // Subtle dashed outline around where the master would sit at matching aspect,
    // so the ghost's bounds are distinguishable from the canvas edge.
    guideLayer.add(new Konva.Rect({
      x: gx, y: gy, width: gw, height: gh,
      stroke: "#5b8cff",
      strokeWidth: 1 / scale,
      dash: [6 / scale, 4 / scale],
      listening: false,
    }));
  }

  // Safe-zone overlay on the guide layer (sits on top of imagery so it's visible as a warning).
  if (state.prefs.showSafeZones && c.safeZones && c.safeZones.length) {
    c.safeZones.forEach(z => {
      guideLayer.add(new Konva.Rect({
        x: z.x, y: z.y, width: z.w, height: z.h,
        stroke: "#ffb857", strokeWidth: 2 / scale, dash: [8 / scale, 6 / scale],
        fill: "rgba(255,184,87,0.08)",
        listening: false
      }));
      if (z.label) {
        guideLayer.add(new Konva.Text({
          x: z.x + 6, y: z.y + 6,
          text: z.label,
          fontSize: Math.max(12, 18 / scale),
          fontFamily: "system-ui, sans-serif",
          fill: "#ffb857", listening: false
        }));
      }
    });
  }

  const nodes = {};
  const ordered = [...c.layout].sort((a, b) => a.z - b.z);
  ordered.forEach(entry => {
    const la = state.layers.find(l => l.id === entry.layerId);
    if (!la) return;
    const img = new Konva.Image({
      image: la.image,
      x: entry.x,
      y: entry.y,
      offsetX: la.image.naturalWidth / 2,
      offsetY: la.image.naturalHeight / 2,
      scaleX: entry.scaleX,
      scaleY: entry.scaleY,
      rotation: entry.rotation || 0,
      opacity: entry.opacity == null ? 1 : entry.opacity,
      visible: entry.visible !== false,
      draggable: !entry.locked,
      id: entry.layerId,
    });
    img.on("mousedown touchstart", e => { e.cancelBubble = true; selectLayer(entry.layerId); });

    // Remember the starting position for each dragstart so we can compute deltas
    // for grouped drag and so snapping is relative to the original grab point.
    let dragStart = null;
    img.on("dragstart", () => {
      pushHistory();
      dragStart = { x: img.x(), y: img.y() };
      // Snapshot starting positions for every sibling in the same group so we can translate
      // them by the same delta as the dragged layer.
      const layerInfo = state.layers.find(x => x.id === entry.layerId);
      if (layerInfo && layerInfo.groupId) {
        c.layout.forEach(sibEntry => {
          if (sibEntry.layerId === entry.layerId) return;
          const sibLayer = state.layers.find(l => l.id === sibEntry.layerId);
          if (sibLayer && sibLayer.groupId === layerInfo.groupId) {
            sibEntry._dragStart = { x: sibEntry.x, y: sibEntry.y };
          }
        });
      }
    });
    img.on("dragmove", () => {
      applySnapping(img, c, guideLayer, scale);
      const layerInfo = state.layers.find(x => x.id === entry.layerId);
      if (layerInfo && layerInfo.groupId && dragStart) {
        const dx = img.x() - dragStart.x;
        const dy = img.y() - dragStart.y;
        c.layout.forEach(sibEntry => {
          if (sibEntry.layerId === entry.layerId) return;
          if (!sibEntry._dragStart) return;
          const sibNode = nodes[sibEntry.layerId];
          if (!sibNode) return;
          sibNode.x(sibEntry._dragStart.x + dx);
          sibNode.y(sibEntry._dragStart.y + dy);
        });
      }
    });
    img.on("dragend", () => {
      entry.x = img.x();
      entry.y = img.y();
      // Commit sibling positions & clean up snapshots.
      c.layout.forEach(sibEntry => {
        if (sibEntry._dragStart) {
          const sibNode = nodes[sibEntry.layerId];
          if (sibNode) {
            sibEntry.x = sibNode.x();
            sibEntry.y = sibNode.y();
          }
          delete sibEntry._dragStart;
        }
      });
      clearGuides(guideLayer);
      dragStart = null;
      syncAfterEdit();
    });
    img.on("transformstart", () => { pushHistory(); });
    img.on("transformend", () => {
      entry.x = img.x();
      entry.y = img.y();
      entry.scaleX = img.scaleX();
      entry.scaleY = img.scaleY();
      entry.rotation = img.rotation();
      syncAfterEdit();
    });
    kLayer.add(img);
    nodes[entry.layerId] = img;
  });

  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    keepRatio: true,
    enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
    borderStroke: "#5b8cff",
    anchorStroke: "#5b8cff",
    anchorFill: "#fff",
    anchorSize: 8,
  });
  kLayer.add(transformer);

  stage.on("click tap", e => { if (e.target === stage) selectLayer(null); });

  c.stage = stage;
  c.konvaLayer = kLayer;
  c.transformer = transformer;
  c.nodes = nodes;

  if (state.selectedLayerId && nodes[state.selectedLayerId]) {
    transformer.nodes([nodes[state.selectedLayerId]]);
  }

  kLayer.draw();

  document.getElementById("active-canvas-info").innerHTML =
    `<div><strong>${c.network}</strong></div><div class="muted">${c.name} · ${c.w}×${c.h}</div>`;

  renderLayerPanel();
  renderTransformPanel();
}

// ---------- snap-to-guide during drag ----------
const SNAP_THRESHOLD_PX = 8; // in screen pixels; converted to canvas coords via stage scale

function applySnapping(node, canvasState, guideLayer, stageScale) {
  clearGuides(guideLayer);
  if (!state.prefs.snapEnabled) return;

  const thresh = SNAP_THRESHOLD_PX / stageScale;
  const w = node.width()  * node.scaleX();
  const h = node.height() * node.scaleY();
  const cx = node.x(), cy = node.y();
  const left = cx - w / 2, right = cx + w / 2;
  const top  = cy - h / 2, bottom = cy + h / 2;

  const W = canvasState.w, H = canvasState.h;
  const safeMargin = 0.02 * Math.min(W, H);

  // Canvas guides: edges, safe-margin frame, quarter lines, center.
  const xLines = [0, W / 4, W / 2, W * 3 / 4, W, safeMargin, W - safeMargin];
  const yLines = [0, H / 4, H / 2, H * 3 / 4, H, safeMargin, H - safeMargin];

  // Layer-to-layer: every other visible non-dragged layer contributes three x-lines
  // (left edge, center, right edge) and three y-lines (top, center, bottom).
  const draggedId = node.id();
  canvasState.layout.forEach(entry => {
    if (entry.layerId === draggedId) return;
    if (entry.visible === false) return;
    const layer = state.layers.find(l => l.id === entry.layerId);
    if (!layer) return;
    const lw = layer.image.naturalWidth  * entry.scaleX;
    const lh = layer.image.naturalHeight * entry.scaleY;
    xLines.push(entry.x - lw / 2, entry.x, entry.x + lw / 2);
    yLines.push(entry.y - lh / 2, entry.y, entry.y + lh / 2);
  });

  // Find closest snap within threshold for center / left / right.
  const snapX = findClosestSnap([
    { node: cx,    kind: "center" },
    { node: left,  kind: "left"   },
    { node: right, kind: "right"  },
  ], xLines, thresh);
  const snapY = findClosestSnap([
    { node: cy,     kind: "center" },
    { node: top,    kind: "top"    },
    { node: bottom, kind: "bottom" },
  ], yLines, thresh);

  if (snapX) {
    const newCx = snapX.kind === "center" ? snapX.line
               : snapX.kind === "left"   ? snapX.line + w / 2
               :                            snapX.line - w / 2;
    node.x(newCx);
    drawGuideLine(guideLayer, { vertical: true, pos: snapX.line, length: H, stageScale });
  }
  if (snapY) {
    const newCy = snapY.kind === "center" ? snapY.line
               : snapY.kind === "top"    ? snapY.line + h / 2
               :                            snapY.line - h / 2;
    node.y(newCy);
    drawGuideLine(guideLayer, { vertical: false, pos: snapY.line, length: W, stageScale });
  }
}

function findClosestSnap(edges, lines, thresh) {
  let best = null;
  edges.forEach(e => {
    lines.forEach(l => {
      const d = Math.abs(e.node - l);
      if (d <= thresh && (!best || d < best.d)) {
        best = { d, line: l, kind: e.kind };
      }
    });
  });
  return best;
}

function drawGuideLine(guideLayer, { vertical, pos, length, stageScale }) {
  const common = {
    stroke: "#5b8cff",
    strokeWidth: 1 / stageScale,
    dash: [6 / stageScale, 4 / stageScale],
    listening: false,
  };
  const line = vertical
    ? new Konva.Line({ points: [pos, 0, pos, length], ...common })
    : new Konva.Line({ points: [0, pos, length, pos], ...common });
  line.addName("snap-guide");
  guideLayer.add(line);
  guideLayer.batchDraw();
}

function clearGuides(guideLayer) {
  if (!guideLayer) return;
  guideLayer.find(".snap-guide").forEach(n => n.destroy());
  guideLayer.batchDraw();
}

function syncAfterEdit() {
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;
  const canvasEl = document.getElementById(`preview-${c.id}`);
  if (canvasEl) drawPreviewThumbnail(c, canvasEl);
  renderTransformPanel();
}

function selectLayer(id) {
  state.selectedLayerId = id;
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;
  const entry = id ? c.layout.find(e => e.layerId === id) : null;
  // Locked entries can still be selected (to view/inspect) but the transformer
  // handles are suppressed so the user can't accidentally scale/rotate.
  if (id && c.nodes[id] && entry && !entry.locked) {
    c.transformer.nodes([c.nodes[id]]);
  } else {
    c.transformer.nodes([]);
  }
  c.konvaLayer.draw();
  renderLayerPanel();
  renderTransformPanel();
}

// ---------- right-sidebar layer list ----------
function renderLayerPanel() {
  const ul = document.getElementById("layers-list");
  ul.innerHTML = "";
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;

  // Top of list = top z-order on the canvas.
  const ordered = [...c.layout].sort((a, b) => b.z - a.z);
  ordered.forEach(entry => {
    const layer = state.layers.find(l => l.id === entry.layerId);
    if (!layer) return;

    const li = document.createElement("li");
    li.className =
      (entry.visible === false ? "hidden-layer " : "") +
      (entry.autoHidden ? "auto-hidden " : "") +
      (entry.layerId === state.selectedLayerId ? "selected" : "");

    const visBtn = document.createElement("button");
    visBtn.className = "icon-btn";
    visBtn.title = entry.autoHidden
      ? "Auto-hidden by banner mode · click to override"
      : "Toggle visibility";
    visBtn.textContent = entry.visible === false ? "◌" : "●";
    visBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      pushHistory();
      entry.visible = entry.visible === false ? true : false;
      if (entry.visible) {
        // Showing a layer clears both hidden flags — user explicitly wants it on.
        entry.autoHidden = false;
        entry.userHidden = false;
      } else {
        // Explicit hide: mark as user-hidden so a Reset won't bring it back.
        entry.userHidden = true;
      }
      renderActiveCanvas();
      const canvasEl = document.getElementById(`preview-${c.id}`);
      if (canvasEl) drawPreviewThumbnail(c, canvasEl);
    });

    const nameWrap = document.createElement("span");
    nameWrap.className = "layer-name";
    nameWrap.title = layer.name;
    const nameTxt = document.createElement("div");
    if (layer.groupId) {
      const badge = document.createElement("span");
      badge.className = "group-badge";
      badge.setAttribute("data-group", layer.groupId);
      badge.textContent = layer.groupId;
      nameTxt.appendChild(badge);
      nameTxt.appendChild(document.createTextNode(" " + layer.name));
    } else {
      nameTxt.textContent = layer.name;
    }
    const roleTxt = document.createElement("div");
    roleTxt.className = "layer-role";
    roleTxt.textContent = entry.autoHidden
      ? `${ROLE_LABELS[layer.role]} · auto-hidden (banner mode)`
      : ROLE_LABELS[layer.role];
    nameWrap.appendChild(nameTxt);
    nameWrap.appendChild(roleTxt);

    const upBtn = document.createElement("button");
    upBtn.className = "icon-btn";
    upBtn.title = "Move up";
    upBtn.textContent = "▲";
    upBtn.addEventListener("click", ev => { ev.stopPropagation(); moveLayerZ(entry.layerId, +1); });

    const downBtn = document.createElement("button");
    downBtn.className = "icon-btn";
    downBtn.title = "Move down";
    downBtn.textContent = "▼";
    downBtn.addEventListener("click", ev => { ev.stopPropagation(); moveLayerZ(entry.layerId, -1); });

    const applyBtn = document.createElement("button");
    applyBtn.className = "icon-btn";
    applyBtn.title = "Apply this layer's position to every size";
    applyBtn.textContent = "⤢";
    applyBtn.addEventListener("click", ev => { ev.stopPropagation(); applyLayerToAllSizes(entry.layerId); });

    const lockBtn = document.createElement("button");
    lockBtn.className = "icon-btn";
    lockBtn.title = entry.locked
      ? "Locked on this canvas · click to unlock"
      : "Lock position / scale on this canvas · survives Reset, excluded from collision";
    lockBtn.textContent = entry.locked ? "🔒" : "🔓";
    lockBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      pushHistory();
      entry.locked = !entry.locked;
      renderActiveCanvas();
    });
    if (entry.locked) li.classList.add("locked");

    li.appendChild(visBtn);
    li.appendChild(nameWrap);
    li.appendChild(upBtn);
    li.appendChild(downBtn);
    li.appendChild(applyBtn);
    li.appendChild(lockBtn);
    li.addEventListener("click", () => selectLayer(entry.layerId));
    ul.appendChild(li);
  });
}

function moveLayerZ(layerId, dir) {
  const c = state.canvases[state.activeCanvasId];
  if (!c) return;
  const ordered = [...c.layout].sort((a, b) => a.z - b.z);
  const idx = ordered.findIndex(e => e.layerId === layerId);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= ordered.length) return;
  pushHistory();
  const a = ordered[idx], b = ordered[swap];
  const tmp = a.z; a.z = b.z; b.z = tmp;
  renderActiveCanvas();
  const canvasEl = document.getElementById(`preview-${c.id}`);
  if (canvasEl) drawPreviewThumbnail(c, canvasEl);
}

function applyLayerToAllSizes(layerId) {
  const src = state.canvases[state.activeCanvasId];
  if (!src) return;
  const srcEntry = src.layout.find(e => e.layerId === layerId);
  if (!srcEntry) return;
  pushHistory();
  const fx = srcEntry.x / src.w;
  const fy = srcEntry.y / src.h;
  const srcMin = Math.min(src.w, src.h);

  Object.values(state.canvases).forEach(c => {
    if (c.id === src.id) return;
    const entry = c.layout.find(e => e.layerId === layerId);
    if (!entry) return;
    entry.x = fx * c.w;
    entry.y = fy * c.h;
    const ratio = Math.min(c.w, c.h) / srcMin;
    entry.scaleX = srcEntry.scaleX * ratio;
    entry.scaleY = srcEntry.scaleY * ratio;
    entry.rotation = srcEntry.rotation;
    entry.visible = srcEntry.visible;
    entry.opacity = srcEntry.opacity;
  });
  Object.values(state.canvases).forEach(c => {
    const el = document.getElementById(`preview-${c.id}`);
    if (el) drawPreviewThumbnail(c, el);
  });
  renderActiveCanvas();
  toast("Applied to all sizes");
}

// ---------- transform panel ----------
function renderTransformPanel() {
  const panel = document.getElementById("transform-panel");
  const c = state.canvases[state.activeCanvasId];
  if (!c || !state.selectedLayerId) {
    panel.innerHTML = `<div class="muted">Select a layer to edit</div>`;
    return;
  }
  const entry = c.layout.find(e => e.layerId === state.selectedLayerId);
  if (!entry) { panel.innerHTML = `<div class="muted">Select a layer to edit</div>`; return; }

  const currentOverride = (c.anchorOverrides && c.anchorOverrides[state.selectedLayerId]) || "auto";
  const anchorOptions = [
    ["auto",          "Auto (inferred)"],
    ["top-left",      "Top Left"],    ["top-center", "Top Center"],    ["top-right", "Top Right"],
    ["middle-left",   "Middle Left"], ["center",     "Center"],        ["middle-right", "Middle Right"],
    ["bottom-left",   "Bottom Left"], ["bottom-center", "Bottom Center"], ["bottom-right", "Bottom Right"],
  ];
  panel.innerHTML = `
    <div class="row"><label>X</label><input type="number" id="tp-x" value="${Math.round(entry.x)}"></div>
    <div class="row"><label>Y</label><input type="number" id="tp-y" value="${Math.round(entry.y)}"></div>
    <div class="row"><label>Scale</label><input type="number" step="0.01" id="tp-scale" value="${(+entry.scaleX).toFixed(3)}"></div>
    <div class="row"><label>Rotation</label><input type="number" id="tp-rot" value="${Math.round(entry.rotation || 0)}"></div>
    <div class="row"><label>Opacity</label><input type="number" min="0" max="1" step="0.05" id="tp-op" value="${entry.opacity == null ? 1 : entry.opacity}"></div>
    <div class="row"><label>Anchor</label><select id="tp-anchor">${
      anchorOptions.map(([v, l]) => `<option value="${v}" ${v === currentOverride ? "selected" : ""}>${l}</option>`).join("")
    }</select></div>
    <div class="actions">
      <button id="tp-apply-all">Apply position to all sizes</button>
      <button id="tp-anchor-all">Apply anchor to all canvases</button>
    </div>
  `;
  const apply = () => {
    entry.x = +document.getElementById("tp-x").value;
    entry.y = +document.getElementById("tp-y").value;
    const s = +document.getElementById("tp-scale").value;
    entry.scaleX = s; entry.scaleY = s;
    entry.rotation = +document.getElementById("tp-rot").value;
    entry.opacity = +document.getElementById("tp-op").value;
    const node = c.nodes[state.selectedLayerId];
    if (node) {
      node.position({ x: entry.x, y: entry.y });
      node.scale({ x: entry.scaleX, y: entry.scaleY });
      node.rotation(entry.rotation);
      node.opacity(entry.opacity);
      c.konvaLayer.draw();
    }
    const canvasEl = document.getElementById(`preview-${c.id}`);
    if (canvasEl) drawPreviewThumbnail(c, canvasEl);
  };
  ["tp-x", "tp-y", "tp-scale", "tp-rot", "tp-op"].forEach(id => {
    const el = document.getElementById(id);
    // One history snapshot per focus session (not per keystroke).
    el.addEventListener("focus", () => { pushHistory(); });
    el.addEventListener("input", apply);
  });
  document.getElementById("tp-anchor").addEventListener("change", e => {
    pushHistory();
    c.anchorOverrides = c.anchorOverrides || {};
    if (e.target.value === "auto") {
      delete c.anchorOverrides[state.selectedLayerId];
    } else {
      c.anchorOverrides[state.selectedLayerId] = e.target.value;
    }
    toast("Anchor set — hit Reset Layout to apply");
  });
  document.getElementById("tp-apply-all").addEventListener("click", () =>
    applyLayerToAllSizes(state.selectedLayerId)
  );
  document.getElementById("tp-anchor-all").addEventListener("click", () =>
    applyAnchorToAllCanvases(state.selectedLayerId)
  );
}

// Copy the active canvas's anchor override for this layer to every canvas, then
// re-run the smart layout on each so the new anchor takes effect everywhere at once.
function applyAnchorToAllCanvases(layerId) {
  const src = state.canvases[state.activeCanvasId];
  if (!src) return;
  pushHistory();
  const override = (src.anchorOverrides && src.anchorOverrides[layerId]) || "auto";
  const detected = resolveMasterDims(state.master, state.layers);
  const master = detected || { w: 1080, h: 1920, source: "fallback" };
  let touched = 0;
  Object.values(state.canvases).forEach(c => {
    c.anchorOverrides = c.anchorOverrides || {};
    if (override === "auto") {
      if (c.anchorOverrides[layerId]) delete c.anchorOverrides[layerId];
    } else {
      c.anchorOverrides[layerId] = override;
    }
    c.layout = buildSmartLayout(
      state.layers, master,
      { w: c.w, h: c.h },
      c.anchorOverrides || {},
      c.layout
    );
    const el = document.getElementById(`preview-${c.id}`);
    if (el) drawPreviewThumbnail(c, el);
    touched++;
  });
  renderActiveCanvas();
  toast(`Anchor applied across ${touched} canvas${touched === 1 ? "" : "es"}`);
}

// ---------- save/load template ----------
function saveTemplate() {
  if (state.layers.length === 0 && Object.keys(state.variants).length <= 1) {
    return toast("Nothing to save yet", true);
  }
  saveActiveVariantState();
  const template = {
    version: 2,
    savedAt: new Date().toISOString(),
    activeVariantId: state.activeVariantId,
    variants: Object.values(state.variants).map(v => ({
      id: v.id, name: v.name,
      master: v.master ? { width: v.master.width, height: v.master.height, name: v.master.name } : null,
      nextLayerOrder: v.nextLayerOrder,
      selectedSizes: v.selectedSizes,
      layers: (v.layers || []).map(l => ({
        id: l.id, name: l.name, role: l.role, order: l.order,
        groupId: l.groupId || null,
        imageDataUrl: imageToDataUrl(l.image),
        originalWidth: l.originalWidth,
        originalHeight: l.originalHeight,
        bboxInOriginal: l.bboxInOriginal,
        wasCropped: !!l.wasCropped,
      })),
      canvases: Object.values(v.canvases || {}).map(c => ({
        id: c.id, w: c.w, h: c.h, name: c.name, network: c.network,
        safeZones: c.safeZones || null,
        anchorOverrides: c.anchorOverrides || {},
        presets: c.presets || {},
        layout: c.layout.map(e => ({
          layerId: e.layerId, z: e.z, x: e.x, y: e.y,
          scaleX: e.scaleX, scaleY: e.scaleY, rotation: e.rotation || 0,
          visible: e.visible !== false, opacity: e.opacity == null ? 1 : e.opacity,
          autoHidden: !!e.autoHidden,
          userHidden: !!e.userHidden,
          locked: !!e.locked,
        })),
      })),
    })),
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  downloadBlob(blob, `banner-template-${Date.now()}.json`);
  toast("Template saved");
}

function loadTemplate(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const tpl = JSON.parse(e.target.result);
      applyTemplate(tpl);
    } catch (err) {
      console.error(err);
      toast("Invalid template file", true);
    }
  };
  reader.readAsText(file);
}

async function applyTemplate(tpl) {
  // Tear down any live state — templates fully replace everything.
  Object.values(state.canvases).forEach(c => { if (c.stage) c.stage.destroy(); });
  state.layers = [];
  state.canvases = {};
  state.nextLayerOrder = 0;
  state.selectedLayerId = null;
  state.master = null;

  // v2 templates are variant-aware. v1 gets migrated into a single "Base" variant.
  if (tpl.version >= 2 && Array.isArray(tpl.variants)) {
    state.variants = {};
    for (const vspec of tpl.variants) {
      const variant = await hydrateVariantFromTemplate(vspec);
      state.variants[variant.id] = variant;
    }
    const fallbackId = Object.keys(state.variants)[0];
    state.activeVariantId = state.variants[tpl.activeVariantId] ? tpl.activeVariantId : fallbackId;
    const active = state.variants[state.activeVariantId];
    state.master         = active.master || null;
    state.layers         = active.layers || [];
    state.canvases       = active.canvases || {};
    state.selectedSizes  = active.selectedSizes || [];
    state.nextLayerOrder = active.nextLayerOrder || 0;
    state.activeCanvasId = Object.keys(state.canvases)[0] || null;

    renderUploadLayersList();
    renderMasterPreviewFromState();
    renderDetectedMaster();
    syncNetworkCheckboxesFromState();
    renderPreviews();
    renderActiveCanvas();
    renderVariantPicker();
    toast("Template loaded");
    return;
  }
  // --- legacy v1 branch below ---

  const loads = (tpl.layers || []).map(spec => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      rememberImage(spec.id, img);
      state.layers.push({
        id: spec.id,
        name: spec.name,
        image: img,
        role: spec.role,
        order: spec.order,
        groupId: spec.groupId || null,
        originalWidth: spec.originalWidth,
        originalHeight: spec.originalHeight,
        bboxInOriginal: spec.bboxInOriginal || null,
        wasCropped: !!spec.wasCropped,
      });
      state.nextLayerOrder = Math.max(state.nextLayerOrder, spec.order + 1);
      resolve();
    };
    img.onerror = reject;
    img.src = spec.imageDataUrl;
  }));
  try {
    await Promise.all(loads);
  } catch (err) {
    toast("Failed to load one or more layer images", true);
  }

  (tpl.canvases || []).forEach(c => {
    state.canvases[c.id] = {
      id: c.id, w: c.w, h: c.h, name: c.name, network: c.network,
      safeZones: c.safeZones || null,
      anchorOverrides: c.anchorOverrides || {},
      presets: c.presets || {},
      layout: (c.layout || []).map(e => ({
        layerId: e.layerId, z: e.z, x: e.x, y: e.y,
        scaleX: e.scaleX, scaleY: e.scaleY,
        rotation: e.rotation || 0,
        visible: e.visible !== false,
        opacity: e.opacity == null ? 1 : e.opacity,
        autoHidden: !!e.autoHidden,
        userHidden: !!e.userHidden,
        locked: !!e.locked
      }))
    };
  });
  state.activeCanvasId = Object.keys(state.canvases)[0] || null;

  if (tpl.master) {
    state.master = { width: tpl.master.width, height: tpl.master.height, name: tpl.master.name };
    const preview = document.getElementById("master-preview");
    preview.innerHTML = `<div class="muted">${tpl.master.width} × ${tpl.master.height} — ${tpl.master.name || "template master"}</div>`;
  } else {
    document.getElementById("master-preview").innerHTML = "";
    renderDetectedMaster();
  }

  // Reflect selected sizes in the checkboxes.
  const pickedIds = new Set(Object.values(state.canvases).map(c => `${c.network}|${c.w}x${c.h}|${c.name}`));
  document.querySelectorAll('#networks-list input[type="checkbox"]').forEach(cb => {
    const key = `${cb.dataset.network}|${cb.dataset.w}x${cb.dataset.h}|${cb.dataset.name}`;
    cb.checked = pickedIds.has(key);
  });
  updateSelectedSizes();

  // Migrate the just-loaded legacy v1 payload into the variants map so the rest
  // of the app sees a consistent variants structure.
  const migrateId = "v_" + Math.random().toString(36).slice(2, 8);
  state.variants = {
    [migrateId]: {
      id: migrateId, name: "Base",
      master: state.master ? { width: state.master.width, height: state.master.height, name: state.master.name } : null,
      layers: state.layers,
      canvases: state.canvases,
      selectedSizes: state.selectedSizes,
      nextLayerOrder: state.nextLayerOrder,
    }
  };
  state.activeVariantId = migrateId;

  renderUploadLayersList();
  renderPreviews();
  renderActiveCanvas();
  renderVariantPicker();
  toast("Template loaded");
}

// Build a variant's in-memory state from its serialized template spec.
// Images are hydrated from base64 data URLs and also cached so undo restores work.
async function hydrateVariantFromTemplate(vspec) {
  const layers = [];
  const canvases = {};

  const loads = (vspec.layers || []).map(spec => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      rememberImage(spec.id, img);
      layers.push({
        id: spec.id, name: spec.name, image: img,
        role: spec.role, order: spec.order,
        groupId: spec.groupId || null,
        originalWidth: spec.originalWidth,
        originalHeight: spec.originalHeight,
        bboxInOriginal: spec.bboxInOriginal || null,
        wasCropped: !!spec.wasCropped,
      });
      resolve();
    };
    img.onerror = reject;
    img.src = spec.imageDataUrl;
  }));
  try { await Promise.all(loads); } catch (e) { console.warn(e); }

  (vspec.canvases || []).forEach(c => {
    canvases[c.id] = {
      id: c.id, w: c.w, h: c.h, name: c.name, network: c.network,
      safeZones: c.safeZones || null,
      anchorOverrides: c.anchorOverrides || {},
      presets: c.presets || {},
      layout: (c.layout || []).map(e => ({
        layerId: e.layerId, z: e.z, x: e.x, y: e.y,
        scaleX: e.scaleX, scaleY: e.scaleY,
        rotation: e.rotation || 0,
        visible: e.visible !== false,
        opacity: e.opacity == null ? 1 : e.opacity,
        autoHidden: !!e.autoHidden,
        userHidden: !!e.userHidden,
        locked:     !!e.locked,
      })),
    };
  });

  return {
    id: vspec.id || ("v_" + Math.random().toString(36).slice(2, 8)),
    name: vspec.name || "Base",
    master: vspec.master ? { width: vspec.master.width, height: vspec.master.height, name: vspec.master.name } : null,
    layers,
    canvases,
    selectedSizes: vspec.selectedSizes || [],
    nextLayerOrder: vspec.nextLayerOrder || layers.reduce((m, l) => Math.max(m, l.order + 1), 0),
  };
}

function imageToDataUrl(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return c.toDataURL("image/png");
}

// ---------- export (modal-driven) ----------
//
// Tokens supported in the filename template, replaced per canvas:
//   {network} {w} {h} {name} {index} {variant}
// Characters outside [a-zA-Z0-9_.\-] are collapsed to "_" so the ZIP entries stay portable.
function formatFilename(template, ctx) {
  const safe = s => String(s == null ? "" : s).replace(/[^a-z0-9_.\-]/gi, "_");
  return template
    .replace(/\{network\}/g, safe(ctx.network))
    .replace(/\{w\}/g,       safe(ctx.w))
    .replace(/\{h\}/g,       safe(ctx.h))
    .replace(/\{name\}/g,    safe(ctx.name))
    .replace(/\{index\}/g,   safe(ctx.index))
    .replace(/\{variant\}/g, safe(ctx.variant));
}

function openExportModal() {
  const canvases = Object.values(state.canvases);
  if (canvases.length === 0) return toast("Nothing to export yet", true);

  const list = document.getElementById("export-canvas-list");
  list.innerHTML = "";
  canvases.forEach((c, i) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.canvasId = c.id;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div>${c.network} · ${c.w}×${c.h} · ${c.name}</div>
                      <span class="filename" data-canvas-id="${c.id}"></span>`;
    label.appendChild(cb);
    label.appendChild(wrap);
    list.appendChild(label);
  });

  // Hide the "all variants" checkbox if there's only a single variant.
  const variantIds = Object.keys(state.variants || {});
  const allVariantsCb = document.getElementById("export-all-variants");
  allVariantsCb.closest("label").style.display = variantIds.length > 1 ? "" : "none";
  allVariantsCb.checked = false;

  updateExportFilenamePreview();
  document.getElementById("export-template").oninput = updateExportFilenamePreview;

  document.getElementById("export-modal").hidden = false;
}

function closeExportModal() {
  document.getElementById("export-modal").hidden = true;
}

function updateExportFilenamePreview() {
  const tpl = document.getElementById("export-template").value || "{network}_{w}x{h}_{name}";
  const canvases = Object.values(state.canvases);
  const variantName = (state.variants && state.variants[state.activeVariantId])
    ? state.variants[state.activeVariantId].name : "base";
  canvases.forEach((c, i) => {
    const preview = document.querySelector(`#export-canvas-list .filename[data-canvas-id="${c.id}"]`);
    if (!preview) return;
    preview.textContent = formatFilename(tpl, {
      network: c.network, w: c.w, h: c.h, name: c.name,
      index: i + 1, variant: variantName
    }) + ".png";
  });
}

async function performExport() {
  const tpl = (document.getElementById("export-template").value || "{network}_{w}x{h}_{name}").trim() || "{network}_{w}x{h}_{name}";
  const allVariants = document.getElementById("export-all-variants").checked;
  const checked = Array.from(document.querySelectorAll("#export-canvas-list input[type=checkbox]"))
    .filter(cb => cb.checked).map(cb => cb.dataset.canvasId);
  if (checked.length === 0) {
    toast("Select at least one canvas", true);
    return;
  }

  const zip = new JSZip();

  if (allVariants && state.variants && Object.keys(state.variants).length > 1) {
    // Persist current top-level edits into the active variant before iterating.
    saveActiveVariantState();
    Object.values(state.variants).forEach(v => {
      const folder = zip.folder(sanitizeFolderName(v.name));
      const canvases = Object.values(v.canvases || {}).filter(c => checked.includes(c.id));
      canvases.forEach((c, i) => {
        const png = renderCanvasToPngWithLayers(c, v.layers);
        const filename = formatFilename(tpl, {
          network: c.network, w: c.w, h: c.h, name: c.name,
          index: i + 1, variant: v.name
        });
        folder.file(filename + ".png", png.split(",")[1], { base64: true });
      });
    });
  } else {
    const variantName = (state.variants && state.variants[state.activeVariantId])
      ? state.variants[state.activeVariantId].name : "base";
    const canvases = Object.values(state.canvases).filter(c => checked.includes(c.id));
    canvases.forEach((c, i) => {
      const png = renderCanvasToPngWithLayers(c, state.layers);
      const filename = formatFilename(tpl, {
        network: c.network, w: c.w, h: c.h, name: c.name,
        index: i + 1, variant: variantName
      });
      zip.file(filename + ".png", png.split(",")[1], { base64: true });
    });
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `banners-${Date.now()}.zip`);
  closeExportModal();
  toast(`Exported ${checked.length} canvas${checked.length === 1 ? "" : "es"}${allVariants ? " × all variants" : ""}`);
}

function sanitizeFolderName(s) {
  return String(s || "variant").replace(/[^a-z0-9_.\-]/gi, "_") || "variant";
}

// Render a canvas to a PNG data URL. `layers` is the layer set to draw (defaults
// to current top-level state.layers, but can be a variant's layer set during
// export-all-variants).
function renderCanvasToPngWithLayers(c, layers) {
  const holder = document.createElement("div");
  holder.style.position = "absolute";
  holder.style.left = "-99999px";
  holder.style.top = "-99999px";
  document.body.appendChild(holder);

  const stage = new Konva.Stage({ container: holder, width: c.w, height: c.h });
  const kLayer = new Konva.Layer();
  stage.add(kLayer);

  const ordered = [...c.layout].sort((a, b) => a.z - b.z);
  ordered.forEach(entry => {
    if (entry.visible === false) return;
    const la = layers.find(l => l.id === entry.layerId);
    if (!la) return;
    kLayer.add(new Konva.Image({
      image: la.image,
      x: entry.x, y: entry.y,
      offsetX: la.image.naturalWidth / 2,
      offsetY: la.image.naturalHeight / 2,
      scaleX: entry.scaleX, scaleY: entry.scaleY,
      rotation: entry.rotation || 0,
      opacity: entry.opacity == null ? 1 : entry.opacity,
    }));
  });
  kLayer.draw();
  const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
  stage.destroy();
  holder.remove();
  return dataUrl;
}

// ---------- small utilities ----------
function setupDragDrop(el, onFiles) {
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("dragover");
    onFiles(e.dataTransfer.files);
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toast(msg, isError) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; }, 2500);
  setTimeout(() => t.remove(), 3000);
}
