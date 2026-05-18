// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  async _fetch(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },
  getMatrix()                          { return this._fetch("GET",    "/api/matrix"); },
  getMissions()                        { return this._fetch("GET",    "/api/missions"); },
  getHistory()                         { return this._fetch("GET",    "/api/history"); },
  addMaterial(name)                    { return this._fetch("POST",   "/api/materials",       { name }); },
  deleteMaterial(id)                   { return this._fetch("DELETE", `/api/materials/${id}`); },
  addDestination(name)                 { return this._fetch("POST",   "/api/destinations",    { name }); },
  updateDestination(id, name)          { return this._fetch("PUT",    `/api/destinations/${id}`, { name }); },
  deleteDestination(id)                { return this._fetch("DELETE", `/api/destinations/${id}`); },
  setQuantity(destId, matId, quantity) { return this._fetch("PUT",    `/api/quantities/${destId}/${matId}`, { quantity }); },
  createMission(reward, deliveries, contracted_by, pickup_location) {
    return this._fetch("POST", "/api/missions", { reward, deliveries, contracted_by, pickup_location });
  },
  clearMissions()                      { return this._fetch("DELETE", "/api/missions"); },
  deleteMission(id)                    { return this._fetch("DELETE", `/api/missions/${id}`); },
  endRun(entries)                      { return this._fetch("POST",   "/api/missions/end-run", { entries }); },
  deleteRun(id)                        { return this._fetch("DELETE", `/api/runs/${id}`); },
  reorderMaterials(ids)                { return this._fetch("PUT", "/api/materials/reorder",    { ids }); },
  reorderDestinations(ids)             { return this._fetch("PUT", "/api/destinations/reorder", { ids }); },
  applyOcr(data)                       { return this._fetch("POST",   "/api/ocr/apply",        data); },
  getAliases()                         { return this._fetch("GET",    "/api/aliases"); },
  addAlias(alias, destId)              { return this._fetch("POST",   "/api/aliases",           { alias, dest_id: destId }); },
  deleteAlias(id)                      { return this._fetch("DELETE", `/api/aliases/${id}`); },

  async ocrImage(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/ocr", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  },
};

// ── drag & drop ────────────────────────────────────────────────────────────────

const _drag = { type: null, id: null };

function _reorderIds(type, fromId, toId) {
  const items = type === "material" ? state.materials : state.destinations;
  const ids = items.map(x => x.id);
  const fi = ids.indexOf(fromId), ti = ids.indexOf(toId);
  if (fi === -1 || ti === -1 || fi === ti) return null;
  ids.splice(fi, 1);
  ids.splice(ti, 0, fromId);
  return ids;
}

async function _applyReorder(type, ids) {
  try {
    if (type === "material") await api.reorderMaterials(ids);
    else await api.reorderDestinations(ids);
    await reload();
  } catch (err) { flashError(err.message); }
}

function makeDraggable(itemEl, type, id) {
  itemEl.draggable = true;
  itemEl.addEventListener("dragstart", e => {
    _drag.type = type; _drag.id = id;
    itemEl.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");   // required by Firefox
  });
  itemEl.addEventListener("dragend", () => {
    _drag.type = null; _drag.id = null;
    itemEl.classList.remove("is-dragging");
    document.querySelectorAll(".drag-over").forEach(x => x.classList.remove("drag-over"));
  });
  itemEl.addEventListener("dragover", e => {
    if (_drag.type !== type) return;
    e.preventDefault();
    document.querySelectorAll(".drag-over").forEach(x => x.classList.remove("drag-over"));
    itemEl.classList.add("drag-over");
  });
  itemEl.addEventListener("dragleave", e => {
    if (!itemEl.contains(e.relatedTarget)) itemEl.classList.remove("drag-over");
  });
  itemEl.addEventListener("drop", async e => {
    e.preventDefault();
    itemEl.classList.remove("drag-over");
    if (_drag.id === id || _drag.type !== type) return;
    const ids = _reorderIds(type, _drag.id, id);
    if (ids) await _applyReorder(type, ids);
  });
}

// ── cell tooltip (mission sources) ─────────────────────────────────────────────

function computeCardSources() {
  const sources = {};  // { destId: { matId: [{num, qty, pct}] } }
  state.missions.forEach((mission, idx) => {
    const pct = state.missionPcts[mission.id] ?? 100;
    for (const d of mission.deliveries) {
      if (!d.dest_id || !d.mat_id) continue;
      const dk = String(d.dest_id), mk = String(d.mat_id);
      if (!sources[dk]) sources[dk] = {};
      if (!sources[dk][mk]) sources[dk][mk] = [];
      sources[dk][mk].push({ num: idx + 1, qty: Math.ceil(d.quantity * pct / 100), pct });
    }
  });
  return sources;
}

let _cellTip = null;
function getCellTip() {
  if (!_cellTip) {
    _cellTip = document.createElement("div");
    _cellTip.className = "cell-tooltip";
    document.body.appendChild(_cellTip);
  }
  return _cellTip;
}

function setupCellTooltip(td) {
  td.addEventListener("mouseenter", () => {
    const src = computeCardSources()[td.dataset.destId]?.[td.dataset.matId];
    if (!src || !src.length) return;
    const tip = getCellTip();
    tip.innerHTML = "";
    src.forEach(s => {
      const row = document.createElement("div");
      row.className = "tooltip-row";
      row.innerHTML =
        `<span class="tooltip-mission">Mission ${s.num}</span>` +
        (s.pct < 100 ? `<span class="tooltip-pct">${s.pct}%</span>` : "") +
        `<span class="tooltip-qty">${s.qty} SCU</span>`;
      tip.appendChild(row);
    });
    const rect = td.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 180);
    const top  = rect.bottom + 4 < window.innerHeight - 80
      ? rect.bottom + 4
      : rect.top - tip.offsetHeight - 4;
    tip.style.left = left + "px";
    tip.style.top  = top  + "px";
    tip.classList.add("visible");
  });
  td.addEventListener("mouseleave", () => {
    if (_cellTip) _cellTip.classList.remove("visible");
  });
}

// ── state ──────────────────────────────────────────────────────────────────────

const state = {
  materials:      [],
  destinations:   [],
  missions:       [],
  aliases:        [],
  missionPcts:    {},   // { missionId: 25|50|75|100 }
  tab:            "tracker",
  history:        null,
  historyLoading: false,
  ocrBusy:        false,
  error:          null,
};

// ── DOM ────────────────────────────────────────────────────────────────────────

const $app   = document.getElementById("app");
const $modal = document.getElementById("modal-root");

// ── top-level render ───────────────────────────────────────────────────────────

