import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient("https://eatxkhhpjruwwibhcubf.supabase.co", "sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: "loan-ledger-auth" },
});

const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
let mode = localStorage.getItem("loanLedger.preferredLoanView") || "borrower";
let busy = false;

function isLoansPage() {
  return qs("loansPage")?.classList.contains("active-page");
}

function pageTo(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
}

function removeOldToggle() {
  qs("btnLoansByBorrower")?.closest(".view-toggle")?.remove();
}

function ensureNewToggle() {
  const list = qs("loanList");
  if (!list) return;

  if (!qs("loanViewToggle")) {
    const box = document.createElement("div");
    box.id = "loanViewToggle";
    box.className = "card";
    box.innerHTML = `
      <div style="font-weight:800;">Loan View</div>
      <div class="row">
        <button id="loanViewBorrowerNew" type="button">By Borrower</button>
        <button id="loanViewLoanNew" type="button">By Loan</button>
      </div>
    `;
    list.parentElement.insertBefore(box, list);
    qs("loanViewBorrowerNew").onclick = () => { mode = "borrower"; localStorage.setItem("loanLedger.preferredLoanView", mode); render(true); };
    qs("loanViewLoanNew").onclick = () => { mode = "loan"; localStorage.setItem("loanLedger.preferredLoanView", mode); render(true); };
  }

  qs("loanViewBorrowerNew")?.classList.toggle("active", mode === "borrower");
  qs("loanViewLoanNew")?.classList.toggle("active", mode === "loan");
  qs("loanViewBorrowerNew")?.style.setProperty("background", mode === "borrower" ? "#2b63ff" : "#333");
  qs("loanViewLoanNew")?.style.setProperty("background", mode === "loan" ? "#2b63ff" : "#333");
}

function miniCard(html, attrs = "") {
  return `<div class="card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;cursor:pointer;box-sizing:border-box;">${html}</div>`;
}

async function render(force = false) {
  if (!isLoansPage() || busy || !qs("loanList")) return;
  removeOldToggle();
  ensureNewToggle();
  if (!force && qs("loanList").dataset.loanViewFixMode === mode) return;

  busy = true;
  try {
    if (mode === "loan") await renderByLoan();
    else await renderByBorrower();
    qs("loanList").dataset.loanViewFixMode = mode;
  } finally {
    busy = false;
  }
}

async function renderByBorrower() {
  const [{ data: borrowers, error: bErr }, { data: loans, error: lErr }] = await Promise.all([
    supabase.from("borrower_loan_summary").select("*"),
    supabase.from("loans").select("id, borrower_id, start_date, principal_original, principal_outstanding, status, created_at").order("created_at", { ascending: false }),
  ]);
  if (bErr || lErr) throw (bErr || lErr);

  const byBorrower = new Map();
  (loans || []).forEach((loan) => {
    if (!byBorrower.has(loan.borrower_id)) byBorrower.set(loan.borrower_id, []);
    byBorrower.get(loan.borrower_id).push(loan);
  });

  qs("loanList").innerHTML = (borrowers || []).map((b) => {
    const recent = (byBorrower.get(b.borrower_id) || []).slice(0, 3);
    return miniCard(`
      <strong>${b.full_name}</strong><br>
      <span class="muted">${b.phone || "No phone"}</span><br>
      <span class="muted">Loans: ${b.loan_count} | Active: ${b.active_loan_count} | Outstanding: ${money(b.total_outstanding)} | Original: ${money(b.total_original)}</span>
      <div style="margin-top:8px;">
        ${recent.map((l) => `<div style="padding:8px 0;border-top:1px solid #222;"><span class="muted">${l.start_date} | ${l.status} | Balance ${money(l.principal_outstanding)} | Original ${money(l.principal_original)}</span></div>`).join("") || `<span class="muted">No loans yet.</span>`}
      </div>
      <div class="muted" style="margin-top:8px;">Click to open borrower details.</div>
    `, `data-new-borrower-card="${b.borrower_id}"`);
  }).join("") || "No borrowers yet.";

  document.querySelectorAll("[data-new-borrower-card]").forEach((el) => {
    el.onclick = () => openBorrower(el.dataset.newBorrowerCard);
  });
}

async function renderByLoan() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, status, borrowers(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  qs("loanList").innerHTML = (data || []).map((l) => miniCard(`
    <strong>${l.borrowers?.full_name || "Unknown"}</strong><br>
    <span class="muted">${l.start_date} | ${l.status}</span><br>
    <span class="muted">Balance: ${money(l.principal_outstanding)} | Original: ${money(l.principal_original)}</span>
    <div class="muted" style="margin-top:8px;">Click to open loan details.</div>
  `, `data-new-loan-card="${l.id}"`)).join("") || "No loans yet.";

  document.querySelectorAll("[data-new-loan-card]").forEach((el) => {
    el.onclick = () => openLoan(el.dataset.newLoanCard);
  });
}

