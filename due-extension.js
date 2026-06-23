import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import './admin-tools.js?v=2';
import './batch-tools.js?v=2';
import './menu-page-fix.js?v=1';
import './loan-view-fix.js?v=2';
import './partners-page-fix.js?v=4';
import './settings-validation-fix.js?v=1';
import './loan-actions.js?v=1';
import './payment-management.js?v=3';
import './activity-log.js?v=2';
import './ui-stability-fixes.js?v=1';
import './followups.js?v=1';
import './loan-health.js?v=1';
import './dashboard-command.js?v=1';
import './role-security.js?v=1';
import './system-check.js?v=1';
import './language-toggle.js?v=2';

const acctDb = createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const acct$ = id => document.getElementById(id);
const acctMoney = n => `$${Number(n||0).toFixed(2)}`;
const acctToday = () => new Date().toISOString().slice(0,10);
let acctBorrowerId = null;
let acctBusy = false;
let acctListBusy = false;
let acctPaymentPatched = false;

function acctIsPage(id){return acct$(id)?.classList.contains('active-page');}
function acctOpenPage(id){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active-page'));
  const tab=document.querySelector(`.tab-btn[data-page="${id}"]`); if(tab) tab.classList.add('active');
  acct$(id)?.classList.add('active-page');
  acct$('sideMenu')?.classList.remove('open'); acct$('menuOverlay')?.classList.remove('open');
}
function acctCard(html, attrs=''){
  return `<div class="compact-card" ${attrs} style="background:#0f0f11;border:1px solid #2a2a2e;border-radius:12px;padding:12px;margin:10px 0;box-sizing:border-box;${attrs?'cursor:pointer;':''}">${html}</div>`;
}
function acctEnsurePage(){
  const app=acct$('app'); if(!app) return;
  if(!acct$('borrowerAccountPage')){
    const p=document.createElement('div'); p.id='borrowerAccountPage'; p.className='page';
    p.innerHTML='<div id="borrowerAccountContent" class="muted">Cargando cuenta...</div>'; app.appendChild(p);
  }
  if(!acct$('acctStyle')){
    const s=document.createElement('style'); s.id='acctStyle'; s.textContent='.acct-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px}.acct-stat{background:#0f0f11;border:1px solid #2a2a2e;border-radius:14px;padding:14px}.acct-label{color:#b8b8c2;font-size:13px;margin-bottom:6px}.acct-value{font-size:22px;font-weight:800}.acct-danger{color:#ff8b8b}.acct-ok{color:#9ff5b2}.acct-warn{color:#ffd27a}@media(max-width:650px){.acct-grid{grid-template-columns:1fr}}'; document.head.appendChild(s);
  }
}
function acctStatusClass(s){return s==='ATRASADO'?'acct-danger':'acct-ok';}
function acctTypeLabel(t){return {INSTALLMENT:'Cuota/interés',PRINCIPAL:'Abono a capital',MIXED:'Mixto',PAYOFF:'Saldar capital'}[t]||t;}

