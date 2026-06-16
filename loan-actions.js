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
let activeLoanId = null;
let busy = false;
let renderTimer = null;

function isLoanDetailsPage() {
  return qs("loanDetailsPage")?.classList.contains("active-page");
}

function setActiveLoanFromEvent(event) {
  const loanCard = event.target.closest("[data-loan-id], [data-new-loan-card]");
  const id = loanCard?.dataset?.loanId || loanCard?.dataset?.newLoanCard;
  if (id) activeLoanId = id;
}

document.addEventListener("click", setActiveLoanFromEvent, true);

function pageTo(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
}

async function loadLoan(loanId) {
  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, monthly_rate_total, monthly_rate_mgmt, status, notes, closed_at, void_reason, borrowers(full_name)")
    .eq("id", loanId)
    .single();

  if (error) throw error;
  return data;
}

async function refreshLoanDetailsView(loanId) {
  const [loanRes, dueRes, paymentRes] = await Promise.all([
    supabase
      .from("loans")
      .select("id, start_date, principal_original, principal_outstanding, status, monthly_rate_total, monthly_rate_mgmt, notes, closed_at, void_reason, borrowers(full_name)")
      .eq("id", loanId)
      .single(),
    supabase
      .from("loan_due_events")
      .select("due_date, expected_total, paid_total, status")
      .eq("loan_id", loanId)
      .order("due_date", { ascending: true }),
    supabase
      .from("payments")
      .select("paid_on, amount, applied_interest, applied_mgmt, applied_funders, applied_principal, is_voided, notes")
      .eq("loan_id", loanId)
      .order("paid_on", { ascending: false }),
  ]);

  if (loanRes.error) throw loanRes.error;
  if (dueRes.error) throw dueRes.error;
  if (paymentRes.error) throw paymentRes.error;

  const loan = loanRes.data;
  qs("loanDetailsHeader").innerHTML = `
    <div><strong>Borrower:</strong> ${loan.borrowers?.full_name ?? "Unknown"}</div>
    <div><strong>Start Date:</strong> ${loan.start_date}</div>
    <div><strong>Original Principal:</strong> ${money(loan.principal_original)}</div>
    <div><strong>Outstanding:</strong> ${money(loan.principal_outstanding)}</div>
    <div><strong>Total Monthly Interest:</strong> ${(Number(loan.monthly_rate_total || 0) * 100).toFixed(2)}%</div>
    <div><strong>Management Share:</strong> ${(Number(loan.monthly_rate_mgmt || 0) * 100).toFixed(2)}%</div>
    <div><strong>Status:</strong> ${loan.status}</div>
    ${loan.closed_at ? `<div><strong>Closed:</strong> ${new Date(loan.closed_at).toLocaleString()}</div>` : ""}
    ${loan.notes ? `<div><strong>Notes:</strong> ${loan.notes}</div>` : ""}
    ${loan.void_reason ? `<div><strong>Void reason:</strong> ${loan.void_reason}</div>` : ""}
  `;

  const today = new Date().toISOString().slice(0, 10);
  qs("loanDetailsDueList").innerHTML = (dueRes.data || []).length
    ? dueRes.data.map((d) => {
        const remaining = Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0));
        const overdue = d.due_date < today && remaining > 0 && !["PAID", "CANCELLED"].includes(d.status);
        return `
          <div class="compact-card" style="background:#0f0f11;border:1px solid ${overdue ? "#7a2b2b" : "#2a2a2e"};border-radius:12px;padding:10px;margin:8px 0;">
            <strong>${d.due_date}</strong> ${overdue ? "— OVERDUE" : ""}<br>
            <span class="muted">Expected: ${money(d.expected_total)} | Paid: ${money(d.paid_total)} | Remaining: ${money(remaining)} | ${d.status}</span>
          </div>
        `;
      }).join("")
    : "No due events yet.";

  qs("loanDetailsPaymentList").innerHTML = (paymentRes.data || []).length
    ? paymentRes.data.map((p) => `
        <div class="compact-card" style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:10px;margin:8px 0;">
          <strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br>
          <span class="muted">Interest: ${money(p.applied_interest)} | Mgmt: ${money(p.applied_mgmt)} | Funders: ${money(p.applied_funders)} | Principal: ${money(p.applied_principal)}${p.notes ? ` | ${p.notes}` : ""}</span>
        </div>
      `).join("")
    : "No payments yet.";
}

function removeOlderInjectedPanels() {
  qs("loanEditBox")?.remove();
  qs("dueExtensionBox")?.remove();
}

