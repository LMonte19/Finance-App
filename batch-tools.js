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

let currentBorrowerId = null;
let borrowerEditInFlight = false;
let enhancementTimer = null;

function activePage(id) {
  return qs(id)?.classList.contains("active-page");
}

function compactCard(html, extraAttrs = "") {
  return `<div class="compact-card" ${extraAttrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:10px;margin:8px 0;box-sizing:border-box;max-width:100%;">${html}</div>`;
}

function ensureEnhancementStyles() {
  if (qs("batchToolsStyle")) return;
  const style = document.createElement("style");
  style.id = "batchToolsStyle";
  style.textContent = `
    input, select, button { box-sizing: border-box; }
    button { cursor: pointer; }
    .batch-action-button {
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.05s ease, background 0.15s ease;
    }
    .batch-action-button:hover { filter: brightness(1.18); }
    .batch-action-button:active { transform: scale(0.98); }
    .batch-action-button.active { background: #2b63ff !important; color: #fff !important; }
    .batch-danger-button { background: #7a2b2b !important; }
    .batch-danger-button:hover { filter: brightness(1.18); }
    .borrower-edit-box input { width: 100%; max-width: 100%; }
  `;
  document.head.appendChild(style);
}

function ensurePage(id, title) {
  if (qs(id)) return qs(id);
  const app = qs("app");
  if (!app) return null;
  const page = document.createElement("div");
  page.id = id;
  page.className = "page";
  page.innerHTML = `<div class="card"><div style="font-weight:800;">${title}</div><div id="${id}Content" class="muted">Loading...</div></div>`;
  app.appendChild(page);
  return page;
}

function openPage(id) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
  qs(id)?.classList.add("active-page");
  qs("sideMenu")?.classList.remove("open");
  qs("menuOverlay")?.classList.remove("open");
}

function ensureMenuItem() {
  if (qs("menuDueOverdue")) return;
  const sideMenu = qs("sideMenu");
  if (!sideMenu) return;
  const btn = document.createElement("button");
  btn.id = "menuDueOverdue";
  btn.className = "menu-link batch-action-button";
  btn.textContent = "Due / Overdue";
  btn.onclick = async () => {
    ensurePage("dueOverduePage", "Due / Overdue");
    openPage("dueOverduePage");
    await refreshDueOverduePage();
  };
  const defaultsBtn = sideMenu.querySelector('[data-page="defaultsPage"]');
  sideMenu.insertBefore(btn, defaultsBtn || null);
}

function ensureFilters() {
  if (activePage("loansPage") && qs("loanList") && !qs("loanSearch")) {
    const box = document.createElement("input");
    box.id = "loanSearch";
    box.placeholder = "Search loans by borrower, amount, status, due date...";
    box.oninput = () => filterCards("loanList", box.value);
    qs("loanList").parentElement.insertBefore(box, qs("loanList"));
  }

  if (activePage("borrowersPage") && qs("borrowerList") && !qs("borrowerSearch")) {
    const box = document.createElement("input");
    box.id = "borrowerSearch";
    box.placeholder = "Search borrowers by name, phone, notes...";
    box.oninput = () => filterCards("borrowerList", box.value);
    qs("borrowerList").parentElement.insertBefore(box, qs("borrowerList"));
  }

  if (activePage("paymentsPage") && qs("paymentList") && !qs("paymentSearch")) {
    const box = document.createElement("input");
    box.id = "paymentSearch";
    box.placeholder = "Search payments by borrower, date, notes...";
    box.oninput = () => filterCards("paymentList", box.value);
    qs("paymentList").parentElement.insertBefore(box, qs("paymentList"));
  }
}

function filterCards(containerId, value) {
  const term = String(value || "").toLowerCase();
  qs(containerId)?.querySelectorAll(".card,.compact-card").forEach((card) => {
    card.style.display = card.textContent.toLowerCase().includes(term) ? "" : "none";
  });
}

document.addEventListener("click", (event) => {
  const borrowerCard = event.target.closest("[data-borrower-id]");
  if (borrowerCard?.dataset?.borrowerId) currentBorrowerId = borrowerCard.dataset.borrowerId;
});