function render() {
  $app.innerHTML = "";

  if (state.error) {
    const div = el("div", { className: "error-banner" });
    div.textContent = state.error;
    $app.appendChild(div);
  }

  $app.appendChild(buildHeader());
  $app.appendChild(buildTabNav());

  if (state.tab === "tracker") {
    $app.appendChild(buildOCRSection());
    $app.appendChild(buildMatrixSection());
    $app.appendChild(buildMissionsSection());
    const listsRow = el("div", { className: "lists-row" });
    listsRow.appendChild(buildMaterialsSection());
    listsRow.appendChild(buildDestinationsSection());
    listsRow.appendChild(buildAliasesSection());
    $app.appendChild(listsRow);
  } else {
    $app.appendChild(buildHistoryTab());
  }
}

// ── header ─────────────────────────────────────────────────────────────────────

function buildHeader() {
  const header = el("header");
  header.appendChild(el("h1", {}, [
    text("SC Cargo Tracker "),
    el("span", {}, [text("— destination matrix")]),
  ]));
  const btn = el("button", { className: "btn-ghost btn-sm" }, [text("Copy as Table")]);
  btn.onclick = copyAsTable;
  header.appendChild(btn);
  return header;
}

// ── tab navigation ─────────────────────────────────────────────────────────────

function buildTabNav() {
  const nav = el("div", { className: "tabs" });
  for (const [id, label] of [["tracker", "Tracker"], ["history", "History"]]) {
    const btn = el("button", { className: "tab-btn" + (state.tab === id ? " active" : "") }, [text(label)]);
    btn.onclick = () => switchTab(id);
    nav.appendChild(btn);
  }
  return nav;
}

async function switchTab(id) {
  if (state.tab === id) return;
  state.tab = id;
  if (id === "history" && !state.history) {
    state.historyLoading = true;
    render();
    try {
      state.history = await api.getHistory();
    } catch (e) {
      state.error = `Could not load history: ${e.message}`;
    }
    state.historyLoading = false;
  }
  render();
}

// ── materials ──────────────────────────────────────────────────────────────────

function buildMaterialsSection() {
  const section = el("section");
  section.appendChild(el("h2", {}, [text("Materials")]));

  if (state.materials.length > 0) {
    const list = el("div", { className: "material-list" });
    for (const mat of state.materials) {
      const item = el("div", { className: "material-item" });
      item.appendChild(el("span", { className: "drag-handle", title: "Drag to reorder" }, [text("⣿")]));
      item.appendChild(el("span", { style: "flex:1" }, [text(mat.name)]));
      const del = el("button", { className: "btn-danger", title: `Remove ${mat.name}` }, [text("×")]);
      del.onclick = () => removeMaterial(mat.id);
      item.appendChild(del);
      makeDraggable(item, "material", mat.id);
      list.appendChild(item);
    }
    section.appendChild(list);
  }

  const form = el("div", { className: "add-material-form" });
  const input = el("input", { type: "text", placeholder: "New material…", id: "new-mat-input" });
  const btn   = el("button", { className: "btn-primary btn-sm" }, [text("Add")]);

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    try { await api.addMaterial(name); input.value = ""; await reload(); }
    catch (e) { flashError(e.message); }
  };
  input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  btn.onclick = submit;
  form.appendChild(input);
  form.appendChild(btn);
  section.appendChild(form);
  return section;
}

// ── matrix ─────────────────────────────────────────────────────────────────────

function buildMatrixSection() {
  const section = el("section");
  section.appendChild(el("h2", {}, [text("Matrix")]));

  const noMats  = state.materials.length    === 0;
  const noDests = state.destinations.length === 0;

  if (noMats || noDests) {
    const hint = el("div", { className: "hint-box" });
    const strong = el("strong");
    strong.textContent = noMats ? "No materials yet" : "No destinations yet";
    hint.appendChild(strong);
    hint.appendChild(text(noMats
      ? "Add at least one material below to start tracking."
      : "Add at least one destination below to start tracking."));
    section.appendChild(hint);
  } else {
    const wrap = el("div", { className: "table-wrap" });
    wrap.appendChild(buildTable());
    section.appendChild(wrap);
  }

  return section;
}

function computeCardMatrix() {
  // { destId: { matId: totalEffectiveQty } } — derived from active mission cards
  const matrix = {};
  for (const mission of state.missions) {
    const pct = state.missionPcts[mission.id] ?? 100;
    for (const d of mission.deliveries) {
      if (!d.dest_id || !d.mat_id) continue;
      if (!matrix[d.dest_id]) matrix[d.dest_id] = {};
      const eff = Math.ceil(d.quantity * pct / 100);
      matrix[d.dest_id][d.mat_id] = (matrix[d.dest_id][d.mat_id] || 0) + eff;
    }
  }
  return matrix;
}

function updateMatrixFromCards() {
  const matrix = computeCardMatrix();
  document.querySelectorAll("td[data-dest-id][data-mat-id]").forEach(td => {
    const qty = matrix[td.dataset.destId]?.[td.dataset.matId] ?? null;
    td.textContent = qty != null ? String(qty) : "—";
    td.className   = "qty-cell" + (qty != null ? "" : " is-null");
  });
  document.querySelectorAll("td[data-total-dest]").forEach(td => {
    const destMats = matrix[td.dataset.totalDest];
    if (!destMats || !Object.keys(destMats).length) {
      td.textContent = "—";
      td.className   = "qty-cell total-cell is-null";
    } else {
      td.textContent = String(Object.values(destMats).reduce((s, q) => s + q, 0));
      td.className   = "qty-cell total-cell";
    }
  });
}

function buildTable() {
  const cardMatrix = computeCardMatrix();
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", { className: "col-dest" }, [text("Destination")]));
  for (const mat of state.materials) {
    const th = el("th", { className: "col-mat", title: "Drag to reorder columns" });
    th.appendChild(el("span", { className: "drag-handle th-drag-handle" }, [text("⣿")]));
    th.appendChild(text(mat.name));
    makeDraggable(th, "material", mat.id);
    headRow.appendChild(th);
  }
  headRow.appendChild(el("th", { className: "col-total" }, [text("Total SCU")]));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const dest of state.destinations) tbody.appendChild(buildDestRow(dest, cardMatrix));
  table.appendChild(tbody);
  return table;
}

function buildDestRow(dest, cardMatrix) {
  const tr = el("tr", { "data-dest-id": dest.id });

  const nameTd = el("td", { className: "cell-dest", title: "Drag to reorder rows" });
  nameTd.appendChild(el("span", { className: "drag-handle row-drag-handle" }, [text("⣿")]));
  nameTd.appendChild(text(dest.name));
  makeDraggable(nameTd, "destination", dest.id);
  tr.appendChild(nameTd);

  let rowTotal = 0;
  let rowHasAny = false;
  for (const mat of state.materials) {
    const qty = cardMatrix[dest.id]?.[mat.id] ?? null;
    const td  = el("td", {
      className:        "qty-cell" + (qty != null ? "" : " is-null"),
      "data-dest-id":   String(dest.id),
      "data-mat-id":    String(mat.id),
    });
    td.textContent = qty != null ? String(qty) : "—";
    if (qty != null) { rowTotal += qty; rowHasAny = true; }
    setupCellTooltip(td);
    tr.appendChild(td);
  }

  const totalTd = el("td", {
    className:         "qty-cell total-cell" + (rowHasAny ? "" : " is-null"),
    "data-total-dest": String(dest.id),
  });
  totalTd.textContent = rowHasAny ? String(rowTotal) : "—";
  tr.appendChild(totalTd);

  return tr;
}

