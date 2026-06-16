import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://eatxkhhpjruwwibhcubf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: "loan-ledger-auth",
  },
});

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const setDebug = (msg) => { const el = qs("debug"); if (el) el.textContent = msg || ""; };
const safe = (fn) => (...args) => fn(...args).catch((e) => {
  console.error(e);
  setDebug(e?.message || String(e));
  alert(e?.message || String(e));
});

let currentProfile = null;
let currentLoanId = null;
let isBooting = false;
let bootedOnce = false;
let creatingNewBorrower = false;
let pendingNewLoanFunding = [];
let currentLoanView = "borrower";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)),
  ]);
}

async function loadProfileByUserId(userId) {
  if (!userId) throw new Error("Missing userId for profile lookup.");
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Profile missing for user_id: " + userId);
  return data;
}

function openMenu() { qs("sideMenu")?.classList.add("open"); qs("menuOverlay")?.classList.add("open"); }
function closeMenu() { qs("sideMenu")?.classList.remove("open"); qs("menuOverlay")?.classList.remove("open"); }

function openPage(targetId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  const matchingTab = document.querySelector(`.tab-btn[data-page="${targetId}"]`);
  if (matchingTab) matchingTab.classList.add("active");
  qs(targetId)?.classList.add("active-page");
  closeMenu();
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => { btn.onclick = () => openPage(btn.dataset.page); });
  document.querySelectorAll(".menu-link").forEach((btn) => { btn.onclick = () => openPage(btn.dataset.page); });
  if (qs("btnMenu")) qs("btnMenu").onclick = openMenu;
  if (qs("btnCloseMenu")) qs("btnCloseMenu").onclick = closeMenu;
  if (qs("menuOverlay")) qs("menuOverlay").onclick = closeMenu;
}

function ensureDefaultsButtons() {
  if (!qs("btnSaveDefaultRates")) {
    const rateCard = qs("defaultManagementRate")?.closest(".card");
    if (rateCard) {
      const btn = document.createElement("button");
      btn.id = "btnSaveDefaultRates";
      btn.type = "button";
      btn.textContent = "Save default rates";
      rateCard.appendChild(btn);
    }
  }
}

function ensureLoanViewToggle() {
  if (!qs("loanList") || qs("btnLoansByBorrower")) return;
  const wrap = document.createElement("div");
  wrap.className = "view-toggle";
  wrap.style.display = "grid";
  wrap.style.gridTemplateColumns = "1fr 1fr";
  wrap.style.gap = "8px";
  wrap.style.margin = "10px 0 4px";
  wrap.innerHTML = `
    <button id="btnLoansByBorrower" class="loan-view-btn active" type="button">By Borrower</button>
    <button id="btnLoansByLoan" class="loan-view-btn" type="button">By Loan</button>
  `;
  qs("loanList").parentElement.insertBefore(wrap, qs("loanList"));
}

function initLoanViewToggle() {
  ensureLoanViewToggle();
  const byBorrower = qs("btnLoansByBorrower");
  const byLoan = qs("btnLoansByLoan");
  if (!byBorrower || !byLoan) return;

  byBorrower.onclick = safe(async () => {
    currentLoanView = "borrower";
    byBorrower.classList.add("active");
    byLoan.classList.remove("active");
    await refreshLoans();
  });

  byLoan.onclick = safe(async () => {
    currentLoanView = "loan";
    byLoan.classList.add("active");
    byBorrower.classList.remove("active");
    await refreshLoans();
  });
}

function generateDueDates(startDateStr, monthsAhead = 6) {
  const start = new Date(startDateStr + "T00:00:00");
  const dates = [];
  for (let i = 0; i < monthsAhead; i++) {
    const y = start.getFullYear();
    const m = start.getMonth() + i;
    const d15 = new Date(y, m, 15);
    const dLast = new Date(y, m + 1, 0);
    if (d15 >= start) dates.push(d15);
    if (dLast >= start) dates.push(dLast);
  }
  return Array.from(new Set(dates.map((d) => d.toISOString().slice(0, 10)))).sort();
}

