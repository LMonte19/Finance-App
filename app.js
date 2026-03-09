import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const setDebug = (msg) => {
  const el = document.getElementById("debug");
  if (el) el.textContent = msg;
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);

// 1) Paste your Supabase values here:
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

// UI helpers
const qs = (id) => document.getElementById(id);
const authCard = qs("authCard");
const appDiv = qs("app");
const whoami = qs("whoami");
const rolePill = qs("rolePill");
const btnSignOut = qs("btnSignOut");

let currentProfile = null;
let currentLoanId = null;

async function loadProfileByUserId(userId) {
  if (!userId) throw new Error("Missing userId for profile lookup.");

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Profile missing for user_id: " + userId);

  return data;
}

function lastDayOfMonth(d) {
  const dt = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return dt;
}

let isBooting = false;
let bootedOnce = false;

async function bootFromSession(session, source = "unknown") {
  if (!session) return setSignedOutUI();
  if (isBooting) return;

  isBooting = true;
  try {

    setDebug("Step 1/2: profile...");
    const profile = await withTimeout(
      loadProfileByUserId(session.user.id),
      8000,
      "loadProfileByUserId"
    );
    setDebug("Step 2/2: app...");
    await setSignedInUI(profile);

    bootedOnce = true;
    setDebug("");
  } catch (e) {
    console.error("[BOOT] error:", e);
    setDebug("Error after sign-in: " + (e?.message || String(e)));
    alert("Error after sign-in: " + (e?.message || String(e)));
    await setSignedOutUI();
  } finally {
    isBooting = false;
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  console.log("[AUTH]", event, "session?", !!session);
  if (!session) return setSignedOutUI();
  bootFromSession(session, "auth:" + event);
});

// fallback only if auth event never fires
setTimeout(async () => {
  if (bootedOnce) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) bootFromSession(data.session, "fallback:getSession");
  else setSignedOutUI();
}, 800);

function openPage(targetId) {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const pages = document.querySelectorAll(".page");

  tabButtons.forEach((b) => b.classList.remove("active"));
  pages.forEach((p) => p.classList.remove("active-page"));

  const matchingTab = document.querySelector(`.tab-btn[data-page="${targetId}"]`);
  if (matchingTab) matchingTab.classList.add("active");

  const page = qs(targetId);
  if (page) page.classList.add("active-page");

  closeMenu();
}

function openMenu() {
  qs("sideMenu").classList.add("open");
  qs("menuOverlay").classList.add("open");
}

function closeMenu() {
  qs("sideMenu").classList.remove("open");
  qs("menuOverlay").classList.remove("open");
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => openPage(btn.dataset.page);
  });

  document.querySelectorAll(".menu-link").forEach((btn) => {
    btn.onclick = () => openPage(btn.dataset.page);
  });

  qs("btnMenu").onclick = openMenu;
  qs("btnCloseMenu").onclick = closeMenu;
  qs("menuOverlay").onclick = closeMenu;
}