// ── missions section ───────────────────────────────────────────────────────────

function buildMissionsSection() {
  const section = el("section");

  const headRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.75rem;flex-wrap:wrap;" });

  const titleWrap = el("div", { style: "display:flex;align-items:center;gap:.6rem;" });
  const h2 = el("h2", { style: "margin-bottom:0;" }, [text("Active Missions")]);
  const badge = el("span", {
    style: `background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:.1rem .55rem;font-size:.75rem;color:var(--text-muted);font-weight:600;`,
  }, [text(`${state.missions.length} / 10`)]);
  titleWrap.appendChild(h2);
  titleWrap.appendChild(badge);
  headRow.appendChild(titleWrap);

  const btnGroup = el("div", { style: "display:flex;gap:.5rem;" });

  const cancelBtn = el("button", {
    className: "btn-ghost btn-sm",
    disabled: state.missions.length === 0,
  }, [text("Cancel Run")]);
  cancelBtn.onclick = handleCancelRun;

  const endBtn = el("button", {
    className: "btn-primary btn-sm",
    disabled: state.missions.length === 0,
  }, [text("End Run")]);
  endBtn.onclick = handleEndRun;

  btnGroup.appendChild(cancelBtn);
  btnGroup.appendChild(endBtn);
  headRow.appendChild(btnGroup);

  section.appendChild(headRow);

  if (state.missions.length === 0) {
    section.appendChild(el("p", { className: "missions-empty" }, [
      text("No active missions. Paste a mission screenshot (Ctrl+V) to add a card."),
    ]));
    return section;
  }

  const grid = el("div", { className: "missions-grid" });
  state.missions.forEach((mission, idx) => {
    grid.appendChild(buildMissionCard(mission, idx + 1));
  });
  section.appendChild(grid);
  return section;
}