async function getNextDueByLoan(loanId) {
  const { data, error } = await supabase
    .from("loan_due_events")
    .select("due_date, expected_total, paid_total, status")
    .eq("loan_id", loanId)
    .in("status", ["DUE", "PARTIAL"])
    .order("due_date", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function loadAppSetting(key) {
  const { data, error } = await supabase.from("app_settings").select("setting_value").eq("setting_key", key).maybeSingle();
  if (error) throw error;
  return data?.setting_value ?? null;
}

async function saveAppSetting(key, value) {
  const { error } = await supabase.rpc("set_app_setting", { p_key: key, p_value: value });
  if (error) throw error;
}

function renderDefaultFundingList(rows = []) {
  const el = qs("defaultFundingList");
  if (!el) return;
  const total = rows.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  el.innerHTML = rows.length ? `
    ${rows.map((row) => `
      <div class="compact-card" data-partner-id="${row.partner_user_id}" data-percent="${row.funding_percent}" data-partner-name="${row.partner_name}">
        <strong>${row.partner_name}</strong><br>
        <span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span>
      </div>
    `).join("")}
    <div style="margin-top:10px"><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
    ${total > 1 ? `<div style="color:#ff8b8b;margin-top:8px">Warning: total exceeds 100%</div>` : ""}
    ${total < 1 ? `<div style="color:#ffd27a;margin-top:8px">Warning: total is below 100%</div>` : ""}
  ` : "No default funding split saved yet.";
}

function renderPendingNewLoanFunding() {
  const el = qs("newLoanFundingList");
  if (!el) return;
  const total = pendingNewLoanFunding.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  el.innerHTML = pendingNewLoanFunding.length ? `
    ${pendingNewLoanFunding.map((row) => `
      <div class="compact-card">
        <strong>${row.partner_name}</strong><br>
        <span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span>
      </div>
    `).join("")}
    <div style="margin-top:10px"><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
    ${total > 1 ? `<div style="color:#ff8b8b;margin-top:8px">Warning: total exceeds 100%</div>` : ""}
    ${total < 1 ? `<div style="color:#ffd27a;margin-top:8px">Warning: total is below 100%</div>` : ""}
  ` : "No funding split added yet.";
}

function updateLoanFunderRatePreview() {
  const total = Number(qs("loanTotalRate")?.value || 0);
  const mgmt = Number(qs("loanMgmtRate")?.value || 0);
  const funders = total - mgmt;
  if (qs("loanFunderRatePreview")) {
    qs("loanFunderRatePreview").textContent = funders >= 0 ? `Funders share: ${funders.toFixed(2)}%` : "Funders share is invalid.";
  }
}

async function loadDefaultsIntoSettingsUI() {
  const rates = await loadAppSetting("loan_defaults");
  const funding = await loadAppSetting("default_funding_split");
  if (qs("defaultInterestRate")) qs("defaultInterestRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("defaultManagementRate")) qs("defaultManagementRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
  renderDefaultFundingList(funding ?? []);
}

async function prefillLoanDefaults(force = false) {
  const rates = await loadAppSetting("loan_defaults");
  const funding = await loadAppSetting("default_funding_split");
  if (qs("loanTotalRate")) qs("loanTotalRate").value = rates?.default_total_monthly_rate != null ? Number(rates.default_total_monthly_rate).toFixed(2) : "10.00";
  if (qs("loanMgmtRate")) qs("loanMgmtRate").value = rates?.default_management_rate != null ? Number(rates.default_management_rate).toFixed(2) : "3.00";
  updateLoanFunderRatePreview();
  if (force || pendingNewLoanFunding.length === 0) {
    pendingNewLoanFunding = (funding ?? []).map((row) => ({
      partner_user_id: row.partner_user_id,
      funding_percent: Number(row.funding_percent),
      partner_name: row.partner_name,
    }));
    renderPendingNewLoanFunding();
  }
}

async function refreshFundingPartnerSelects() {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, role")
    .in("role", ["ADMIN", "PARTNER"])
    .order("full_name", { ascending: true });
  if (error) throw error;
  const options = data.map((p) => `<option value="${p.user_id}">${p.full_name} (${p.role})</option>`).join("");
  ["fundingPartner", "newLoanFundingPartner", "defaultFundingPartner"].forEach((id) => { if (qs(id)) qs(id).innerHTML = options; });
}

async function refreshBorrowers() {
  const { data, error } = await supabase.from("borrowers").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  if (qs("borrowerList")) {
    qs("borrowerList").innerHTML = data.map((b) => `
      <div class="card" style="margin:10px 0;cursor:pointer;padding:12px" data-borrower-id="${b.id}">
        <strong>${b.full_name}</strong><br>
        <span class="muted">${b.phone ?? "No phone"}${b.notes ? ` | ${b.notes}` : ""}</span>
      </div>
    `).join("");
    document.querySelectorAll("[data-borrower-id]").forEach((el) => { el.onclick = () => openBorrowerDetails(el.dataset.borrowerId); });
  }
  if (qs("loanBorrower")) qs("loanBorrower").innerHTML = data.map((b) => `<option value="${b.id}">${b.full_name}</option>`).join("");
}

async function getLoansWithDue() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, borrower_id, start_date, principal_original, principal_outstanding, status, borrowers(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (loan) => ({ ...loan, nextDue: await getNextDueByLoan(loan.id) })));
}

function dueLabel(nextDue) {
  if (!nextDue?.due_date) return "CURRENT";
  if (nextDue.due_date < todayIso()) return "OVERDUE";
  if (nextDue.due_date === todayIso()) return "DUE TODAY";
  return "CURRENT";
}

function amountDue(nextDue) {
  return Math.max(0, Number(nextDue?.expected_total || 0) - Number(nextDue?.paid_total || 0));
}

async function refreshLoans() {
  const loans = await getLoansWithDue();
  const list = qs("loanList");
  if (!list) return;
  if (currentLoanView === "loan") renderLoansByLoan(loans);
  else renderLoansByBorrower(loans);
}

function renderLoansByLoan(loans) {
  qs("loanList").innerHTML = loans.length ? loans.map((l) => `
    <div class="card" style="margin:10px 0;cursor:pointer;padding:12px" data-loan-id="${l.id}">
      <strong>${l.borrowers?.full_name ?? "Unknown"}</strong><br>
      <span class="muted">Original: ${money(l.principal_original)} | Balance: ${money(l.principal_outstanding)} | ${l.status}</span><br>
      <span class="muted">Next Due: ${l.nextDue?.due_date ?? "—"} | Amount Due: ${money(amountDue(l.nextDue))} | ${dueLabel(l.nextDue)}</span>
    </div>
  `).join("") : "No loans yet.";
  document.querySelectorAll("[data-loan-id]").forEach((el) => { el.onclick = () => openLoanDetails(el.dataset.loanId); });
}

function renderLoansByBorrower(loans) {
  const groups = new Map();
  loans.forEach((loan) => {
    const key = loan.borrower_id || "unknown";
    if (!groups.has(key)) groups.set(key, { borrower_id: key, name: loan.borrowers?.full_name ?? "Unknown", loans: [] });
    groups.get(key).loans.push(loan);
  });

  const rows = Array.from(groups.values()).map((g) => {
    const totalOutstanding = g.loans.reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
    const activeLoans = g.loans.filter((l) => l.status === "ACTIVE").length;
    const overdueAmount = g.loans.reduce((sum, l) => dueLabel(l.nextDue) === "OVERDUE" ? sum + amountDue(l.nextDue) : sum, 0);
    const sortedDue = g.loans.filter((l) => l.nextDue?.due_date).sort((a, b) => a.nextDue.due_date.localeCompare(b.nextDue.due_date));
    const nextDue = sortedDue[0]?.nextDue;
    const preview = g.loans.slice(0, 3).map((l) => `
      <div class="compact-card">
        <strong>${l.start_date}</strong> — Balance: ${money(l.principal_outstanding)}<br>
        <span class="muted">Next Due: ${l.nextDue?.due_date ?? "—"} | Due: ${money(amountDue(l.nextDue))} | ${dueLabel(l.nextDue)}</span>
      </div>
    `).join("");
    const more = g.loans.length > 3 ? `<div class="muted">+ ${g.loans.length - 3} more loan(s)</div>` : "";

    return `
      <div class="card" style="margin:10px 0;cursor:pointer;padding:12px" data-borrower-id="${g.borrower_id}">
        <strong>${g.name}</strong><br>
        <span class="muted">Total Outstanding: ${money(totalOutstanding)} | Active Loans: ${activeLoans}</span><br>
        <span class="muted">Next Due: ${nextDue?.due_date ?? "—"} | Overdue: ${money(overdueAmount)}</span>
        ${preview}${more}
      </div>
    `;
  });

  qs("loanList").innerHTML = rows.length ? rows.join("") : "No loans yet.";
  document.querySelectorAll("#loanList [data-borrower-id]").forEach((el) => { el.onclick = () => openBorrowerDetails(el.dataset.borrowerId); });
}

async function refreshLoanDropdownForPayments() {
  const { data, error } = await supabase.from("loans").select("id, borrowers(full_name)").order("created_at", { ascending: false });
  if (error) throw error;
  if (qs("paymentLoan")) qs("paymentLoan").innerHTML = (data ?? []).map((l) => `<option value="${l.id}">${l.borrowers?.full_name ?? "Unknown"} (${l.id.slice(0, 6)}…)</option>`).join("");
}

async function refreshPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("paid_on, amount, applied_interest, applied_mgmt, applied_funders, applied_principal, borrowers(full_name), notes")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  if (qs("paymentList")) {
    qs("paymentList").innerHTML = (data ?? []).length ? data.map((p) => `
      <div class="compact-card">
        <strong>${p.borrowers?.full_name ?? "Unknown"}</strong> — ${money(p.amount)} <span class="muted">(${p.paid_on})</span><br>
        <span class="muted">Interest ${money(p.applied_interest)}, Mgmt ${money(p.applied_mgmt)}, Funders ${money(p.applied_funders)}, Principal ${money(p.applied_principal)}</span>
        ${p.notes ? `<br><span class="muted">${p.notes}</span>` : ""}
      </div>
    `).join("") : "No payments yet.";
  }
}

