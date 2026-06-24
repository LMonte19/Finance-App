import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
let healthTimer = null;
let healthBusy = false;
let lastHealthHtml = "";

function isPage(id) { return qs(id)?.classList.contains("active-page"); }
function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}
function card(html, attrs = "") { return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`; }
function severityColor(severity) { if (severity === "HIGH") return "#ff8b8b"; if (severity === "MEDIUM") return "#ffd27a"; if (severity === "LOW") return "#8fb1ff"; return "#9ff5b2"; }
function prettyCode(code = "") {
  const labels = {
    ACTIVE_DISBURSEMENT_NO_FUNDING: "Desembolso sin distribución",
    FUNDING_SPLIT_NOT_100: "Distribución no suma 100%",
    PAYMENT_MISSING_TYPE: "Pago sin tipo",
    VOIDED_PAYMENT_HAS_ACTIVE_ALLOCATIONS: "Pago anulado con distribuciones",
    PAYMENT_ALLOCATION_MISMATCH: "Distribución no coincide",
    PRINCIPAL_PAYMENT_NOT_TRACKED: "Capital sin rastreo",
    ACCOUNT_WITH_INVALID_RATE: "Tasa inválida",
    ACCOUNT_OVERDUE: "Cuenta atrasada",
  };
  return labels[code] || String(code).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function loanHealthHtml() {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Revisión de cuentas / sistema</div>
      <div class="muted">Revisa capital activo, distribuciones, pagos anulados, abonos a capital y consistencia del modelo nuevo.</div>
      <div class="stats-grid" style="margin-top:12px;">
        <div class="stat-card"><div class="stat-label">Alertas</div><div class="stat-value" id="healthStatTotal">0</div></div>
        <div class="stat-card"><div class="stat-label">Alta</div><div class="stat-value" id="healthStatHigh">0</div></div>
        <div class="stat-card"><div class="stat-label">Media</div><div class="stat-value" id="healthStatMedium">0</div></div>
        <div class="stat-card"><div class="stat-label">Baja</div><div class="stat-value" id="healthStatLow">0</div></div>
      </div>
    </div>
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Vista de revisión</div>
      <div class="row">
        <button id="healthFilterAll" type="button">Todas</button>
        <button id="healthFilterHigh" type="button">Alta</button>
      </div>
      <div class="row">
        <button id="healthFilterMedium" type="button">Media</button>
        <button id="healthFilterLow" type="button">Baja</button>
      </div>
      <div class="row">
        <input id="healthSearch" placeholder="Buscar cliente, alerta, detalles..." />
        <button id="btnRefreshHealth" type="button">Actualizar</button>
      </div>
      <div class="muted">Las cuotas futuras son virtuales. Esta página ya no genera fechas manualmente.</div>
    </div>
    <div class="card" data-no-translate="true">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-weight:800;">Alertas</div>
        <span class="pill" id="healthCountPill">0</span>
      </div>
      <div id="loanHealthList" class="muted">Cargando...</div>
    </div>
  `;
}
function ensureLoanHealthPage() {
  const app = qs("app");
  if (!app) return null;
  let page = qs("loanHealthPage");
  if (!page) { page = document.createElement("div"); page.id = "loanHealthPage"; page.className = "page"; app.appendChild(page); }
  if (!qs("loanHealthList") || qs("btnGenerateAllDue")) page.innerHTML = loanHealthHtml();
  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuLoanHealth")) {
    const btn = document.createElement("button");
    btn.id = "menuLoanHealth";
    btn.className = "menu-link";
    btn.dataset.page = "loanHealthPage";
    btn.textContent = "Revisión de sistema";
    const dueBtn = qs("menuDueOverdue");
    const followBtn = qs("menuFollowups");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, dueBtn || followBtn || defaultsBtn || null);
  }
  const menuBtn = qs("menuLoanHealth");
  if (menuBtn && menuBtn.dataset.bound !== "true") {
    menuBtn.dataset.bound = "true";
    menuBtn.onclick = (event) => { event.preventDefault(); event.stopPropagation(); ensureLoanHealthPage(); openPage("loanHealthPage"); renderHealth(true); };
  }
  bindControls();
  return page;
}
function bindControls() {
  [["healthFilterAll", "ALL"], ["healthFilterHigh", "HIGH"], ["healthFilterMedium", "MEDIUM"], ["healthFilterLow", "LOW"]].forEach(([id, value]) => {
    const btn = qs(id);
    if (btn && btn.dataset.bound !== "true") {
      btn.dataset.bound = "true";
      btn.onclick = () => { localStorage.setItem("loanLedger.healthFilter", value); lastHealthHtml = ""; renderHealth(true); };
    }
  });
  if (qs("btnRefreshHealth") && qs("btnRefreshHealth").dataset.bound !== "true") { qs("btnRefreshHealth").dataset.bound = "true"; qs("btnRefreshHealth").onclick = () => renderHealth(true); }
  if (qs("healthSearch") && qs("healthSearch").dataset.bound !== "true") { qs("healthSearch").dataset.bound = "true"; qs("healthSearch").oninput = () => renderHealth(true); }
}
function setFilterButtons() {
  const filter = localStorage.getItem("loanLedger.healthFilter") || "ALL";
  const ids = { ALL: "healthFilterAll", HIGH: "healthFilterHigh", MEDIUM: "healthFilterMedium", LOW: "healthFilterLow" };
  Object.entries(ids).forEach(([key, id]) => { const btn = qs(id); if (btn) btn.style.background = key === filter ? "#2b63ff" : "#333"; });
}
function filterIssues(rows) {
  const filter = localStorage.getItem("loanLedger.healthFilter") || "ALL";
  const term = String(qs("healthSearch")?.value || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "ALL" && row.severity !== filter) return false;
    if (term) {
      const haystack = [row.issue_code, prettyCode(row.issue_code), row.severity, row.borrower_name, row.summary, row.details].map((x) => String(x || "").toLowerCase()).join(" ");
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}
function renderIssue(row) {
  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div><strong>${row.borrower_name || "Sin cliente"}</strong><br><span class="muted">${prettyCode(row.issue_code)}</span></div>
      <span class="pill" style="color:${severityColor(row.severity)};">${row.severity}</span>
    </div>
    <div style="margin-top:8px;">
      <strong>${row.summary}</strong><br>
      <span class="muted">${row.details || "—"}</span>
      ${row.loan_id ? `<br><span class="muted">Desembolso: ${String(row.loan_id).slice(0, 8)}…</span>` : ""}
    </div>
  `);
}
async function renderHealth(force = false) {
  ensureLoanHealthPage();
  if (!isPage("loanHealthPage") || healthBusy || !qs("loanHealthList")) return;
  healthBusy = true;
  try {
    setFilterButtons();
    const { data, error } = await supabase.from("loan_health_issues").select("*").order("severity", { ascending: true }).order("borrower_name", { ascending: true });
    if (error) throw error;
    const allRows = data || [];
    const rows = filterIssues(allRows);
    qs("healthStatTotal").textContent = String(allRows.length);
    qs("healthStatHigh").textContent = String(allRows.filter((r) => r.severity === "HIGH").length);
    qs("healthStatMedium").textContent = String(allRows.filter((r) => r.severity === "MEDIUM").length);
    qs("healthStatLow").textContent = String(allRows.filter((r) => r.severity === "LOW").length);
    qs("healthCountPill").textContent = String(rows.length);
    const html = rows.length ? rows.map(renderIssue).join("") : "No hay alertas para esta vista.";
    if (force || html !== lastHealthHtml) { qs("loanHealthList").innerHTML = html; lastHealthHtml = html; }
  } catch (error) { console.error(error); qs("loanHealthList").innerHTML = error.message || String(error); } finally { healthBusy = false; }
}
async function tick() { ensureLoanHealthPage(); if (isPage("loanHealthPage")) await renderHealth(); }
const observer = new MutationObserver(() => { clearTimeout(healthTimer); healthTimer = setTimeout(tick, 200); });
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2500);
tick();
