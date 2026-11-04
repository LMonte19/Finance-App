import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readPageQuery, invalidatePageReads, getPageSessionId } from './page-read-runtime.js?v=1';
import { openFloatingPanel, floatingHeader } from './floating-panel.js?v=1';
import { openRegisterDrawer } from './payment-management.js?v=10';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
const drafts=new Map();
let draftOwner;
const field=(label,name,attrs='')=>`<label>${label}<input name="${name}" ${attrs}></label>`;

function fields(kind){
  if(kind==='loan')return `${field('Capital desembolsado','principal','type="number" min="0.01" step="0.01" required')}${field('Fecha de inicio','start_date',`type="date" value="${today()}" required`)}<div class="ll-floating-two">${field('Interés mensual total %','rate_total','type="number" min="0" step="0.01" required')}${field('Administración %','rate_mgmt','type="number" min="0" step="0.01" required')}</div><label>Notas<input name="notes" placeholder="Notas opcionales"></label><section class="ll-floating-funding"><h3>Distribución de inversión</h3><div data-quick-funding></div><p class="ll-floating-help" data-quick-funding-total></p></section><p class="ll-floating-help">El capital se agrega a la cuenta y las cuotas futuras se recalculan.</p>`;
  const loan='<label>Desembolso relacionado<select name="loan_id"><option value="">Cuenta general</option></select></label>';
  if(kind==='followup')return `<div class="ll-floating-two">${field('Fecha','due_date',`type="date" value="${today()}" required`)}<label>Prioridad<select name="priority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div>${loan}<label>Motivo<textarea name="reason" rows="4" placeholder="Motivo o recordatorio" required></textarea></label>`;
  return `<div class="ll-floating-two"><label>Tipo de contacto<select name="contact_type">${[['NOTE','Nota'],['CALL','Llamada'],['TEXT','Texto'],['WHATSAPP','WhatsApp'],['EMAIL','Correo'],['IN_PERSON','En persona'],['OTHER','Otro']].map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>${field('Fecha','contact_date',`type="date" value="${today()}" required`)}</div>${loan}${field('Resultado','outcome','placeholder="Ej.: prometió pagar el viernes"')}<label>Notas<textarea name="notes" rows="4" placeholder="Escribe la nota del contacto" required></textarea></label>`;
}
async function actor(){
  const {data,error}=await db.auth.getUser();if(error)throw error;if(!data.user)throw new Error('No se encontró una sesión activa.');
  const profile=await db.from('profiles').select('role').eq('user_id',data.user.id).single();if(profile.error)throw profile.error;
  if(!['ADMIN','AGENT'].includes(profile.data?.role))throw new Error('Tu acceso permite consultar, pero no registrar movimientos.');
  return data.user.id;
}