async function refreshDashboard() {
  const [{ data: loans }, { data: borrowers }, { data: payments }] = await Promise.all([
    supabase.from("loans").select("id, principal_outstanding, borrowers(full_name)"),
    supabase.from("borrowers").select("id"),
    supabase.from("payments").select("amount, paid_on, borrowers(full_name)").order("created_at", { ascending: false }).limit(5),
  ]);
  if (qs("statActiveLoans")) qs("statActiveLoans").textContent = loans?.length ?? 0;
  if (qs("statOutstanding")) qs("statOutstanding").textContent = money((loans ?? []).reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0));
  if (qs("statPaymentsCount")) qs("statPaymentsCount").textContent = payments?.length ?? 0;
  if (qs("statBorrowersCount")) qs("statBorrowersCount").textContent = borrowers?.length ?? 0;
  if (qs("dashboardRecentPayments")) qs("dashboardRecentPayments").innerHTML = (payments ?? []).length ? payments.map((p) => `• ${p.borrowers?.full_name ?? "Unknown"} — ${money(p.amount)} <span class="muted">(${p.paid_on})</span>`).join("<br>") : "No payments yet.";

  const loansWithDue = await Promise.all((loans ?? []).map(async (l) => ({ ...l, nextDue: await getNextDueByLoan(l.id) })));
  const overdue = loansWithDue.filter((l) => dueLabel(l.nextDue) === "OVERDUE");
  if (qs("dashboardLoansSnapshot")) qs("dashboardLoansSnapshot").innerHTML = overdue.length ? overdue.map((l) => `• ${l.borrowers?.full_name ?? "Unknown"} — Overdue ${money(amountDue(l.nextDue))} <span class="muted">(Due ${l.nextDue.due_date})</span>`).join("<br>") : "No overdue loans.";
}