// Generate due dates: 15th + last day of month (next 6 months)
function generateDueDates(startDateStr, monthsAhead = 6) {
  const start = new Date(startDateStr + "T00:00:00");
  const dates = [];
  for (let i = 0; i < monthsAhead; i++) {
    const y = start.getFullYear();
    const m = start.getMonth() + i;
    const d15 = new Date(y, m, 15);
    const dLast = new Date(y, m + 1, 0);

    // include if on/after start date
    if (d15 >= start) dates.push(d15);
    if (dLast >= start) dates.push(dLast);
  }
  // sort, unique
  const uniq = Array.from(new Set(dates.map(d => d.toISOString().slice(0,10)))).sort();
  return uniq;
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

async function refreshBorrowers() {
  const { data, error } = await supabase
    .from("borrowers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  qs("borrowerList").innerHTML = data.map(b => `
    <div class="card" style="margin:10px 0; cursor:pointer; padding:12px;" data-borrower-id="${b.id}">
      <strong>${b.full_name}</strong><br>
      <span class="muted">${b.phone ?? "No phone"} ${b.notes ? `| ${b.notes}` : ""}</span>
    </div>
  `).join("");

  document.querySelectorAll("[data-borrower-id]").forEach((el) => {
    el.onclick = () => openBorrowerDetails(el.dataset.borrowerId);
  });

  const sel = qs("loanBorrower");
  if (sel) {
    sel.innerHTML = data.map(b => `<option value="${b.id}">${b.full_name}</option>`).join("");
  }
}

async function refreshLoans() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, status, borrowers(full_name)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const today = new Date().toISOString().slice(0, 10);

  const loansWithDue = await Promise.all(
    data.map(async (l) => {
      const nextDue = await getNextDueByLoan(l.id);
      return { ...l, nextDue };
    })
  );

  qs("loanList").innerHTML = loansWithDue.map(l => {
    const dueDate = l.nextDue?.due_date ?? "—";
    const amountDue = l.nextDue
      ? Number((Number(l.nextDue.expected_total || 0) - Number(l.nextDue.paid_total || 0))).toFixed(2)
      : "0.00";

    let dueLabel = "CURRENT";
    if (l.nextDue?.due_date && l.nextDue.due_date < today) {
      dueLabel = "OVERDUE";
    } else if (l.nextDue?.due_date && l.nextDue.due_date === today) {
      dueLabel = "DUE TODAY";
    }

    return `
      <div class="card" style="margin:10px 0; cursor:pointer; padding:12px;" data-loan-id="${l.id}">
        <strong>${l.borrowers?.full_name ?? "Unknown"}</strong><br>
        <span class="muted">
          Original: $${Number(l.principal_original || 0).toFixed(2)} |
          Balance: $${Number(l.principal_outstanding || 0).toFixed(2)} |
          ${l.status}
        </span><br>
        <span class="muted">
          Next Due: ${dueDate} |
          Amount Due: $${amountDue} |
          ${dueLabel}
        </span>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-loan-id]").forEach((el) => {
    el.onclick = () => openLoanDetails(el.dataset.loanId);
  });
}

async function refreshLoanDropdownForPayments() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, borrowers(full_name)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  qs("paymentLoan").innerHTML = data.map(l =>
    `<option value="${l.id}">${l.borrowers?.full_name ?? "Unknown"} (${l.id.slice(0,6)}…)</option>`
  ).join("");
}

async function refreshPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("paid_on, amount, applied_interest, applied_principal, borrowers(full_name), notes")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  qs("paymentList").innerHTML = data.map(p =>
    `• ${p.borrowers?.full_name ?? "Unknown"} — $${Number(p.amount).toFixed(2)} <span class="muted">(${p.paid_on})</span>
     <span class="muted">interest $${Number(p.applied_interest).toFixed(2)}, principal $${Number(p.applied_principal).toFixed(2)}</span>
     ${p.notes ? `<span class="muted">— ${p.notes}</span>` : ""}`
  ).join("<br>");
}

async function refreshDashboard() {
  const [{ data: loans }, { data: borrowers }, { data: payments }] = await Promise.all([
    supabase.from("loans").select("id, principal_outstanding, borrowers(full_name)"),
    supabase.from("borrowers").select("id"),
    supabase.from("payments").select("amount, paid_on, borrowers(full_name)").order("created_at", { ascending: false }).limit(5)
  ]);

  const activeLoans = loans?.length ?? 0;
  const totalOutstanding = (loans ?? []).reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
  const paymentsCount = payments?.length ?? 0;
  const borrowersCount = borrowers?.length ?? 0;

  qs("statActiveLoans").textContent = activeLoans;
  qs("statOutstanding").textContent = `$${totalOutstanding.toFixed(2)}`;
  qs("statPaymentsCount").textContent = paymentsCount;
  qs("statBorrowersCount").textContent = borrowersCount;

  qs("dashboardRecentPayments").innerHTML = (payments ?? []).length
    ? payments.map(p =>
        `• ${p.borrowers?.full_name ?? "Unknown"} — $${Number(p.amount).toFixed(2)} <span class="muted">(${p.paid_on})</span>`
      ).join("<br>")
    : "No payments yet.";

  const today = new Date().toISOString().slice(0, 10);

  const loansWithDue = await Promise.all(
    (loans ?? []).map(async (l) => {
      const nextDue = await getNextDueByLoan(l.id);
      return { ...l, nextDue };
    })
  );

  const overdueLoans = loansWithDue.filter(l => l.nextDue?.due_date && l.nextDue.due_date < today);

  qs("dashboardLoansSnapshot").innerHTML = overdueLoans.length
    ? overdueLoans.map(l => {
        const amountDue = Number((Number(l.nextDue.expected_total || 0) - Number(l.nextDue.paid_total || 0))).toFixed(2);
        return `• ${l.borrowers?.full_name ?? "Unknown"} — Overdue $${amountDue} <span class="muted">(Due ${l.nextDue.due_date})</span>`;
      }).join("<br>")
    : "No overdue loans.";
}

