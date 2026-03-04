import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function loadProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) throw error;
  return data;
}

function lastDayOfMonth(d) {
  const dt = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return dt;
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

async function refreshBorrowers() {
  const { data, error } = await supabase.from("borrowers").select("*").order("created_at", { ascending: false });
  if (error) throw error;

  qs("borrowerList").innerHTML = data.map(b => `• ${b.full_name} <span class="muted">${b.phone ?? ""}</span>`).join("<br>");

  const sel = qs("loanBorrower");
  sel.innerHTML = data.map(b => `<option value="${b.id}">${b.full_name}</option>`).join("");
}

async function refreshLoans() {
  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_outstanding, status, borrowers(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;

  qs("loanList").innerHTML = data.map(l =>
    `• ${l.borrowers?.full_name ?? "Unknown"} — Balance: ${Number(l.principal_outstanding).toFixed(2)} — ${l.status} <span class="muted">(start ${l.start_date})</span>`
  ).join("<br>");
}

async function setSignedInUI(profile) {
  currentProfile = profile;
  authCard.style.display = "none";
  appDiv.style.display = "block";
  btnSignOut.style.display = "inline-block";
  whoami.textContent = `${profile.full_name ?? "User"} • ${profile.role}`;
  rolePill.textContent = profile.role;

  await refreshBorrowers();
  await refreshLoans();
}

async function setSignedOutUI() {
  currentProfile = null;
  authCard.style.display = "block";
  appDiv.style.display = "none";
  btnSignOut.style.display = "none";
  whoami.textContent = "Not signed in";
}

// Auth
qs("btnSignIn").onclick = async () => {
  const email = qs("email").value.trim();
  const password = qs("password").value.trim();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert(error.message);
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
  alert("Loan created + due dates generated.");
};

// init
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session) return setSignedOutUI();
  try {
    const profile = await loadProfile();
    await setSignedInUI(profile);
  } catch (e) {
    alert("Profile missing. Admin needs to add you to profiles table.");
    await setSignedOutUI();
  }
});

(async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return setSignedOutUI();
  const profile = await loadProfile();
  await setSignedInUI(profile);
})();