async function refreshLoanFunding(loanId) {
  const [{ data, error }, { data: partners, error: partnersErr }] = await Promise.all([
    supabase.from("loan_funding").select("id, funding_percent, partner_user_id").eq("loan_id", loanId),
    supabase.from("profiles").select("user_id, full_name"),
  ]);
  if (error) throw error;
  if (partnersErr) throw partnersErr;
  const partnerMap = Object.fromEntries((partners ?? []).map((p) => [p.user_id, p.full_name]));
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);
  if (qs("loanFundingList")) qs("loanFundingList").innerHTML = (data ?? []).length ? `
    ${(data ?? []).map((row) => `<div class="compact-card"><strong>${partnerMap[row.partner_user_id] ?? "Unknown"}</strong><br><span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span></div>`).join("")}
    <div><strong>Total:</strong> ${(total * 100).toFixed(2)}%</div>
    ${total > 1 ? `<div style="color:#ff8b8b;margin-top:8px">Warning: total exceeds 100%</div>` : ""}
    ${total < 1 ? `<div style="color:#ffd27a;margin-top:8px">Warning: total is below 100%</div>` : ""}
  ` : "No funding split saved yet.";
}

async function openLoanDetails(loanId) {
  setDebug("Loading loan details...");
  currentLoanId = loanId;
  await refreshFundingPartnerSelects();
  await refreshLoanFunding(loanId);

  const [{ data: loan, error: loanErr }, { data: dueRows, error: dueErr }, { data: payments, error: payErr }] = await Promise.all([
    supabase.from("loans").select("id, start_date, principal_original, principal_outstanding, status, borrowers(full_name)").eq("id", loanId).single(),
    supabase.from("loan_due_events").select("due_date, expected_total, paid_total, status").eq("loan_id", loanId).order("due_date", { ascending: true }),
    supabase.from("payments").select("paid_on, amount, applied_interest, applied_principal, notes").eq("loan_id", loanId).order("paid_on", { ascending: false }),
  ]);
  if (loanErr) throw loanErr;
  if (dueErr) throw dueErr;
  if (payErr) throw payErr;

  if (qs("loanDetailsHeader")) qs("loanDetailsHeader").innerHTML = `
    <div><strong>Borrower:</strong> ${loan.borrowers?.full_name ?? "Unknown"}</div>
    <div><strong>Start Date:</strong> ${loan.start_date}</div>
    <div><strong>Original Principal:</strong> ${money(loan.principal_original)}</div>
    <div><strong>Outstanding:</strong> ${money(loan.principal_outstanding)}</div>
    <div><strong>Status:</strong> ${loan.status}</div>
  `;
  if (qs("loanDetailsDueList")) qs("loanDetailsDueList").innerHTML = (dueRows ?? []).length ? dueRows.map((d) => {
    const remaining = Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0));
    const overdue = d.due_date < todayIso() && remaining > 0;
    return `<div class="compact-card" style="border-color:${overdue ? "#7a2b2b" : "#2a2a2e"}"><strong>${d.due_date}</strong> ${overdue ? "— OVERDUE" : ""}<br><span class="muted">Expected: ${money(d.expected_total)} | Paid: ${money(d.paid_total)} | Remaining: ${money(remaining)} | ${d.status}</span></div>`;
  }).join("") : "No due events yet.";
  if (qs("loanDetailsPaymentList")) qs("loanDetailsPaymentList").innerHTML = (payments ?? []).length ? payments.map((p) => `<div class="compact-card"><strong>${p.paid_on}</strong> — ${money(p.amount)}<br><span class="muted">Interest: ${money(p.applied_interest)} | Principal: ${money(p.applied_principal)}${p.notes ? ` | ${p.notes}` : ""}</span></div>`).join("") : "No payments yet.";
  openPage("loanDetailsPage");
  setDebug("");
}

