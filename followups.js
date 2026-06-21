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
const todayIso = () => new Date().toISOString().slice(0, 10);
let followupTimer = null;
let followupBusy = false;
let borrowerContactBusy = false;
let selectedBorrowerId = null;
let selectedBorrowerName = "";
let lastFollowupHtml = "";

function isPage(id) {
  return qs(id)?.classList.contains("active-page");
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function card(html, attrs = "") {
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;">${html}</div>`;
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function ensureStyles() {
  if (qs("followupsStyle")) return;
  const style = document.createElement("style");
  style.id = "followupsStyle";
  style.textContent = `
    .followup-status-overdue{color:#ff8b8b;font-weight:800;}
    .followup-status-today{color:#ffd27a;font-weight:800;}
    .followup-status-upcoming{color:#8fb1ff;font-weight:800;}
    .followup-status-done{color:#9ff5b2;font-weight:800;}
    .followup-small-btn{width:auto !important;padding:8px 12px !important;margin:4px 4px 4px 0 !important;}
  `;
  document.head.appendChild(style);
}

function followupsPageHtml() {
  return `
    <div class="card">
      <div style="font-weight:800;">Follow-ups</div>
      <div class="muted">Track calls, WhatsApp/texts, promises to pay, and reminders.</div>

      <div class="stats-grid" style="margin-top:12px;">
        <div class="stat-card"><div class="stat-label">Open</div><div class="stat-value" id="followupStatOpen">0</div></div>
        <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-value" id="followupStatOverdue">0</div></div>
        <div class="stat-card"><div class="stat-label">Due Today</div><div class="stat-value" id="followupStatToday">0</div></div>
        <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value" id="followupStatDone">0</div></div>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:800;">Add Follow-up</div>
      <div class="row">
        <select id="followupBorrower"><option value="">Select borrower</option></select>
        <select id="followupLoan"><option value="">Optional loan</option></select>
      </div>
      <div class="row">
        <input id="followupDueDate" type="date" />
        <select id="followupPriority">
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <input id="followupReason" placeholder="Reason / reminder note (e.g., promised to pay Friday)" />
      <button id="btnAddFollowup" type="button">Add Follow-up</button>
    </div>

    <div class="card">
      <div style="font-weight:800;">Log Contact</div>
      <div class="row">
        <select id="contactBorrower"><option value="">Select borrower</option></select>
        <select id="contactLoan"><option value="">Optional loan</option></select>
      </div>
      <div class="row">
        <input id="contactDate" type="date" />
        <select id="contactType">
          <option value="NOTE">Note</option>
          <option value="CALL">Call</option>
          <option value="TEXT">Text</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Email</option>
          <option value="IN_PERSON">In person</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <input id="contactOutcome" placeholder="Outcome (optional, e.g. no answer, promised payment)" />
      <input id="contactNotes" placeholder="Contact notes" />
      <button id="btnAddContactLog" type="button">Save Contact Note</button>
    </div>

    <div class="card">
      <div style="font-weight:800;">Follow-up View</div>
      <div class="row">
        <button id="filterFollowupsOpen" type="button">Open</button>
        <button id="filterFollowupsOverdue" type="button">Overdue</button>
      </div>
      <div class="row">
        <button id="filterFollowupsToday" type="button">Due Today</button>
        <button id="filterFollowupsAll" type="button">All</button>
      </div>
      <input id="followupSearch" placeholder="Search borrower, phone, reason, priority..." />
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-weight:800;">Follow-up List</div>
        <span class="pill" id="followupCountPill">0</span>
      </div>
      <div id="followupList" class="muted">Loading...</div>
    </div>

    <div class="card">
      <div style="font-weight:800;">Recent Contact Notes</div>
      <div id="recentContactList" class="muted">Loading...</div>
    </div>
  `;
}

function ensureFollowupsPage() {
  ensureStyles();
  const app = qs("app");
  if (!app) return null;

  let page = qs("followupsPage");
  if (!page) {
    page = document.createElement("div");
    page.id = "followupsPage";
    page.className = "page";
    app.appendChild(page);
  }

  if (!qs("followupList") || !qs("btnAddFollowup")) {
    page.innerHTML = followupsPageHtml();
  }

  const sideMenu = qs("sideMenu");
  if (sideMenu && !qs("menuFollowups")) {
    const btn = document.createElement("button");
    btn.id = "menuFollowups";
    btn.className = "menu-link";
    btn.dataset.page = "followupsPage";
    btn.textContent = "Follow-ups";
    const activityBtn = qs("menuActivity");
    const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
    sideMenu.insertBefore(btn, activityBtn || defaultsBtn || null);
  }

  const menuBtn = qs("menuFollowups");
  if (menuBtn && menuBtn.dataset.followupsBound !== "true") {
    menuBtn.dataset.followupsBound = "true";
    menuBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureFollowupsPage();
      openPage("followupsPage");
      renderFollowups(true);
    };
  }

  bindFollowupControls();
  return page;
}

function bindFollowupControls() {
  const map = [
    ["filterFollowupsOpen", "OPEN"],
    ["filterFollowupsOverdue", "OVERDUE"],
    ["filterFollowupsToday", "DUE_TODAY"],
    ["filterFollowupsAll", "ALL"],
  ];

  map.forEach(([id, value]) => {
    const btn = qs(id);
    if (btn && btn.dataset.bound !== "true") {
      btn.dataset.bound = "true";
      btn.onclick = () => {
        localStorage.setItem("loanLedger.followupFilter", value);
        lastFollowupHtml = "";
        renderFollowups(true);
      };
    }
  });

  const borrowerSelects = [qs("followupBorrower"), qs("contactBorrower")];
  borrowerSelects.forEach((sel) => {
    if (sel && sel.dataset.bound !== "true") {
      sel.dataset.bound = "true";
      sel.onchange = () => populateLoanDropdownForBorrower(sel.id === "followupBorrower" ? "followupLoan" : "contactLoan", sel.value);
    }
  });

  if (qs("followupSearch") && qs("followupSearch").dataset.bound !== "true") {
    qs("followupSearch").dataset.bound = "true";
    qs("followupSearch").oninput = () => renderFollowups(true);
  }

  if (qs("btnAddFollowup") && qs("btnAddFollowup").dataset.bound !== "true") {
    qs("btnAddFollowup").dataset.bound = "true";
    qs("btnAddFollowup").onclick = addFollowup;
  }

  if (qs("btnAddContactLog") && qs("btnAddContactLog").dataset.bound !== "true") {
    qs("btnAddContactLog").dataset.bound = "true";
    qs("btnAddContactLog").onclick = addContactLogFromPage;
  }
}

async function populateBorrowerDropdowns() {
  const selects = [qs("followupBorrower"), qs("contactBorrower"), qs("borrowerDetailFollowupLoanBorrower")].filter(Boolean);
  if (!selects.length) return;
  if (qs("followupBorrower")?.dataset.loaded === "true") return;

  const { data, error } = await supabase
    .from("borrowers")
    .select("id, full_name, phone")
    .order("full_name", { ascending: true });

  if (error) throw error;

  const options = `<option value="">Select borrower</option>${(data || []).map((b) => `<option value="${b.id}">${b.full_name}${b.phone ? ` (${b.phone})` : ""}</option>`).join("")}`;

  if (qs("followupBorrower")) qs("followupBorrower").innerHTML = options;
  if (qs("contactBorrower")) qs("contactBorrower").innerHTML = options;

  if (qs("followupBorrower")) qs("followupBorrower").dataset.loaded = "true";
}

async function populateLoanDropdownForBorrower(selectId, borrowerId, selectedLoanId = "") {
  const sel = qs(selectId);
  if (!sel) return;
  sel.innerHTML = `<option value="">Optional loan</option>`;
  if (!borrowerId) return;

  const { data, error } = await supabase
    .from("loans")
    .select("id, start_date, principal_outstanding, status")
    .eq("borrower_id", borrowerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  sel.innerHTML = `<option value="">Optional loan</option>${(data || []).map((l) => `
    <option value="${l.id}">${l.start_date} | ${l.status} | ${money(l.principal_outstanding)}</option>
  `).join("")}`;
  if (selectedLoanId) sel.value = selectedLoanId;
}

function setFollowupFilterButtons() {
  const current = localStorage.getItem("loanLedger.followupFilter") || "OPEN";
  const ids = {
    OPEN: "filterFollowupsOpen",
    OVERDUE: "filterFollowupsOverdue",
    DUE_TODAY: "filterFollowupsToday",
    ALL: "filterFollowupsAll",
  };
  Object.entries(ids).forEach(([key, id]) => {
    const btn = qs(id);
    if (!btn) return;
    btn.style.background = key === current ? "#2b63ff" : "#333";
  });
}

function timingClass(row) {
  if (row.status === "DONE") return "followup-status-done";
  if (row.timing_status === "OVERDUE") return "followup-status-overdue";
  if (row.timing_status === "DUE_TODAY") return "followup-status-today";
  return "followup-status-upcoming";
}

function filterFollowupRows(rows) {
  const filter = localStorage.getItem("loanLedger.followupFilter") || "OPEN";
  const term = String(qs("followupSearch")?.value || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (filter === "OPEN" && row.status !== "OPEN") return false;
    if (filter === "OVERDUE" && row.timing_status !== "OVERDUE") return false;
    if (filter === "DUE_TODAY" && row.timing_status !== "DUE_TODAY") return false;

    if (term) {
      const haystack = [row.borrower_name, row.borrower_phone, row.reason, row.priority, row.status, row.timing_status, row.loan_status]
        .map((x) => String(x || "").toLowerCase()).join(" ");
      if (!haystack.includes(term)) return false;
    }

    return true;
  });
}

function renderFollowupRow(row) {
  const statusLabel = row.timing_status === "DUE_TODAY" ? "DUE TODAY" : String(row.timing_status || row.status).replaceAll("_", " ");
  const doneButton = row.status === "OPEN"
    ? `<button class="followup-small-btn" data-complete-followup="${row.id}" type="button">Mark Done</button>`
    : "";

  return card(`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div>
        <strong>${row.borrower_name || "Unknown"}</strong><br>
        <span class="muted">${row.borrower_phone || "No phone"}</span>
      </div>
      <span class="pill ${timingClass(row)}">${statusLabel}</span>
    </div>
    <div style="margin-top:8px;">
      <strong>Due:</strong> ${row.due_date} | <strong>Priority:</strong> ${row.priority}<br>
      <span class="muted">${row.reason || "—"}</span><br>
      <span class="muted">Loan: ${row.loan_start_date || "—"} ${row.loan_status ? `| ${row.loan_status}` : ""}</span>
      ${row.completed_notes ? `<br><span class="muted">Done note: ${row.completed_notes}</span>` : ""}
    </div>
    ${doneButton}
  `);
}

async function renderFollowups(force = false) {
  ensureFollowupsPage();
  if (!isPage("followupsPage") || followupBusy || !qs("followupList")) return;

  followupBusy = true;
  try {
    await populateBorrowerDropdowns();
    setFollowupFilterButtons();

    if (qs("followupDueDate") && !qs("followupDueDate").value) qs("followupDueDate").value = todayIso();
    if (qs("contactDate") && !qs("contactDate").value) qs("contactDate").value = todayIso();

    const [followupsRes, contactsRes] = await Promise.all([
      supabase.from("borrower_followups_view").select("*").order("due_date", { ascending: true }).limit(250),
      supabase.from("borrower_contact_log_view").select("*").order("created_at", { ascending: false }).limit(25),
    ]);

    if (followupsRes.error) throw followupsRes.error;
    if (contactsRes.error) throw contactsRes.error;

    const allRows = followupsRes.data || [];
    const rows = filterFollowupRows(allRows);

    const open = allRows.filter((r) => r.status === "OPEN").length;
    const overdue = allRows.filter((r) => r.timing_status === "OVERDUE").length;
    const today = allRows.filter((r) => r.timing_status === "DUE_TODAY").length;
    const done = allRows.filter((r) => r.status === "DONE").length;

    qs("followupStatOpen").textContent = open;
    qs("followupStatOverdue").textContent = overdue;
    qs("followupStatToday").textContent = today;
    qs("followupStatDone").textContent = done;
    qs("followupCountPill").textContent = rows.length;

    const html = rows.length ? rows.map(renderFollowupRow).join("") : "No follow-ups in this view.";
    if (force || html !== lastFollowupHtml) {
      qs("followupList").innerHTML = html;
      lastFollowupHtml = html;
    }

    document.querySelectorAll("[data-complete-followup]").forEach((btn) => {
      if (btn.dataset.bound === "true") return;
      btn.dataset.bound = "true";
      btn.onclick = () => completeFollowup(btn.dataset.completeFollowup);
    });

    qs("recentContactList").innerHTML = (contactsRes.data || []).length
      ? contactsRes.data.map((c) => card(`
          <strong>${c.borrower_name}</strong> — ${c.contact_type} <span class="muted">${c.contact_date}</span><br>
          <span class="muted">${c.outcome || "—"}</span><br>
          <span>${c.notes || ""}</span>
        `)).join("")
      : "No contact notes yet.";
  } catch (error) {
    console.error(error);
    qs("followupList").innerHTML = error.message || String(error);
  } finally {
    followupBusy = false;
  }
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user?.id;
}

async function addFollowup() {
  const borrower_id = qs("followupBorrower").value;
  const loan_id = qs("followupLoan").value || null;
  const due_date = qs("followupDueDate").value;
  const priority = qs("followupPriority").value;
  const reason = qs("followupReason").value.trim();

  if (!borrower_id || !due_date || !reason) return alert("Borrower, due date, and reason are required.");

  const created_by = await currentUserId();
  const { error } = await supabase.from("borrower_followups").insert({ borrower_id, loan_id, due_date, priority, reason, created_by });
  if (error) return alert(error.message);

  qs("followupReason").value = "";
  lastFollowupHtml = "";
  await renderFollowups(true);
  alert("Follow-up added.");
}

async function addContactLogFromPage() {
  const borrower_id = qs("contactBorrower").value;
  const loan_id = qs("contactLoan").value || null;
  const contact_date = qs("contactDate").value;
  const contact_type = qs("contactType").value;
  const outcome = qs("contactOutcome").value.trim() || null;
  const notes = qs("contactNotes").value.trim();

  if (!borrower_id || !contact_date || !notes) return alert("Borrower, contact date, and notes are required.");

  const created_by = await currentUserId();
  const { error } = await supabase.from("borrower_contact_log").insert({ borrower_id, loan_id, contact_date, contact_type, outcome, notes, created_by });
  if (error) return alert(error.message);

  qs("contactOutcome").value = "";
  qs("contactNotes").value = "";
  await renderFollowups(true);
  alert("Contact note saved.");
}

async function completeFollowup(followupId) {
  const note = prompt("Completion note (optional):", "");
  if (note === null) return;

  const { error } = await supabase.rpc("complete_followup", {
    p_followup_id: followupId,
    p_completed_notes: note.trim() || null,
  });

  if (error) return alert(error.message);
  lastFollowupHtml = "";
  await renderFollowups(true);
  alert("Follow-up marked done.");
}

function detectBorrowerDetails() {
  if (!isPage("borrowerDetailsPage")) return null;
  const header = qs("borrowerDetailsHeader");
  if (!header) return null;

  const card = document.querySelector("[data-borrower-id]");
  const detailText = header.textContent || "";
  const nameMatch = detailText.match(/Name:\s*([^\n]+)/i);

  if (card?.dataset?.borrowerId && nameMatch?.[1]) {
    return { id: card.dataset.borrowerId, name: nameMatch[1].trim() };
  }

  if (selectedBorrowerId && selectedBorrowerName && detailText.includes(selectedBorrowerName)) {
    return { id: selectedBorrowerId, name: selectedBorrowerName };
  }

  return null;
}

document.addEventListener("click", (event) => {
  const borrowerCard = event.target.closest("[data-borrower-id]");
  if (borrowerCard?.dataset?.borrowerId) {
    selectedBorrowerId = borrowerCard.dataset.borrowerId;
    selectedBorrowerName = borrowerCard.textContent.trim().split("\n")[0].trim();
  }
});

function borrowerContactHtml() {
  return `
    <div class="card" id="borrowerContactBox">
      <div style="font-weight:800;">Contact / Follow-ups</div>
      <div class="row">
        <select id="borrowerContactType">
          <option value="NOTE">Note</option>
          <option value="CALL">Call</option>
          <option value="TEXT">Text</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Email</option>
          <option value="IN_PERSON">In person</option>
          <option value="OTHER">Other</option>
        </select>
        <input id="borrowerContactDate" type="date" />
      </div>
      <input id="borrowerContactOutcome" placeholder="Outcome (optional)" />
      <input id="borrowerContactNotes" placeholder="Contact notes" />
      <button id="btnBorrowerSaveContact" type="button">Save Contact Note</button>

      <div style="font-weight:800;margin-top:16px;">Schedule Follow-up</div>
      <div class="row">
        <input id="borrowerFollowupDueDate" type="date" />
        <select id="borrowerFollowupPriority">
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <input id="borrowerFollowupReason" placeholder="Follow-up reason" />
      <button id="btnBorrowerAddFollowup" type="button">Add Follow-up</button>

      <div style="font-weight:800;margin-top:16px;">Open Follow-ups</div>
      <div id="borrowerOpenFollowups" class="muted">Loading...</div>

      <div style="font-weight:800;margin-top:16px;">Contact History</div>
      <div id="borrowerContactHistory" class="muted">Loading...</div>
    </div>
  `;
}

async function ensureBorrowerContactSection() {
  const details = detectBorrowerDetails();
  if (!details || borrowerContactBusy) return;
  const header = qs("borrowerDetailsHeader");
  if (!header) return;

  if (!qs("borrowerContactBox")) {
    const holder = document.createElement("div");
    holder.innerHTML = borrowerContactHtml();
    header.parentElement.insertAdjacentElement("afterend", holder.firstElementChild);
  }

  if (qs("borrowerContactBox")?.dataset.borrowerId !== details.id) {
    qs("borrowerContactBox").dataset.borrowerId = details.id;
    qs("borrowerContactDate").value = todayIso();
    qs("borrowerFollowupDueDate").value = todayIso();
    await refreshBorrowerContactSection(details.id);
  }

  if (qs("btnBorrowerSaveContact") && qs("btnBorrowerSaveContact").dataset.bound !== "true") {
    qs("btnBorrowerSaveContact").dataset.bound = "true";
    qs("btnBorrowerSaveContact").onclick = () => addBorrowerDetailContact(details.id);
  }

  if (qs("btnBorrowerAddFollowup") && qs("btnBorrowerAddFollowup").dataset.bound !== "true") {
    qs("btnBorrowerAddFollowup").dataset.bound = "true";
    qs("btnBorrowerAddFollowup").onclick = () => addBorrowerDetailFollowup(details.id);
  }
}

async function refreshBorrowerContactSection(borrowerId) {
  borrowerContactBusy = true;
  try {
    const [followupsRes, contactsRes] = await Promise.all([
      supabase.from("borrower_followups_view").select("*").eq("borrower_id", borrowerId).eq("status", "OPEN").order("due_date", { ascending: true }).limit(20),
      supabase.from("borrower_contact_log_view").select("*").eq("borrower_id", borrowerId).order("created_at", { ascending: false }).limit(20),
    ]);

    if (followupsRes.error) throw followupsRes.error;
    if (contactsRes.error) throw contactsRes.error;

    qs("borrowerOpenFollowups").innerHTML = (followupsRes.data || []).length
      ? followupsRes.data.map(renderFollowupRow).join("")
      : "No open follow-ups.";

    qs("borrowerContactHistory").innerHTML = (contactsRes.data || []).length
      ? contactsRes.data.map((c) => card(`
          <strong>${c.contact_type}</strong> <span class="muted">${c.contact_date}</span><br>
          <span class="muted">${c.outcome || "—"}</span><br>
          <span>${c.notes || ""}</span>
        `)).join("")
      : "No contact notes yet.";
  } catch (error) {
    console.error(error);
    if (qs("borrowerContactHistory")) qs("borrowerContactHistory").innerHTML = error.message || String(error);
  } finally {
    borrowerContactBusy = false;
  }
}

async function addBorrowerDetailContact(borrowerId) {
  const contact_date = qs("borrowerContactDate").value || todayIso();
  const contact_type = qs("borrowerContactType").value;
  const outcome = qs("borrowerContactOutcome").value.trim() || null;
  const notes = qs("borrowerContactNotes").value.trim();
  if (!notes) return alert("Contact notes are required.");

  const created_by = await currentUserId();
  const { error } = await supabase.from("borrower_contact_log").insert({ borrower_id: borrowerId, contact_date, contact_type, outcome, notes, created_by });
  if (error) return alert(error.message);

  qs("borrowerContactOutcome").value = "";
  qs("borrowerContactNotes").value = "";
  await refreshBorrowerContactSection(borrowerId);
  alert("Contact note saved.");
}

async function addBorrowerDetailFollowup(borrowerId) {
  const due_date = qs("borrowerFollowupDueDate").value || todayIso();
  const priority = qs("borrowerFollowupPriority").value;
  const reason = qs("borrowerFollowupReason").value.trim();
  if (!reason) return alert("Follow-up reason is required.");

  const created_by = await currentUserId();
  const { error } = await supabase.from("borrower_followups").insert({ borrower_id: borrowerId, due_date, priority, reason, created_by });
  if (error) return alert(error.message);

  qs("borrowerFollowupReason").value = "";
  await refreshBorrowerContactSection(borrowerId);
  alert("Follow-up added.");
}

async function tick() {
  ensureFollowupsPage();
  if (isPage("followupsPage")) await renderFollowups();
  if (isPage("borrowerDetailsPage")) await ensureBorrowerContactSection();
}

const observer = new MutationObserver(() => {
  clearTimeout(followupTimer);
  followupTimer = setTimeout(tick, 200);
});

observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(tick, 2000);
tick();