async function acctRenderLoanList(){
  if(!acctIsPage('loansPage')||acctListBusy||!acct$('loanList')) return;
  acctListBusy=true;
  try{
    const [aRes,dRes]=await Promise.all([
      acctDb.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),
      acctDb.from('borrower_disbursements_view').select('*').order('start_date',{ascending:false})
    ]);
    if(aRes.error) throw aRes.error; if(dRes.error) throw dRes.error;
    const by=new Map(); (dRes.data||[]).forEach(d=>{if(!by.has(d.borrower_id))by.set(d.borrower_id,[]); by.get(d.borrower_id).push(d);});
    const html=(aRes.data||[]).map(a=>{
      const recent=(by.get(a.borrower_id)||[]).slice(0,3).map(d=>`<div style="margin:6px 0"><strong>${d.start_date}</strong> — Desembolso ${acctMoney(d.principal_original)} | Balance ${acctMoney(d.principal_outstanding)} | ${d.status}</div>`).join('');
      return acctCard(`<div style="display:flex;justify-content:space-between;gap:10px"><div><strong>${a.full_name}</strong><br><span class="muted">${a.phone||'Sin teléfono'}</span></div><span class="pill ${acctStatusClass(a.account_status)}">${a.account_status}</span></div><div style="margin-top:8px">Balance de capital: <strong>${acctMoney(a.principal_balance)}</strong> | Total desembolsado: ${acctMoney(a.total_disbursed)}<br>Cuota mensual actual: <strong>${acctMoney(a.current_monthly_fee)}</strong> | Cuota por ciclo: ${acctMoney(a.current_cycle_fee)}<br>Próxima cuota: ${a.next_due_date||'—'} | Atrasado: ${acctMoney(a.overdue_amount)}</div><div style="border-top:1px solid #2a2a2e;margin-top:10px;padding-top:10px">${recent||'Sin desembolsos.'}</div><div class="muted" style="margin-top:10px">Clic para abrir cuenta completa.</div>`,`data-acct-borrower="${a.borrower_id}"`);
    }).join('')||'No hay clientes/cuentas para mostrar.';
    acct$('loanList').innerHTML=html;
    document.querySelectorAll('[data-acct-borrower]').forEach(el=>{el.onclick=()=>acctOpenAccount(el.dataset.acctBorrower);});
  }catch(e){console.error(e); acct$('loanList').innerHTML=e.message||String(e);} finally{acctListBusy=false;}
}
async function acctOpenAccount(id){acctBorrowerId=id; acctEnsurePage(); acctOpenPage('borrowerAccountPage'); await acctRenderAccount();}
async function acctRenderAccount(){
  if(!acctBorrowerId||!acctIsPage('borrowerAccountPage')||acctBusy) return; acctBusy=true;
  try{
    const [sRes,dRes,duRes,pRes,cRes,fRes]=await Promise.all([
      acctDb.from('borrower_account_summary').select('*').eq('borrower_id',acctBorrowerId).single(),
      acctDb.from('borrower_disbursements_view').select('*').eq('borrower_id',acctBorrowerId).order('start_date',{ascending:false}),
      acctDb.from('borrower_due_events_view').select('*').eq('borrower_id',acctBorrowerId).order('due_date',{ascending:true}).limit(80),
      acctDb.from('borrower_account_payments_view').select('*').eq('borrower_id',acctBorrowerId).order('paid_on',{ascending:false}).limit(80),
      acctDb.from('borrower_contact_log_view').select('*').eq('borrower_id',acctBorrowerId).order('created_at',{ascending:false}).limit(12),
      acctDb.from('borrower_followups_view').select('*').eq('borrower_id',acctBorrowerId).order('due_date',{ascending:true}).limit(12)
    ]);
    for(const r of [sRes,dRes,duRes,pRes,cRes,fRes]) if(r.error) throw r.error;
    const a=sRes.data;
    const disb=(dRes.data||[]).map(d=>acctCard(`<strong>${d.start_date}</strong> — Desembolso ${acctMoney(d.principal_original)}<br>Balance asignado: ${acctMoney(d.principal_outstanding)} | Estado: ${d.status}<br><span class="muted">Interés mensual ${(Number(d.monthly_rate_total||0)*100).toFixed(2)}% | Administración ${(Number(d.monthly_rate_mgmt||0)*100).toFixed(2)}%</span>`)).join('')||'No hay desembolsos.';
    const dues=(duRes.data||[]).map(d=>acctCard(`<strong>${d.due_date}</strong> <span class="pill">${d.timing_status}</span><br>Esperado: ${acctMoney(d.expected_total)} | Pagado: ${acctMoney(d.paid_total)} | Pendiente: ${acctMoney(d.amount_due)} | ${d.status}<br><span class="muted">Capital base: ${acctMoney(d.principal_snapshot)}</span>`)).join('')||'No hay cuotas generadas.';
    const pays=(pRes.data||[]).map(p=>acctCard(`<strong>${p.paid_on}</strong> — ${acctMoney(p.amount)} <span class="pill">${acctTypeLabel(p.payment_type)}</span>${p.is_voided?" <span class='pill acct-danger'>ANULADO</span>":''}<br>Cuota/interés: ${acctMoney(p.applied_interest)} | Capital: ${acctMoney(p.applied_principal)}<br>Administración: ${acctMoney(p.applied_mgmt)} | Socios: ${acctMoney(p.applied_funders)}${p.notes?`<br><span class="muted">${p.notes}</span>`:''}`)).join('')||'No hay pagos.';
    const contacts=(cRes.data||[]).map(c=>acctCard(`<strong>${c.contact_type}</strong> — ${c.contact_date}<br><span class="muted">${c.outcome||'—'}</span><br>${c.notes||''}`)).join('')||'No hay notas.';
    const follows=(fRes.data||[]).map(f=>acctCard(`<strong>${f.due_date}</strong> — ${f.priority} | ${f.timing_status}<br><span class="muted">${f.reason||'—'}</span>`)).join('')||'No hay seguimientos.';
    acct$('borrowerAccountContent').innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px"><div><div style="font-weight:800;font-size:22px">Cuenta del cliente</div><div class="muted">${a.full_name} ${a.phone?`| ${a.phone}`:''}</div></div><button id="acctBack" style="width:auto;background:#333;padding:10px 14px">Volver</button></div><div class="acct-grid"><div class="acct-stat"><div class="acct-label">Balance de capital</div><div class="acct-value">${acctMoney(a.principal_balance)}</div></div><div class="acct-stat"><div class="acct-label">Cuota mensual actual</div><div class="acct-value">${acctMoney(a.current_monthly_fee)}</div></div><div class="acct-stat"><div class="acct-label">Cuota por ciclo</div><div class="acct-value">${acctMoney(a.current_cycle_fee)}</div></div><div class="acct-stat"><div class="acct-label">Estado</div><div class="acct-value ${acctStatusClass(a.account_status)}">${a.account_status}</div></div></div><div class="muted" style="margin-top:12px">Los pagos de cuota no rebajan capital. El capital solo baja con abono a capital, mixto o saldo.</div></div><div class="card"><div style="font-weight:800">Registrar pago</div><div class="row"><input id="acctPayDate" type="date" value="${acctToday()}"><input id="acctPayAmount" type="number" step="0.01" placeholder="Monto pagado"></div><select id="acctPayType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select><input id="acctPayNotes" placeholder="Notas del pago"><button id="acctPayBtn">Aplicar pago</button></div><div class="card"><div style="font-weight:800">Mantenimiento de cuotas</div><div class="row"><button id="acctGen6">Generar 6 meses</button><button id="acctGen12">Generar 12 meses</button></div><div id="acctGenResult" class="muted"></div></div><div class="card"><div style="font-weight:800">Desembolsos / capital agregado</div>${disb}</div><div class="card"><div style="font-weight:800">Calendario de cuotas de la cuenta</div>${dues}</div><div class="card"><div style="font-weight:800">Historial de pagos</div>${pays}</div><div class="card"><div style="font-weight:800">Seguimientos</div>${follows}</div><div class="card"><div style="font-weight:800">Notas de contacto</div>${contacts}</div>`;
    acct$('acctBack').onclick=()=>acctOpenPage('loansPage'); acct$('acctPayBtn').onclick=acctApplyAccountPayment; acct$('acctGen6').onclick=()=>acctGenerateDue(6); acct$('acctGen12').onclick=()=>acctGenerateDue(12);
  }catch(e){console.error(e); acct$('borrowerAccountContent').innerHTML=`<div class="card">${e.message||String(e)}</div>`;} finally{acctBusy=false;}
}
async function acctApplyAccountPayment(){
  const amount=Number(acct$('acctPayAmount')?.value||0); const paid_on=acct$('acctPayDate')?.value; const payment_type=acct$('acctPayType')?.value; const notes=acct$('acctPayNotes')?.value?.trim()||null;
  if(!acctBorrowerId||!amount||!paid_on) return alert('Fecha y monto son requeridos.');
  const {error}=await acctDb.rpc('apply_borrower_payment',{p_borrower_id:acctBorrowerId,p_paid_on:paid_on,p_amount:amount,p_payment_type:payment_type,p_notes:notes});
  if(error) return alert(error.message); await acctRenderAccount(); await acctRenderLoanList(); alert('Pago aplicado.');
}
async function acctGenerateDue(months){
  const through=new Date(); through.setMonth(through.getMonth()+months); const out=acct$('acctGenResult'); if(out) out.textContent='Generando...';
  const {data,error}=await acctDb.rpc('generate_missing_borrower_due_events',{p_borrower_id:acctBorrowerId,p_through_date:through.toISOString().slice(0,10),p_from_date:acctToday(),p_only_active:true});
  if(error){if(out)out.textContent=error.message; return alert(error.message);} if(out) out.textContent=`Cuotas creadas: ${data||0}`; await acctRenderAccount();
}
async function acctPatchPaymentPage(){
  if(!acctIsPage('paymentsPage')||acctPaymentPatched) return; const old=acct$('paymentLoan'); if(!old) return;
  const box=old.parentElement; if(!box) return; const {data,error}=await acctDb.from('borrower_account_summary').select('borrower_id,full_name,principal_balance,account_status').order('full_name',{ascending:true}); if(error) return;
  box.innerHTML=`<div style="font-weight:800">Registrar pago por cliente/cuenta</div><select id="acctPageBorrower">${(data||[]).map(b=>`<option value="${b.borrower_id}">${b.full_name} (${b.account_status}, ${acctMoney(b.principal_balance)})</option>`).join('')}</select><div class="row"><input id="acctPageDate" type="date" value="${acctToday()}"><input id="acctPageAmount" type="number" step="0.01" placeholder="Monto pagado"></div><select id="acctPageType"><option value="INSTALLMENT">Pago de cuota/interés</option><option value="PRINCIPAL">Abono directo a capital</option><option value="MIXED">Mixto: cuota y sobrante a capital</option><option value="PAYOFF">Saldar capital</option></select><input id="acctPageNotes" placeholder="Notas del pago"><button id="acctPageBtn">Aplicar pago</button><div class="muted">Los pagos de cuota no rebajan capital.</div>`;
  acctPaymentPatched=true; acct$('acctPageBtn').onclick=async()=>{const {error}=await acctDb.rpc('apply_borrower_payment',{p_borrower_id:acct$('acctPageBorrower').value,p_paid_on:acct$('acctPageDate').value,p_amount:Number(acct$('acctPageAmount').value||0),p_payment_type:acct$('acctPageType').value,p_notes:acct$('acctPageNotes').value.trim()||null}); if(error)return alert(error.message); acct$('acctPageAmount').value=''; acct$('acctPageNotes').value=''; alert('Pago aplicado.');};
}
let acctTimer=null; function acctTick(){acctEnsurePage(); if(acctIsPage('loansPage')) acctRenderLoanList(); if(acctIsPage('borrowerAccountPage')) acctRenderAccount(); if(acctIsPage('paymentsPage')) acctPatchPaymentPage();}
new MutationObserver(()=>{clearTimeout(acctTimer); acctTimer=setTimeout(acctTick,250);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
setInterval(acctTick,2500); acctTick();
