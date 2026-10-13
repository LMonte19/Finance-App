import { readPageQuery, watchPage, isStalePageSession } from './page-read-runtime.js?v=1';
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
let busy = false;

function isDefaultsPage() {
  return qs("defaultsPage")?.classList.contains("active-page");
}

function isLoansPage() {
  return qs("loansPage")?.classList.contains("active-page");
}

const editedRates=new Set();
document.addEventListener('input',event=>{if(['defaultInterestRate','defaultManagementRate'].includes(event.target.id))editedRates.add(event.target.id);});
window.addEventListener('loan-ledger:rates-updated',()=>{editedRates.clear();renderEnhancedDefaults(true);});
async function loadSetting(key){
 const {data,error}=await readPageQuery('setting:'+key,()=>supabase.from('app_settings').select('setting_value').eq('setting_key',key).maybeSingle());
 if(error)throw error;return data?.setting_value??null;
}
async function renderEnhancedDefaults(force=false){
 if(!isDefaultsPage()||busy)return;busy=true;
 try{
  const rates=await loadSetting('loan_defaults');
  const values={defaultInterestRate:rates?.default_total_monthly_rate??10,defaultManagementRate:rates?.default_management_rate??3};
  for(const [id,value] of Object.entries(values))if(qs(id)&&(force||!editedRates.has(id)))qs(id).value=Number(value).toFixed(2);
 }catch(error){if(!isStalePageSession(error))console.error(error);}finally{busy=false;}
}

function parseNewLoanSplitTotal() {
  const text = qs("newLoanFundingList")?.textContent || "";
  const match = text.match(/Total:\s*([0-9.]+)%/i);
  if (!match) return null;
  return Number(match[1]);
}

function validationMessage() {
  const usingNewBorrower = qs("newBorrowerFields") && qs("newBorrowerFields").style.display !== "none";
  const borrowerId = qs("loanBorrower")?.value;
  const newBorrowerName = qs("newBorrowerName")?.value.trim();
  const principal = Number(qs("principal")?.value || 0);
  const startDate = qs("startDate")?.value;
  const totalRate = Number(qs("loanTotalRate")?.value || 0);
  const mgmtRate = Number(qs("loanMgmtRate")?.value || 0);
  const splitTotal = parseNewLoanSplitTotal();

  if (usingNewBorrower && !newBorrowerName) return "Enter the new borrower name.";
  if (!usingNewBorrower && !borrowerId) return "Select a borrower or use + New Borrower.";
  if (!principal || principal <= 0) return "Enter a principal amount greater than 0.";
  if (!startDate) return "Choose a start date.";
  if (!totalRate || totalRate <= 0) return "Enter the total monthly interest percent.";
  if (mgmtRate < 0) return "Management share cannot be negative.";
  if (mgmtRate > totalRate) return "Management share cannot be higher than total monthly interest.";
  if (splitTotal == null) return "Add at least one funding split.";
  if (Math.abs(splitTotal - 100) > 0.1) return `Funding split must total 100%. Current total: ${splitTotal.toFixed(2)}%.`;
  return "Ready to save.";
}

function ensureLoanValidationBox() {
  const btn = qs("btnCreateLoan");
  if (!btn || qs("loanValidationStatus")) return;
  const box = document.createElement("div");
  box.id = "loanValidationStatus";
  box.className = "muted";
  box.style.marginTop = "8px";
  btn.insertAdjacentElement("beforebegin", box);
}

function refreshLoanValidationMessage() {
  if (!isLoansPage() || !qs("loanValidationStatus")) return;
  const msg = validationMessage();
  const el = qs("loanValidationStatus");
  el.textContent = msg;
  el.style.color = msg === "Ready to save." ? "#87e39a" : "#ffd27a";
}

function setupLoanValidationGuard() {
  if (document.body.dataset.loanValidationGuard === "true") return;
  document.body.dataset.loanValidationGuard = "true";

  document.addEventListener("input", () => setTimeout(refreshLoanValidationMessage, 50), true);
  document.addEventListener("change", () => setTimeout(refreshLoanValidationMessage, 50), true);

  document.addEventListener("click", (event) => {
    if (event.target?.id !== "btnCreateLoan") return;
    const msg = validationMessage();
    if (msg !== "Ready to save.") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      alert(msg);
    }
  }, true);
}

async function tick() {
  setupLoanValidationGuard();
  if (isDefaultsPage()) await renderEnhancedDefaults();
  if (isLoansPage()) {
    ensureLoanValidationBox();
    refreshLoanValidationMessage();
  }
}

tick();
watchPage("defaultsPage", tick, {prefetch: () => loadSetting("loan_defaults")});
watchPage("loansPage", tick, {interval:1000});