function buildMissionCard(mission, num) {
  const pct  = state.missionPcts[mission.id] ?? 100;
  const card = el("div", { className: "mission-card" });

  // ── header ──
  const header = el("div", { className: "mission-card-header" });

  const titleEl = el("div", { style: "display:flex;flex-direction:column;gap:.1rem;" });
  titleEl.appendChild(el("div", { className: "mission-card-title" }, [text(`Mission ${num}`)]));

  const removeBtn = el("button", {
    className: "btn-danger",
    title: "Remove card",
    style: "padding:.2rem .45rem;font-size:.9rem;",
  }, [text("×")]);
  removeBtn.onclick = () => removeMissionCard(mission.id);

  const rewardWrap = el("div", { style: "display:flex;align-items:flex-start;gap:.6rem;" });

  const amountEl = el("div", { className: "mission-reward-amount" });
  const labelEl  = el("div", { className: "mission-reward-label" });

  if (mission.reward != null) {
    const rewardCol = el("div", { className: "mission-reward" });
    labelEl.textContent = "aUEC reward";

    function updateReward() {
      const effective = Math.ceil(mission.reward * (state.missionPcts[mission.id] ?? 100) / 100);
      amountEl.textContent = effective.toLocaleString();
    }
    updateReward();
    card._updateReward = updateReward;

    rewardCol.appendChild(amountEl);
    rewardCol.appendChild(labelEl);
    rewardWrap.appendChild(rewardCol);
  }

  rewardWrap.appendChild(removeBtn);
  header.appendChild(titleEl);
  header.appendChild(rewardWrap);
  card.appendChild(header);

  // ── meta (contracted by / pickup) ──
  const hasMeta = mission.contracted_by || mission.pickup_location;
  if (hasMeta) {
    const metaDiv = el("div", { className: "mission-meta" });
    if (mission.contracted_by) {
      const row = el("div", { className: "mission-meta-row" });
      row.appendChild(el("span", { className: "meta-label" }, [text("By")]));
      row.appendChild(el("span", { className: "meta-value" }, [text(mission.contracted_by)]));
      metaDiv.appendChild(row);
    }
    if (mission.pickup_location) {
      const row = el("div", { className: "mission-meta-row" });
      row.appendChild(el("span", { className: "meta-label" }, [text("Pickup")]));
      row.appendChild(el("span", { className: "meta-value" }, [text(mission.pickup_location)]));
      metaDiv.appendChild(row);
    }
    card.appendChild(metaDiv);
  }

  // ── deliveries ──
  const deliveriesDiv = el("div", { className: "mission-deliveries" });
  const qtyUpdaters = [];

  for (const d of mission.deliveries) {
    const row = el("div", { className: "mission-delivery-row" });

    const info = el("div", { className: "delivery-info" });

    const matDiv = el("div", { className: "delivery-mat" });
    matDiv.appendChild(text(d.mat_name));
    if (!d.mat_id) matDiv.appendChild(el("span", { className: "tag-new" }, [text("new")]));
    info.appendChild(matDiv);

    const destDiv = el("div", {
      className: "delivery-dest" + (d.dest_id ? "" : " unmatched"),
      title: d.dest_name,
    });
    if (d.dest_id) {
      destDiv.textContent = d.dest_matched_name || d.dest_name;
    } else {
      destDiv.appendChild(el("span", { className: "tag-unmatched" }, [text("?")]));
      destDiv.appendChild(text(" " + d.dest_name.slice(0, 30) + (d.dest_name.length > 30 ? "…" : "")));
    }
    info.appendChild(destDiv);
    row.appendChild(info);

    const qtyEl   = el("div", { className: "delivery-qty" });
    const qtySpan = el("span");
    const unitSpan = el("span", { className: "qty-unit" }, [text("SCU")]);

    function makeUpdater(baseQty, span) {
      return function() {
        span.textContent = String(Math.ceil(baseQty * (state.missionPcts[mission.id] ?? 100) / 100));
      };
    }
    const updater = makeUpdater(d.quantity, qtySpan);
    updater();
    qtyUpdaters.push(updater);

    qtyEl.appendChild(qtySpan);
    qtyEl.appendChild(unitSpan);
    row.appendChild(qtyEl);
    deliveriesDiv.appendChild(row);
  }

  card._qtyUpdaters = qtyUpdaters;
  card.appendChild(deliveriesDiv);

  // ── summary row (total SCU + stops) ──
  const uniqueDests = new Set(mission.deliveries.filter(d => d.dest_id).map(d => d.dest_id)).size;
  const sumDiv = el("div", { className: "mission-summary" });

  const scuItem = el("div", { className: "sum-item" });
  const scuStrong = el("strong");
  function updateSCUSummary() {
    const curPct = state.missionPcts[mission.id] ?? 100;
    const total  = mission.deliveries.reduce((acc, d) => acc + Math.ceil(d.quantity * curPct / 100), 0);
    scuStrong.textContent = String(total);
  }
  updateSCUSummary();
  card._updateSCU = updateSCUSummary;
  scuItem.appendChild(scuStrong);
  scuItem.appendChild(text(" SCU total"));
  sumDiv.appendChild(scuItem);

  if (uniqueDests > 0) {
    const stopItem = el("div", { className: "sum-item" });
    stopItem.appendChild(el("strong", {}, [text(String(uniqueDests))]));
    stopItem.appendChild(text(` stop${uniqueDests !== 1 ? "s" : ""}`));
    sumDiv.appendChild(stopItem);
  }
  card.appendChild(sumDiv);

  // ── completion % selector ──
  const compRow = el("div", { className: "completion-row" });
  for (const p of [25, 50, 75, 100]) {
    const btn = el("button", { className: "pct-btn" + (pct === p ? " active" : "") }, [text(`${p}%`)]);
    btn.onclick = () => {
      state.missionPcts[mission.id] = p;
      card.querySelectorAll(".pct-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      card._qtyUpdaters.forEach(u => u());
      if (card._updateReward) card._updateReward();
      if (card._updateSCU)    card._updateSCU();
      updateMatrixFromCards();
    };
    compRow.appendChild(btn);
  }
  card.appendChild(compRow);

  return card;
}

// ── end run ────────────────────────────────────────────────────────────────────

async function handleEndRun() {
  if (state.missions.length === 0) return;

  const lines = state.missions.map((m, i) => {
    const pct = state.missionPcts[m.id] ?? 100;
    const reward = m.reward ? ` · ${Math.ceil(m.reward * pct / 100).toLocaleString()} aUEC` : "";
    const scu    = m.deliveries.reduce((acc, d) => acc + Math.ceil(d.quantity * pct / 100), 0);
    return `  Mission ${i + 1}: ${pct}%${reward} · ${scu} SCU`;
  });

  if (!confirm(`End run and apply ${state.missions.length} mission(s)?\n\n${lines.join("\n")}\n\nThis will add quantities to the matrix and remove all cards.`)) return;

  const entries = state.missions.map(m => ({
    mission_id:     m.id,
    completion_pct: state.missionPcts[m.id] ?? 100,
  }));

  try {
    await api.endRun(entries);
    state.missionPcts = {};
    state.history     = null;  // invalidate cached history
    await reload();
    flashBanner(`Run complete — ${entries.length} mission(s) applied!`, "success");
  } catch (e) {
    flashError(e.message);
  }
}

async function handleCancelRun() {
  if (state.missions.length === 0) return;
  if (!confirm(`Cancel run and discard all ${state.missions.length} mission card(s)?\n\nThis will NOT update the matrix or save any history.`)) return;
  try {
    await api.clearMissions();
    state.missionPcts = {};
    await reload();
  } catch (e) {
    flashError(e.message);
  }
}

async function removeMissionCard(id) {
  try {
    await api.deleteMission(id);
    delete state.missionPcts[id];
    state.missions = state.missions.filter(m => m.id !== id);
    render();
  } catch (e) { flashError(e.message); }
}

// ── OCR section ────────────────────────────────────────────────────────────────

function buildOCRSection() {
  const section = el("section");
  section.appendChild(el("h2", {}, [text("Screenshot OCR")]));

  if (state.ocrBusy) {
    const busy = el("div", { className: "ocr-busy" });
    busy.appendChild(el("div", { className: "spinner" }));
    busy.appendChild(text("Running OCR — this may take a moment on first use…"));
    section.appendChild(busy);
    return section;
  }

  const pasteBtn = el("button", {
    className: "btn-primary",
    "data-paste-btn": "1",
  }, [text("Paste from Clipboard")]);
  pasteBtn.onclick = pasteFromClipboard;
  section.appendChild(pasteBtn);

  section.appendChild(el("p", { style: "font-size:.78rem;color:var(--text-muted);margin-top:.4rem;" }, [
    text("Ctrl+V also works anywhere on the page · processed locally"),
  ]));

  return section;
}

async function pasteFromClipboard() {
  if (state.ocrBusy) return;

  // Try the modern clipboard API first (works when clipboard-read is permitted)
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const t = item.types.find(t => t.startsWith("image/"));
        if (t) { processOCRFile(await item.getType(t)); return; }
      }
      flashError("No image in clipboard — copy a screenshot first.");
      return;
    } catch { /* permission denied — fall through */ }
  }

  // Fallback: focus a hidden contenteditable so paste fires without clipboard-read permission
  const sink = document.createElement("div");
  sink.contentEditable = "true";
  Object.assign(sink.style, {
    position: "fixed", top: "-9999px", left: "0", width: "1px", height: "1px",
  });
  document.body.appendChild(sink);
  sink.focus();

  const btn = document.querySelector("[data-paste-btn]");
  const origText = btn?.textContent;
  if (btn) { btn.textContent = "Press Ctrl+V…"; btn.style.background = "var(--amber)"; btn.style.color = "#000"; }

  const cleanup = (errMsg) => {
    sink.remove();
    if (btn) { btn.textContent = origText; btn.style.background = ""; btn.style.color = ""; }
    if (errMsg) flashError(errMsg);
  };

  sink.addEventListener("paste", (e) => {
    e.preventDefault();
    for (const item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith("image/")) { cleanup(); processOCRFile(item.getAsFile()); return; }
    }
    cleanup("No image in clipboard — copy a screenshot first.");
  }, { once: true });

  setTimeout(() => cleanup(), 10000);
}

// ── OCR processing ─────────────────────────────────────────────────────────────

async function processOCRFile(file) {
  state.ocrBusy = true; state.error = null; render();
  let result;
  try {
    result = await api.ocrImage(file);
  } catch (e) {
    state.ocrBusy = false; state.error = `OCR failed: ${e.message}`; render(); return;
  }
  state.ocrBusy = false; render();

  if (result.type === "mission") {
    showMissionModal(result);
  } else {
    showManifestModal(result);
  }
}

// ── mission save modal ─────────────────────────────────────────────────────────

