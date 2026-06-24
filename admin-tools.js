import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://eatxkhhpjruwwibhcubf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
let currentProfile = null;
let adminRefreshTimer = null;
let profilesRefreshInFlight = false;

function activePage(id) { return qs(id)?.classList.contains("active-page"); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso, days) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function money(n) { return Number(n || 0).toFixed(2); }
function card(html) { return `<div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:10px;margin:8px 0;box-sizing:border-box;max-width:100%;">${html}</div>`; }

function ensureStyles() {
  if (qs("adminToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "adminToolsStyle";
  style.textContent = `
    .admin-tools-button{cursor:pointer;transition:filter .15s ease,transform .05s ease;}
    .admin-tools-button:hover{filter:brightness(1.18);}.admin-tools-button:active{transform:scale(.98);}
    .admin-danger{background:#7a2b2b!important}.admin-muted-btn{background:#333!important}
    .admin-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.admin-profile-card input,.admin-profile-card select{box-sizing:border-box;max-width:100%;}
    @media(max-width:650px){.admin-mini-grid{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);
}

async function getMyProfile(force = false) {
  if (currentProfile && !force) return currentProfile;
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  currentProfile = data;
  return data;
}

function ensurePage(id, title) {
  if (qs(id)) return qs(id);
  const app = qs("app");
  if (!app) return null;
  const page = document.createElement("div");
  page.id = id;
  page.className = "page";
  page.innerHTML = `<div class="card"><div style="font-weight:800;">${title}</div><div id="${id}Content" class="muted">Loading...</div></div>`;
  app.appendChild(page);
  return page;
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function insertMenuButton({ id, page, label, beforeDefaults = true, onOpen }) {
  const sideMenu = qs("sideMenu");
  if (!sideMenu || qs(id)) return;
  const btn = document.createElement("button");
  btn.id = id;
  btn.className = "menu-link admin-tools-button";
  btn.dataset.page = page;
  btn.textContent = label;
  btn.onclick = async (event) => { event.preventDefault(); event.stopPropagation(); openPage(page); await onOpen?.(); };
  const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
  if (beforeDefaults && defaultsBtn) sideMenu.insertBefore(btn, defaultsBtn);
  else sideMenu.appendChild(btn);
}

function ensureAdminMenuItems() {
  ensurePage("profilesPage", "Profiles / Users");
  ensurePage("reportsPage", "Reports / Export");
  ensurePage("maintenancePage", "Maintenance");
  insertMenuButton({ id: "menuProfiles", page: "profilesPage", label: "Profiles / Users", onOpen: () => refreshProfilesPage({ force: true }) });
  insertMenuButton({ id: "menuReports", page: "reportsPage", label: "Reports / Export", onOpen: () => refreshReportsPage({ force: true }) });
  insertMenuButton({ id: "menuMaintenance", page: "maintenancePage", label: "Maintenance", beforeDefaults: false, onOpen: () => refreshMaintenancePage({ force: true }) });
}

async function refreshProfilesPage({ force = false } = {}) {
  const content = qs("profilesPageContent");
  if (!content || profilesRefreshInFlight) return;
  if (!force && content.dataset.loaded === "true") return;
  const active = document.activeElement;
  if (!force && active && active.closest?.("#profilesPage")) return;
  profilesRefreshInFlight = true;
  try {
    const profile = await getMyProfile();
    const { data, error } = await supabase.from("profiles").select("user_id, full_name, role, created_at").order("created_at", { ascending: true });
    if (error) throw error;
    content.dataset.loaded = "true";
    content.innerHTML = `${profile?.role !== "ADMIN" ? `<div style="color:#ffd27a;">Only Admin can edit profile roles.</div>` : ""}${(data ?? []).map((p) => card(`<div class="admin-profile-card" data-profile-card="${p.user_id}"><div style="font-weight:800;">${p.full_name || "Unnamed"}</div><div class="muted">${p.user_id}</div><div class="admin-mini-grid" style="margin-top:8px;"><input data-profile-name="${p.user_id}" value="${p.full_name || ""}" placeholder="Display name" ${profile?.role === "ADMIN" ? "" : "disabled"} /><select data-profile-role="${p.user_id}" ${profile?.role === "ADMIN" ? "" : "disabled"}>${["ADMIN", "AGENT", "PARTNER"].map((role) => `<option value="${role}" ${p.role === role ? "selected" : ""}>${role}</option>`).join("")}</select></div>${profile?.role === "ADMIN" ? `<button class="admin-tools-button" data-save-profile="${p.user_id}" type="button">Save Profile</button>` : ""}</div>`)).join("") || "No profiles found."}`;
    document.querySelectorAll("[data-save-profile]").forEach((btn) => {
      btn.onclick = async () => {
        const userId = btn.dataset.saveProfile;
        const fullName = document.querySelector(`[data-profile-name="${userId}"]`)?.value || "";
        const role = document.querySelector(`[data-profile-role="${userId}"]`)?.value || "PARTNER";
        const { error } = await supabase.rpc("update_profile_admin", { p_user_id: userId, p_full_name: fullName, p_role: role });
        if (error) return alert(error.message);
        currentProfile = null;
        content.dataset.loaded = "";
        await refreshProfilesPage({ force: true });
        alert("Profile updated.");
      };
    });
  } finally { profilesRefreshInFlight = false; }
}

function toCsv(rows) {
  if (!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => esc(row[h])).join(","))].join("\n");
}
function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  if (!csv) return alert("No data to export.");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function exportTableOrView(viewName, filename, transform = null) {
  const { data, error } = await supabase.from(viewName).select("*");
  if (error) return alert(error.message);
  downloadCsv(filename, transform ? transform(data ?? []) : (data ?? []));
}
function stamp(name) { return `loan-ledger-${name}-${todayIso()}.csv`; }

function formatAccountRows(rows) {
  return rows.map((r) => ({
    cliente: r.full_name,
    telefono: r.phone,
    capital_activo: money(r.principal_balance),
    total_desembolsado: money(r.total_disbursed),
    cuota_mensual: money(r.current_monthly_fee),
    cuota_por_ciclo: money(r.current_cycle_fee),
    administracion_mensual: money(r.current_monthly_mgmt),
    socios_mensual: money(r.current_monthly_funders),
    proxima_cuota: r.next_due_date,
    monto_atrasado_guardado: money(r.overdue_amount),
    cuotas_atrasadas_guardadas: r.overdue_count,
    dias_tarde_guardado: r.max_days_late,
    estado: r.account_status,
  }));
}
function formatPaymentRows(rows) {
  return rows.map((p) => ({
    cliente: p.borrower_name,
    fecha_pago: p.paid_on,
    monto: money(p.amount),
    tipo_pago: p.payment_type,
    cuota_interes: money(p.applied_interest),
    capital: money(p.applied_principal),
    administracion: money(p.applied_mgmt),
    socios: money(p.applied_funders),
    anulado: p.is_voided ? "SI" : "NO",
    motivo_anulacion: p.void_reason,
    notas: p.notes,
    creado: p.created_at,
  }));
}
function formatPartnerRows(rows) {
  return rows.map((p) => ({
    socio: p.full_name,
    rol: p.role,
    capital_activo: money(p.active_capital),
    capital_original: money(p.original_capital),
    clientes_activos: p.active_borrowers,
    desembolsos: p.funded_disbursements,
    ganancia_total: money(p.total_earned),
    ganancia_administracion: money(p.management_earned),
    ganancia_socio: money(p.funding_earned),
    distribuciones: p.allocation_count,
    distribuciones_anuladas: p.voided_allocation_count,
    monto_anulado: money(p.voided_earned),
  }));
}
function formatDisbursementRows(rows) {
  return rows.map((l) => ({
    socio: l.partner_name,
    cliente: l.borrower_name,
    telefono_cliente: l.borrower_phone,
    fecha_inicio: l.start_date,
    estado: l.status,
    porcentaje_socio: `${(Number(l.funding_percent || 0) * 100).toFixed(2)}%`,
    capital_original_prestamo: money(l.principal_original),
    capital_activo_prestamo: money(l.principal_outstanding),
    capital_original_socio: money(l.partner_original_capital),
    capital_activo_socio: money(l.partner_active_capital),
  }));
}
function formatAllocationRows(rows) {
  return rows.map((a) => ({
    socio: a.partner_name,
    tipo_distribucion: a.allocation_type,
    monto: money(a.amount),
    cliente: a.borrower_name,
    fecha_pago: a.paid_on,
    monto_pago: money(a.payment_amount),
    tipo_pago: a.payment_type,
    anulado: a.is_voided ? "SI" : "NO",
    motivo_anulacion: a.void_reason,
    creado: a.created_at,
  }));
}
async function exportVirtualDueReport() {
  const start = qs("reportStartDate")?.value || addDaysIso(todayIso(), -90);
  const end = qs("reportEndDate")?.value || addDaysIso(todayIso(), 90);
  const { data: accounts, error } = await supabase.from("borrower_account_summary").select("borrower_id, full_name, phone, principal_balance").gt("principal_balance", 0).order("full_name", { ascending: true });
  if (error) return alert(error.message);
  const chunks = await Promise.all((accounts ?? []).map(async (a) => {
    const { data, error: rpcErr } = await supabase.rpc("get_borrower_due_calendar", { p_borrower_id: a.borrower_id, p_start_date: start, p_end_date: end });
    if (rpcErr) throw rpcErr;
    return (data ?? []).map((d) => ({ ...d, phone: a.phone }));
  }));
  const rows = chunks.flat().filter((d) => Number(d.amount_due || 0) > 0 || ["PAID", "PARTIAL"].includes(d.status));
  downloadCsv(stamp("cuotas-virtuales"), rows.map((d) => ({
    cliente: d.borrower_name,
    telefono: d.phone,
    fecha_cuota: d.due_date,
    estado: d.status,
    estado_tiempo: d.timing_status,
    capital_base: money(d.principal_snapshot),
    cuota_esperada: money(d.expected_total),
    pagado: money(d.paid_total),
    pendiente: money(d.amount_due),
    administracion_esperada: money(d.expected_mgmt),
    socios_esperado: money(d.expected_funders),
    virtual: d.is_virtual ? "SI" : "NO",
  })));
}

async function refreshReportsPage({ force = false } = {}) {
  const content = qs("reportsPageContent");
  if (!content) return;
  if (!force && content.dataset.loaded === "true") return;
  content.dataset.loaded = "true";
  content.innerHTML = `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Reportes / Exportar CSV</div>
      <div class="muted">Reportes actualizados para el modelo de cuenta por cliente y calendario virtual.</div>
      <div class="admin-mini-grid" style="margin-top:10px;">
        <input id="reportStartDate" type="date" value="${addDaysIso(todayIso(), -90)}" />
        <input id="reportEndDate" type="date" value="${addDaysIso(todayIso(), 90)}" />
      </div>
      <div class="muted">El rango aplica al reporte de cuotas virtuales.</div>
    </div>
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Cuentas y pagos</div>
      <button id="btnExportAccounts" class="admin-tools-button" type="button">Exportar cuentas de clientes</button>
      <button id="btnExportPayments" class="admin-tools-button" type="button">Exportar pagos</button>
      <button id="btnExportVirtualDue" class="admin-tools-button" type="button">Exportar cuotas virtuales / atrasos</button>
    </div>
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Socios</div>
      <button id="btnExportPartners" class="admin-tools-button" type="button">Exportar resumen de socios</button>
      <button id="btnExportDisbursements" class="admin-tools-button" type="button">Exportar desembolsos por socio</button>
      <button id="btnExportAllocations" class="admin-tools-button" type="button">Exportar distribuciones a socios</button>
    </div>
  `;
  qs("btnExportAccounts").onclick = () => exportTableOrView("borrower_account_summary", stamp("cuentas-clientes"), formatAccountRows);
  qs("btnExportPayments").onclick = () => exportTableOrView("borrower_account_payments_view", stamp("pagos"), formatPaymentRows);
  qs("btnExportVirtualDue").onclick = exportVirtualDueReport;
  qs("btnExportPartners").onclick = () => exportTableOrView("partner_earnings_summary", stamp("socios-resumen"), formatPartnerRows);
  qs("btnExportDisbursements").onclick = () => exportTableOrView("partner_funded_loans", stamp("socios-desembolsos"), formatDisbursementRows);
  qs("btnExportAllocations").onclick = () => exportTableOrView("partner_allocation_details", stamp("socios-distribuciones"), formatAllocationRows);
}

async function refreshMaintenancePage({ force = false } = {}) {
  const content = qs("maintenancePageContent");
  if (!content) return;
  if (!force && content.dataset.loaded === "true") return;
  const profile = await getMyProfile();
  content.dataset.loaded = "true";
  content.innerHTML = `<div class="card"><div style="font-weight:800;">Maintenance</div><div class="muted">Admin-only maintenance tools.</div></div><div class="card"><div style="font-weight:800;">Reset Test Data</div><div class="muted">This clears borrowers, loans, due events, payments, payment allocations, and funding splits. It keeps profiles and defaults/settings.</div>${profile?.role === "ADMIN" ? `<button id="btnResetTestData" class="admin-tools-button admin-danger" type="button">Reset Test Data</button>` : `<div style="color:#ffd27a;">Only Admin can reset test data.</div>`}</div>`;
  const btn = qs("btnResetTestData");
  if (btn) {
    btn.onclick = async () => {
      const first = prompt("Type RESET to delete all test transaction data.");
      if (first !== "RESET") return alert("Reset cancelled.");
      if (!confirm("Final confirmation: delete all borrowers, loans, payments, due events, allocations, and funding splits?")) return;
      const { error } = await supabase.rpc("reset_test_data");
      if (error) return alert(error.message);
      alert("Test data reset. Hard refresh the app.");
    };
  }
}

async function refreshVisibleAdminTools() {
  try {
    ensureStyles();
    ensureAdminMenuItems();
    if (activePage("profilesPage") && qs("profilesPageContent")?.dataset.loaded !== "true") await refreshProfilesPage();
    if (activePage("reportsPage") && qs("reportsPageContent")?.dataset.loaded !== "true") await refreshReportsPage();
    if (activePage("maintenancePage") && qs("maintenancePageContent")?.dataset.loaded !== "true") await refreshMaintenancePage();
  } catch (error) { console.error(error); }
}

const observer = new MutationObserver(() => { clearTimeout(adminRefreshTimer); adminRefreshTimer = setTimeout(refreshVisibleAdminTools, 200); });
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(refreshVisibleAdminTools, 3000);
refreshVisibleAdminTools();