export async function openQuickAction(kind,{accounts=null}={}){
  if(kind==='payment')return openRegisterDrawer({accounts});
  if(!['loan','followup','contact'].includes(kind))return;
  const owner=getPageSessionId();if(draftOwner!==owner){drafts.clear();draftOwner=owner;}
  const title={loan:'Nuevo desembolso',followup:'Programar seguimiento',contact:'Nota de contacto'}[kind];
  const saveLabel={loan:'Guardar desembolso',followup:'Crear seguimiento',contact:'Guardar nota'}[kind];
  let draft=drafts.get(kind);
  const panel=openFloatingPanel({label:title,html:floatingHeader(title,'Acción rápida')+'<div class="ll-floating-scroll" data-quick-body></div>',canClose:()=>!draft?.saving});
  if(!panel)return;
  if(!draft){
    const form=document.createElement('form');form.className='ll-floating-form';
    form.innerHTML=`<label>Cliente<select name="borrower_id" required><option value="">Selecciona un cliente</option></select></label><p class="ll-floating-help" data-quick-account></p>${fields(kind)}<p class="ll-floating-status" data-quick-status role="status" aria-live="polite"></p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Cancelar</button><button type="submit" disabled>${saveLabel}</button></div>`;
    draft={form,saving:false,ready:false,loanId:null,borrowerSequence:0};drafts.set(kind,draft);
  }
  const {form}=draft;
  panel.body.querySelector('[data-quick-body]').appendChild(form);
  const input=name=>form.querySelector(`[name="${name}"]`), value=name=>input(name)?.value?.trim()||'';
  const status=(text,error=false)=>{const node=form.querySelector('[data-quick-status]');node.textContent=text;node.className='ll-floating-status'+(error?' error':'');};
  const submit=form.querySelector('[type="submit"]');
  function fundingTotal(){const sum=[...form.querySelectorAll('[data-quick-share]')].reduce((n,node)=>n+Number(node.value||0),0);form.querySelector('[data-quick-funding-total]').textContent=`Total: ${sum.toFixed(2)}%${Math.abs(sum-100)>.01?' · Debe sumar 100%.':''}`;}
  async function borrowerChanged(){
    const id=value('borrower_id'),sequence=++draft.borrowerSequence;
    const account=(draft.accounts||[]).find(row=>String(row.borrower_id)===id);
    form.querySelector('[data-quick-account]').textContent=account?`Capital pendiente: ${money(account.principal_balance)}`:'';
    if(kind==='loan')return;
    input('loan_id').innerHTML='<option value="">Cuenta general</option>';
    if(!id)return;
    try{
      const result=await readPageQuery('quick-action-loans:'+id,()=>db.from('borrower_disbursements_view').select('id,start_date,principal_outstanding,status').eq('borrower_id',id).order('start_date',{ascending:false}),{ttl:45000});
      if(!panel.isCurrent()||sequence!==draft.borrowerSequence||id!==value('borrower_id'))return;
      if(result.error)throw result.error;
      input('loan_id').innerHTML='<option value="">Cuenta general</option>'+(result.data||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.start_date)} · ${money(row.principal_outstanding)}</option>`).join('');
    }catch(error){if(panel.isCurrent())status(error.message||'No se pudieron consultar los desembolsos.',true);}
  }
  form.onchange=event=>{if(event.target.name==='borrower_id')borrowerChanged();};
  form.oninput=event=>{if(event.target.matches('[data-quick-share]'))fundingTotal();};
  form.onsubmit=async event=>{
    event.preventDefault();if(draft.saving||!draft.ready||!form.reportValidity())return;
    draft.saving=true;submit.disabled=true;panel.setBusy(true);status(draft.loanId?'Completando distribución…':'Guardando…');
    try{
      const created_by=await actor();if(!panel.isCurrent())return;
      const borrower_id=value('borrower_id');if(!borrower_id)throw new Error('Selecciona un cliente.');
      if(kind==='contact'){
        const result=await db.from('borrower_contact_log').insert({borrower_id,created_by,loan_id:value('loan_id')||null,contact_date:value('contact_date'),contact_type:value('contact_type'),outcome:value('outcome')||null,notes:value('notes')});if(result.error)throw result.error;
      }else if(kind==='followup'){
        const result=await db.from('borrower_followups').insert({borrower_id,created_by,loan_id:value('loan_id')||null,due_date:value('due_date'),priority:value('priority'),reason:value('reason')});if(result.error)throw result.error;
      }else{
        const principal=Number(value('principal')),total=Number(value('rate_total'))/100,mgmt=Number(value('rate_mgmt'))/100;
        const funding=[...form.querySelectorAll('[data-quick-share]')].map(node=>({partner_user_id:node.dataset.quickShare,funding_percent:Number(node.value||0)/100})).filter(row=>row.funding_percent>0);
        if(!Number.isFinite(principal)||principal<=0)throw new Error('Escribe un capital mayor que cero.');
        if(mgmt>total)throw new Error('La administración no puede superar el interés total.');
        if(!funding.length||Math.abs(funding.reduce((sum,row)=>sum+row.funding_percent,0)-1)>.0001)throw new Error('La distribución debe sumar 100%.');
        if(!draft.loanId){
          const loan=await db.from('loans').insert({borrower_id,created_by,start_date:value('start_date'),principal_original:principal,principal_outstanding:principal,monthly_rate_total:total,monthly_rate_mgmt:mgmt,notes:value('notes')||null,status:'ACTIVE'}).select('id').single();
          if(loan.error)throw loan.error;draft.loanId=loan.data.id;
          // Retain this ID on a funding failure, so retry cannot create another loan.
          form.querySelectorAll('input,select,textarea').forEach(node=>{if(!node.matches('[data-quick-share]'))node.disabled=true;});
        }
        const result=await db.from('loan_funding').insert(funding.map(row=>({loan_id:draft.loanId,...row})));if(result.error)throw new Error('El desembolso se creó, pero falta completar su distribución. '+result.error.message);
      }
      drafts.delete(kind);invalidatePageReads();
      window.dispatchEvent(new CustomEvent('loan-ledger:account-changed',{detail:{borrowerId:borrower_id}}));
      if(panel.isCurrent()){
        form.innerHTML=`<p class="ll-floating-status success" role="status">${{loan:'Desembolso guardado.',contact:'Nota guardada.',followup:'Seguimiento creado.'}[kind]}</p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Listo</button></div>`;
        panel.focus('[data-close-floating-panel]');
      }
    }catch(error){if(panel.isCurrent()){status(error.message||String(error),true);if(draft.loanId)submit.textContent='Completar distribución';}}
    finally{draft.saving=false;submit.disabled=!draft.ready;panel.setBusy(false);}
  };
  if(draft.ready){panel.focus('[name="borrower_id"]');return;}
  try{
    const [accountResult,settings,profiles]=await Promise.all([
      accounts?Promise.resolve({data:accounts}):readPageQuery('quick-action-accounts',()=>db.from('borrower_account_summary').select('*').order('full_name',{ascending:true}),{ttl:45000}),
      kind==='loan'?readPageQuery('quick-action-settings',()=>db.from('app_settings').select('setting_key,setting_value').in('setting_key',['loan_defaults','default_funding_split']),{ttl:45000}):Promise.resolve({data:[]}),
      kind==='loan'?readPageQuery('quick-action-profiles',()=>db.from('profiles').select('user_id,full_name'),{ttl:45000}):Promise.resolve({data:[]})
    ]);
    if(!panel.isCurrent())return;
    for(const result of [accountResult,settings,profiles])if(result.error)throw result.error;
    draft.accounts=accountResult.data||[];
    const current=value('borrower_id');input('borrower_id').innerHTML='<option value="">Selecciona un cliente</option>'+draft.accounts.map(row=>`<option value="${esc(row.borrower_id)}">${esc(row.full_name)}</option>`).join('');input('borrower_id').value=current;
    if(kind==='loan'){
      const config=Object.fromEntries((settings.data||[]).map(row=>[row.setting_key,row.setting_value])),defaults=config.loan_defaults||{};
      input('rate_total').value=Number(defaults.default_total_monthly_rate??10).toFixed(2);input('rate_mgmt').value=Number(defaults.default_management_rate??3).toFixed(2);
      const names=new Map((profiles.data||[]).map(row=>[row.user_id,row.full_name]));
      const funding=Array.isArray(config.default_funding_split)?config.default_funding_split:[];
      form.querySelector('[data-quick-funding]').innerHTML=funding.length?funding.map(row=>`<label>${esc(names.get(row.partner_user_id)||row.partner_name||'Socio')}<input type="number" data-quick-share="${esc(row.partner_user_id)}" aria-label="Participación de ${esc(names.get(row.partner_user_id)||row.partner_name||'Socio')} en porcentaje" min="0" max="100" step="0.01" value="${(Number(row.funding_percent||0)*100).toFixed(2)}" required></label>`).join(''):'<p class="ll-floating-help">Configura la distribución predeterminada en Socios y usuarios para registrar un desembolso.</p>';
      fundingTotal();if(!funding.length)return;
    }
    draft.ready=true;submit.disabled=false;panel.focus('[name="borrower_id"]');
  }catch(error){if(panel.isCurrent()){status(error.message||'No se pudo preparar el formulario. Cierra el panel y vuelve a abrirlo para reintentar.',true);}}
}
