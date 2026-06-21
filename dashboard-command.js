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
let commandCenterBound = false;

function isDashboardPage() {
  return qs("dashboardPage")?.classList.contains("active-page");
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));

  const matchingTab = document.querySelector(`.tab-btn[data-page="${id}"]`);
  if (matchingTab) matchingTab.classList.add("active");

  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function smallAction(html, attrs = "") {
  return `<div ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:8px 0;box-sizing:border-box;">${html}</div>`;
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
    dashboard.appendChild(box);
  }

  return box;
}

async function fetchDashboardData() {
  const today = todayIso();
  const month = monthPrefix();

  const [
    loansRes,
    dueRes,
    followupsRes,
    healthRes,
    paymentsRes,
    riskRes,
    activityRes,
    contactsRes,
  ] = await Promise.all([
    supabase.from("loans").select("id, start_date, principal_outstanding, status, borrowers(full_name)").order("created_at", { ascending: false }).limit(200),
    supabase.from("loan_due_events").select("id, loan_id, due_date, expected_total, paid_total, status, loans(id,status,borrowers(full_name))").in("status", ["DUE", "PARTIAL"]).order("due_date", { ascending: true }).limit(250),
    supabase.from("borrower_followups_view").select("*").order("due_date", { ascending: true }).limit(100),
    supabase.from("loan_health_issues").select("*").limit(100),
    supabase.from("payment_detail_view").select("*").order("created_at", { ascending: false }).limit(25),
    supabase.from("borrower_risk_summary").select("*").order("overdue_amount", { ascending: false }).limit(8),
    supabase.from("activity_log_view").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("borrower_contact_log_view").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const errors = [loansRes, dueRes, followupsRes, healthRes, paymentsRes, riskRes, activityRes, contactsRes].filter((res) => res.error);
  if (errors.length) throw errors[0].error;

  const loans = loansRes.data || [];
  const dueRows = (dueRes.data || []).map((d) => ({
    ...d,
    remaining: Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0)),
    borrower_name: d.loans?.borrowers?.full_name || "Unknown",
    loan_status: d.loans?.status || "UNKNOWN",
  })).filter((d) => d.remaining > 0 && d.loan_status === "ACTIVE");

  const overdueDue = dueRows.filter((d) => d.due_date < today);
  const dueToday = dueRows.filter((d) => d.due_date === today);
  const upcomingDue = dueRows.filter((d) => d.due_date > today).slice(0, 5);

  const followups = followupsRes.data || [];
  const openFollowups = followups.filter((f) => f.status === "OPEN");
  const overdueFollowups = openFollowups.filter((f) => f.timing_status === "OVERDUE");
  const todayFollowups = openFollowups.filter((f) => f.timing_status === "DUE_TODAY");
  const urgentFollowups = openFollowups.filter((f) => ["URGENT", "HIGH"].includes(f.priority));

  const health = healthRes.data || [];
  const highHealth = health.filter((h) => h.severity === "HIGH");
  const medHealth = health.filter((h) => h.severity === "MEDIUM");

  const payments = paymentsRes.data || [];
  const activePayments = payments.filter((p) => !p.is_voided);
  const paymentsThisMonth = activePayments.filter((p) => String(p.paid_on || "").slice(0, 7) === month);
  const paymentsThisMonthTotal = paymentsThisMonth.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const activeLoans = loans.filter((l) => l.status === "ACTIVE");
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
  const overdueAmount = overdueDue.reduce((sum, d) => sum + d.remaining, 0);
  const dueTodayAmount = dueToday.reduce((sum, d) => sum + d.remaining, 0);

  return {
    today,
    loans,
    activeLoans,
    totalOutstanding,
    dueRows,
    overdueDue,
    overdueAmount,
    dueToday,
    dueTodayAmount,
    upcomingDue,
    followups,
    openFollowups,
    overdueFollowups,
    todayFollowups,
    urgentFollowups,
    health,
    highHealth,
    medHealth,
    payments,
    activePayments,
    paymentsThisMonth,
    paymentsThisMonthTotal,
    risk: riskRes.data || [],
    activity: activityRes.data || [],
    contacts: contactsRes.data || [],
  };
}

