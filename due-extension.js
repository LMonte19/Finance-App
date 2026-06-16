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
let activeLoanId = null;
let injecting = false;

document.addEventListener("click", (event) => {
  const loanCard = event.target.closest("[data-loan-id]");
  if (loanCard?.dataset?.loanId) {
    activeLoanId = loanCard.dataset.loanId;
  }
});

function isLoanDetailsOpen() {
  return qs("loanDetailsPage")?.classList.contains("active-page");
}

function ensureDueExtensionControls() {
  if (injecting || !isLoanDetailsOpen() || !qs("loanDetailsDueList") || qs("dueExtensionBox")) return;
  injecting = true;

  const box = document.createElement("div");
  box.id = "dueExtensionBox";
  box.className = "compact-card";
  box.style.marginBottom = "12px";
  box.innerHTML = `
    <div style="font-weight:800;">Extend Due Schedule</div>
    <div class="muted" style="margin-top:4px;">Adds future due dates using the current outstanding balance and saved loan rates.</div>
    <div class="row" style="margin-top:8px;">
      <input id="extendDueMonths" type="number" min="1" max="24" step="1" value="6" placeholder="Months to add" />
      <button id="btnExtendDueSchedule" type="button">Add Due Dates</button>
    </div>
    <div id="dueExtensionStatus" class="muted"></div>
  `;

  qs("loanDetailsDueList").parentElement.insertBefore(box, qs("loanDetailsDueList"));

  qs("btnExtendDueSchedule").onclick = async () => {
    try {
      const status = qs("dueExtensionStatus");
      if (!activeLoanId) {
        status.textContent = "Open the loan again from the Loans list first.";
        alert("Open the loan again from the Loans list first.");
        return;
      }

      const months = Number(qs("extendDueMonths").value || 6);
      if (!months || months < 1 || months > 24) {
        alert("Months must be between 1 and 24.");
        return;
      }

      status.textContent = "Adding due dates...";
      const { data, error } = await supabase.rpc("generate_loan_due_events", {
        p_loan_id: activeLoanId,
        p_months_ahead: months,
      });

      if (error) throw error;

      await refreshDueList(activeLoanId);
      status.textContent = `Added ${data ?? 0} due date(s).`;
      alert(`Added ${data ?? 0} due date(s).`);
    } catch (error) {
      console.error(error);
      qs("dueExtensionStatus").textContent = error?.message || String(error);
      alert(error?.message || String(error));
    }
  };

  injecting = false;
}

async function refreshDueList(loanId) {
  const { data, error } = await supabase
    .from("loan_due_events")
    .select("due_date, expected_total, paid_total, status")
    .eq("loan_id", loanId)
    .order("due_date", { ascending: true });

  if (error) throw error;

  const today = new Date().toISOString().slice(0, 10);

  qs("loanDetailsDueList").innerHTML = (data ?? []).length
    ? data.map((d) => {
        const remaining = Math.max(0, Number(d.expected_total || 0) - Number(d.paid_total || 0));
        const overdue = d.due_date < today && remaining > 0;
        return `
          <div class="compact-card" style="border-color:${overdue ? "#7a2b2b" : "#2a2a2e"}">
            <strong>${d.due_date}</strong> ${overdue ? "— OVERDUE" : ""}<br>
            <span class="muted">
              Expected: ${money(d.expected_total)} |
              Paid: ${money(d.paid_total)} |
              Remaining: ${money(remaining)} |
              ${d.status}
            </span>
          </div>
        `;
      }).join("")
    : "No due events yet.";
}

const observer = new MutationObserver(() => ensureDueExtensionControls());
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

setInterval(ensureDueExtensionControls, 1000);