async function refreshFundingPartnerDropdown() {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, role")
    .in("role", ["ADMIN", "PARTNER"])
    .order("full_name", { ascending: true });

  if (error) throw error;

  qs("fundingPartner").innerHTML = data.map(p =>
    `<option value="${p.user_id}">${p.full_name} (${p.role})</option>`
  ).join("");
}

async function openLoanDetails(loanId) {
  setDebug("Loading loan details...");
  currentLoanId = loanId;
  await refreshFundingPartnerDropdown();
  await refreshLoanFunding(loanId);
    
  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .select(`
      id,
      start_date,
      principal_original,
      principal_outstanding,
      status,
      borrowers(full_name)
    `)
    .eq("id", loanId)
    .single();

  if (loanErr) {
    console.error(loanErr);
    alert(loanErr.message);
    return;
  }

  const { data: dueRows, error: dueErr } = await supabase
    .from("loan_due_events")
    .select("due_date, expected_total, paid_total, status")
    .eq("loan_id", loanId)
    .order("due_date", { ascending: true });

  if (dueErr) {
    console.error(dueErr);
    alert(dueErr.message);
    return;
  }

  const { data: payments, error: payErr } = await supabase
    .from("payments")
    .select("paid_on, amount, applied_interest, applied_principal, notes")
    .eq("loan_id", loanId)
    .order("paid_on", { ascending: false });

  if (payErr) {
    console.error(payErr);
    alert(payErr.message);
    return;
  }

  qs("loanDetailsHeader").innerHTML = `
    <div><strong>Borrower:</strong> ${loan.borrowers?.full_name ?? "Unknown"}</div>
    <div><strong>Start Date:</strong> ${loan.start_date}</div>
    <div><strong>Original Principal:</strong> $${Number(loan.principal_original).toFixed(2)}</div>
    <div><strong>Outstanding:</strong> $${Number(loan.principal_outstanding).toFixed(2)}</div>
    <div><strong>Status:</strong> ${loan.status}</div>
  `;

const today = new Date().toISOString().slice(0, 10);

qs("loanDetailsDueList").innerHTML = dueRows.length
  ? dueRows.map(d => {
      const remaining = Number(d.expected_total || 0) - Number(d.paid_total || 0);
      const overdue = d.due_date < today && remaining > 0;
      return `
        <div style="margin-bottom:10px; padding:10px; border:1px solid ${overdue ? '#7a2b2b' : '#2a2a2e'}; border-radius:12px;">
          <strong>${d.due_date}</strong> ${overdue ? "— OVERDUE" : ""}<br>
          <span class="muted">
            Expected: $${Number(d.expected_total || 0).toFixed(2)} |
            Paid: $${Number(d.paid_total || 0).toFixed(2)} |
            Remaining: $${remaining.toFixed(2)} |
            ${d.status}
          </span>
        </div>
      `;
    }).join("")
  : "No due events yet.";

  qs("loanDetailsPaymentList").innerHTML = payments.length
    ? payments.map(p => `
        <div style="margin-bottom:10px;">
          <strong>${p.paid_on}</strong> — $${Number(p.amount).toFixed(2)}<br>
          <span class="muted">
            Interest: $${Number(p.applied_interest || 0).toFixed(2)} |
            Principal: $${Number(p.applied_principal || 0).toFixed(2)}
            ${p.notes ? `| ${p.notes}` : ""}
          </span>
        </div>
      `).join("")
    : "No payments yet.";

  openPage("loanDetailsPage");
  setDebug("");
}