async function openBorrowerDetails(borrowerId) {
  setDebug("Loading borrower details...");
  const [{ data: borrower, error: borrowerErr }, { data: loans, error: loansErr }, { data: payments, error: paymentsErr }] = await Promise.all([
    supabase.from("borrowers").select("*").eq("id", borrowerId).single(),
    supabase.from("loans").select("id, start_date, principal_original, principal_outstanding, status").eq("borrower_id", borrowerId).order("created_at", { ascending: false }),
    supabase.from("payments").select("paid_on, amount, applied_interest, applied_principal, notes").eq("borrower_id", borrowerId).order("paid_on", { ascending: false }),
  ]);
  if (borrowerErr) throw borrowerErr;
  if (loansErr) throw loansErr;
  if (paymentsErr) throw paymentsErr;

  let overdueCount = 0;
  let overdueAmount = 0;
  for (const loan of loans ?? []) {
    const { data: dueRows } = await supabase.from("loan_due_events").select("due_date, expected_total, paid_total").eq("loan_id", loan.id).in("status", ["DUE", "PARTIAL"]);
    (dueRows ?? []).forEach((d) => {
      const remaining = Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0));
      if (d.due_date < todayIso() && remaining > 0) { overdueCount += 1; overdueAmount += remaining; }
    });
  }

  const totalBorrowed = (loans ?? []).reduce((sum, l) => sum + Number(l.principal_original || 0), 0);
  const totalOutstanding = (loans ?? []).reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  if (qs("borrowerDetailsHeader")) qs("borrowerDetailsHeader").innerHTML = `
    <div><strong>Name:</strong> ${borrower.full_name}</div>
    <div><strong>Phone:</strong> ${borrower.phone ?? "—"}</div>
    <div><strong>Notes:</strong> ${borrower.notes ?? "—"}</div>
    <div><strong>Total Borrowed:</strong> ${money(totalBorrowed)}</div>
    <div><strong>Total Outstanding:</strong> ${money(totalOutstanding)}</div>
    <div><strong>Total Paid:</strong> ${money(totalPaid)}</div>
    <div><strong>Overdue Items:</strong> ${overdueCount}</div>
    <div><strong>Overdue Amount:</strong> ${money(overdueAmount)}</div>
  `;
  if (qs("borrowerDetailsLoans")) qs("borrowerDetailsLoans").innerHTML = (loans ?? []).length ? loans.map((l) => `<div class="compact-card"><strong>${l.start_date}</strong><br><span class="muted">Original: ${money(l.principal_original)} | Balance: ${money(l.principal_outstanding)} | ${l.status}</span></div>`).join("") : "No loans yet.";
  if (qs("borrowerDetailsPayments")) qs("borrowerDetailsPayments").innerHTML = (payments ?? []).length ? payments.map((p) => `<div class="compact-card"><strong>${p.paid_on}</strong> — ${money(p.amount)}<br><span class="muted">Interest: ${money(p.applied_interest)} | Principal: ${money(p.applied_principal)}${p.notes ? ` | ${p.notes}` : ""}</span></div>`).join("") : "No payments yet.";
  openPage("borrowerDetailsPage");
  setDebug("");
}

