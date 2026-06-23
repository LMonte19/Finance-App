import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://eatxkhhpjruwwibhcubf.supabase.co",
  "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "loan-ledger-auth",
    },
  }
);

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => new Date().toISOString().slice(0, 7);

let dashboardTimer = null;
let dashboardBusy = false;
let lastDashboardHtml = "";
let bound = false;

function isDashboardPage() {
  return qs("dashboardPage")?.classList.contains("active-page");
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  document.querySelector(`.tab-btn[data-page="${id}"]`)?.classList.add("active");
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function smallAction(html) {
  return `<div style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:8px 0;box-sizing:border-box;">${html}</div>`;
}

function ensureStyles() {
  if (qs("dashboardCommandStyle")) return;
  const style = document.createElement("style");
  style.id = "dashboardCommandStyle";
  style.textContent = `
    .command-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px;}
    .command-card{background:#0f0f11;border:1px solid #2a2a2e;border-radius:14px;padding:14px;box-sizing:border-box;}
    .command-label{color:#b8b8c2;font-size:13px;margin-bottom:6px;}
    .command-value{font-size:22px;font-weight:800;}
    .command-btn{cursor:pointer;transition:filter .15s ease, transform .05s ease;}
    .command-btn:hover{filter:brightness(1.18);}
    .command-btn:active{transform:scale(.98);}
    .command-high{color:#ff8b8b;font-weight:800;}
    .command-med{color:#ffd27a;font-weight:800;}
    .command-ok{color:#9ff5b2;font-weight:800;}
    @media(max-width:650px){.command-grid{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);
}

function ensureCommandCenterDom() {
  ensureStyles();
  const dashboard = qs("dashboardPage");
  if (!dashboard) return null;
  let box = qs("dashboardCommandCenter");
  if (!box) {
    box = document.createElement("div");
    box.id = "dashboardCommandCenter";
    dashboard.innerHTML = "";
    dashboard.appendChild(box);
  }
  return box;
}

async function fetchDashboardData() {
  const today = todayIso();
  const month = monthPrefix();

  const [accountsRes, dueRes, paymentsRes, followupsRes, healthRes, activityRes, contactsRes, partnersRes] = await Promise.all([
    supabase.from("borrower_account_summary").select("*").order("overdue_amount", { ascending: false }).limit(200),
    supabase.from("borrower_due_events_view").select("*").in("status", ["DUE", "PARTIAL"]).order("due_date", { ascending: true }).limit(250),
    supabase.from("borrower_account_payments_view").select("*").order("created_at", { ascending: false }).limit(80),
    supabase.from("borrower_followups_view").select("*").order("due_date", { ascending: true }).limit(80),
    supabase.from("borrower_account_health_issues").select("*").limit(80),
    supabase.from("activity_log_view").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("borrower_contact_log_view").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("partner_earnings_summary").select("*").limit(50),
  ]);

  const errors = [accountsRes, dueRes, paymentsRes, followupsRes, healthRes, activityRes, contactsRes, partnersRes].filter((res) => res.error);
  if (errors.length) throw errors[0].error;

  const accounts = accountsRes.data || [];
  const activeAccounts = accounts.filter((a) => Number(a.principal_balance || 0) > 0);
  const overdueAccounts = accounts.filter((a) => Number(a.overdue_amount || 0) > 0);
  const dueTodayAccounts = accounts.filter((a) => Number(a.due_today_amount || 0) > 0);

  const dueRows = (dueRes.data || [])
    .map((d) => ({ ...d, amount_due: Number(d.amount_due || 0) }))
    .filter((d) => d.amount_due > 0);

  const overdueDue = dueRows.filter((d) => d.due_date < today || d.timing_status === "OVERDUE");
  const dueToday = dueRows.filter((d) => d.due_date === today || d.timing_status === "DUE_TODAY");
  const upcomingDue = dueRows.filter((d) => d.due_date > today && d.timing_status !== "OVERDUE").slice(0, 6);

  const payments = paymentsRes.data || [];
  const activePayments = payments.filter((p) => !p.is_voided);
  const paymentsThisMonth = activePayments.filter((p) => String(p.paid_on || "").slice(0, 7) === month);
  const paymentsThisMonthTotal = paymentsThisMonth.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const feesThisMonth = paymentsThisMonth.reduce((sum, p) => sum + Number(p.applied_interest || 0), 0);
  const principalThisMonth = paymentsThisMonth.reduce((sum, p) => sum + Number(p.applied_principal || 0), 0);

  const partners = partnersRes.data || [];
  const activeCapital = activeAccounts.reduce((sum, a) => sum + Number(a.principal_balance || 0), 0);
  const totalOverdue = overdueAccounts.reduce((sum, a) => sum + Number(a.overdue_amount || 0), 0);
  const dueTodayAmount = dueTodayAccounts.reduce((sum, a) => sum + Number(a.due_today_amount || 0), 0);
  const monthlyFee = activeAccounts.reduce((sum, a) => sum + Number(a.current_monthly_fee || 0), 0);
  const monthlyMgmt = activeAccounts.reduce((sum, a) => sum + Number(a.current_monthly_mgmt || 0), 0);
  const monthlyFunders = activeAccounts.reduce((sum, a) => sum + Number(a.current_monthly_funders || 0), 0);
  const partnerActiveCapital = partners.reduce((sum, p) => sum + Number(p.active_capital || 0), 0);
  const partnerTotalEarned = partners.reduce((sum, p) => sum + Number(p.total_earned || 0), 0);

  const followups = followupsRes.data || [];
  const openFollowups = followups.filter((f) => f.status === "OPEN");
  const overdueFollowups = openFollowups.filter((f) => f.timing_status === "OVERDUE");
  const todayFollowups = openFollowups.filter((f) => f.timing_status === "DUE_TODAY");
  const urgentFollowups = openFollowups.filter((f) => ["URGENT", "HIGH"].includes(f.priority));

  const health = healthRes.data || [];
  const highHealth = health.filter((h) => h.severity === "HIGH");
  const medHealth = health.filter((h) => h.severity === "MEDIUM");

  return {
    today,
    accounts,
    activeAccounts,
    overdueAccounts,
    dueTodayAccounts,
    activeCapital,
    totalOverdue,
    dueTodayAmount,
    monthlyFee,
    monthlyMgmt,
    monthlyFunders,
    dueRows,
    overdueDue,
    dueToday,
    upcomingDue,
    payments,
    activePayments,
    paymentsThisMonth,
    paymentsThisMonthTotal,
    feesThisMonth,
    principalThisMonth,
    partnerActiveCapital,
    partnerTotalEarned,
    followups,
    openFollowups,
    overdueFollowups,
    todayFollowups,
    urgentFollowups,
    health,
    highHealth,
    medHealth,
    activity: activityRes.data || [],
    contacts: contactsRes.data || [],
  };
}

function statusPill(text, cls = "") {
  return `<span class="pill ${cls}" style="margin-left:6px;">${text}</span>`;
}

function renderTopSummary(data) {
  return `
    <div class="card" data-no-translate="true">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div><div style="font-weight:800;">Inicio / Resumen</div><div class="muted">Vista rápida de cuentas, cuotas y pagos.</div></div>
        <button id="btnRefreshCommandCenter" class="command-btn" type="button" style="width:auto;background:#333;padding:10px 14px;">Actualizar</button>
      </div>
      <div class="command-grid">
        <div class="command-card"><div class="command-label">Capital activo</div><div class="command-value">${money(data.activeCapital)}</div></div>
        <div class="command-card"><div class="command-label">Atrasado</div><div class="command-value ${data.totalOverdue > 0 ? "command-high" : "command-ok"}">${money(data.totalOverdue)}</div></div>
        <div class="command-card"><div class="command-label">Vence hoy</div><div class="command-value ${data.dueTodayAmount > 0 ? "command-med" : ""}">${money(data.dueTodayAmount)}</div></div>
        <div class="command-card"><div class="command-label">Pagos del mes</div><div class="command-value">${money(data.paymentsThisMonthTotal)}</div></div>
        <div class="command-card"><div class="command-label">Cuotas cobradas</div><div class="command-value">${money(data.feesThisMonth)}</div></div>
        <div class="command-card"><div class="command-label">Abono a capital</div><div class="command-value">${money(data.principalThisMonth)}</div></div>
      </div>
    </div>
  `;
}

function renderExpectedMonthly(data) {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Proyección actual</div>
      <div class="muted">Basado en el balance activo actual de cada cuenta.</div>
      <div class="command-grid">
        <div class="command-card"><div class="command-label">Cuota mensual total</div><div class="command-value">${money(data.monthlyFee)}</div></div>
        <div class="command-card"><div class="command-label">Administración mensual</div><div class="command-value">${money(data.monthlyMgmt)}</div></div>
        <div class="command-card"><div class="command-label">Socios mensual</div><div class="command-value">${money(data.monthlyFunders)}</div></div>
        <div class="command-card"><div class="command-label">Capital socios activo</div><div class="command-value">${money(data.partnerActiveCapital)}</div></div>
      </div>
    </div>
  `;
}

function renderQuickActions() {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Acciones rápidas</div>
      <div class="row">
        <button id="quickNewLoan" class="command-btn" type="button">Nuevo desembolso</button>
        <button id="quickRecordPayment" class="command-btn" type="button">Registrar pago</button>
      </div>
      <div class="row">
        <button id="quickFollowup" class="command-btn" type="button">Seguimiento</button>
        <button id="quickLogContact" class="command-btn" type="button">Nota de contacto</button>
      </div>
      <button id="quickGenerateDue" class="command-btn" type="button">Recalcular cuotas futuras</button>
      <div id="quickActionStatus" class="muted" style="margin-top:8px;"></div>
    </div>
  `;
}

function renderActionQueue(data) {
  const items = [];

  data.overdueAccounts.slice(0, 6).forEach((a) => {
    items.push({ priority: 1, html: smallAction(`<strong>${a.full_name}</strong> ${statusPill("ATRASADO", "command-high")}<br><span class="muted">Atrasado: ${money(a.overdue_amount)} | ${a.overdue_count || 0} cuotas | ${a.max_days_late || 0} días tarde</span>`) });
  });

  data.dueTodayAccounts.slice(0, 4).forEach((a) => {
    items.push({ priority: 2, html: smallAction(`<strong>${a.full_name}</strong> ${statusPill("VENCE HOY", "command-med")}<br><span class="muted">Monto: ${money(a.due_today_amount)} | Balance: ${money(a.principal_balance)}</span>`) });
  });

  data.todayFollowups.slice(0, 4).forEach((f) => {
    items.push({ priority: 3, html: smallAction(`<strong>${f.borrower_name}</strong> ${statusPill("SEGUIMIENTO", "command-med")}<br><span class="muted">${f.reason || "—"} | ${f.borrower_phone || "Sin teléfono"}</span>`) });
  });

  data.highHealth.slice(0, 4).forEach((h) => {
    items.push({ priority: 4, html: smallAction(`<strong>${h.borrower_name || h.full_name || "Cuenta"}</strong> ${statusPill("REVISAR", "command-high")}<br><span class="muted">${h.summary || h.issue_type || "Alerta"} | ${h.details || ""}</span>`) });
  });

  const sorted = items.sort((a, b) => a.priority - b.priority).slice(0, 12);
  return `<div class="card" data-no-translate="true"><div style="font-weight:800;">Prioridad de hoy</div><div class="muted">Lo más importante para revisar primero.</div>${sorted.length ? sorted.map(x => x.html).join("") : `<div class="command-ok" style="margin-top:10px;">No hay acciones urgentes ahora.</div>`}</div>`;
}

function renderDueSection(data) {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Cuotas</div>
      <div style="font-weight:800;margin-top:10px;">Vencen hoy</div>
      ${data.dueToday.length ? data.dueToday.slice(0, 6).map(d => smallAction(`<strong>${d.borrower_name}</strong> — ${money(d.amount_due)}<br><span class="muted">Fecha: ${d.due_date} | ${d.status}</span>`)).join("") : `<div class="muted">No hay cuotas venciendo hoy.</div>`}
      <div style="font-weight:800;margin-top:14px;">Próximas cuotas</div>
      ${data.upcomingDue.length ? data.upcomingDue.map(d => smallAction(`<strong>${d.borrower_name}</strong> — ${money(d.amount_due)}<br><span class="muted">Fecha: ${d.due_date} | Capital base: ${money(d.principal_snapshot)}</span>`)).join("") : `<div class="muted">No hay cuotas próximas generadas.</div>`}
    </div>
  `;
}

function renderAccounts(data) {
  const risky = [...data.overdueAccounts, ...data.activeAccounts.filter(a => Number(a.overdue_amount || 0) <= 0)].slice(0, 8);
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Cuentas de clientes</div>
      ${risky.length ? risky.map(a => smallAction(`<strong>${a.full_name}</strong> ${statusPill(a.account_status, a.account_status === "ATRASADO" ? "command-high" : "command-ok")}<br><span class="muted">Balance: ${money(a.principal_balance)} | Cuota mensual: ${money(a.current_monthly_fee)} | Próxima: ${a.next_due_date || "—"}</span>`)).join("") : "No hay cuentas activas."}
    </div>
  `;
}

function renderRecent(data) {
  return `
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Pagos recientes</div>
      ${data.activePayments.length ? data.activePayments.slice(0, 6).map(p => smallAction(`<strong>${p.borrower_name || "Cliente"}</strong> — ${money(p.amount)}<br><span class="muted">${p.paid_on} | Cuota/interés: ${money(p.applied_interest)} | Capital: ${money(p.applied_principal)}</span>`)).join("") : "No hay pagos todavía."}
    </div>
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Actividad reciente</div>
      ${data.activity.length ? data.activity.slice(0, 5).map(a => smallAction(`<strong>${String(a.action_type || "").replaceAll("_", " ")}</strong><br><span class="muted">${new Date(a.created_at).toLocaleString()} | ${a.actor_name || "Sistema"} | ${a.summary || "—"}</span>`)).join("") : "No hay actividad."}
    </div>
    <div class="card" data-no-translate="true">
      <div style="font-weight:800;">Notas de contacto recientes</div>
      ${data.contacts.length ? data.contacts.slice(0, 5).map(c => smallAction(`<strong>${c.borrower_name}</strong> — ${c.contact_type}<br><span class="muted">${c.contact_date} | ${c.outcome || "—"}</span><br><span>${c.notes || ""}</span>`)).join("") : "No hay notas de contacto."}
    </div>
  `;
}

async function renderCommandCenter(force = false) {
  const box = ensureCommandCenterDom();
  if (!box || !isDashboardPage() || dashboardBusy) return;
  dashboardBusy = true;
  try {
    const data = await fetchDashboardData();
    const html = `${renderTopSummary(data)}${renderExpectedMonthly(data)}${renderQuickActions()}${renderActionQueue(data)}${renderDueSection(data)}${renderAccounts(data)}${renderRecent(data)}`;
    if (force || html !== lastDashboardHtml) {
      box.innerHTML = html;
      lastDashboardHtml = html;
      bindQuickActions();
    }
  } catch (error) {
    console.error(error);
    box.innerHTML = `<div class="card"><strong>Inicio</strong><br><span class="muted">${error.message || String(error)}</span></div>`;
  } finally {
    dashboardBusy = false;
  }
}

function bindQuickActions() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", async (event) => {
    const id = event.target?.id;
    if (!id) return;
    if (id === "btnRefreshCommandCenter") { event.preventDefault(); lastDashboardHtml = ""; await renderCommandCenter(true); return; }
    if (id === "quickNewLoan") { event.preventDefault(); openPage("loansPage"); qs("principal")?.focus(); return; }
    if (id === "quickRecordPayment") { event.preventDefault(); openPage("paymentsPage"); qs("acctPageAmount")?.focus(); qs("paymentAmount")?.focus(); return; }
    if (id === "quickFollowup") { event.preventDefault(); openPage("followupsPage"); qs("followupReason")?.focus(); return; }
    if (id === "quickLogContact") { event.preventDefault(); openPage("followupsPage"); qs("contactNotes")?.focus(); return; }
    if (id === "quickGenerateDue") {
      event.preventDefault();
      const status = qs("quickActionStatus");
      if (status) status.textContent = "Recalculando cuotas futuras...";
      const { data, error } = await supabase.rpc("regenerate_future_borrower_due_events_all", { p_months_ahead: 12 });
      if (error) { if (status) status.textContent = error.message; alert(error.message); return; }
      const total = (data || []).reduce((sum, row) => sum + Number(row.inserted_count || 0), 0);
      if (status) status.textContent = `Cuentas revisadas: ${(data || []).length}. Cuotas creadas/recalculadas: ${total}.`;
      lastDashboardHtml = "";
      await renderCommandCenter(true);
    }
  }, true);
}

function tick() {
  ensureCommandCenterDom();
  if (isDashboardPage()) renderCommandCenter(false);
}

new MutationObserver(() => {
  clearTimeout(dashboardTimer);
  dashboardTimer = setTimeout(tick, 250);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

setInterval(tick, 4000);
tick();
