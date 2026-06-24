import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
let activityTimer = null;
let lastActivityHtml = "";
let activityBusy = false;

function isActivityPage() { return qs("activityPage")?.classList.contains("active-page"); }
function money(n) { return `$${Number(n || 0).toFixed(2)}`; }
function safeText(value) { if (value === null || value === undefined || value === "") return "—"; if (typeof value === "object") return JSON.stringify(value); return String(value); }
function fmtDate(value) { try { return value ? new Date(value).toLocaleString() : "—"; } catch { return value || "—"; } }
function card(html, attrs = "") { return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`; }

const actionLabels = {
  CLIENT_CREATED: "Cliente creado",
  CLIENT_EDITED: "Cliente editado",
  CLIENT_DELETED: "Cliente eliminado",
  DISBURSEMENT_CREATED: "Desembolso creado",
  DISBURSEMENT_EDITED: "Desembolso editado",
  DISBURSEMENT_DELETED: "Desembolso eliminado",
  DISBURSEMENT_CLOSED: "Desembolso cerrado",
  DISBURSEMENT_VOIDED: "Desembolso anulado",
  DISBURSEMENT_REACTIVATED: "Desembolso reactivado",
  DISBURSEMENT_STATUS_CHANGED: "Estado de desembolso cambiado",
  PRINCIPAL_BALANCE_CHANGED: "Balance de capital cambiado",
  ACCOUNT_PRINCIPAL_PAID_OFF: "Capital saldado",
  ACCOUNT_MARKED_DEFAULTED: "Cuenta marcada en default",
  ACCOUNT_PAUSED: "Cuenta pausada",
  ACCOUNT_PAYMENT_RECORDED: "Pago registrado",
  ACCOUNT_PAYMENT_VOIDED: "Pago anulado",
  PAYMENT_EDITED: "Pago editado",
  PAYMENT_DELETED: "Pago eliminado",
  PAYMENT_NOTES_EDITED: "Notas del pago editadas",
  FUNDING_SPLIT_ADDED: "Distribución de inversión agregada",
  FUNDING_SPLIT_EDITED: "Distribución de inversión editada",
  FUNDING_SPLIT_REMOVED: "Distribución de inversión removida",
  PARTNER_ALLOCATION_CREATED: "Distribución a socio creada",
  PARTNER_ALLOCATION_EDITED: "Distribución a socio editada",
  PARTNER_ALLOCATION_REVERSED: "Distribución a socio revertida",
  PRINCIPAL_PAYMENT_APPLIED: "Abono a capital aplicado",
  PRINCIPAL_PAYMENT_EDITED: "Abono a capital editado",
  PRINCIPAL_PAYMENT_REVERSED: "Abono a capital revertido",
  CONTACT_NOTE_CREATED: "Nota de contacto creada",
  CONTACT_NOTE_EDITED: "Nota de contacto editada",
  CONTACT_NOTE_DELETED: "Nota de contacto eliminada",
  FOLLOWUP_CREATED: "Seguimiento creado",
  FOLLOWUP_EDITED: "Seguimiento editado",
  FOLLOWUP_DELETED: "Seguimiento eliminado",
  DEFAULT_SPLIT_ADDED: "Distribución predeterminada agregada",
  DEFAULT_SPLIT_EDITED: "Distribución predeterminada editada",
  DEFAULT_SPLIT_REMOVED: "Distribución predeterminada removida",
  SETTING_CREATED: "Configuración creada",
  SETTING_EDITED: "Configuración editada",
  SETTING_DELETED: "Configuración eliminada",
  PROFILE_CREATED: "Perfil creado",
  PROFILE_EDITED: "Perfil editado",
  PROFILE_DELETED: "Perfil eliminado",
};

const tableLabels = {
  borrowers: "Clientes",
  loans: "Desembolsos / Capital",
  payments: "Pagos",
  loan_funding: "Distribución de inversión",
  payment_allocations: "Distribuciones a socios",
  payment_principal_applications: "Abonos a capital",
  borrower_contact_log: "Notas de contacto",
  borrower_followups: "Seguimientos",
  default_funding_splits: "Distribuciones predeterminadas",
  app_settings: "Configuración",
  profiles: "Perfiles",
};

function prettyAction(action = "") { return actionLabels[action] || String(action).replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
function tableLabel(table = "") { return tableLabels[table] || table || "—"; }
function actionClass(action = "") {
  if (action.includes("VOID") || action.includes("DELETED") || action.includes("REVERSED")) return "activity-danger";
  if (action.includes("PAYMENT") || action.includes("PRINCIPAL")) return "activity-money";
  if (action.includes("FOLLOWUP") || action.includes("CONTACT")) return "activity-note";
  return "";
}
function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}
function ensureStyles() {
  if (qs("activityStyle")) return;
  const style = document.createElement("style");
  style.id = "activityStyle";
  style.textContent = `
    .activity-danger{color:#ff8b8b;}.activity-money{color:#9ff5b2;}.activity-note{color:#ffd27a;}
    .activity-chip{display:inline-block;padding:4px 9px;border:1px solid #333;border-radius:999px;font-size:12px;color:#cfcfe6;}
    .activity-row:hover{filter:brightness(1.06);}
  `;
  document.head.appendChild(style);
}
function activityPageHtml() {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Actividad / Historial</div>
      <div class="muted">Registro de desembolsos, pagos, anulaciones, capital, socios, seguimientos y cambios importantes.</div>
      <div class="row" style="margin-top:10px;">
        <select id="activityFilterAction"><option value="">Todas las acciones</option></select>
        <select id="activityFilterTable">
          <option value="">Todas las secciones</option>
          <option value="borrowers">Clientes</option>
          <option value="loans">Desembolsos / Capital</option>
          <option value="payments">Pagos</option>
          <option value="loan_funding">Distribución de inversión</option>
          <option value="payment_allocations">Distribuciones a socios</option>
          <option value="payment_principal_applications">Abonos a capital</option>
          <option value="borrower_contact_log">Notas de contacto</option>
          <option value="borrower_followups">Seguimientos</option>
          <option value="default_funding_splits">Distribuciones predeterminadas</option>
          <option value="app_settings">Configuración</option>
          <option value="profiles">Perfiles</option>
        </select>
      </div>
      <div class="row">
        <input id="activitySearch" placeholder="Buscar usuario, cliente, acción, resumen..." />
        <button id="btnRefreshActivity" type="button">Actualizar</button>
      </div>
    </div>
    <div class="card" data-no-translate="true">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-weight:800;">Actividad reciente</div>
        <span class="pill" id="activityCountPill">0</span>
      </div>
      <div id="activityList" class="muted">Cargando...</div>
    </div>
  `;
}
function ensureActivityPage() {
  const app = qs("app");
  if (!app) return null;
  let page = qs("activityPage");
  if (!page) { page = document.createElement("div"); page.id = "activityPage"; page.className = "page"; app.appendChild(page); }
  if (!qs("activityList") || !qs("activityFilterAction")) page.innerHTML = activityPageHtml();

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuActivity")) {
    const btn = document.createElement("button");
    btn.id = "menuActivity";
    btn.className = "menu-link";
    btn.dataset.page = "activityPage";
    btn.textContent = "Actividad / Historial";
    const reportsBtn = qs("menuReports");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    if (reportsBtn) sideMenu.insertBefore(btn, reportsBtn);
    else sideMenu.insertBefore(btn, defaultsBtn || null);
  }
  const menuBtn = qs("menuActivity");
  if (menuBtn && menuBtn.dataset.activityBound !== "true") {
    menuBtn.dataset.activityBound = "true";
    menuBtn.onclick = (event) => { event.preventDefault(); event.stopPropagation(); ensureActivityPage(); openPage("activityPage"); renderActivity(true); };
  }
  if (qs("btnRefreshActivity") && qs("btnRefreshActivity").dataset.bound !== "true") {
    qs("btnRefreshActivity").dataset.bound = "true";
    qs("btnRefreshActivity").onclick = () => renderActivity(true);
    qs("activitySearch").oninput = () => renderActivity(false, true);
    qs("activityFilterAction").onchange = () => renderActivity(true);
    qs("activityFilterTable").onchange = () => renderActivity(true);
  }
  return page;
}
async function populateActionFilter(rows) {
  const sel = qs("activityFilterAction");
  if (!sel) return;
  const current = sel.value || "";
  const actions = [...new Set(rows.map((r) => r.action_type).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todas las acciones</option>${actions.map((a) => `<option value="${a}">${prettyAction(a)}</option>`).join("")}`;
  sel.value = actions.includes(current) ? current : "";
}
function rowMatchesFilters(row) {
  const action = qs("activityFilterAction")?.value || "";
  const table = qs("activityFilterTable")?.value || "";
  const term = String(qs("activitySearch")?.value || "").trim().toLowerCase();
  if (action && row.action_type !== action) return false;
  if (table && row.entity_table !== table) return false;
  if (term) {
    const haystack = [row.actor_name, row.actor_role, row.action_type, prettyAction(row.action_type), tableLabel(row.entity_table), row.entity_text, row.borrower_name, row.summary, row.loan_id, row.payment_id].map((x) => String(x || "").toLowerCase()).join(" ");
    if (!haystack.includes(term)) return false;
  }
  return true;
}
function changedFields(oldData = {}, newData = {}) {
  if (!oldData || !newData) return [];
  const ignored = new Set(["updated_at", "created_at", "id", "loan_id", "borrower_id", "created_by"]);
  const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])].filter((k) => !ignored.has(k));
  return keys.filter((key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])).slice(0, 6).map((key) => ({ key, before: oldData[key], after: newData[key] }));
}
function renderChangeSummary(row) {
  const oldData = row.old_data || null;
  const newData = row.new_data || null;
  if (!oldData && newData) {
    const interesting = ["full_name", "paid_on", "amount", "payment_type", "principal_original", "principal_outstanding", "status", "funding_percent", "allocation_type", "role", "due_date", "priority", "contact_type"];
    return interesting.filter((k) => newData[k] !== undefined && newData[k] !== null).map((k) => `<div><strong>${k}:</strong> ${safeText(newData[k])}</div>`).join("");
  }
  if (oldData && !newData) return `<div><strong>Eliminado:</strong> ${safeText(row.summary)}</div>`;
  const changes = changedFields(oldData, newData);
  if (!changes.length) return "";
  return changes.map((c) => `<div><strong>${c.key}:</strong> <span class="muted">${safeText(c.before)}</span> → <span>${safeText(c.after)}</span></div>`).join("");
}
function renderRow(row) {
  const action = prettyAction(row.action_type);
  const cls = actionClass(row.action_type);
  const entity = row.borrower_name || row.entity_text || (row.payment_id ? `Pago ${String(row.payment_id).slice(0, 8)}` : "") || (row.loan_id ? `Desembolso ${String(row.loan_id).slice(0, 8)}` : "") || tableLabel(row.entity_table);
  const amountLine = row.payment_amount != null ? `<span class="muted">Pago: ${money(row.payment_amount)} ${row.payment_paid_on ? `el ${row.payment_paid_on}` : ""}</span><br>` : "";
  const changes = renderChangeSummary(row);
  return card(`<div class="activity-row"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;"><div><strong class="${cls}">${action}</strong><br><span class="muted">${fmtDate(row.created_at)} | ${row.actor_name || "Sistema"}${row.actor_role ? ` (${row.actor_role})` : ""}</span></div><span class="activity-chip">${tableLabel(row.entity_table)}</span></div><div style="margin-top:8px;"><strong>${entity}</strong><br><span class="muted">${row.summary || "—"}</span><br>${amountLine}${changes ? `<div style="margin-top:8px;">${changes}</div>` : ""}</div></div>`);
}
async function renderActivity(force = false, localOnly = false) {
  ensureActivityPage();
  if (!isActivityPage() || activityBusy || !qs("activityList")) return;
  if (localOnly) {
    const term = String(qs("activitySearch")?.value || "").trim().toLowerCase();
    document.querySelectorAll("#activityList .compact-card").forEach((el) => { el.style.display = !term || el.textContent.toLowerCase().includes(term) ? "" : "none"; });
    return;
  }
  const stamp = `${qs("activityFilterAction")?.value || ""}:${qs("activityFilterTable")?.value || ""}`;
  if (!force && qs("activityList").dataset.stamp === stamp && lastActivityHtml) return;
  activityBusy = true;
  try {
    const { data, error } = await supabase.from("activity_log_view").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    await populateActionFilter(data || []);
    const rows = (data || []).filter(rowMatchesFilters);
    const html = rows.length ? rows.map(renderRow).join("") : "No hay actividad para esta vista.";
    qs("activityList").dataset.stamp = stamp;
    qs("activityCountPill").textContent = String(rows.length);
    if (force || html !== lastActivityHtml) { qs("activityList").innerHTML = html; lastActivityHtml = html; }
  } catch (error) { console.error(error); qs("activityList").innerHTML = error.message || String(error); } finally { activityBusy = false; }
}
async function tick() { ensureStyles(); ensureActivityPage(); if (isActivityPage()) await renderActivity(); }
const observer = new MutationObserver(() => { clearTimeout(activityTimer); activityTimer = setTimeout(tick, 200); });
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2500);
tick();