function statusPill(text, cls = "") {
  return `<span class="pill ${cls}" style="margin-left:6px;">${text}</span>`;
}

function renderTopSummary(data) {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-weight:800;">Command Center</div>
          <div class="muted">Fast view of what needs attention today.</div>
        </div>
        <button id="btnRefreshCommandCenter" class="command-btn" type="button" style="width:auto;background:#333;padding:10px 14px;">Refresh</button>
      </div>

      <div class="command-grid">
        <div class="command-card"><div class="command-label">Total Outstanding</div><div class="command-value">${money(data.totalOutstanding)}</div></div>
        <div class="command-card"><div class="command-label">Overdue Amount</div><div class="command-value ${data.overdueAmount > 0 ? "command-high" : ""}">${money(data.overdueAmount)}</div></div>
        <div class="command-card"><div class="command-label">Due Today</div><div class="command-value ${data.dueTodayAmount > 0 ? "command-med" : ""}">${money(data.dueTodayAmount)}</div></div>
        <div class="command-card"><div class="command-label">Open Follow-ups</div><div class="command-value">${data.openFollowups.length}</div></div>
        <div class="command-card"><div class="command-label">Health Issues</div><div class="command-value ${data.highHealth.length ? "command-high" : data.medHealth.length ? "command-med" : "command-ok"}">${data.health.length}</div></div>
        <div class="command-card"><div class="command-label">Payments This Month</div><div class="command-value">${money(data.paymentsThisMonthTotal)}</div></div>
      </div>
    </div>
  `;
}

function renderQuickActions() {
  return `
    <div class="card">
      <div style="font-weight:800;">Quick Actions</div>
      <div class="row">
        <button id="quickNewLoan" class="command-btn" type="button">New Loan</button>
        <button id="quickRecordPayment" class="command-btn" type="button">Record Payment</button>
      </div>
      <div class="row">
        <button id="quickFollowup" class="command-btn" type="button">Add Follow-up</button>
        <button id="quickLogContact" class="command-btn" type="button">Log Contact</button>
      </div>
      <button id="quickGenerateDue" class="command-btn" type="button">Generate Missing Due Dates</button>
      <div id="quickActionStatus" class="muted" style="margin-top:8px;"></div>
    </div>
  `;
}

function renderActionQueue(data) {
  const items = [];

  data.overdueDue.slice(0, 5).forEach((d) => {
    items.push({
      priority: 1,
      html: smallAction(`
        <strong>${d.borrower_name}</strong> ${statusPill("OVERDUE", "command-high")}<br>
        <span class="muted">Due ${d.due_date} | Amount: ${money(d.remaining)} | Loan ${String(d.loan_id).slice(0, 8)}…</span>
      `),
    });
  });

  data.todayFollowups.slice(0, 4).forEach((f) => {
    items.push({
      priority: 2,
      html: smallAction(`
        <strong>${f.borrower_name}</strong> ${statusPill("FOLLOW-UP TODAY", "command-med")}<br>
        <span class="muted">${f.reason || "—"} | Priority: ${f.priority} | ${f.borrower_phone || "No phone"}</span>
      `),
    });
  });

  data.urgentFollowups.slice(0, 4).forEach((f) => {
    items.push({
      priority: 3,
      html: smallAction(`
        <strong>${f.borrower_name}</strong> ${statusPill(f.priority, "command-high")}<br>
        <span class="muted">Due ${f.due_date} | ${f.reason || "—"}</span>
      `),
    });
  });

  data.highHealth.slice(0, 4).forEach((h) => {
    items.push({
      priority: 4,
      html: smallAction(`
        <strong>${h.borrower_name}</strong> ${statusPill("HEALTH", "command-high")}<br>
        <span class="muted">${h.summary} | ${h.details || ""}</span>
      `),
    });
  });

  const sorted = items.sort((a, b) => a.priority - b.priority).slice(0, 10);

  return `
    <div class="card">
      <div style="font-weight:800;">Action Queue</div>
      <div class="muted">The most urgent things to handle first.</div>
      ${sorted.length ? sorted.map((x) => x.html).join("") : "No urgent actions right now."}
    </div>
  `;
}

function renderDueFollowups(data) {
  return `
    <div class="card">
      <div style="font-weight:800;">Today / Upcoming</div>
      <div style="font-weight:800;margin-top:10px;">Due Today</div>
      ${data.dueToday.length ? data.dueToday.slice(0, 5).map((d) => smallAction(`
        <strong>${d.borrower_name}</strong> — ${money(d.remaining)}<br>
        <span class="muted">Due ${d.due_date} | ${d.status}</span>
      `)).join("") : `<div class="muted">No loan payments due today.</div>`}

      <div style="font-weight:800;margin-top:14px;">Upcoming Due</div>
      ${data.upcomingDue.length ? data.upcomingDue.map((d) => smallAction(`
        <strong>${d.borrower_name}</strong> — ${money(d.remaining)}<br>
        <span class="muted">Due ${d.due_date} | ${d.status}</span>
      `)).join("") : `<div class="muted">No upcoming due rows found.</div>`}

      <div style="font-weight:800;margin-top:14px;">Follow-ups Due</div>
      ${[...data.overdueFollowups, ...data.todayFollowups].slice(0, 6).map((f) => smallAction(`
        <strong>${f.borrower_name}</strong> — ${f.timing_status.replaceAll("_", " ")}<br>
        <span class="muted">${f.reason || "—"} | Due ${f.due_date} | ${f.borrower_phone || "No phone"}</span>
      `)).join("") || `<div class="muted">No overdue or due-today follow-ups.</div>`}
    </div>
  `;
}

function renderRisk(data) {
  const risky = (data.risk || []).filter((b) => Number(b.overdue_amount || 0) > 0 || Number(b.total_outstanding || 0) > 0).slice(0, 6);
  return `
    <div class="card">
      <div style="font-weight:800;">Borrower Risk Snapshot</div>
      ${risky.length ? risky.map((b) => smallAction(`
        <strong>${b.full_name}</strong> ${statusPill(b.risk_status, b.risk_status === "OVERDUE" ? "command-high" : "") }<br>
        <span class="muted">Outstanding: ${money(b.total_outstanding)} | Overdue: ${money(b.overdue_amount)} | Days late: ${b.max_days_late || 0} | Last payment: ${b.last_payment_date || "—"}</span>
      `)).join("") : "No borrower risk data yet."}
    </div>
  `;
}

function renderRecent(data) {
  return `
    <div class="card">
      <div style="font-weight:800;">Recent Payments</div>
      ${data.activePayments.length ? data.activePayments.slice(0, 5).map((p) => smallAction(`
        <strong>${p.borrower_name || "Unknown"}</strong> — ${money(p.amount)}<br>
        <span class="muted">Paid ${p.paid_on} | Interest: ${money(p.applied_interest)} | Principal: ${money(p.applied_principal)}</span>
      `)).join("") : "No payments yet."}
    </div>

    <div class="card">
      <div style="font-weight:800;">Recent Activity</div>
      ${data.activity.length ? data.activity.slice(0, 5).map((a) => smallAction(`
        <strong>${String(a.action_type || "").replaceAll("_", " ")}</strong><br>
        <span class="muted">${new Date(a.created_at).toLocaleString()} | ${a.actor_name || "System"} | ${a.summary || "—"}</span>
      `)).join("") : "No activity yet."}
    </div>

    <div class="card">
      <div style="font-weight:800;">Recent Contact Notes</div>
      ${data.contacts.length ? data.contacts.slice(0, 5).map((c) => smallAction(`
        <strong>${c.borrower_name}</strong> — ${c.contact_type}<br>
        <span class="muted">${c.contact_date} | ${c.outcome || "—"}</span><br>
        <span>${c.notes || ""}</span>
      `)).join("") : "No contact notes yet."}
    </div>
  `;
}

function renderHealthPreview(data) {
  return `
    <div class="card">
      <div style="font-weight:800;">Loan Health Preview</div>
      ${data.health.length ? data.health.slice(0, 6).map((h) => smallAction(`
        <strong>${h.borrower_name}</strong> ${statusPill(h.severity, h.severity === "HIGH" ? "command-high" : "command-med")}<br>
        <span class="muted">${h.summary} | ${h.details || ""}</span>
      `)).join("") : `<div class="command-ok">No loan health issues found.</div>`}
    </div>
  `;
}

async function renderCommandCenter(force = false) {
  const box = ensureCommandCenterDom();
  if (!box || !isDashboardPage() || dashboardBusy) return;

  dashboardBusy = true;
  try {
    const data = await fetchDashboardData();
    const html = `
      ${renderTopSummary(data)}
      ${renderQuickActions()}
      ${renderActionQueue(data)}
      ${renderDueFollowups(data)}
      ${renderRisk(data)}
      ${renderHealthPreview(data)}
      ${renderRecent(data)}
    `;

    if (force || html !== lastDashboardHtml) {
      box.innerHTML = html;
      lastDashboardHtml = html;
      bindQuickActions();
    }
  } catch (error) {
    console.error(error);
    box.innerHTML = `<div class="card"><strong>Command Center</strong><br><span class="muted">${error.message || String(error)}</span></div>`;
  } finally {
    dashboardBusy = false;
  }
}

function bindQuickActions() {
  if (commandCenterBound) return;
  commandCenterBound = true;

  document.addEventListener("click", async (event) => {
    const id = event.target?.id;
    if (!id) return;

    if (id === "btnRefreshCommandCenter") {
      event.preventDefault();
      lastDashboardHtml = "";
      commandCenterBound = false;
      await renderCommandCenter(true);
      return;
    }

    if (id === "quickNewLoan") {
      event.preventDefault();
      openPage("loansPage");
      qs("principal")?.focus();
      return;
    }

    if (id === "quickRecordPayment") {
      event.preventDefault();
      openPage("paymentsPage");
      qs("paymentAmount")?.focus();
      return;
    }

    if (id === "quickFollowup") {
      event.preventDefault();
      openPage("followupsPage");
      qs("followupReason")?.focus();
      return;
    }

    if (id === "quickLogContact") {
      event.preventDefault();
      openPage("followupsPage");
      qs("contactNotes")?.focus();
      return;
    }

    if (id === "quickGenerateDue") {
      event.preventDefault();
      const status = qs("quickActionStatus");
      if (status) status.textContent = "Generating missing due dates...";
      const { data, error } = await supabase.rpc("generate_missing_due_events_all", { p_months_ahead: 12 });
      if (error) {
        if (status) status.textContent = error.message;
        alert(error.message);
        return;
      }
      const total = (data || []).reduce((sum, row) => sum + Number(row.inserted_count || 0), 0);
      if (status) status.textContent = `Generated ${total} missing due row(s).`;
      lastDashboardHtml = "";
      commandCenterBound = false;
      await renderCommandCenter(true);
    }
  }, true);
}

function tick() {
  ensureCommandCenterDom();
  if (isDashboardPage()) renderCommandCenter(false);
}

const observer = new MutationObserver(() => {
  clearTimeout(dashboardTimer);
  dashboardTimer = setTimeout(tick, 250);
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 3500);
tick();