async function setSignedInUI(profile) {
  currentProfile = profile;
  qs("authCard").style.display = "none";
  qs("app").style.display = "block";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "inline-block";
  if (qs("whoami")) qs("whoami").textContent = `${profile.full_name ?? "User"} • ${profile.role}`;
  if (qs("rolePill")) qs("rolePill").textContent = profile.role;

  ensureDefaultsButtons();
  ensureLoanViewToggle();
  initTabs();
  initLoanViewToggle();
  initHandlers();

  qs("loanTotalRate") && (qs("loanTotalRate").oninput = updateLoanFunderRatePreview);
  qs("loanMgmtRate") && (qs("loanMgmtRate").oninput = updateLoanFunderRatePreview);

  setDebug("Loading borrowers..."); await refreshBorrowers();
  setDebug("Loading loans..."); await refreshLoans();
  setDebug("Loading payments..."); await refreshLoanDropdownForPayments(); await refreshPayments();
  setDebug("Loading defaults..."); await refreshFundingPartnerSelects(); await loadDefaultsIntoSettingsUI(); await prefillLoanDefaults(true);
  setDebug("Loading dashboard..."); await refreshDashboard();
  setDebug("");
}

async function setSignedOutUI() {
  currentProfile = null;
  if (qs("authCard")) qs("authCard").style.display = "block";
  if (qs("app")) qs("app").style.display = "none";
  if (qs("btnSignOut")) qs("btnSignOut").style.display = "none";
  if (qs("whoami")) qs("whoami").textContent = "Not signed in";
  if (qs("rolePill")) qs("rolePill").textContent = "role";
  setDebug("");
}

function initHandlers() {
  if (qs("btnSignIn")) qs("btnSignIn").onclick = safe(async () => {
    const btn = qs("btnSignIn");
    btn.disabled = true;
    try {
      setDebug("Signing in...");
      const { data, error } = await supabase.auth.signInWithPassword({ email: qs("email").value.trim(), password: qs("password").value.trim() });
      if (error) throw error;
      const session = data?.session || (await supabase.auth.getSession()).data.session;
      await bootFromSession(session, "signInHandler");
    } finally { btn.disabled = false; }
  });

  if (qs("btnSignOut")) qs("btnSignOut").onclick = safe(async () => { await supabase.auth.signOut(); });
  if (qs("btnBackToLoans")) qs("btnBackToLoans").onclick = () => openPage("loansPage");
  if (qs("btnBackToBorrowers")) qs("btnBackToBorrowers").onclick = () => openPage("borrowersPage");

  if (qs("btnToggleNewBorrower")) qs("btnToggleNewBorrower").onclick = () => {
    creatingNewBorrower = !creatingNewBorrower;
    qs("newBorrowerFields").style.display = creatingNewBorrower ? "block" : "none";
    qs("btnToggleNewBorrower").textContent = creatingNewBorrower ? "Use Existing Borrower" : "+ New Borrower";
  };

  if (qs("btnAddBorrower")) qs("btnAddBorrower").onclick = safe(addBorrower);
  if (qs("btnCreateLoan")) qs("btnCreateLoan").onclick = safe(createLoan);
  if (qs("btnAddPayment")) qs("btnAddPayment").onclick = safe(addPayment);
  if (qs("btnAddFundingSplit")) qs("btnAddFundingSplit").onclick = safe(saveLoanFundingSplit);
  if (qs("btnAddNewLoanFunding")) qs("btnAddNewLoanFunding").onclick = addPendingLoanFunding;
  if (qs("btnSaveDefaultFunding")) qs("btnSaveDefaultFunding").onclick = safe(saveDefaultFunding);
  if (qs("btnSaveDefaultRates")) qs("btnSaveDefaultRates").onclick = safe(saveDefaultRates);
}

