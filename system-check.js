import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
let timer = null;
let busy = false;
let lastHtml = "";

function isPage(id) { return qs(id)?.classList.contains("active-page"); }
function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}
function statusColor(status) { if (status === "PASS") return "#9ff5b2"; if (status === "WARN") return "#ffd27a"; return "#ff8b8b"; }
function card(html, attrs = "") { return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`; }
function statusEs(status) { return { PASS: "BIEN", WARN: "REVISAR", FAIL: "FALLA" }[status] || status; }
function severityEs(sev) { return { HIGH: "ALTA", MEDIUM: "MEDIA", LOW: "BAJA" }[sev] || sev; }
function ensureSystemCheckPage() {
  const app = qs("app");
  if (!app) return null;
  let page = qs("systemCheckPage");
  if (!page) {
    page = document.createElement("div");
    page.id = "systemCheckPage";
    page.className = "page";
    page.innerHTML = `
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Revisión del sistema</div>
        <div class="muted">Lista de preparación antes de usar datos reales.</div>
        <button id="btnRefreshSystemCheck" type="button">Actualizar revisión</button>
      </div>
      <div class="card" data-no-translate="true">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:800;">Resultados</div>
          <span class="pill" id="systemCheckCount">0</span>
        </div>
        <div id="systemCheckList" class="muted">Cargando...</div>
      </div>
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Permisos por rol</div>
        <div id="rolePermissionList" class="muted">Cargando...</div>
      </div>
      <div class="card" data-no-translate="true">
        <div style="font-weight:800;">Checklist manual</div>
        <div class="muted">Pruebas rápidas para confirmar que el flujo completo funciona.</div>
        <div id="manualChecklist" class="muted"></div>
      </div>
    `;
    app.appendChild(page);
  }
  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuSystemCheck")) {
    const btn = document.createElement("button");
    btn.id = "menuSystemCheck";
    btn.className = "menu-link";
    btn.dataset.page = "systemCheckPage";
    btn.textContent = "Revisión del sistema";
    const activityBtn = qs("menuActivity");
    const reportsBtn = qs("menuReports");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, activityBtn || reportsBtn || defaultsBtn || null);
  }
  const menuBtn = qs("menuSystemCheck");
  if (menuBtn && menuBtn.dataset.bound !== "true") {
    menuBtn.dataset.bound = "true";
    menuBtn.onclick = (event) => { event.preventDefault(); event.stopPropagation(); ensureSystemCheckPage(); openPage("systemCheckPage"); renderSystemCheck(true); };
  }
  const refreshBtn = qs("btnRefreshSystemCheck");
  if (refreshBtn && refreshBtn.dataset.bound !== "true") { refreshBtn.dataset.bound = "true"; refreshBtn.onclick = () => renderSystemCheck(true); }
  return page;
}
function renderCheck(row) {
  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div><strong>${row.summary}</strong><br><span class="muted">${row.details || "—"}</span></div>
      <span class="pill" style="color:${statusColor(row.status)};">${statusEs(row.status)}</span>
    </div>
    <div class="muted" style="margin-top:6px;">${row.check_code} | ${severityEs(row.severity)}</div>
  `);
}
function renderPermissions(rows) {
  const labels = { ADMIN: "Administrador", AGENT: "Agente", PARTNER: "Socio" };
  const grouped = rows.reduce((acc, row) => { acc[row.role] ||= []; acc[row.role].push(row); return acc; }, {});
  return ["ADMIN", "AGENT", "PARTNER"].map((role) => {
    const list = grouped[role] || [];
    return card(`<strong>${labels[role] || role}</strong>${list.map((row) => `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px;"><span>${row.capability}</span><span class="pill" style="color:${row.allowed ? "#9ff5b2" : "#ff8b8b"};">${row.allowed ? "SI" : "NO"}</span></div>`).join("")}`);
  }).join("");
}
function manualChecklistHtml() {
  const items = [
    "Abrir Inicio/Home y confirmar que capital activo, atrasado y próximas cuotas cargan.",
    "Crear un cliente nuevo desde Nuevo desembolso.",
    "Crear un desembolso con tasas y distribución de inversión al 100%.",
    "Entrar a Cuenta del cliente y confirmar que el calendario virtual muestra 15 y último día del mes.",
    "Mover el calendario con las flechas hacia fechas futuras y pasadas.",
    "Registrar un pago de cuota/interés y confirmar que no rebaja capital.",
    "Registrar un abono a capital y confirmar que el balance baja.",
    "Anular un pago como Admin y confirmar que cuota/capital/distribuciones se revierten.",
    "Abrir Socios y confirmar capital activo, ganancias y distribuciones.",
    "Abrir Revisión de sistema y confirmar que no hay alertas HIGH antes de usar datos reales.",
    "Agregar un seguimiento y marcarlo completado.",
    "Agregar una nota de contacto.",
    "Abrir Actividad / Historial y confirmar que registra pagos, anulaciones, desembolsos y notas.",
    "Exportar CSV de cuentas, pagos, cuotas virtuales y socios.",
    "Entrar como Agent y confirmar que acciones Admin-only están ocultas o bloqueadas.",
    "Entrar como Partner y confirmar que solo ve lo que corresponde.",
  ];
  return items.map((item, index) => `<label style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;"><input type="checkbox" data-manual-check="${index}" style="width:auto;margin:2px 0 0 0;" /><span>${item}</span></label>`).join("");
}
async function renderSystemCheck(force = false) {
  ensureSystemCheckPage();
  if (!isPage("systemCheckPage") || busy || !qs("systemCheckList")) return;
  busy = true;
  try {
    const [checksRes, permissionsRes] = await Promise.all([
      supabase.from("system_check_results").select("*").order("sort_order", { ascending: true }),
      supabase.from("role_permission_matrix").select("*").order("role", { ascending: true }).order("capability", { ascending: true }),
    ]);
    if (checksRes.error) throw checksRes.error;
    if (permissionsRes.error) throw permissionsRes.error;
    const checks = checksRes.data || [];
    const permissions = permissionsRes.data || [];
    const problemCount = checks.filter((c) => c.status !== "PASS").length;
    const html = `${checks.map(renderCheck).join("")}---PERMS---${renderPermissions(permissions)}`;
    qs("systemCheckCount").textContent = problemCount ? `${problemCount} revisar` : "Todo bien";
    if (force || html !== lastHtml) {
      qs("systemCheckList").innerHTML = checks.length ? checks.map(renderCheck).join("") : "No hay revisiones del sistema.";
      qs("rolePermissionList").innerHTML = permissions.length ? renderPermissions(permissions) : "No hay matriz de permisos.";
      qs("manualChecklist").innerHTML = manualChecklistHtml();
      lastHtml = html;
    }
  } catch (error) { console.error(error); qs("systemCheckList").innerHTML = error.message || String(error); } finally { busy = false; }
}
function tick() { ensureSystemCheckPage(); if (isPage("systemCheckPage")) renderSystemCheck(false); }
const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tick, 200); });
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 3000);
tick();
