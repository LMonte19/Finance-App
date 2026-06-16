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

    qs("loanViewBorrowerNew").onclick = () => {
      mode = "borrower";
      localStorage.setItem("loanLedger.preferredLoanView", mode);
      render(true);
    };

    qs("loanViewLoanNew").onclick = () => {
      mode = "loan";
      localStorage.setItem("loanLedger.preferredLoanView", mode);
      render(true);
    };
  }

  qs("loanViewBorrowerNew")?.style.setProperty("background", mode === "borrower" ? "#2b63ff" : "#333");
  qs("loanViewLoanNew")?.style.setProperty("background", mode === "loan" ? "#2b63ff" : "#333");
}

function card(html, attrs = "") {
  return `<div class="card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;cursor:pointer;box-sizing:border-box;">${html}</div>`;
}

function compact(html) {
  return `<div class="compact-card" style="margin-top:8px;">${html}</div>`;
}

function dueRemaining(due) {
  if (!due) return 0;
  return Math.max(0, Number(due.expected_total || 0) - Number(due.paid_total || 0));
}

function dueLabel(due) {
  if (!due?.due_date || dueRemaining(due) <= 0) return "CURRENT";
  if (due.due_date < todayIso()) return "OVERDUE";
  if (due.due_date === todayIso()) return "DUE TODAY";
  return "CURRENT";
}

function firstOpenDue(dueRows = []) {
  return dueRows
    .filter((d) => dueRemaining(d) > 0)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0] || null;
}

async function getLoanData() {
  const [{ data: loans, error: loanErr }, { data: dueRows, error: dueErr }] = await Promise.all([
    supabase
      .from("loans")
      .select("id, borrower_id, start_date, principal_original, principal_outstanding, status, created_at, borrowers(full_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("loan_due_events")
      .select("loan_id, due_date, expected_total, paid_total, status")
      .in("status", ["DUE", "PARTIAL"])
      .order("due_date", { ascending: true }),
  ]);

  if (loanErr) throw loanErr;
  if (dueErr) throw dueErr;

  const dueByLoan = new Map();
  (dueRows || []).forEach((d) => {
    if (!dueByLoan.has(d.loan_id)) dueByLoan.set(d.loan_id, []);
    dueByLoan.get(d.loan_id).push(d);
  });

  const enrichedLoans = (loans || []).map((loan) => {
    const openDueRows = dueByLoan.get(loan.id) || [];
    return { ...loan, openDueRows, nextDue: firstOpenDue(openDueRows) };
  });

  return enrichedLoans;
}

async function render(force = false) {
  if (!isLoansPage() || busy || !qs("loanList")) return;

  removeOldToggle();
  ensureNewToggle();

  const currentKey = `${mode}:${Date.now() - (Date.now() % 3000)}`;
  if (!force && qs("loanList").dataset.loanViewFixMode === currentKey) return;

  busy = true;
  try {
    const loans = await getLoanData();
    if (mode === "loan") renderByLoan(loans);
    else renderByBorrower(loans);
    qs("loanList").dataset.loanViewFixMode = currentKey;
  } finally {
    busy = false;
  }
}

function renderByBorrower(loans) {
  const groups = new Map();

  loans.forEach((loan) => {
    const key = loan.borrower_id || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        borrower_id: key,
        name: loan.borrowers?.full_name || "Unknown",
        loans: [],
      });
    }
    groups.get(key).loans.push(loan);
  });

  const html = Array.from(groups.values()).map((group) => {
    const totalOutstanding = group.loans.reduce((sum, loan) => sum + Number(loan.principal_outstanding || 0), 0);
    const activeLoans = group.loans.filter((loan) => loan.status === "ACTIVE").length;

    const allDueRows = group.loans.flatMap((loan) => loan.openDueRows || []);
    const nextDue = firstOpenDue(allDueRows);
    const overdueAmount = allDueRows.reduce((sum, due) => {
      return due.due_date < todayIso() ? sum + dueRemaining(due) : sum;
    }, 0);

    const preview = group.loans.slice(0, 3).map((loan) => {
      const label = dueLabel(loan.nextDue);
      return compact(`
        <strong>${loan.start_date}</strong> — Balance: ${money(loan.principal_outstanding)}<br>
        <span class="muted">Next Due: ${loan.nextDue?.due_date || "—"} | Due: ${money(dueRemaining(loan.nextDue))} | ${label}</span>
      `);
    }).join("");

    const more = group.loans.length > 3
      ? `<div class="muted" style="margin-top:8px;">+ ${group.loans.length - 3} more loan(s)</div>`
      : "";

    return card(`
      <strong>${group.name}</strong><br>
      <span class="muted">Total Outstanding: ${money(totalOutstanding)} | Active Loans: ${activeLoans}</span><br>
      <span class="muted">Next Due: ${nextDue?.due_date || "—"} | Overdue: ${money(overdueAmount)}</span>
      ${preview || `<div class="muted" style="margin-top:8px;">No loans yet.</div>`}
      ${more}
    `, `data-new-borrower-card="${group.borrower_id}"`);
  }).join("");

  qs("loanList").innerHTML = html || "No loans yet.";

  document.querySelectorAll("[data-new-borrower-card]").forEach((el) => {
    el.onclick = () => openBorrower(el.dataset.newBorrowerCard);
  });
}