async function addBorrower() {
  if (!currentProfile || !["ADMIN", "AGENT"].includes(currentProfile.role)) return alert("Only Admin/Agent can add borrowers.");
  const full_name = qs("bName").value.trim();
  if (!full_name) return alert("Borrower name required.");
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("borrowers").insert({
    full_name,
    phone: qs("bPhone").value.trim() || null,
    notes: qs("bNotes").value.trim() || null,
    created_by: userData.user.id,
  });
  if (error) throw error;
  qs("bName").value = ""; qs("bPhone").value = ""; qs("bNotes").value = "";
  await refreshBorrowers(); await refreshDashboard();
}

function addPendingLoanFunding() {
  const partner_user_id = qs("newLoanFundingPartner").value;
  const percent = Number(qs("newLoanFundingPercent").value);
  if (!partner_user_id || !percent) return alert("Partner and percent are required.");
  const partner_name = qs("newLoanFundingPartner").selectedOptions[0]?.textContent || "Unknown";
  const funding_percent = percent / 100;
  const index = pendingNewLoanFunding.findIndex((x) => x.partner_user_id === partner_user_id);
  if (index >= 0) pendingNewLoanFunding[index] = { partner_user_id, funding_percent, partner_name };
  else pendingNewLoanFunding.push({ partner_user_id, funding_percent, partner_name });
  qs("newLoanFundingPercent").value = "";
  renderPendingNewLoanFunding();
}

async function createLoan() {
  if (!currentProfile || !["ADMIN", "AGENT"].includes(currentProfile.role)) return alert("Only Admin/Agent can create loans.");
  let borrower_id = qs("loanBorrower").value;

  if (creatingNewBorrower) {
    const full_name = qs("newBorrowerName").value.trim();
    if (!full_name) return alert("New borrower name is required.");
    const { data: userData } = await supabase.auth.getUser();
    const { data: borrower, error } = await supabase.from("borrowers").insert({
      full_name,
      phone: qs("newBorrowerPhone").value.trim() || null,
      notes: qs("newBorrowerNotes").value.trim() || null,
      created_by: userData.user.id,
    }).select("*").single();
    if (error) throw error;
    borrower_id = borrower.id;
  }

  const principal = Number(qs("principal").value);
  const start_date = qs("startDate").value;
  const monthly_rate_total = Number(qs("loanTotalRate").value) / 100;
  const monthly_rate_mgmt = Number(qs("loanMgmtRate").value) / 100;
  const splitTotal = pendingNewLoanFunding.reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);

  if (!borrower_id || !principal || !start_date) return alert("Borrower, principal, and start date are required.");
  if (monthly_rate_mgmt > monthly_rate_total) return alert("Management share cannot exceed total monthly interest.");
  if (!pendingNewLoanFunding.length) return alert("Add at least one funding split.");
  if (Math.abs(splitTotal - 1) > 0.001) return alert("Funding split should total 100% before saving the loan.");

  const { data: userData } = await supabase.auth.getUser();
  const { data: loan, error: loanErr } = await supabase.from("loans").insert({
    borrower_id,
    created_by: userData.user.id,
    start_date,
    principal_original: principal,
    principal_outstanding: principal,
    monthly_rate_total,
    monthly_rate_mgmt,
    status: "ACTIVE",
  }).select("*").single();
  if (loanErr) throw loanErr;

  const totalRatePerCycle = monthly_rate_total / 2;
  const mgmtRatePerCycle = monthly_rate_mgmt / 2;
  const fundersRatePerCycle = totalRatePerCycle - mgmtRatePerCycle;
  const dueRows = generateDueDates(start_date, 6).map((d) => ({
    loan_id: loan.id,
    due_date: d,
    expected_interest: Number((principal * totalRatePerCycle).toFixed(2)),
    expected_total: Number((principal * totalRatePerCycle).toFixed(2)),
    expected_mgmt: Number((principal * mgmtRatePerCycle).toFixed(2)),
    expected_funders: Number((principal * fundersRatePerCycle).toFixed(2)),
    status: "DUE",
  }));
  const { error: dueErr } = await supabase.from("loan_due_events").insert(dueRows);
  if (dueErr) throw dueErr;

  const fundingRows = pendingNewLoanFunding.map((row) => ({ loan_id: loan.id, partner_user_id: row.partner_user_id, funding_percent: row.funding_percent }));
  const { error: fundingErr } = await supabase.from("loan_funding").insert(fundingRows);
  if (fundingErr) throw fundingErr;

  ["principal", "startDate", "newBorrowerName", "newBorrowerPhone", "newBorrowerNotes"].forEach((id) => { if (qs(id)) qs(id).value = ""; });
  creatingNewBorrower = false;
  if (qs("newBorrowerFields")) qs("newBorrowerFields").style.display = "none";
  if (qs("btnToggleNewBorrower")) qs("btnToggleNewBorrower").textContent = "+ New Borrower";
  await prefillLoanDefaults(true);
  await refreshBorrowers(); await refreshLoans(); await refreshLoanDropdownForPayments(); await refreshDashboard();
  alert("Loan created successfully.");
}