async function openBorrower(id) {
  const [b, loans, payments] = await Promise.all([
    supabase.from("borrowers").select("*").eq("id", id).single(),
    supabase.from("loans").select("id,start_date,principal_original,principal_outstanding,status").eq("borrower_id", id).order("created_at", { ascending: false }),
    supabase.from("payments").select("paid_on,amount,applied_interest,applied_principal,is_voided,notes").eq("borrower_id", id).order("paid_on", { ascending: false }),
  ]);
  if (b.error || loans.error || payments.error) return alert((b.error || loans.error || payments.error).message);

  const totalBorrowed = (loans.data || []).reduce((s, l) => s + Number(l.principal_original || 0), 0);
  const totalOutstanding = (loans.data || []).reduce((s, l) => s + Number(l.principal_outstanding || 0), 0);
  const totalPaid = (payments.data || []).filter((p) => !p.is_voided).reduce((s, p) => s + Number(p.amount || 0), 0);

  qs("borrowerDetailsHeader").innerHTML = `<div><strong>Name:</strong> ${b.data.full_name}</div><div><strong>Phone:</strong> ${b.data.phone || "—"}</div><div><strong>Notes:</strong> ${b.data.notes || "—"}</div><div><strong>Total Borrowed:</strong> ${money(totalBorrowed)}</div><div><strong>Total Outstanding:</strong> ${money(totalOutstanding)}</div><div><strong>Total Paid:</strong> ${money(totalPaid)}</div>`;
  qs("borrowerDetailsLoans").innerHTML = (loans.data || []).map((l) => miniCard(`<strong>${l.start_date}</strong><br><span class="muted">${l.status} | Original ${money(l.principal_original)} | Balance ${money(l.principal_outstanding)}</span>`)).join("") || "No loans yet.";
  qs("borrowerDetailsPayments").innerHTML = (payments.data || []).map((p) => miniCard(`<strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br><span class="muted">Interest ${money(p.applied_interest)} | Principal ${money(p.applied_principal)} ${p.notes ? `| ${p.notes}` : ""}</span>`)).join("") || "No payments yet.";
  pageTo("borrowerDetailsPage");
}

async function openLoan(id) {
  const [loan, due, payments] = await Promise.all([
    supabase.from("loans").select("id,start_date,principal_original,principal_outstanding,status,monthly_rate_total,monthly_rate_mgmt,borrowers(full_name)").eq("id", id).single(),
    supabase.from("loan_due_events").select("due_date,expected_total,paid_total,status").eq("loan_id", id).order("due_date", { ascending: true }),
    supabase.from("payments").select("paid_on,amount,applied_interest,applied_principal,is_voided,notes").eq("loan_id", id).order("paid_on", { ascending: false }),
  ]);
  if (loan.error || due.error || payments.error) return alert((loan.error || due.error || payments.error).message);

  qs("loanDetailsHeader").innerHTML = `<div><strong>Borrower:</strong> ${loan.data.borrowers?.full_name || "Unknown"}</div><div><strong>Start Date:</strong> ${loan.data.start_date}</div><div><strong>Original Principal:</strong> ${money(loan.data.principal_original)}</div><div><strong>Outstanding:</strong> ${money(loan.data.principal_outstanding)}</div><div><strong>Total Monthly Interest:</strong> ${(Number(loan.data.monthly_rate_total || 0) * 100).toFixed(2)}%</div><div><strong>Management Share:</strong> ${(Number(loan.data.monthly_rate_mgmt || 0) * 100).toFixed(2)}%</div><div><strong>Status:</strong> ${loan.data.status}</div>`;
  qs("loanDetailsDueList").innerHTML = (due.data || []).map((d) => miniCard(`<strong>${d.due_date}</strong><br><span class="muted">Expected ${money(d.expected_total)} | Paid ${money(d.paid_total)} | Remaining ${money(Number(d.expected_total || 0) - Number(d.paid_total || 0))} | ${d.status}</span>`)).join("") || "No due events yet.";
  qs("loanDetailsPaymentList").innerHTML = (payments.data || []).map((p) => miniCard(`<strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br><span class="muted">Interest ${money(p.applied_interest)} | Principal ${money(p.applied_principal)} ${p.notes ? `| ${p.notes}` : ""}</span>`)).join("") || "No payments yet.";
  pageTo("loanDetailsPage");
}

async function renderPartnersPage({ force = false } = {}) {
  if (!activePage("partnersPage") || !qs("partnersPage") || partnersRenderInFlight) return;
  const page = qs("partnersPage");
  if (!force && page.dataset.workflowLoaded === "true") return;

  partnersRenderInFlight = true;
  try {
    const { data, error } = await supabase.from("partner_earnings_summary").select("*");
    if (error) throw error;

    page.dataset.workflowLoaded = "true";
    page.innerHTML = `
      <div class="card">
        <div style="font-weight:800;">Partner Earnings</div>
        <div class="muted">Based on non-voided payment allocations.</div>
        ${(data ?? []).length ? (data ?? []).map((p) => card(`
          <strong>${p.partner_name || "Unnamed"}</strong> <span class="muted">(${p.role})</span><br>
          <span class="muted">Total earned: ${money(p.total_earned)} | Management: ${money(p.management_earned)} | Funders: ${money(p.funder_earned)} | Allocations: ${p.allocation_count ?? 0}</span>
        `)).join("") : "No partner earnings yet."}
      </div>
    `;
  } finally {
    partnersRenderInFlight = false;
  }
}

async function refreshWorkflowEnhancements() {
  try {
    ensureStyles();
    removeOldToggle();
    ensureDefaultsSaveHandler();
    await refreshDefaultsUI();
    if (activePage("loansPage")) {
      ensureNewToggle();
      await render();
    }
    if (activePage("partnersPage")) await renderPartnersPage();
  } catch (error) {
    console.error(error);
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(workflowTimer);
  workflowTimer = setTimeout(refreshWorkflowEnhancements, 250);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(refreshWorkflowEnhancements, 900);
refreshWorkflowEnhancements();
