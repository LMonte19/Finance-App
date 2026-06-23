import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
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

let currentBorrowerId = null;
let currentBorrowerName = "";
let lastSummaryBorrowerId = null;
let lastLang = null;
let summaryBusy = false;

const today = () => new Date().toISOString().slice(0, 10);
const qs = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const lang = () => localStorage.getItem("loanLedger.language") || "es";
const tx = (es, en) => (lang() === "en" ? en : es);

function statusText(status) {
  if (lang() !== "en") return status || "—";
  return {
    "AL DIA": "CURRENT",
    "ATRASADO": "OVERDUE",
    "SALDADO": "PAID OFF",
  }[status] || status || "—";
}

function rememberFromCard(card) {
  if (!card) return;
  currentBorrowerId = card.dataset.acctBorrower || currentBorrowerId;
  const name = card.querySelector("strong")?.textContent?.trim();
  if (name) currentBorrowerName = name;
  lastSummaryBorrowerId = null;
}

function ensureStableStyle() {
  if (qs("stableAccountStyle")) return;
  const style = document.createElement("style");
  style.id = "stableAccountStyle";
  style.textContent = `
    #stableAccountTop { display:block; }
    .account-stable-active #borrowerAccountContent > .card:nth-of-type(1),
    .account-stable-active #borrowerAccountContent > .card:nth-of-type(2) {
      display:none !important;
    }
    .stable-account-grid {
      display:grid;
      grid-template-columns:repeat(2,1fr);
      gap:12px;
      margin-top:12px;
    }
    .stable-account-stat {
      background:#0f0f11;
      border:1px solid #2a2a2e;
      border-radius:14px;
      padding:14px;
    }
    .stable-account-label { color:#b8b8c2; font-size:13px; margin-bottom:6px; }
    .stable-account-value { font-size:22px; font-weight:800; }
    @media(max-width:650px){.stable-account-grid{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);
}

function ensureStableTop() {
  const page = qs("borrowerAccountPage");
  const content = qs("borrowerAccountContent");
  if (!page || !content || !currentBorrowerId) return null;

  ensureStableStyle();
  page.classList.add("account-stable-active");

  let top = qs("stableAccountTop");
  if (!top) {
    top = document.createElement("div");
    top.id = "stableAccountTop";
    top.setAttribute("translate", "no");
    page.insertBefore(top, content);
  }

  return top;
}

function ensureStableSummaryCard() {
  const top = ensureStableTop();
  if (!top) return null;

  let card = qs("stableAccountSummaryCard");
  if (!card) {
    card = document.createElement("div");
    card.id = "stableAccountSummaryCard";
    card.className = "card";
    card.innerHTML = `<div class="muted">${tx("Cargando resumen...", "Loading summary...")}</div>`;
    top.appendChild(card);
  }
  return card;
}

function paymentCardHtml() {
  return `
    <div style="font-weight:800">${tx("Registrar pago", "Record payment")}</div>
    <div class="muted" id="stablePayBorrowerName"></div>
    <div class="row">
      <input id="stablePayDate" type="date" />
      <input id="stablePayAmount" type="number" step="0.01" placeholder="${tx("Monto pagado", "Amount paid")}" />
    </div>
    <select id="stablePayType">
      <option value="INSTALLMENT">${tx("Pago de cuota/interés", "Installment / interest payment")}</option>
      <option value="PRINCIPAL">${tx("Abono directo a capital", "Principal payment")}</option>
      <option value="MIXED">${tx("Mixto: cuota y sobrante a capital", "Mixed: installment then principal")}</option>
      <option value="PAYOFF">${tx("Saldar capital", "Pay off principal")}</option>
    </select>
    <input id="stablePayNotes" placeholder="${tx("Notas del pago", "Payment notes")}" />
    <button id="stablePayBtn" type="button">${tx("Aplicar pago", "Apply payment")}</button>
    <div class="muted" id="stablePayStatus">${tx("Los pagos de cuota no rebajan capital.", "Installment payments do not reduce principal.")}</div>
  `;
}

function ensureStablePaymentCard() {
  const top = ensureStableTop();
  if (!top) return;

  ensureStableSummaryCard();

  let card = qs("stableAccountPaymentCard");
  const current = lang();
  if (!card) {
    card = document.createElement("div");
    card.id = "stableAccountPaymentCard";
    card.className = "card";
    top.appendChild(card);
  }

  if (card.dataset.lang !== current) {
    const amount = qs("stablePayAmount")?.value || "";
    const date = qs("stablePayDate")?.value || today();
    const type = qs("stablePayType")?.value || "INSTALLMENT";
    const notes = qs("stablePayNotes")?.value || "";

    card.innerHTML = paymentCardHtml();
    card.dataset.lang = current;

    qs("stablePayDate").value = date;
    qs("stablePayAmount").value = amount;
    qs("stablePayType").value = type;
    qs("stablePayNotes").value = notes;
    qs("stablePayBtn").onclick = applyStablePayment;
  }

  const label = qs("stablePayBorrowerName");
  if (label) label.textContent = currentBorrowerName ? `${tx("Cliente", "Borrower")}: ${currentBorrowerName}` : tx("Cliente seleccionado", "Selected borrower");
}

async function refreshStableSummary(force = false) {
  if (!currentBorrowerId || summaryBusy) return;
  const card = ensureStableSummaryCard();
  if (!card) return;

  const current = lang();
  if (!force && lastSummaryBorrowerId === currentBorrowerId && lastLang === current) return;

  summaryBusy = true;
  try {
    const { data, error } = await db
      .from("borrower_account_summary")
      .select("*")
      .eq("borrower_id", currentBorrowerId)
      .single();

    if (error) throw error;

    currentBorrowerName = data.full_name || currentBorrowerName;
    lastSummaryBorrowerId = currentBorrowerId;
    lastLang = current;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div>
          <div style="font-weight:800;font-size:22px;">${tx("Cuenta del cliente", "Borrower account")}</div>
          <div class="muted">${data.full_name || tx("Cliente", "Borrower")} ${data.phone ? `| ${data.phone}` : ""}</div>
        </div>
        <button id="stableBackBtn" type="button" style="width:auto;background:#333;padding:10px 14px;">${tx("Volver", "Back")}</button>
      </div>
      <div class="stable-account-grid">
        <div class="stable-account-stat"><div class="stable-account-label">${tx("Balance de capital", "Principal balance")}</div><div class="stable-account-value">${money(data.principal_balance)}</div></div>
        <div class="stable-account-stat"><div class="stable-account-label">${tx("Cuota mensual actual", "Current monthly fee")}</div><div class="stable-account-value">${money(data.current_monthly_fee)}</div></div>
        <div class="stable-account-stat"><div class="stable-account-label">${tx("Cuota por ciclo", "Cycle fee")}</div><div class="stable-account-value">${money(data.current_cycle_fee)}</div></div>
        <div class="stable-account-stat"><div class="stable-account-label">${tx("Estado", "Status")}</div><div class="stable-account-value">${statusText(data.account_status)}</div></div>
      </div>
      <div class="muted" style="margin-top:12px;">
        ${tx("Próxima cuota", "Next due")}: ${data.next_due_date || "—"} | ${tx("Atrasado", "Overdue")}: ${money(data.overdue_amount)} | ${tx("Días tarde", "Days late")}: ${data.max_days_late || 0}<br>
        ${tx("Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.", "Installment payments do not reduce principal. Principal only goes down with a principal payment, mixed payment, or payoff.")}
      </div>
    `;

    const back = qs("stableBackBtn");
    if (back) {
      back.onclick = () => {
        document.querySelectorAll(".page").forEach((p) => p.classList.remove("active-page"));
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        qs("loansPage")?.classList.add("active-page");
        document.querySelector('.tab-btn[data-page="loansPage"]')?.classList.add("active");
      };
    }

    const label = qs("stablePayBorrowerName");
    if (label) label.textContent = `${tx("Cliente", "Borrower")}: ${currentBorrowerName}`;
  } catch (error) {
    console.error(error);
    card.innerHTML = `<div class="muted">${error.message || String(error)}</div>`;
  } finally {
    summaryBusy = false;
  }
}