function renderByLoan(loans) {
  qs("loanList").innerHTML = loans.length ? loans.map((loan) => {
    return card(`
      <strong>${loan.borrowers?.full_name || "Unknown"}</strong><br>
      <span class="muted">Original: ${money(loan.principal_original)} | Balance: ${money(loan.principal_outstanding)} | ${loan.status}</span><br>
      <span class="muted">Next Due: ${loan.nextDue?.due_date || "—"} | Amount Due: ${money(dueRemaining(loan.nextDue))} | ${dueLabel(loan.nextDue)}</span>
    `, `data-new-loan-card="${loan.id}"`);
  }).join("") : "No loans yet.";

  document.querySelectorAll("[data-new-loan-card]").forEach((el) => {
    el.onclick = () => openLoan(el.dataset.newLoanCard);
  });
}

async function openBorrower(id) {
  const [borrowerRes, loansRes, paymentsRes] = await Promise.all([
    supabase.from("borrowers").select("*").eq("id", id).single(),
    supabase.from("loans").select("id,start_date,principal_original,principal_outstanding,status").eq("borrower_id", id).order("created_at", { ascending: false }),
    supabase.from("payments").select("paid_on,amount,applied_interest,applied_principal,is_voided,notes").eq("borrower_id", id).order("paid_on", { ascending: false }),
  ]);

  if (borrowerRes.error || loansRes.error || paymentsRes.error) {
    return alert((borrowerRes.error || loansRes.error || paymentsRes.error).message);
  }

  const borrower = borrowerRes.data;
  const loans = loansRes.data || [];
  const payments = paymentsRes.data || [];
  const totalBorrowed = loans.reduce((sum, loan) => sum + Number(loan.principal_original || 0), 0);
  const totalOutstanding = loans.reduce((sum, loan) => sum + Number(loan.principal_outstanding || 0), 0);
  const totalPaid = payments.filter((p) => !p.is_voided).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  qs("borrowerDetailsHeader").innerHTML = `
    <div><strong>Name:</strong> ${borrower.full_name}</div>
    <div><strong>Phone:</strong> ${borrower.phone || "—"}</div>
    <div><strong>Notes:</strong> ${borrower.notes || "—"}</div>
    <div><strong>Total Borrowed:</strong> ${money(totalBorrowed)}</div>
    <div><strong>Total Outstanding:</strong> ${money(totalOutstanding)}</div>
    <div><strong>Total Paid:</strong> ${money(totalPaid)}</div>
  `;

  qs("borrowerDetailsLoans").innerHTML = loans.length
    ? loans.map((loan) => card(`<strong>${loan.start_date}</strong><br><span class="muted">${loan.status} | Original ${money(loan.principal_original)} | Balance ${money(loan.principal_outstanding)}</span>`)).join("")
    : "No loans yet.";

  qs("borrowerDetailsPayments").innerHTML = payments.length
    ? payments.map((p) => card(`<strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br><span class="muted">Interest ${money(p.applied_interest)} | Principal ${money(p.applied_principal)}${p.notes ? ` | ${p.notes}` : ""}</span>`)).join("")
    : "No payments yet.";

  pageTo("borrowerDetailsPage");
}

async function openLoan(id) {
  const [loanRes, dueRes, paymentRes] = await Promise.all([
    supabase.from("loans").select("id,start_date,principal_original,principal_outstanding,status,monthly_rate_total,monthly_rate_mgmt,borrowers(full_name)").eq("id", id).single(),
    supabase.from("loan_due_events").select("due_date,expected_total,paid_total,status").eq("loan_id", id).order("due_date", { ascending: true }),
    supabase.from("payments").select("paid_on,amount,applied_interest,applied_principal,is_voided,notes").eq("loan_id", id).order("paid_on", { ascending: false }),
  ]);

  if (loanRes.error || dueRes.error || paymentRes.error) {
    return alert((loanRes.error || dueRes.error || paymentRes.error).message);
  }

  const loan = loanRes.data;

  qs("loanDetailsHeader").innerHTML = `
    <div><strong>Borrower:</strong> ${loan.borrowers?.full_name || "Unknown"}</div>
    <div><strong>Start Date:</strong> ${loan.start_date}</div>
    <div><strong>Original Principal:</strong> ${money(loan.principal_original)}</div>
    <div><strong>Outstanding:</strong> ${money(loan.principal_outstanding)}</div>
    <div><strong>Total Monthly Interest:</strong> ${(Number(loan.monthly_rate_total || 0) * 100).toFixed(2)}%</div>
    <div><strong>Management Share:</strong> ${(Number(loan.monthly_rate_mgmt || 0) * 100).toFixed(2)}%</div>
    <div><strong>Status:</strong> ${loan.status}</div>
  `;

  qs("loanDetailsDueList").innerHTML = (dueRes.data || []).map((due) => {
    const remaining = dueRemaining(due);
    const label = due.due_date < todayIso() && remaining > 0 ? " — OVERDUE" : "";
    return card(`<strong>${due.due_date}</strong>${label}<br><span class="muted">Expected ${money(due.expected_total)} | Paid ${money(due.paid_total)} | Remaining ${money(remaining)} | ${due.status}</span>`);
  }).join("") || "No due events yet.";

  qs("loanDetailsPaymentList").innerHTML = (paymentRes.data || []).map((p) => {
    return card(`<strong>${p.paid_on}</strong> — ${money(p.amount)} ${p.is_voided ? "VOIDED" : ""}<br><span class="muted">Interest ${money(p.applied_interest)} | Principal ${money(p.applied_principal)}${p.notes ? ` | ${p.notes}` : ""}</span>`);
  }).join("") || "No payments yet.";

  pageTo("loanDetailsPage");
}

const observer = new MutationObserver(() => setTimeout(render, 150));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(render, 1000);
render(true);