async function addPayment() {
  if (!currentProfile || !["ADMIN", "AGENT"].includes(currentProfile.role)) return alert("Only Admin/Agent can record payments.");
  const loan_id = qs("paymentLoan").value;
  const paid_on = qs("paymentDate").value;
  const amount = Number(qs("paymentAmount").value);
  const notes = qs("paymentNotes").value.trim() || null;
  if (!loan_id || !paid_on || !amount) return alert("Loan, date, and amount are required.");
  const { error } = await supabase.rpc("apply_payment", { p_loan_id: loan_id, p_paid_on: paid_on, p_amount: amount, p_notes: notes });
  if (error) throw error;
  qs("paymentAmount").value = ""; qs("paymentNotes").value = "";
  await refreshLoans(); await refreshPayments(); await refreshDashboard();
  alert("Payment applied.");
}

async function saveLoanFundingSplit() {
  if (!currentProfile || currentProfile.role !== "ADMIN") return alert("Only Admin can edit funding splits.");
  if (!currentLoanId) return alert("Open a loan first.");
  const partner_user_id = qs("fundingPartner").value;
  const percentInput = Number(qs("fundingPercent").value);
  if (!partner_user_id || !percentInput) return alert("Partner and percent are required.");
  const { error } = await supabase.from("loan_funding").upsert({ loan_id: currentLoanId, partner_user_id, funding_percent: percentInput / 100 }, { onConflict: "loan_id,partner_user_id" });
  if (error) throw error;
  qs("fundingPercent").value = "";
  await refreshLoanFunding(currentLoanId);
  alert("Funding split saved.");
}

async function saveDefaultRates() {
  if (!currentProfile || currentProfile.role !== "ADMIN") return alert("Only Admin can update defaults.");
  const default_total_monthly_rate = Number(qs("defaultInterestRate").value);
  const default_management_rate = Number(qs("defaultManagementRate").value);
  if (!default_total_monthly_rate || default_management_rate < 0) return alert("Enter valid default rates.");
  if (default_management_rate > default_total_monthly_rate) return alert("Management share cannot exceed total monthly interest.");
  await saveAppSetting("loan_defaults", { default_total_monthly_rate, default_management_rate });
  await prefillLoanDefaults(true);
  alert("Default rates saved.");
}

async function saveDefaultFunding() {
  if (!currentProfile || currentProfile.role !== "ADMIN") return alert("Only Admin can update defaults.");
  const partner_user_id = qs("defaultFundingPartner").value;
  const percent = Number(qs("defaultFundingPercent").value);
  if (!partner_user_id || !percent) return alert("Partner and percent are required.");
  const partner_name = qs("defaultFundingPartner").selectedOptions[0]?.textContent || "Unknown";
  const current = (await loadAppSetting("default_funding_split")) ?? [];
  const next = [...current];
  const index = next.findIndex((x) => x.partner_user_id === partner_user_id);
  const row = { partner_user_id, funding_percent: percent / 100, partner_name };
  if (index >= 0) next[index] = row;
  else next.push(row);
  await saveAppSetting("default_funding_split", next);
  qs("defaultFundingPercent").value = "";
  renderDefaultFundingList(next);
  await prefillLoanDefaults(true);
  alert("Default funding split saved.");
}

async function bootFromSession(session, source = "unknown") {
  if (!session) return setSignedOutUI();
  if (isBooting) return;
  isBooting = true;
  try {
    setDebug("Step 1/2: profile...");
    const profile = await withTimeout(loadProfileByUserId(session.user.id), 8000, "loadProfileByUserId");
    setDebug("Step 2/2: app...");
    await setSignedInUI(profile);
    bootedOnce = true;
  } catch (e) {
    console.error("[BOOT]", source, e);
    alert("Error after sign-in: " + (e?.message || String(e)));
    await setSignedOutUI();
  } finally { isBooting = false; }
}

supabase.auth.onAuthStateChange((event, session) => {
  console.log("[AUTH]", event, "session?", !!session);
  if (!session) return setSignedOutUI();
  bootFromSession(session, "auth:" + event);
});

setTimeout(safe(async () => {
  if (bootedOnce) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) await bootFromSession(data.session, "fallback:getSession");
  else await setSignedOutUI();
}), 800);

initHandlers();