function findDuplicateMission(result) {
  const incoming = result.deliveries;
  if (!incoming.length) return null;
  for (const mission of state.missions) {
    const existing = mission.deliveries;
    if (existing.length !== incoming.length) continue;
    const allMatch = incoming.every(nd =>
      existing.some(ed => {
        if (nd.quantity !== ed.quantity) return false;
        const matOk = (nd.mat_id && ed.mat_id)
          ? nd.mat_id === ed.mat_id
          : nd.mat_name.toLowerCase() === ed.mat_name.toLowerCase();
        const ndDest = (nd.dest_matched_name || nd.dest_name || "").toLowerCase();
        const destOk = (nd.dest_id && ed.dest_id)
          ? nd.dest_id === ed.dest_id
          : ndDest === ed.dest_name.toLowerCase();
        return matOk && destOk;
      })
    );
    if (allMatch) return mission;
  }
  return null;
}

function showMissionModal(result) {
  $modal.innerHTML = "";
  const overlay = el("div", { className: "modal-overlay" });
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const modal = el("div", { className: "modal" });

  const mh = el("div", { className: "modal-header" });
  mh.appendChild(el("h3", {}, [text("Mission Detected")]));
  const closeBtn = el("button", { className: "modal-close" }, [text("×")]);
  closeBtn.onclick = closeModal;
  mh.appendChild(closeBtn);
  modal.appendChild(mh);

  const body = el("div", { className: "modal-body" });

  // meta row (reward + contracted_by + pickup)
  const metaWrap = el("div", { style: "display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:flex-start;" });
  if (result.reward != null) {
    const r = el("div");
    r.appendChild(el("div", { className: "modal-section-label", style: "margin-bottom:.2rem;" }, [text("Reward")]));
    r.appendChild(el("div", { style: "font-size:1.1rem;font-weight:700;color:var(--amber);" }, [
      text(result.reward.toLocaleString() + " aUEC"),
    ]));
    metaWrap.appendChild(r);
  }
  if (result.contracted_by) {
    const r = el("div");
    r.appendChild(el("div", { className: "modal-section-label", style: "margin-bottom:.2rem;" }, [text("Contracted by")]));
    r.appendChild(el("div", { style: "font-size:.88rem;" }, [text(result.contracted_by)]));
    metaWrap.appendChild(r);
  }
  if (result.pickup_location) {
    const r = el("div");
    r.appendChild(el("div", { className: "modal-section-label", style: "margin-bottom:.2rem;" }, [text("Pickup")]));
    r.appendChild(el("div", { style: "font-size:.88rem;" }, [text(result.pickup_location)]));
    metaWrap.appendChild(r);
  }
  if (metaWrap.children.length) body.appendChild(metaWrap);

  // deliveries table
  const sec = el("div");
  sec.appendChild(el("div", { className: "modal-section-label" }, [text("Deliveries")]));

  const tbl = el("table", { className: "review-table" });
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Material", "→ Destination", "SCU"]) hr.appendChild(el("th", {}, [text(h)]));
  thead.appendChild(hr); tbl.appendChild(thead);

  const tbody = el("tbody");
  for (const d of result.deliveries) {
    const tr = el("tr");

    const matTd = el("td");
    matTd.appendChild(text(d.mat_name));
    if (!d.mat_known) matTd.appendChild(el("span", { className: "tag-new" }, [text("new")]));
    tr.appendChild(matTd);

    const destTd = el("td");
    if (d.dest_id) {
      destTd.textContent = d.dest_matched_name || d.dest_name;
      destTd.style.color = "var(--success)";
    } else {
      destTd.appendChild(el("span", { className: "tag-new" }, [text("new")]));
      destTd.appendChild(text(" " + d.dest_name));
      destTd.title = "Not yet in your list — will be added as a new destination when you save";
    }
    tr.appendChild(destTd);

    tr.appendChild(el("td", { style: "text-align:center;font-weight:700;" }, [text(String(d.quantity))]));
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  sec.appendChild(tbl);
  body.appendChild(sec);

  const unmatched = result.deliveries.filter(d => !d.dest_id);
  if (unmatched.length > 0) {
    body.appendChild(el("p", { style: "font-size:.8rem;color:var(--text-muted);" }, [
      text(`${unmatched.length} destination(s) marked new were not recognized and will be added to your destination list when you save.`),
    ]));
  }

  if (result.raw_lines?.length) {
    const det = el("details", { className: "raw-lines-details" });
    det.appendChild(el("summary", {}, [text(`Raw OCR (${result.raw_lines.length} tokens)`)]));
    const pre = el("pre"); pre.textContent = result.raw_lines.join("\n");
    det.appendChild(pre);
    body.appendChild(det);
  }

  const duplicate = findDuplicateMission(result);
  if (duplicate) {
    const warn = el("div", { className: "duplicate-warning" });
    warn.appendChild(text("⚠ Possible duplicate — this card matches an existing mission exactly."));
    body.appendChild(warn);
  }

  modal.appendChild(body);

  const footer = el("div", { className: "modal-footer" });
  const cancelBtn = el("button", { className: "btn-ghost" }, [text("Cancel")]);
  cancelBtn.onclick = closeModal;

  const saveBtn = el("button", { className: "btn-primary" }, [text(duplicate ? "Save Anyway" : "Save as Mission Card")]);
  saveBtn.onclick = async () => {
    if (state.missions.length >= 10) { flashError("Maximum of 10 mission cards reached."); return; }
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      // Add any unrecognised materials
      const newMats = result.deliveries.filter(d => !d.mat_known);
      if (newMats.length > 0) {
        for (const d of newMats) {
          try { await api.addMaterial(d.mat_name); } catch { /* already exists */ }
        }
      }

      // Add any unmatched destinations
      const newDests = result.deliveries.filter(d => !d.dest_id && d.dest_name);
      if (newDests.length > 0) {
        const uniqueNames = [...new Set(newDests.map(d => d.dest_name))];
        for (const name of uniqueNames) {
          try { await api.addDestination(name); } catch { /* ignore */ }
        }
      }

      // Refresh lookup tables once if anything was added
      let matByName  = Object.fromEntries(state.materials.map(m => [m.name.toLowerCase(), m.id]));
      let destByName = Object.fromEntries(state.destinations.map(d => [d.name.toLowerCase(), d.id]));
      if (newMats.length > 0 || newDests.length > 0) {
        const fresh = await api.getMatrix();
        matByName  = Object.fromEntries(fresh.materials.map(m => [m.name.toLowerCase(), m.id]));
        destByName = Object.fromEntries(fresh.destinations.map(d => [d.name.toLowerCase(), d.id]));
      }

      const cleanDeliveries = result.deliveries.map(d => ({
        mat_name:  d.mat_name,
        mat_id:    d.mat_id ?? matByName[d.mat_name.toLowerCase()] ?? null,
        dest_name: d.dest_matched_name || d.dest_name,
        dest_id:   d.dest_id ?? destByName[(d.dest_matched_name || d.dest_name).toLowerCase()] ?? null,
        quantity:  d.quantity,
      }));

      await api.createMission(
        result.reward,
        cleanDeliveries,
        result.contracted_by  ?? null,
        result.pickup_location ?? null,
      );
      closeModal();
      await reload();
    } catch (e) {
      flashError(e.message);
      saveBtn.disabled = false; saveBtn.textContent = "Save as Mission Card";
    }
  };
  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  $modal.appendChild(overlay);
}

