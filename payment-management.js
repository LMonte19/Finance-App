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

let paymentFilter = localStorage.getItem("loanLedger.paymentFilter") || "active";
let paymentBusy = false;
let activePaymentId = null;
let detailOpen = false;
let timer = null;

function isPaymentsPage() {
  return qs("paymentsPage")?.classList.contains("active-page");
}

function isDashboardPage() {
  return qs("dashboardPage")?.classList.contains("active-page");
}

function isBorrowerDetailsPage() {
  return qs("borrowerDetailsPage")?.classList.contains("active-page");
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function clickableCard(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;cursor:pointer;">${html}</div>`;
}

function setStatus(msg) {
  const el = qs("paymentActionStatus");
  if (el) el.textContent = msg;
}

function ensurePaymentFilterControls() {
  const paymentList = qs("paymentList");
  if (!paymentList || qs("paymentFilterBox")) return;

  const box = document.createElement("div");
  box.id = "paymentFilterBox";
  box.className = "card";
  box.innerHTML = `
    <div style="font-weight:800;">Payment View</div>
    <div class="row">
      <button id="payFilterActive" type="button">Active</button>
      <button id="payFilterAll" type="button">All</button>
    </div>
    <div class="row">
      <button id="payFilterVoided" type="button">Voided</button>
      <button id="payFilterMonth" type="button">This Month</button>
    </div>
    <div class="row">
      <select id="payFilterBorrower"><option value="">All borrowers</option></select>
      <select id="payFilterLoan"><option value="">All loans</option></select>
    </div>
  `;
  paymentList.parentElement.insertBefore(box, paymentList);

  qs("payFilterActive").onclick = () => setFilter("active");
  qs("payFilterAll").onclick = () => setFilter("all");
  qs("payFilterVoided").onclick = () => setFilter("voided");
  qs("payFilterMonth").onclick = () => setFilter("month");
  qs("payFilterBorrower").onchange = () => renderPayments(true);
  qs("payFilterLoan").onchange = () => renderPayments(true);
}

async function populatePaymentFilterDropdowns() {
  if (!qs("payFilterBorrower") || qs("payFilterBorrower").dataset.loaded === "true") return;

  const [borrowerRes, loanRes] = await Promise.all([
    supabase.from("borrowers").select("id, full_name").order("full_name", { ascending: true }),
    supabase.from("loans").select("id, borrowers(full_name)").order("created_at", { ascending: false }),
  ]);

  if (!borrowerRes.error) {
    qs("payFilterBorrower").innerHTML = `<option value="">All borrowers</option>${(borrowerRes.data || []).map((b) => `<option value="${b.id}">${b.full_name}</option>`).join("")}`;
  }

  if (!loanRes.error) {
    qs("payFilterLoan").innerHTML = `<option value="">All loans</option>${(loanRes.data || []).map((l) => `<option value="${l.id}">${l.borrowers?.full_name || "Unknown"} (${String(l.id).slice(0, 6)}…)</option>`).join("")}`;
  }

  qs("payFilterBorrower").dataset.loaded = "true";
}

function setFilter(next) {
  paymentFilter = next;
  localStorage.setItem("loanLedger.paymentFilter", next);
  detailOpen = false;
  activePaymentId = null;
  renderPayments(true);
}

function updateFilterButtons() {
  const buttons = {
    active: qs("payFilterActive"),
    all: qs("payFilterAll"),
    voided: qs("payFilterVoided"),
    month: qs("payFilterMonth"),
  };
  Object.entries(buttons).forEach(([key, btn]) => {
    if (!btn) return;
    btn.style.background = paymentFilter === key ? "#2b63ff" : "#333";
  });
}

function filterPayments(rows) {
  const borrowerId = qs("payFilterBorrower")?.value || "";
  const loanId = qs("payFilterLoan")?.value || "";
  const monthPrefix = new Date().toISOString().slice(0, 7);

  return rows.filter((p) => {
    if (borrowerId && p.borrower_id !== borrowerId) return false;
    if (loanId && p.loan_id !== loanId) return false;
    if (paymentFilter === "active" && p.is_voided) return false;
    if (paymentFilter === "voided" && !p.is_voided) return false;
    if (paymentFilter === "month" && String(p.paid_on || "").slice(0, 7) !== monthPrefix) return false;
    return true;
  });
}

async function renderPayments(force = false) {
  if (!isPaymentsPage() || !qs("paymentList") || paymentBusy) return;
  if (detailOpen && !force) return;

  ensurePaymentFilterControls();
  await populatePaymentFilterDropdowns();
  updateFilterButtons();

  const stamp = `${paymentFilter}:${qs("payFilterBorrower")?.value || ""}:${qs("payFilterLoan")?.value || ""}:${Date.now() - (Date.now() % 3000)}`;
  if (!force && qs("paymentList").dataset.paymentStamp === stamp) return;

  paymentBusy = true;
  try {
    const { data, error } = await supabase
      .from("payment_detail_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = filterPayments(data || []);
    qs("paymentList").dataset.paymentStamp = stamp;
    qs("paymentList").innerHTML = rows.length ? rows.map((p) => clickableCard(`
      <strong>${p.borrower_name || "Unknown"}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br>
      <span class="muted">Paid: ${p.paid_on} | Interest: ${money(p.applied_interest)} | Principal: ${money(p.applied_principal)}</span><br>
      <span class="muted">Mgmt: ${money(p.applied_mgmt)} | Funders: ${money(p.applied_funders)} | Click for details</span>
    `, `data-payment-id="${p.id}"`)).join("") : "No payments match this view.";

    document.querySelectorAll("[data-payment-id]").forEach((el) => {
      el.onclick = () => openPaymentDetails(el.dataset.paymentId);
    });
  } catch (error) {
    console.error(error);
    qs("paymentList").innerHTML = error.message || String(error);
  } finally {
    paymentBusy = false;
  }
}

async function openPaymentDetails(paymentId) {
  activePaymentId = paymentId;
  detailOpen = true;

  const list = qs("paymentList");
  if (!list) return;
  list.innerHTML = card(`<strong>Payment Details</strong><br><span class="muted">Loading...</span>`);

  try {
    const [paymentRes, applicationsRes, allocationsRes] = await Promise.all([
      supabase.from("payment_detail_view").select("*").eq("id", paymentId).single(),
      supabase.from("payment_due_applications").select("applied_total, applied_mgmt, applied_funders, loan_due_events(due_date, status)").eq("payment_id", paymentId),
      supabase.from("payment_allocations").select("allocation_type, amount, profiles(full_name, role)").eq("payment_id", paymentId),
    ]);

    if (paymentRes.error) throw paymentRes.error;
    if (applicationsRes.error) throw applicationsRes.error;
    if (allocationsRes.error) throw allocationsRes.error;

    const p = paymentRes.data;
    const apps = applicationsRes.data || [];
    const allocations = allocationsRes.data || [];

    list.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-weight:800;">Payment Details</div>
          <button id="btnBackToPayments" type="button" style="width:auto;background:#333;padding:10px 14px;">Back</button>
        </div>
        <div style="margin-top:12px;">
          <strong>${p.borrower_name || "Unknown"}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br>
          <span class="muted">Paid on: ${p.paid_on} | Loan: ${String(p.loan_id).slice(0, 8)} | Loan status: ${p.loan_status || "—"}</span><br>
          <span class="muted">Interest: ${money(p.applied_interest)} | Mgmt: ${money(p.applied_mgmt)} | Funders: ${money(p.applied_funders)} | Principal: ${money(p.applied_principal)}</span>
          ${p.void_reason ? `<br><span class="muted">Void reason: ${p.void_reason}</span>` : ""}
        </div>
      </div>

      <div class="card">
        <div style="font-weight:800;">Payment Notes</div>
        <input id="paymentDetailNotes" value="${p.notes || ""}" placeholder="Payment notes" ${p.is_voided ? "disabled" : ""} />
        <button id="btnSavePaymentNotes" type="button" ${p.is_voided ? "disabled" : ""}>Save Notes</button>
      </div>

      <div class="card">
        <div style="font-weight:800;">Due Events Paid</div>
        ${apps.length ? apps.map((a) => card(`
          <strong>${a.loan_due_events?.due_date || "Due event"}</strong><br>
          <span class="muted">Total: ${money(a.applied_total)} | Mgmt: ${money(a.applied_mgmt)} | Funders: ${money(a.applied_funders)} | ${a.loan_due_events?.status || "—"}</span>
        `)).join("") : "No due-event applications. This may have gone fully to principal or be an older payment."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Partner Allocations</div>
        ${allocations.length ? allocations.map((a) => card(`
          <strong>${a.profiles?.full_name || "Unknown"}</strong> — ${money(a.amount)}<br>
          <span class="muted">${a.allocation_type} | ${a.profiles?.role || "—"}</span>
        `)).join("") : "No allocations."}
      </div>

      <div class="card">
        <div style="font-weight:800;">Actions</div>
        <button id="btnVoidPaymentDetail" type="button" style="background:#7a2b2b;" ${p.is_voided ? "disabled" : ""}>Void Payment</button>
        <div id="paymentActionStatus" class="muted" style="margin-top:8px;"></div>
      </div>
    `;

    qs("btnBackToPayments").onclick = () => {
      detailOpen = false;
      activePaymentId = null;
      renderPayments(true);
    };

    qs("btnSavePaymentNotes").onclick = async () => {
      const notes = qs("paymentDetailNotes").value;
      setStatus("Saving notes...");
      const { error } = await supabase.rpc("update_payment_notes", {
        p_payment_id: paymentId,
        p_notes: notes,
      });
      if (error) return alert(error.message);
      setStatus("Notes saved.");
      alert("Payment notes saved.");
    };

    qs("btnVoidPaymentDetail").onclick = async () => {
      const reason = prompt("Reason for voiding this payment:", "Entered incorrectly");
      if (reason === null) return;
      if (reason.trim().length < 3) return alert("Void reason is required.");
      if (!confirm("Void this payment and reverse due totals, principal, and allocations?")) return;

      setStatus("Voiding payment...");
      const { error } = await supabase.rpc("void_payment", {
        p_payment_id: paymentId,
        p_reason: reason,
      });
      if (error) return alert(error.message);

      setStatus("Payment voided.");
      alert("Payment voided and reversed.");
      await openPaymentDetails(paymentId);
    };
  } catch (error) {
    console.error(error);
    list.innerHTML = card(`<strong>Payment Details</strong><br><span class="muted">${error.message || String(error)}</span><br><button id="btnBackToPayments" type="button">Back</button>`);
    qs("btnBackToPayments").onclick = () => {
      detailOpen = false;
      activePaymentId = null;
      renderPayments(true);
    };
  }
}

async function renderRiskDashboard() {
  if (!isDashboardPage() || qs("riskDashboardBox")) return;
  const target = qs("dashboardLoansSnapshot")?.parentElement;
  if (!target) return;

  const box = document.createElement("div");
  box.id = "riskDashboardBox";
  box.className = "card";
  box.innerHTML = `<div style="font-weight:800;">Borrower Risk</div><div id="riskDashboardList" class="muted">Loading...</div>`;
  target.insertAdjacentElement("afterend", box);

  const { data, error } = await supabase
    .from("borrower_risk_summary")
    .select("*")
    .order("overdue_amount", { ascending: false })
    .limit(5);

  if (error) {
    qs("riskDashboardList").textContent = error.message;
    return;
  }

  const risky = (data || []).filter((b) => Number(b.overdue_amount || 0) > 0 || Number(b.total_outstanding || 0) > 0);
  qs("riskDashboardList").innerHTML = risky.length ? risky.map((b) => `
    <div style="margin:8px 0;">
      <strong>${b.full_name}</strong> — ${b.risk_status}<br>
      <span class="muted">Outstanding: ${money(b.total_outstanding)} | Overdue: ${money(b.overdue_amount)} | Days late: ${b.max_days_late || 0} | Last payment: ${b.last_payment_date || "—"}</span>
    </div>
  `).join("") : "No borrower risk yet.";
}

async function renderBorrowerRiskDetails() {
  if (!isBorrowerDetailsPage() || qs("borrowerRiskBox")) return;
  const header = qs("borrowerDetailsHeader");
  if (!header) return;

  const nameMatch = header.textContent.match(/Name:\s*([^\n]+)/i);
  const borrowerName = nameMatch?.[1]?.trim();
  if (!borrowerName) return;

  const box = document.createElement("div");
  box.id = "borrowerRiskBox";
  box.className = "card";
  box.innerHTML = `<div style="font-weight:800;">Risk / Late Summary</div><div id="borrowerRiskContent" class="muted">Loading...</div>`;
  header.parentElement.insertAdjacentElement("afterend", box);

  const { data, error } = await supabase
    .from("borrower_risk_summary")
    .select("*")
    .eq("full_name", borrowerName)
    .limit(1);

  if (error) {
    qs("borrowerRiskContent").textContent = error.message;
    return;
  }

  const b = data?.[0];
  qs("borrowerRiskContent").innerHTML = b ? `
    <div><strong>Status:</strong> ${b.risk_status}</div>
    <div><strong>Total outstanding:</strong> ${money(b.total_outstanding)}</div>
    <div><strong>Overdue amount:</strong> ${money(b.overdue_amount)}</div>
    <div><strong>Overdue count:</strong> ${b.overdue_count}</div>
    <div><strong>Days late:</strong> ${b.max_days_late || 0}</div>
    <div><strong>Last payment:</strong> ${b.last_payment_date || "—"}</div>
  ` : "No risk data found.";
}

async function tick() {
  try {
    if (isPaymentsPage()) await renderPayments();
    if (isDashboardPage()) await renderRiskDashboard();
    if (isBorrowerDetailsPage()) await renderBorrowerRiskDetails();
  } catch (error) {
    console.error(error);
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(tick, 200);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 1200);
tick();