async function refreshDueOverduePage() {
  const page = ensurePage("dueOverduePage", "Due / Overdue");
  if (!page) return;
  const content = qs("dueOverduePageContent");
  if (!content) return;

  const { data, error } = await supabase
    .from("loan_due_events")
    .select("id, due_date, expected_total, paid_total, status, loans(id,status,borrowers(full_name))")
    .in("status", ["DUE", "PARTIAL"])
    .order("due_date", { ascending: true });

  if (error) throw error;

  const today = todayIso();
  const rows = (data ?? []).map((d) => ({
    ...d,
    remaining: Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0)),
    borrower: d.loans?.borrowers?.full_name ?? "Unknown",
    loanStatus: d.loans?.status ?? "UNKNOWN",
  })).filter((d) => d.remaining > 0 && d.loanStatus !== "PAID_OFF");

  const overdue = rows.filter((d) => d.due_date < today);
  const upcoming = rows.filter((d) => d.due_date >= today).slice(0, 25);
  const overdueTotal = overdue.reduce((sum, d) => sum + d.remaining, 0);
  const upcomingTotal = upcoming.reduce((sum, d) => sum + d.remaining, 0);

  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Overdue Items</div><div class="stat-value">${overdue.length}</div></div>
      <div class="stat-card"><div class="stat-label">Overdue Amount</div><div class="stat-value">${money(overdueTotal)}</div></div>
      <div class="stat-card"><div class="stat-label">Upcoming Shown</div><div class="stat-value">${upcoming.length}</div></div>
      <div class="stat-card"><div class="stat-label">Upcoming Amount</div><div class="stat-value">${money(upcomingTotal)}</div></div>
    </div>

    <div class="card">
      <div style="font-weight:800;">Overdue</div>
      ${overdue.length ? overdue.map((d) => compactCard(`<strong>${d.borrower}</strong> — ${money(d.remaining)}<br><span class="muted">Due ${d.due_date} | ${d.status} | Loan ${String(d.loans?.id || "").slice(0, 6)}…</span>`)).join("") : "No overdue due dates."}
    </div>

    <div class="card">
      <div style="font-weight:800;">Upcoming Due</div>
      ${upcoming.length ? upcoming.map((d) => compactCard(`<strong>${d.borrower}</strong> — ${money(d.remaining)}<br><span class="muted">Due ${d.due_date} | ${d.status} | Loan ${String(d.loans?.id || "").slice(0, 6)}…</span>`)).join("") : "No upcoming due dates."}
    </div>
  `;
}

async function injectBorrowerEdit() {
  if (!activePage("borrowerDetailsPage") || !currentBorrowerId || borrowerEditInFlight) return;
  const header = qs("borrowerDetailsHeader");
  if (!header) return;

  const existingBoxes = Array.from(document.querySelectorAll("#borrowerEditBox, .borrower-edit-box"));
  const matchingBox = existingBoxes.find((box) => box.dataset.borrowerId === currentBorrowerId);
  existingBoxes.filter((box) => box !== matchingBox).forEach((box) => box.remove());
  if (matchingBox) return;

  borrowerEditInFlight = true;

  try {
    const { data: borrower, error } = await supabase
      .from("borrowers")
      .select("id, full_name, phone, notes")
      .eq("id", currentBorrowerId)
      .single();
    if (error) return;

    document.querySelectorAll("#borrowerEditBox, .borrower-edit-box").forEach((box) => box.remove());

    const box = document.createElement("div");
    box.id = "borrowerEditBox";
    box.className = "compact-card borrower-edit-box";
    box.dataset.borrowerId = currentBorrowerId;
    box.style.background = "#0f0f11";
    box.style.border = "1px solid #2a2a2e";
    box.style.borderRadius = "12px";
    box.style.padding = "10px";
    box.style.marginTop = "12px";
    box.style.boxSizing = "border-box";
    box.style.maxWidth = "100%";
    box.innerHTML = `
      <div style="font-weight:800;">Edit Borrower</div>
      <input id="editBorrowerName" value="${borrower.full_name ?? ""}" placeholder="Full name" />
      <input id="editBorrowerPhone" value="${borrower.phone ?? ""}" placeholder="Phone" />
      <input id="editBorrowerNotes" value="${borrower.notes ?? ""}" placeholder="Notes" />
      <button id="btnSaveBorrowerEdit" class="batch-action-button" type="button">Save Borrower</button>
    `;
    header.appendChild(box);

    qs("btnSaveBorrowerEdit").onclick = async () => {
      const { error: updateErr } = await supabase
        .from("borrowers")
        .update({
          full_name: qs("editBorrowerName").value.trim(),
          phone: qs("editBorrowerPhone").value.trim() || null,
          notes: qs("editBorrowerNotes").value.trim() || null,
        })
        .eq("id", currentBorrowerId);

      if (updateErr) {
        alert(updateErr.message);
        return;
      }
      alert("Borrower updated.");
    };
  } finally {
    borrowerEditInFlight = false;
  }
}

async function refreshVisibleEnhancements() {
  try {
    ensureEnhancementStyles();
    ensureMenuItem();
    ensureFilters();

    // Payments are now owned by payment-management.js.
    // This file only keeps the search box, Due/Overdue page, and borrower edit helper.
    if (activePage("dueOverduePage")) await refreshDueOverduePage();
    if (activePage("borrowerDetailsPage")) await injectBorrowerEdit();
  } catch (error) {
    console.error(error);
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(enhancementTimer);
  enhancementTimer = setTimeout(refreshVisibleEnhancements, 150);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
setInterval(refreshVisibleEnhancements, 2500);
refreshVisibleEnhancements();