async function refreshLoanFunding(loanId) {
  const { data, error } = await supabase
    .from("loan_funding")
    .select("id, funding_percent, partner_user_id")
    .eq("loan_id", loanId);

  if (error) throw error;

  const { data: partners, error: partnersErr } = await supabase
    .from("profiles")
    .select("user_id, full_name");

  if (partnersErr) throw partnersErr;

  const partnerMap = Object.fromEntries((partners ?? []).map(p => [p.user_id, p.full_name]));

  const totalPercent = (data ?? []).reduce((sum, row) => sum + Number(row.funding_percent || 0), 0);

  qs("loanFundingList").innerHTML = (data ?? []).length
    ? `
      ${(data ?? []).map(row => `
        <div style="margin-bottom:10px;">
          <strong>${partnerMap[row.partner_user_id] ?? "Unknown"}</strong><br>
          <span class="muted">${(Number(row.funding_percent) * 100).toFixed(2)}%</span>
        </div>
      `).join("")}
      <div style="margin-top:10px;"><strong>Total:</strong> ${(totalPercent * 100).toFixed(2)}%</div>
    `
    : "No funding split saved yet.";

  if (totalPercent > 1) {
    qs("loanFundingList").innerHTML += `<div style="color:#ff8b8b; margin-top:10px;">Warning: total funding exceeds 100%.</div>`;
  }
  if (totalPercent < 1) {
    qs("loanFundingList").innerHTML += `<div style="color:#ffd27a; margin-top:10px;">Warning: total funding is below 100%.</div>`;
  }
}

