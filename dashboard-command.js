import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => new Date().toISOString().slice(0, 7);
let timer = null;
let busy = false;
let lastHtml = "";
let bound = false;

function isDashboardPage() { return qs("dashboardPage")?.classList.contains("active-page"); }
function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  document.querySelector(`.tab-btn[data-page="${id}"]`)?.classList.add("active");
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}
function card(html) { return `<div style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:8px 0;box-sizing:border-box;">${html}</div>`; }
function pill(text, cls = "") { return `<span class="pill ${cls}" style="margin-left:6px;">${text}</span>`; }
function ensureStyles() {
  if (qs("dashboardCommandStyle")) return;
  const style = document.createElement("style");
  style.id = "dashboardCommandStyle";
  style.textContent = `
    .command-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px;}
    .command-card{background:#0f0f11;border:1px solid #2a2a2e;border-radius:14px;padding:14px;box-sizing:border-box;}
    .command-label{color:#b8b8c2;font-size:13px;margin-bottom:6px;}.command-value{font-size:22px;font-weight:800;}
    .command-btn{cursor:pointer;transition:filter .15s ease, transform .05s ease;}.command-btn:hover{filter:brightness(1.18);}.command-btn:active{transform:scale(.98);}
    .command-high{color:#ff8b8b;font-weight:800;}.command-med{color:#ffd27a;font-weight:800;}.command-ok{color:#9ff5b2;font-weight:800;}
    @media(max-width:650px){.command-grid{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);
}
function ensureDom() {
  ensureStyles();
  const page = qs("dashboardPage");
  if (!page) return null;
  let box = qs("dashboardCommandCenter");
  if (!box) {
    box = document.createElement("div");
    box.id = "dashboardCommandCenter";
    page.innerHTML = "";
    page.appendChild(box);
  }
  return box;
}
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
async function getVirtualDueRows(activeAccounts) {
  const today = todayIso();
  const start = addDaysIso(today, -90);
  const end = addDaysIso(today, 90);
  const chunks = await Promise.all(activeAccounts.map(async (a) => {
    const { data, error } = await supabase.rpc("get_borrower_due_calendar", { p_borrower_id: a.borrower_id, p_start_date: start, p_end_date: end });
    if (error) {
      console.error("Virtual due error", a.full_name, error);
      return [];
    }
    return (data || []).map((d) => ({ ...d, full_name: a.full_name, phone: a.phone, principal_balance: a.principal_balance }));
  }));
  return chunks.flat().map((d) => ({ ...d, amount_due: Number(d.amount_due || 0) })).filter((d) => d.amount_due > 0 && d.status !== "CANCELLED");
}
async function fetchDashboardData() {
  const today = todayIso();
  const month = monthPrefix();
  const [accountsRes, paymentsRes, followupsRes, healthRes, activityRes, contactsRes, partnersRes] = await Promise.all([
    supabase.from("borrower_account_summary").select("*").order("principal_balance", { ascending: false }).limit(200),
    supabase.from("borrower_account_payments_view").select("*").order("created_at", { ascending: false }).limit(80),
    supabase.from("borrower_followups_view").select("*").order("due_date", { ascending: true }).limit(80),
    supabase.from("borrower_account_health_issues").select("*").limit(80),
    supabase.from("activity_log_view").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("borrower_contact_log_view").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("partner_earnings_summary").select("*").limit(50),
  ]);
  const errors = [accountsRes, paymentsRes, followupsRes, healthRes, activityRes, contactsRes, partnersRes].filter((r) => r.error);
  if (errors.length) throw errors[0].error;

  const accounts = accountsRes.data || [];
  const activeAccounts = accounts.filter((a) => Number(a.principal_balance || 0) > 0);
  const dueRows = await getVirtualDueRows(activeAccounts);
  const overdueDue = dueRows.filter((d) => d.timing_status === "OVERDUE" || d.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const dueToday = dueRows.filter((d) => d.timing_status === "DUE_TODAY" || d.due_date === today).sort((a, b) => a.borrower_name?.localeCompare(b.borrower_name || "") || 0);
  const upcomingDue = dueRows.filter((d) => d.due_date > today && d.timing_status !== "OVERDUE").sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);

  const overdueMap = new Map();
  overdueDue.forEach((d) => {
    const key = d.borrower_id;
    if (!overdueMap.has(key)) overdueMap.set(key, { borrower_id: key, full_name: d.borrower_name || d.full_name, phone: d.phone, principal_balance: d.principal_balance, overdue_amount: 0, overdue_count: 0, oldest_due: d.due_date });
    const row = overdueMap.get(key);
    row.overdue_amount += Number(d.amount_due || 0);
    row.overdue_count += 1;
    if (d.due_date < row.oldest_due) row.oldest_due = d.due_date;
  });
  const overdueAccounts = Array.from(overdueMap.values()).map((a) => ({ ...a, max_days_late: Math.max(0, Math.floor((new Date(`${today}T00:00:00`) - new Date(`${a.oldest_due}T00:00:00`)) / 86400000)) })).sort((a, b) => b.overdue_amount - a.overdue_amount);

  const dueTodayMap = new Map();
  dueToday.forEach((d) => {
    const key = d.borrower_id;
    if (!dueTodayMap.has(key)) dueTodayMap.set(key, { borrower_id: key, full_name: d.borrower_name || d.full_name, principal_balance: d.principal_balance, due_today_amount: 0 });
    dueTodayMap.get(key).due_today_amount += Number(d.amount_due || 0);
  });
  const dueTodayAccounts = Array.from(dueTodayMap.values()).sort((a, b) => b.due_today_amount - a.due_today_amount);

  const payments = paymentsRes.data || [];
  const activePayments = payments.filter((p) => !p.is_voided);
  const paymentsThisMonth = activePayments.filter((p) => String(p.paid_on || "").slice(0, 7) === month);
  const paymentsThisMonthTotal = paymentsThisMonth.reduce((s, p) => s + Number(p.amount || 0), 0);
  const feesThisMonth = paymentsThisMonth.reduce((s, p) => s + Number(p.applied_interest || 0), 0);
  const principalThisMonth = paymentsThisMonth.reduce((s, p) => s + Number(p.applied_principal || 0), 0);

  const partners = partnersRes.data || [];
  const activeCapital = activeAccounts.reduce((s, a) => s + Number(a.principal_balance || 0), 0);
  const totalOverdue = overdueDue.reduce((s, d) => s + Number(d.amount_due || 0), 0);
  const dueTodayAmount = dueToday.reduce((s, d) => s + Number(d.amount_due || 0), 0);
  const monthlyFee = activeAccounts.reduce((s, a) => s + Number(a.current_monthly_fee || 0), 0);
  const monthlyMgmt = activeAccounts.reduce((s, a) => s + Number(a.current_monthly_mgmt || 0), 0);
  const monthlyFunders = activeAccounts.reduce((s, a) => s + Number(a.current_monthly_funders || 0), 0);
  const partnerActiveCapital = partners.reduce((s, p) => s + Number(p.active_capital || 0), 0);

  const followups = followupsRes.data || [];
  const openFollowups = followups.filter((f) => f.status === "OPEN");
  const todayFollowups = openFollowups.filter((f) => f.timing_status === "DUE_TODAY");
  const health = healthRes.data || [];
  const highHealth = health.filter((h) => h.severity === "HIGH");
  const medHealth = health.filter((h) => h.severity === "MEDIUM");

  return { today, accounts, activeAccounts, overdueAccounts, dueTodayAccounts, activeCapital, totalOverdue, dueTodayAmount, monthlyFee, monthlyMgmt, monthlyFunders, dueRows, overdueDue, dueToday, upcomingDue, payments, activePayments, paymentsThisMonth, paymentsThisMonthTotal, feesThisMonth, principalThisMonth, partnerActiveCapital, followups, openFollowups, todayFollowups, health, highHealth, medHealth, activity: activityRes.data || [], contacts: contactsRes.data || [] };
}
function statsGrid(items) { return `<div class="command-grid">${items.map((i) => `<div class="command-card"><div class="command-label">${i.label}</div><div class="command-value ${i.cls || ""}">${i.value}</div></div>`).join("")}</div>`; }
function renderTop(data) {
  return `<div class="card" data-no-translate="true"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><div style="font-weight:800;">Inicio / Resumen</div><div class="muted">Vista rápida de cuentas, cuotas virtuales y pagos.</div></div><button id="btnRefreshCommandCenter" class="command-btn" type="button" style="width:auto;background:#333;padding:10px 14px;">Actualizar</button></div>${statsGrid([{ label: "Capital activo", value: money(data.activeCapital) }, { label: "Atrasado", value: money(data.totalOverdue), cls: data.totalOverdue > 0 ? "command-high" : "command-ok" }, { label: "Vence hoy", value: money(data.dueTodayAmount), cls: data.dueTodayAmount > 0 ? "command-med" : "" }, { label: "Pagos del mes", value: money(data.paymentsThisMonthTotal) }, { label: "Cuotas cobradas", value: money(data.feesThisMonth) }, { label: "Abono a capital", value: money(data.principalThisMonth) }])}</div>`;
}
function renderProjection(data) {
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Proyección actual</div><div class="muted">Basado en balances activos. Las próximas cuotas se calculan virtualmente.</div>${statsGrid([{ label: "Cuota mensual total", value: money(data.monthlyFee) }, { label: "Administración mensual", value: money(data.monthlyMgmt) }, { label: "Socios mensual", value: money(data.monthlyFunders) }, { label: "Capital socios activo", value: money(data.partnerActiveCapital) }])}</div>`;
}
function renderQuickActions() {
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Acciones rápidas</div><div class="row"><button id="quickNewLoan" class="command-btn" type="button">Nuevo desembolso</button><button id="quickRecordPayment" class="command-btn" type="button">Registrar pago</button></div><div class="row"><button id="quickFollowup" class="command-btn" type="button">Seguimiento</button><button id="quickLogContact" class="command-btn" type="button">Nota de contacto</button></div><div id="quickActionStatus" class="muted" style="margin-top:8px;">Las cuotas futuras se calculan automáticamente.</div></div>`;
}
function renderActionQueue(data) {
  const items = [];
  data.overdueAccounts.slice(0, 6).forEach((a) => items.push({ p: 1, html: card(`<strong>${a.full_name}</strong> ${pill("ATRASADO", "command-high")}<br><span class="muted">Atrasado: ${money(a.overdue_amount)} | ${a.overdue_count} cuotas | ${a.max_days_late} días tarde</span>`) }));
  data.dueTodayAccounts.slice(0, 4).forEach((a) => items.push({ p: 2, html: card(`<strong>${a.full_name}</strong> ${pill("VENCE HOY", "command-med")}<br><span class="muted">Monto: ${money(a.due_today_amount)} | Balance: ${money(a.principal_balance)}</span>`) }));
  data.todayFollowups.slice(0, 4).forEach((f) => items.push({ p: 3, html: card(`<strong>${f.borrower_name}</strong> ${pill("SEGUIMIENTO", "command-med")}<br><span class="muted">${f.reason || "—"} | ${f.borrower_phone || "Sin teléfono"}</span>`) }));
  data.highHealth.slice(0, 4).forEach((h) => items.push({ p: 4, html: card(`<strong>${h.borrower_name || h.full_name || "Cuenta"}</strong> ${pill("REVISAR", "command-high")}<br><span class="muted">${h.summary || h.issue_type || "Alerta"} | ${h.details || ""}</span>`) }));
  const sorted = items.sort((a, b) => a.p - b.p).slice(0, 12);
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Prioridad de hoy</div><div class="muted">Lo más importante para revisar primero.</div>${sorted.length ? sorted.map((x) => x.html).join("") : `<div class="command-ok" style="margin-top:10px;">No hay acciones urgentes ahora.</div>`}</div>`;
}
function renderDue(data) {
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Cuotas virtuales</div><div style="font-weight:800;margin-top:10px;">Vencen hoy</div>${data.dueToday.length ? data.dueToday.slice(0, 8).map((d) => card(`<strong>${d.borrower_name}</strong> — ${money(d.amount_due)}<br><span class="muted">Fecha: ${d.due_date} | ${d.status} | ${d.is_virtual ? "virtual" : "registrada"}</span>`)).join("") : `<div class="muted">No hay cuotas venciendo hoy.</div>`}<div style="font-weight:800;margin-top:14px;">Próximas cuotas</div>${data.upcomingDue.length ? data.upcomingDue.map((d) => card(`<strong>${d.borrower_name}</strong> — ${money(d.amount_due)}<br><span class="muted">Fecha: ${d.due_date} | Capital base: ${money(d.principal_snapshot)} | ${d.is_virtual ? "virtual" : "registrada"}</span>`)).join("") : `<div class="muted">No hay próximas cuotas.</div>`}</div>`;
}
function renderAccounts(data) {
  const rows = [...data.overdueAccounts.map((a) => ({ ...a, account_status: "ATRASADO" })), ...data.activeAccounts.filter((a) => !data.overdueAccounts.some((o) => o.borrower_id === a.borrower_id)).map((a) => ({ ...a, account_status: "AL DIA" }))].slice(0, 8);
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Cuentas de clientes</div>${rows.length ? rows.map((a) => card(`<strong>${a.full_name}</strong> ${pill(a.account_status, a.account_status === "ATRASADO" ? "command-high" : "command-ok")}<br><span class="muted">Balance: ${money(a.principal_balance)} | Cuota mensual: ${money(a.current_monthly_fee || 0)}${a.overdue_amount ? ` | Atrasado: ${money(a.overdue_amount)}` : ""}</span>`)).join("") : "No hay cuentas activas."}</div>`;
}
function renderRecent(data) {
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Pagos recientes</div>${data.activePayments.length ? data.activePayments.slice(0, 6).map((p) => card(`<strong>${p.borrower_name || "Cliente"}</strong> — ${money(p.amount)}<br><span class="muted">${p.paid_on} | Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)}</span>`)).join("") : "No hay pagos todavía."}</div><div class="card" data-no-translate="true"><div style="font-weight:800;">Actividad reciente</div>${data.activity.length ? data.activity.slice(0, 5).map((a) => card(`<strong>${String(a.action_type || "").replaceAll("_", " ")}</strong><br><span class="muted">${new Date(a.created_at).toLocaleString()} | ${a.actor_name || "Sistema"} | ${a.summary || "—"}</span>`)).join("") : "No hay actividad."}</div><div class="card" data-no-translate="true"><div style="font-weight:800;">Notas de contacto recientes</div>${data.contacts.length ? data.contacts.slice(0, 5).map((c) => card(`<strong>${c.borrower_name}</strong> — ${c.contact_type}<br><span class="muted">${c.contact_date} | ${c.outcome || "—"}</span><br><span>${c.notes || ""}</span>`)).join("") : "No hay notas de contacto."}</div>`;
}
async function renderDashboard(force = false) {
  const box = ensureDom();
  if (!box || !isDashboardPage() || busy) return;
  busy = true;
  try {
    const data = await fetchDashboardData();
    const html = `${renderTop(data)}${renderProjection(data)}${renderQuickActions()}${renderActionQueue(data)}${renderDue(data)}${renderAccounts(data)}${renderRecent(data)}`;
    if (force || html !== lastHtml) {
      box.innerHTML = html;
      lastHtml = html;
      bindActions();
    }
  } catch (error) {
    console.error(error);
    box.innerHTML = `<div class="card"><strong>Inicio</strong><br><span class="muted">${error.message || String(error)}</span></div>`;
  } finally { busy = false; }
}
function bindActions() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", async (event) => {
    const id = event.target?.id;
    if (id === "btnRefreshCommandCenter") { event.preventDefault(); lastHtml = ""; await renderDashboard(true); }
    if (id === "quickNewLoan") { event.preventDefault(); openPage("loansPage"); qs("principal")?.focus(); }
    if (id === "quickRecordPayment") { event.preventDefault(); openPage("paymentsPage"); qs("acctPageAmount")?.focus(); qs("paymentAmount")?.focus(); }
    if (id === "quickFollowup") { event.preventDefault(); openPage("followupsPage"); qs("followupReason")?.focus(); }
    if (id === "quickLogContact") { event.preventDefault(); openPage("followupsPage"); qs("contactNotes")?.focus(); }
  }, true);
}
function tick() { ensureDom(); if (isDashboardPage()) renderDashboard(false); }
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tick, 250); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 4000);
tick();