async function ensureLoanActionPanel() {
  if (!isLoanDetailsPage() || busy || !qs("loanDetailsHeader")) return;

  removeOlderInjectedPanels();

  if (!activeLoanId) {
    if (!qs("loanActionsPanel")) {
      const panel = document.createElement("div");
      panel.id = "loanActionsPanel";
      panel.className = "card";
      panel.innerHTML = `<div style="font-weight:800;">Loan Actions</div><div class="muted">Open a loan from the Loans page to use actions.</div>`;
      qs("loanDetailsHeader").parentElement.insertAdjacentElement("afterend", panel);
    }
    return;
  }

  if (qs("loanActionsPanel")?.dataset.loanId === activeLoanId) return;

  busy = true;
  try {
    const loan = await loadLoan(activeLoanId);

    qs("loanActionsPanel")?.remove();

    const closed = ["PAID_OFF", "CLOSED", "VOIDED"].includes(loan.status);
    const panel = document.createElement("div");
    panel.id = "loanActionsPanel";
    panel.dataset.loanId = activeLoanId;
    panel.className = "card";
    panel.innerHTML = `
      <div style="font-weight:800;">Loan Actions</div>
      <div class="muted">Edit loan info, manage due dates, and close or void the loan.</div>

      <div style="margin-top:12px;font-weight:800;">Edit Loan</div>
      <div class="row">
        <input id="actionLoanStartDate" type="date" value="${loan.start_date || ""}" />
        <select id="actionLoanStatus">
          ${["ACTIVE", "PAUSED", "DEFAULTED", "PAID_OFF", "CLOSED", "VOIDED"].map((s) => `<option value="${s}" ${loan.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="row">
        <input id="actionLoanOriginal" type="number" step="0.01" value="${Number(loan.principal_original || 0).toFixed(2)}" placeholder="Original principal" />
        <input id="actionLoanOutstanding" type="number" step="0.01" value="${Number(loan.principal_outstanding || 0).toFixed(2)}" placeholder="Outstanding principal" />
      </div>
      <div class="row">
        <input id="actionLoanTotalRate" type="number" step="0.01" value="${(Number(loan.monthly_rate_total || 0) * 100).toFixed(2)}" placeholder="Total monthly interest %" />
        <input id="actionLoanMgmtRate" type="number" step="0.01" value="${(Number(loan.monthly_rate_mgmt || 0) * 100).toFixed(2)}" placeholder="Management share %" />
      </div>
      <input id="actionLoanNotes" value="${loan.notes || ""}" placeholder="Loan notes" />
      <button id="btnSaveLoanActionEdit" type="button">Save Loan Changes</button>

      <div style="margin-top:16px;font-weight:800;">Due Schedule</div>
      <div class="row">
        <button id="btnAdd6DueMonths" type="button" ${closed ? "disabled" : ""}>Add Next 6 Months</button>
        <button id="btnAdd12DueMonths" type="button" ${closed ? "disabled" : ""}>Add Next 12 Months</button>
      </div>
      <button id="btnRegenerateFutureDue" type="button" ${closed ? "disabled" : ""}>Regenerate Future Unpaid Due Dates</button>

      <div style="margin-top:16px;font-weight:800;">Close / Void</div>
      <div class="row">
        <button id="btnMarkPaidOff" type="button" style="background:#2f6d3b;" ${loan.status === "PAID_OFF" ? "disabled" : ""}>Mark Paid Off</button>
        <button id="btnCloseLoan" type="button" style="background:#555;" ${loan.status === "CLOSED" ? "disabled" : ""}>Close Loan</button>
      </div>
      <button id="btnVoidLoan" type="button" style="background:#7a2b2b;" ${loan.status === "VOIDED" ? "disabled" : ""}>Void Loan</button>
      <div id="loanActionStatus" class="muted" style="margin-top:8px;"></div>
    `;

    qs("loanDetailsHeader").parentElement.insertAdjacentElement("afterend", panel);

    qs("btnSaveLoanActionEdit").onclick = saveLoanChanges;
    qs("btnAdd6DueMonths").onclick = () => addDueMonths(6);
    qs("btnAdd12DueMonths").onclick = () => addDueMonths(12);
    qs("btnRegenerateFutureDue").onclick = regenerateFutureDue;
    qs("btnMarkPaidOff").onclick = markPaidOff;
    qs("btnCloseLoan").onclick = closeLoan;
    qs("btnVoidLoan").onclick = voidLoan;
  } catch (error) {
    console.error(error);
  } finally {
    busy = false;
  }
}

function status(msg) {
  const el = qs("loanActionStatus");
  if (el) el.textContent = msg;
}

function validateEditFields() {
  const original = Number(qs("actionLoanOriginal")?.value || 0);
  const outstanding = Number(qs("actionLoanOutstanding")?.value || 0);
  const totalRate = Number(qs("actionLoanTotalRate")?.value || 0);
  const mgmtRate = Number(qs("actionLoanMgmtRate")?.value || 0);
  const startDate = qs("actionLoanStartDate")?.value;

  if (!startDate) return "Start date is required.";
  if (original < 0 || outstanding < 0) return "Principal values cannot be negative.";
  if (totalRate < 0 || mgmtRate < 0) return "Rates cannot be negative.";
  if (mgmtRate > totalRate) return "Management share cannot be higher than total monthly interest.";
  return null;
}

async function afterAction(message) {
  status(message);
  await refreshLoanDetailsView(activeLoanId);
  qs("loanActionsPanel")?.remove();
  await ensureLoanActionPanel();
}

async function saveLoanChanges() {
  try {
    const validation = validateEditFields();
    if (validation) return alert(validation);

    status("Saving loan changes...");
    const { error } = await supabase.rpc("update_loan_details_v2", {
      p_loan_id: activeLoanId,
      p_start_date: qs("actionLoanStartDate").value,
      p_principal_original: Number(qs("actionLoanOriginal").value),
      p_principal_outstanding: Number(qs("actionLoanOutstanding").value),
      p_monthly_rate_total: Number(qs("actionLoanTotalRate").value) / 100,
      p_monthly_rate_mgmt: Number(qs("actionLoanMgmtRate").value) / 100,
      p_status: qs("actionLoanStatus").value,
      p_notes: qs("actionLoanNotes").value,
    });
    if (error) throw error;
    await afterAction("Loan updated.");
    alert("Loan updated.");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

async function addDueMonths(months) {
  try {
    status(`Adding next ${months} months...`);
    const { data, error } = await supabase.rpc("generate_loan_due_events", {
      p_loan_id: activeLoanId,
      p_months_ahead: months,
    });
    if (error) throw error;
    await afterAction(`Added ${data ?? 0} due date(s).`);
    alert(`Added ${data ?? 0} due date(s).`);
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

async function regenerateFutureDue() {
  try {
    if (!confirm("Regenerate future unpaid due dates? This deletes future unpaid DUE rows and recreates them from the current balance/rates.")) return;
    status("Regenerating future due dates...");
    const { data, error } = await supabase.rpc("regenerate_future_due_events", {
      p_loan_id: activeLoanId,
      p_months_ahead: 6,
    });
    if (error) throw error;
    await afterAction(`Regenerated ${data ?? 0} due date(s).`);
    alert(`Regenerated ${data ?? 0} due date(s).`);
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

async function markPaidOff() {
  try {
    if (!confirm("Mark this loan as PAID_OFF and cancel unpaid due dates?")) return;
    status("Marking paid off...");
    const { error } = await supabase.rpc("mark_loan_paid_off", { p_loan_id: activeLoanId });
    if (error) throw error;
    await afterAction("Loan marked paid off.");
    alert("Loan marked paid off.");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

async function closeLoan() {
  try {
    const reason = prompt("Reason / note for closing this loan:", "Closed manually");
    if (reason === null) return;
    if (!confirm("Close this loan and cancel unpaid due dates?")) return;
    status("Closing loan...");
    const { error } = await supabase.rpc("close_loan", {
      p_loan_id: activeLoanId,
      p_reason: reason,
    });
    if (error) throw error;
    await afterAction("Loan closed.");
    alert("Loan closed.");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

async function voidLoan() {
  try {
    const reason = prompt("Reason for voiding this loan:", "Created by mistake");
    if (reason === null) return;
    if (reason.trim().length < 3) return alert("Void reason is required.");
    if (!confirm("VOID this loan? This sets balance to $0 and cancels open due dates. This is Admin-only.")) return;
    status("Voiding loan...");
    const { error } = await supabase.rpc("void_loan", {
      p_loan_id: activeLoanId,
      p_reason: reason,
    });
    if (error) throw error;
    await afterAction("Loan voided.");
    alert("Loan voided.");
  } catch (error) {
    console.error(error);
    alert(error.message || String(error));
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(ensureLoanActionPanel, 150);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(ensureLoanActionPanel, 1200);
ensureLoanActionPanel();