async function openBorrowerDetails(borrowerId) {
  setDebug("Loading borrower details...");

  const { data: borrower, error: borrowerErr } = await supabase
    .from("borrowers")
    .select("*")
    .eq("id", borrowerId)
    .single();

  if (borrowerErr) {
    console.error(borrowerErr);
    alert(borrowerErr.message);
    return;
  }

  const { data: loans, error: loansErr } = await supabase
    .from("loans")
    .select("id, start_date, principal_original, principal_outstanding, status")
    .eq("borrower_id", borrowerId)
    .order("created_at", { ascending: false });

  if (loansErr) {
    console.error(loansErr);
    alert(loansErr.message);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
    
    let overdueCount = 0;
    let overdueAmount = 0;
    
    for (const loan of loans) {
      const { data: dueRows } = await supabase
        .from("loan_due_events")
        .select("due_date, expected_total, paid_total")
        .eq("loan_id", loan.id)
        .in("status", ["DUE", "PARTIAL"]);
    
      (dueRows ?? []).forEach(d => {
        const remaining = Number(d.expected_total || 0) - Number(d.paid_total || 0);
        if (d.due_date < today && remaining > 0) {
          overdueCount += 1;
          overdueAmount += remaining;
        }
      });
    }

  const { data: payments, error: paymentsErr } = await supabase
    .from("payments")
    .select("paid_on, amount, applied_interest, applied_principal, notes")
    .eq("borrower_id", borrowerId)
    .order("paid_on", { ascending: false });

  if (paymentsErr) {
    console.error(paymentsErr);
    alert(paymentsErr.message);
    return;
  }

  const totalBorrowed = (loans ?? []).reduce((sum, l) => sum + Number(l.principal_original || 0), 0);
  const totalOutstanding = (loans ?? []).reduce((sum, l) => sum + Number(l.principal_outstanding || 0), 0);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  qs("borrowerDetailsHeader").innerHTML = `
    <div><strong>Name:</strong> ${borrower.full_name}</div>
    <div><strong>Phone:</strong> ${borrower.phone ?? "—"}</div>
    <div><strong>Notes:</strong> ${borrower.notes ?? "—"}</div>
    <div><strong>Total Borrowed:</strong> $${totalBorrowed.toFixed(2)}</div>
    <div><strong>Total Outstanding:</strong> $${totalOutstanding.toFixed(2)}</div>
    <div><strong>Total Paid:</strong> $${totalPaid.toFixed(2)}</div>
    <div><strong>Overdue Items:</strong> ${overdueCount}</div>
    <div><strong>Overdue Amount:</strong> $${overdueAmount.toFixed(2)}</div>
  `;

  qs("borrowerDetailsLoans").innerHTML = loans.length
    ? loans.map(l => `
        <div style="margin-bottom:10px;">
          <strong>${l.start_date}</strong><br>
          <span class="muted">
            Original: $${Number(l.principal_original || 0).toFixed(2)} |
            Balance: $${Number(l.principal_outstanding || 0).toFixed(2)} |
            ${l.status}
          </span>
        </div>
      `).join("")
    : "No loans yet.";

  qs("borrowerDetailsPayments").innerHTML = payments.length
    ? payments.map(p => `
        <div style="margin-bottom:10px;">
          <strong>${p.paid_on}</strong> — $${Number(p.amount || 0).toFixed(2)}<br>
          <span class="muted">
            Interest: $${Number(p.applied_interest || 0).toFixed(2)} |
            Principal: $${Number(p.applied_principal || 0).toFixed(2)}
            ${p.notes ? `| ${p.notes}` : ""}
          </span>
        </div>
      `).join("")
    : "No payments yet.";

  openPage("borrowerDetailsPage");
  setDebug("");
}

async function setSignedInUI(profile) {
  currentProfile = profile;
  authCard.style.display = "none";
  appDiv.style.display = "block";
  btnSignOut.style.display = "inline-block";
  whoami.textContent = `${profile.full_name ?? "User"} • ${profile.role}`;
  rolePill.textContent = profile.role;

  initTabs();

  setDebug("Loading borrowers...");
  await refreshBorrowers();

  setDebug("Loading loans...");
  await refreshLoans();

  setDebug("Loading payments...");
  await refreshLoanDropdownForPayments();
  await refreshPayments();

  setDebug("");
}

async function setSignedOutUI() {
  currentProfile = null;
  authCard.style.display = "block";
  appDiv.style.display = "none";
  btnSignOut.style.display = "none";
  whoami.textContent = "Not signed in";
  rolePill.textContent = "role";
  setDebug("");
}

// Auth
qs("btnSignIn").onclick = async () => {
  const btn = qs("btnSignIn");
  try {
    btn.disabled = true;

    const email = qs("email").value.trim();
    const password = qs("password").value.trim();

    setDebug("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setDebug("Sign-in error: " + error.message);
      alert(error.message);
      return;
    }

    setDebug("Signed in. Loading...");
    const session = data?.session || (await supabase.auth.getSession()).data.session;
    await bootFromSession(session, "signInHandler");
  } catch (e) {
    const msg = e?.message || String(e);
    setDebug("Unexpected error: " + msg);
    alert("Unexpected error: " + msg);
  } finally {
    btn.disabled = false;
  }
};

btnSignOut.onclick = async () => {
  await supabase.auth.signOut();
};

// Add borrower
qs("btnAddBorrower").onclick = async () => {
  if (!currentProfile || !["ADMIN","AGENT"].includes(currentProfile.role)) {
    alert("Only Admin/Agent can add borrowers.");
    return;
  }

  const full_name = qs("bName").value.trim();
  if (!full_name) return alert("Borrower name required.");

  const phone = qs("bPhone").value.trim() || null;
  const notes = qs("bNotes").value.trim() || null;

  const { data: userData } = await supabase.auth.getUser();
  const created_by = userData.user.id;

  const { error } = await supabase.from("borrowers").insert({ full_name, phone, notes, created_by });
  if (error) return alert(error.message);

  qs("bName").value = "";
  qs("bPhone").value = "";
  qs("bNotes").value = "";
  await refreshBorrowers();
  await refreshDashboard();
};

// Create loan + due events
qs("btnCreateLoan").onclick = async () => {
  if (!currentProfile || !["ADMIN","AGENT"].includes(currentProfile.role)) {
    alert("Only Admin/Agent can create loans.");
    return;
  }

  const borrower_id = qs("loanBorrower").value;
  const principal = Number(qs("principal").value);
  const start_date = qs("startDate").value;
  const mgmt_fee_per_cycle = Number(qs("mgmtFee").value || 0);

  if (!borrower_id || !principal || !start_date) return alert("Borrower, principal, and start date are required.");

  const { data: userData } = await supabase.auth.getUser();
  const created_by = userData.user.id;

  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .insert({
      borrower_id,
      created_by,
      start_date,
      principal_original: principal,
      principal_outstanding: principal,
      monthly_rate_total: 0.10,
      monthly_rate_mgmt: 0.03,
      status: "ACTIVE",
      mgmt_fee_per_cycle
    })
    .select("*")
    .single();

  if (loanErr) return alert(loanErr.message);

  // Generate due events for next 6 months:
  const dueDates = generateDueDates(start_date, 6);
  const totalRatePerCycle = (loan.monthly_rate_total ?? 0.10) / 2; // 10% monthly -> 5% per cycle
  const mgmtRatePerCycle  = (loan.monthly_rate_mgmt  ?? 0.03) / 2; // 3% monthly -> 1.5% per cycle
  const fundersRatePerCycle = totalRatePerCycle - mgmtRatePerCycle; // 3.5% per cycle by default
  
  const dueRows = dueDates.map(d => {
    const expected_total = Number((principal * totalRatePerCycle).toFixed(2));
    const expected_mgmt = Number((principal * mgmtRatePerCycle).toFixed(2));
    const expected_funders = Number((principal * fundersRatePerCycle).toFixed(2));
  
    return {
      loan_id: loan.id,
      due_date: d,
      expected_interest: expected_total,
      expected_total,
      expected_mgmt,
      expected_funders,
      status: "DUE"
    };
  });

  const { error: dueErr } = await supabase.from("loan_due_events").insert(dueRows);
  if (dueErr) return alert(dueErr.message);

  qs("principal").value = "";
  qs("startDate").value = "";
  qs("mgmtFee").value = "";

  await refreshLoans();
  await refreshLoanDropdownForPayments();
  await refreshLoans();
  await refreshDashboard();
  alert("Loan created + due dates generated.");
};


qs("btnAddPayment").onclick = async () => {
  if (!currentProfile || !["ADMIN","AGENT"].includes(currentProfile.role)) {
    alert("Only Admin/Agent can record payments.");
    return;
  }

  const loan_id = qs("paymentLoan").value;
  const paid_on = qs("paymentDate").value;
  const amount = Number(qs("paymentAmount").value);
  const notes = qs("paymentNotes").value.trim() || null;

  if (!loan_id || !paid_on || !amount) {
    return alert("Loan, date, and amount are required.");
  }

  setDebug("Applying payment...");

  const { error } = await supabase.rpc("apply_payment", {
    p_loan_id: loan_id,
    p_paid_on: paid_on,
    p_amount: amount,
    p_notes: notes
  });

  if (error) {
    console.error(error);
    setDebug("Payment error: " + error.message);
    alert(error.message);
    return;
  }

  qs("paymentAmount").value = "";
  qs("paymentNotes").value = "";

  await refreshLoans();
  await refreshPayments();
  await refreshDashboard();

  setDebug("");
  alert("Payment applied.");
};

qs("btnAddFundingSplit").onclick = async () => {
  if (!currentProfile || currentProfile.role !== "ADMIN") {
    alert("Only Admin can edit funding splits.");
    return;
  }

  if (!currentLoanId) {
    return alert("Open a loan first.");
  }

  const partner_user_id = qs("fundingPartner").value;
  const percentInput = Number(qs("fundingPercent").value);

  if (!partner_user_id || !percentInput) {
    return alert("Partner and percent are required.");
  }

  const funding_percent = percentInput / 100;

  const { error } = await supabase
    .from("loan_funding")
    .upsert({
      loan_id: currentLoanId,
      partner_user_id,
      funding_percent
    }, {
      onConflict: "loan_id,partner_user_id"
    });

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  qs("fundingPercent").value = "";

  await refreshLoanFunding(currentLoanId);
  alert("Funding split saved.");
};

qs("btnBackToLoans").onclick = () => {
  openPage("loansPage");
};

qs("btnBackToBorrowers").onclick = () => {
  openPage("borrowersPage");
};