// ── manifest review modal ──────────────────────────────────────────────────────

function showManifestModal(result) {
  $modal.innerHTML = "";
  const overlay = el("div", { className: "modal-overlay" });
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const modal = el("div", { className: "modal" });

  const mh = el("div", { className: "modal-header" });
  mh.appendChild(el("h3", {}, [text("Cargo Manifest — OCR Review")]));
  const closeBtn = el("button", { className: "modal-close" }, [text("×")]);
  closeBtn.onclick = closeModal;
  mh.appendChild(closeBtn);
  modal.appendChild(mh);

  const body = el("div", { className: "modal-body" });

  const destSec = el("div");
  destSec.appendChild(el("div", { className: "modal-section-label" }, [text("Target Destination")]));
  const destSelect = el("select", { className: "dest-select" });
  destSelect.appendChild(el("option", { value: "" }, [text("— select a destination —")]));
  for (const d of result.all_destinations) {
    const opt = el("option", { value: String(d.id) }, [text(d.name)]);
    if (result.destination?.id === d.id) opt.selected = true;
    destSelect.appendChild(opt);
  }
  destSec.appendChild(destSelect);
  body.appendChild(destSec);

  const matSec = el("div");
  matSec.appendChild(el("div", { className: "modal-section-label" }, [text("Detected Materials")]));
  const qtyOverrides = {};

  if (!result.materials?.length) {
    matSec.appendChild(el("p", { className: "no-detections" }, [text("No materials detected.")]));
  } else {
    const tbl = el("table", { className: "review-table" });
    const thead = el("thead");
    const hr = el("tr");
    for (const h of ["Material", "Detected as", "Quantity"]) hr.appendChild(el("th", {}, [text(h)]));
    thead.appendChild(hr); tbl.appendChild(thead);

    const tbody = el("tbody");
    for (const item of result.materials) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, [text(item.name)]));
      tr.appendChild(el("td", { className: "raw-text" }, [text(item.raw_name)]));
      const qtyTd = el("td");
      const qtyI  = el("input", { type: "number", min: "0", step: "1", value: String(item.quantity) });
      Object.assign(qtyI.style, { width:"4.5rem", textAlign:"center", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", color:"var(--text)", padding:".2rem .4rem" });
      qtyI.oninput = () => { const v = parseInt(qtyI.value,10); qtyOverrides[item.mat_id] = isNaN(v) ? null : v; };
      qtyOverrides[item.mat_id] = item.quantity;
      qtyTd.appendChild(qtyI); tr.appendChild(qtyTd);
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    matSec.appendChild(tbl);
  }
  body.appendChild(matSec);

  const unknownChecks = {};
  if (result.unknown_materials?.length) {
    const unkSec = el("div");
    unkSec.appendChild(el("div", { className: "modal-section-label" }, [
      text("New Materials Detected "), el("span", { className: "tag-new" }, [text("new")]),
    ]));
    for (const name of result.unknown_materials) {
      const row = el("div", { className: "unknown-mat-row" });
      const cb  = el("input", { type: "checkbox" }); cb.checked = true;
      const lbl = el("label", {}, [text(name)]);
      const qI  = el("input", { type: "number", min: "0", step: "1", placeholder: "qty", style: "width:4.5rem;margin-left:.5rem;" });
      Object.assign(qI.style, { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", color:"var(--text)", padding:".2rem .4rem", textAlign:"center" });
      unknownChecks[name] = { cb, qI };
      row.appendChild(cb); row.appendChild(lbl); row.appendChild(qI);
      unkSec.appendChild(row);
    }
    body.appendChild(unkSec);
    body._unknownChecks = unknownChecks;
  }

  if (result.raw_lines?.length) {
    const det = el("details", { className: "raw-lines-details" });
    det.appendChild(el("summary", {}, [text(`Raw OCR (${result.raw_lines.length} tokens)`)]));
    const pre = el("pre"); pre.textContent = result.raw_lines.join("\n");
    det.appendChild(pre);
    body.appendChild(det);
  }

  modal.appendChild(body);

  const footer = el("div", { className: "modal-footer" });
  const cancelBtn = el("button", { className: "btn-ghost" }, [text("Cancel")]);
  cancelBtn.onclick = closeModal;

  const applyBtn = el("button", { className: "btn-primary" }, [text("Apply to Matrix")]);
  applyBtn.onclick = async () => {
    const destId = parseInt(destSelect.value, 10);
    if (!destId) { destSelect.style.borderColor = "var(--danger)"; destSelect.focus(); return; }
    applyBtn.disabled = true; applyBtn.textContent = "Applying…";

    const newMats = Object.entries(body._unknownChecks || {})
      .filter(([,v]) => v.cb.checked).map(([name]) => name);
    const mats = [
      ...(result.materials || []).map(item => ({ mat_id: item.mat_id, quantity: qtyOverrides[item.mat_id] ?? item.quantity })),
      ...Object.entries(body._unknownChecks || {}).filter(([,v]) => v.cb.checked && v.qI.value.trim())
        .map(([name,v]) => ({ name, quantity: parseInt(v.qI.value,10)||null })),
    ];

    try {
      await api.applyOcr({ dest_id: destId, materials: mats, new_materials: newMats });
      closeModal(); await reload();
    } catch (e) {
      flashError(e.message);
      applyBtn.disabled = false; applyBtn.textContent = "Apply to Matrix";
    }
  };

  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  $modal.appendChild(overlay);
}

function closeModal() { $modal.innerHTML = ""; }

// ── history tab ────────────────────────────────────────────────────────────────

function buildHistoryTab() {
  const wrap = el("div");

  if (state.historyLoading) {
    const busy = el("div", { className: "ocr-busy", style: "padding:2rem 0;" });
    busy.appendChild(el("div", { className: "spinner" }));
    busy.appendChild(text("Loading history…"));
    wrap.appendChild(busy);
    return wrap;
  }

  const h = state.history;
  if (!h) return wrap;

  // summary stat cards
  const statRow = el("div", { className: "stat-row" });
  const stats = [
    { label: "Total Runs",    value: String(h.summary.total_runs),                           amber: false },
    { label: "Total Earned",  value: h.summary.total_earned.toLocaleString() + " aUEC",      amber: true  },
    { label: "Total SCU",     value: h.summary.total_scu.toLocaleString(),                   amber: false },
  ];
  for (const s of stats) {
    const card = el("div", { className: "stat-card" });
    card.appendChild(el("div", { className: "stat-label" }, [text(s.label)]));
    card.appendChild(el("div", { className: "stat-value" + (s.amber ? " amber" : "") }, [text(s.value)]));
    statRow.appendChild(card);
  }
  wrap.appendChild(statRow);

  // section header
  const headRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.75rem;flex-wrap:wrap;" });
  headRow.appendChild(el("h2", { style: "margin-bottom:0;" }, [text("Run History")]));
  const refreshBtn = el("button", { className: "btn-ghost btn-sm" }, [text("Refresh")]);
  refreshBtn.onclick = async () => {
    state.history = null;
    state.historyLoading = true;
    render();
    try { state.history = await api.getHistory(); } catch (e) { state.error = e.message; }
    state.historyLoading = false;
    render();
  };
  headRow.appendChild(refreshBtn);
  wrap.appendChild(headRow);

  if (!h.runs.length) {
    wrap.appendChild(el("div", { className: "history-empty" }, [
      text("No runs recorded yet. Complete a run using End Run to see history here."),
    ]));
    return wrap;
  }

  // run cards (newest first — already ordered DESC by API)
  h.runs.forEach((run, idx) => {
    wrap.appendChild(buildRunCard(run, h.runs.length - idx));
  });

  return wrap;
}

function buildRunCard(run, runNum) {
  const card = el("div", { className: "run-card" });

  // parse date
  let dateStr = run.completed_at;
  let timeStr = "";
  try {
    const d = new Date(run.completed_at.replace("T", " "));
    dateStr = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch (_) { /* use raw */ }

  const header = el("div", { className: "run-card-header" });

  const dateEl = el("div", { className: "run-date" }, [
    text(`Run #${runNum} — ${dateStr}`),
    el("span", { className: "run-time" }, [text(timeStr)]),
  ]);

  const statsEl = el("div", { className: "run-stats" });
  const statItems = [
    { label: "missions", value: String(run.mission_count) },
    { label: "SCU",      value: run.total_effective_scu.toLocaleString(), amber: false },
    { label: "earned",   value: run.total_effective_reward.toLocaleString() + " aUEC", amber: true },
  ];
  for (const s of statItems) {
    const span = el("span", { className: "run-stat" });
    const strong = el("strong", { className: s.amber ? "amber" : "" }, [text(s.value)]);
    span.appendChild(strong);
    span.appendChild(text(" " + s.label));
    statsEl.appendChild(span);
  }

  const chevron = el("div", { className: "run-chevron" }, [text("▼")]);

  const delBtn = el("button", { className: "run-delete-btn", title: "Delete this run" }, [text("✕")]);
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete Run #${runNum} (${dateStr})?\n\nThis cannot be undone.`)) return;
    try {
      await api.deleteRun(run.id);
      state.history = null;
      render();
      state.historyLoading = true;
      render();
      try { state.history = await api.getHistory(); } catch (err) { state.error = err.message; }
      state.historyLoading = false;
      render();
    } catch (err) {
      state.error = `Failed to delete run: ${err.message}`;
      render();
    }
  };

  header.appendChild(dateEl);
  header.appendChild(statsEl);
  header.appendChild(delBtn);
  header.appendChild(chevron);
  card.appendChild(header);

  const missionsList = el("div", { className: "run-missions-list" });
  run.missions.forEach((m, i) => missionsList.appendChild(buildRunMissionItem(m, i + 1)));
  card.appendChild(missionsList);

  header.onclick = () => {
    const open = missionsList.classList.toggle("open");
    chevron.classList.toggle("open", open);
  };

  return card;
}

function buildRunMissionItem(m, num) {
  const item = el("div", { className: "run-mission-item" });

  const header = el("div", { className: "run-mission-header" });
  header.appendChild(el("span", { className: "run-mission-num" }, [text(`Mission ${num}`)]));

  const badge = el("span", { className: "pct-badge" + (m.completion_pct === 100 ? " full" : "") },
    [text(`${m.completion_pct}%`)]);
  header.appendChild(badge);

  if (m.effective_reward != null) {
    header.appendChild(el("span", { className: "run-mission-reward" }, [
      text(m.effective_reward.toLocaleString() + " aUEC"),
    ]));
  }
  item.appendChild(header);

  // meta
  const metaParts = [];
  if (m.contracted_by)    metaParts.push(`By: ${m.contracted_by}`);
  if (m.pickup_location)  metaParts.push(`Pickup: ${m.pickup_location}`);
  if (metaParts.length) {
    item.appendChild(el("div", { className: "run-mission-meta" }, [text(metaParts.join("  ·  "))]));
  }

  // deliveries
  const dlList = el("div", { className: "run-delivery-list" });
  for (const d of m.deliveries) {
    const row = el("div", { className: "run-delivery-row" });
    row.appendChild(el("span", { className: "rdl-mat" }, [text(d.mat_name)]));
    row.appendChild(el("span", { className: "rdl-dest" }, [text(`→ ${d.dest_name}`)]));
    const qtyEl = el("span", { className: "rdl-qty" });
    qtyEl.appendChild(text(String(d.effective_quantity)));
    if (d.effective_quantity !== d.base_quantity) {
      qtyEl.appendChild(el("span", { className: "rdl-orig" }, [text(`/ ${d.base_quantity}`)]));
    }
    qtyEl.appendChild(text(" SCU"));
    row.appendChild(qtyEl);
    dlList.appendChild(row);
  }
  item.appendChild(dlList);
  return item;
}

// ── matrix actions ─────────────────────────────────────────────────────────────

async function removeMaterial(id) {
  const mat = state.materials.find(m => m.id === id);
  if (!mat || !confirm(`Remove material "${mat.name}"? This deletes its column from every destination.`)) return;
  try { await api.deleteMaterial(id); await reload(); } catch (e) { flashError(e.message); }
}

function buildDestinationsSection() {
  const section = el("section");
  section.appendChild(el("h2", {}, [text("Destinations")]));

  if (state.destinations.length > 0) {
    const list = el("div", { className: "material-list" });
    for (const dest of state.destinations) {
      const item = el("div", { className: "material-item" });
      item.appendChild(el("span", { className: "drag-handle", title: "Drag to reorder" }, [text("⣿")]));
      const nameInput = el("input", { type: "text", className: "dest-name-input", value: dest.name });
      nameInput.onblur = async () => {
        const name = nameInput.value.trim();
        if (!name || name === dest.name) { nameInput.value = dest.name; return; }
        try { await api.updateDestination(dest.id, name); dest.name = name; }
        catch (e) { flashError(e.message); nameInput.value = dest.name; }
      };
      nameInput.onkeydown = (e) => { if (e.key === "Enter") nameInput.blur(); };
      item.appendChild(nameInput);
      const del = el("button", { className: "btn-danger", title: `Remove ${dest.name}` }, [text("×")]);
      del.onclick = () => removeDestination(dest.id);
      item.appendChild(del);
      makeDraggable(item, "destination", dest.id);
      list.appendChild(item);
    }
    section.appendChild(list);
  }

  const form = el("div", { className: "add-material-form" });
  const input = el("input", { type: "text", placeholder: "New destination…" });
  const btn   = el("button", { className: "btn-primary btn-sm" }, [text("Add")]);
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    try { await api.addDestination(name); input.value = ""; await reload(); }
    catch (e) { flashError(e.message); }
  };
  input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  btn.onclick = submit;
  form.appendChild(input);
  form.appendChild(btn);
  section.appendChild(form);
  return section;
}

async function removeDestination(id) {
  const dest = state.destinations.find(d => d.id === id);
  if (!dest || !confirm(`Delete destination "${dest.name}"?`)) return;
  try { await api.deleteDestination(id); await reload(); } catch (e) { flashError(e.message); }
}

function copyAsTable() {
  if (!state.materials.length || !state.destinations.length) return;
  const cardMatrix = computeCardMatrix();
  const header = ["Destination", ...state.materials.map(m => m.name)].join("\t");
  const rows   = state.destinations.map(dest => {
    const cells = state.materials.map(mat => {
      const qty = cardMatrix[dest.id]?.[mat.id];
      return qty != null ? String(qty) : "";
    });
    return [dest.name, ...cells].join("\t");
  });
  navigator.clipboard.writeText([header, ...rows].join("\n"))
    .then(() => flashBanner("Table copied to clipboard!", "success"))
    .catch(() => flashBanner("Clipboard write failed.", "error"));
}

// ── destination aliases ────────────────────────────────────────────────────────

function buildAliasesSection() {
  const section = el("section");

  section.appendChild(el("h2", {}, [text("Aliases")]));
  section.appendChild(el("p", { className: "section-subtitle" }, [
    text("OCR substring → destination mappings"),
  ]));

  if (state.aliases.length > 0) {
    const list = el("div", { className: "alias-list" });
    for (const a of state.aliases) {
      const item = el("div", { className: "alias-item" });
      item.appendChild(el("span", { className: "alias-text" }, [text(a.alias)]));
      item.appendChild(el("span", { className: "alias-arrow" }, [text("→")]));
      item.appendChild(el("span", { className: "alias-dest" }, [text(a.dest_name)]));
      const del = el("button", { className: "btn-danger", title: `Remove alias` }, [text("×")]);
      del.onclick = () => removeAlias(a.id);
      item.appendChild(del);
      list.appendChild(item);
    }
    section.appendChild(list);
  } else {
    section.appendChild(el("p", { style: "font-size:.85rem;color:var(--text-muted);font-style:italic;margin-bottom:.75rem;" }, [
      text("No aliases yet."),
    ]));
  }

  const form = el("div", { className: "alias-add-form" });
  const aliasInput = el("input", { type: "text", placeholder: "Alias substring…", className: "alias-input" });
  form.appendChild(aliasInput);
  form.appendChild(el("span", { style: "color:var(--text-muted);font-size:.9rem;flex-shrink:0;" }, [text("→")]));

  const destSelect = el("select", { className: "alias-dest-select" });
  destSelect.appendChild(el("option", { value: "" }, [text("— destination —")]));
  for (const d of state.destinations) {
    destSelect.appendChild(el("option", { value: String(d.id) }, [text(d.name)]));
  }
  form.appendChild(destSelect);

  const addBtn = el("button", { className: "btn-primary btn-sm" }, [text("Add")]);
  const submit = async () => {
    const alias  = aliasInput.value.trim();
    const destId = parseInt(destSelect.value, 10);
    if (!alias) { aliasInput.focus(); return; }
    if (!destId) { destSelect.focus(); return; }
    addBtn.disabled = true;
    try {
      await api.addAlias(alias, destId);
      aliasInput.value = "";
      destSelect.value = "";
      state.aliases = await api.getAliases();
      render();
    } catch (e) {
      flashError(e.message);
    } finally {
      addBtn.disabled = false;
    }
  };
  aliasInput.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  addBtn.onclick = submit;
  form.appendChild(addBtn);
  section.appendChild(form);

  return section;
}

async function removeAlias(id) {
  try {
    await api.deleteAlias(id);
    state.aliases = await api.getAliases();
    render();
  } catch (e) { flashError(e.message); }
}

// ── data loading ───────────────────────────────────────────────────────────────

async function reload() {
  try {
    const [matrix, missions, aliases] = await Promise.all([
      api.getMatrix(), api.getMissions(), api.getAliases(),
    ]);
    state.materials    = matrix.materials;
    state.destinations = matrix.destinations;
    state.missions     = missions;
    state.aliases      = aliases;
    state.error        = null;
  } catch (e) {
    state.error = `Could not load data: ${e.message}`;
  }
  render();
}

// ── utilities ──────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && typeof v === "string") node.setAttribute("style", v);
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function text(str) { return document.createTextNode(str); }

function flashError(msg) {
  state.error = msg; render();
  setTimeout(() => { if (state.error === msg) { state.error = null; render(); } }, 6000);
}

function flashBanner(msg, type = "success") {
  const banner = el("div", { style: `position:fixed;bottom:1.25rem;right:1.25rem;background:${type==="success"?"var(--success)":"var(--danger)"};color:#000;font-weight:600;padding:.6rem 1rem;border-radius:var(--radius);box-shadow:var(--shadow);z-index:200;font-size:.88rem;` }, [text(msg)]);
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2500);
}

// ── clipboard paste ────────────────────────────────────────────────────────────

document.addEventListener("paste", (e) => {
  const tag = document.activeElement?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (state.ocrBusy) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) processOCRFile(file);
      break;
    }
  }
});

// ── version check ─────────────────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const data = await api._fetch("GET", "/api/version");
    if (data.update_available) showUpdateBanner(data.latest, data.release_url);
  } catch (_) {}
}

function showUpdateBanner(version, url) {
  if (document.getElementById("update-banner")) return;
  const banner = el("div", { id: "update-banner", className: "update-banner" });
  const msg = el("span", {}, [text(`Version ${version} is available`)]);
  const dlBtn = el("a", {
    className: "update-banner-dl",
    href: url || "#",
    target: "_blank",
    rel: "noopener",
    textContent: "Download",
  });
  const closeBtn = el("button", { className: "update-banner-close", textContent: "✕" });
  closeBtn.addEventListener("click", () => banner.remove());
  banner.append(msg, dlBtn, closeBtn);
  document.body.insertBefore(banner, document.body.firstChild);
}

// ── init ───────────────────────────────────────────────────────────────────────

$app.innerHTML = `<div style="padding:2rem;color:var(--text-muted)">Loading…</div>`;
reload();
checkForUpdate();
