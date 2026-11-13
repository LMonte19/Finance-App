import { esc, dateLabel } from './combined-workspace-ui.js?v=2';
import { collectRows } from './report-exports.js?v=2';
import { readPageQuery, watchPage, isStalePageSession, fillInitialLoading, finishPageLoading, loadingRows, getPageSessionId } from './page-read-runtime.js?v=1';
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
const money = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n||0));


let currentBorrowerId = null;
let borrowerEditInFlight = false;
let enhancementTimer = null;

function activePage(id) {
  return qs(id)?.classList.contains("active-page");
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
  page.className = "page ll-combined-page";
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
  btn.textContent = "Cuotas / vencimientos";
  btn.dataset.page="dueOverduePage";
  ensurePage("dueOverduePage","Cuotas y vencimientos");
  btn.onclick = async () => {
    ensurePage("dueOverduePage", "Cuotas y vencimientos");
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

const readDues=()=>readPageQuery("portfolio-open-installments",async()=>({
  data:await collectRows(()=>supabase.rpc('get_portfolio_open_installments').order('due_date').order('borrower_id'))
}));
function dueRows(rows,empty){
  if(!rows.length)return `<p>${empty}</p>`;
  return `<div class="cw-table-scroll"><table class="cw-table"><thead><tr><th>Vence</th><th>Cliente</th><th>Cuota</th><th>Abonado</th><th>Pendiente</th></tr></thead><tbody>${rows.map(d=>`<tr><td>${esc(dateLabel(d.due_date))}</td><td><button class="cw-link" type="button" data-due-borrower="${esc(d.borrower_id)}" data-due-date="${esc(d.due_date)}">${esc(d.borrower_name)}</button></td><td>${money(d.expected_total)}</td><td>${money(d.paid_total)}</td><td><strong>${money(d.amount_due)}</strong></td></tr>`).join('')}</tbody></table></div>`;
}
async function refreshDueOverduePage() {
  const page=ensurePage("dueOverduePage","Cuotas y vencimientos"),owner=getPageSessionId();
  const content=qs("dueOverduePageContent");
  if(!page||!content||!owner)return;
  if(!content.dataset.bound){
    content.dataset.bound='true';
    content.addEventListener('click',event=>{
      const due=event.target.closest('[data-due-borrower]');
      if(due)window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:due.dataset.dueBorrower,dueDate:due.dataset.dueDate}}));
      if(event.target.closest('[data-due-retry]'))refreshDueOverduePage();
    });
  }
  try {
    const {data}=await readDues();
    if(owner!==getPageSessionId())return;
    const overdue=data.filter(d=>d.timing_status==='OVERDUE');
    const dueToday=data.filter(d=>d.timing_status==='DUE_TODAY');
    const upcoming=data.filter(d=>d.timing_status==='UPCOMING');
    const sum=rows=>rows.reduce((n,d)=>n+Number(d.amount_due),0);
    const stat=(label,rows)=>`<div class="stat-card"><div class="stat-label">${label} · ${rows.length}</div><div class="stat-value">${money(sum(rows))}</div></div>`;
    const html=`<div class="stats-grid">${stat('Atrasadas',overdue)}${stat('Vencen hoy',dueToday)}${stat('Próximos 60 días',upcoming)}</div>
      <details class="cw-card" open><summary><strong>Vencen hoy (${dueToday.length})</strong></summary>${dueRows(dueToday,'No hay cuotas pendientes para hoy.')}</details>
      <details class="cw-card" open><summary><strong>Próximos 60 días (${upcoming.length})</strong></summary>${dueRows(upcoming,'No hay cuotas pendientes en los próximos 60 días.')}</details>
      <details class="cw-card"><summary><strong>Atrasadas (${overdue.length})</strong></summary>${dueRows(overdue,'No hay cuotas atrasadas.')}</details>`;
    if(content.dataset.lastMarkup!==html){content.innerHTML=html;content.dataset.lastMarkup=html;}
  }catch(error){
    if(owner!==getPageSessionId()||isStalePageSession(error))return;
    delete content.dataset.lastMarkup;
    content.innerHTML='<p>No se pudieron consultar los vencimientos.</p><button type="button" data-due-retry>Volver a intentar</button>';
  }finally{if(owner===getPageSessionId())finishPageLoading("dueOverduePage");}
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
      <input id="editBorrowerName" value="${esc(borrower.full_name ?? "")}" placeholder="Full name" />
      <input id="editBorrowerPhone" value="${esc(borrower.phone ?? "")}" placeholder="Phone" />
      <input id="editBorrowerNotes" value="${esc(borrower.notes ?? "")}" placeholder="Notes" />
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
    if(!isStalePageSession(error))console.error(error);
  }
}

refreshVisibleEnhancements();
fillInitialLoading("dueOverduePageContent");
watchPage("dueOverduePage", refreshVisibleEnhancements, {prefetch: readDues, reset: () => {const n=qs("dueOverduePageContent");if(n){delete n.dataset.lastMarkup;n.innerHTML=loadingRows();}}});
watchPage("borrowerDetailsPage", refreshVisibleEnhancements);