async function applyStablePayment() {
  const amount = Number(qs("stablePayAmount")?.value || 0);
  const paid_on = qs("stablePayDate")?.value;
  const payment_type = qs("stablePayType")?.value || "INSTALLMENT";
  const notes = qs("stablePayNotes")?.value?.trim() || null;

  if (!currentBorrowerId) return alert(tx("Abre un cliente primero.", "Open a borrower first."));
  if (!paid_on || !amount) return alert(tx("Fecha y monto son requeridos.", "Date and amount are required."));

  const btn = qs("stablePayBtn");
  const status = qs("stablePayStatus");
  if (btn) btn.disabled = true;
  if (status) status.textContent = tx("Aplicando pago...", "Applying payment...");

  const { error } = await db.rpc("apply_borrower_payment", {
    p_borrower_id: currentBorrowerId,
    p_paid_on: paid_on,
    p_amount: amount,
    p_payment_type: payment_type,
    p_notes: notes,
  });

  if (btn) btn.disabled = false;

  if (error) {
    if (status) status.textContent = error.message;
    return alert(error.message);
  }

  qs("stablePayAmount").value = "";
  qs("stablePayNotes").value = "";
  if (status) status.textContent = tx("Pago aplicado.", "Payment applied.");

  lastSummaryBorrowerId = null;
  await refreshStableSummary(true);
  window.dispatchEvent(new CustomEvent("loan-ledger:open-account", { detail: { borrowerId: currentBorrowerId } }));
}

document.addEventListener(
  "click",
  (event) => {
    const card = event.target.closest?.("[data-acct-borrower]");
    if (card) {
      rememberFromCard(card);
      setTimeout(() => {
        ensureStablePaymentCard();
        refreshStableSummary(true);
      }, 400);
      setTimeout(() => {
        ensureStablePaymentCard();
        refreshStableSummary(false);
      }, 1200);
    }
  },
  true
);

window.addEventListener("loan-ledger:open-account", (event) => {
  if (event.detail?.borrowerId) {
    currentBorrowerId = event.detail.borrowerId;
    lastSummaryBorrowerId = null;
  }
  setTimeout(() => {
    ensureStablePaymentCard();
    refreshStableSummary(true);
  }, 400);
});

function tick() {
  const current = lang();
  if (current !== lastLang) {
    lastSummaryBorrowerId = null;
    const paymentCard = qs("stableAccountPaymentCard");
    if (paymentCard) paymentCard.dataset.lang = "";
  }

  if (qs("borrowerAccountPage")?.classList.contains("active-page")) {
    ensureStablePaymentCard();
    refreshStableSummary(false);
  }
}

setInterval(tick, 900);
tick();

console.log("stable account summary/payment language aware");
