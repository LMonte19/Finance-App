import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readPageQuery, invalidatePageReads, getPageSessionId } from './page-read-runtime.js?v=1';
import { openFloatingPanel, floatingHeader } from './floating-panel.js?v=1';
import { openRegisterDrawer } from './payment-management.js?v=11';
import { CLIENT_CHANGED, escapeText as esc, fillClientSelect, mergeClientAccount, clientWriter } from './client-directory.js?v=1';
import { attachNewClientForm } from './client-form.js?v=1';
import { attachFundingEditor } from './funding-editor.js?v=1';
import { installmentLinksMarkup, attachInstallmentLinks, borrowerInstallmentRows, readInstallmentLinkFields } from './installment-links.js?v=1';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const today=()=>new Date().toISOString().slice(0,10);
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
const drafts=new Map();
let draftOwner;
const field=(label,name,attrs='')=>`<label>${label}<input name="${name}" ${attrs}></label>`;
const titles={loan:'Nuevo desembolso',followup:'Programar seguimiento',contact:'Nota de contacto'};
const saveLabels={loan:'Guardar desembolso',followup:'Crear seguimiento',contact:'Guardar nota'};
function fields(kind){
  if(kind==='loan')return `${field('Capital desembolsado','principal','type="number" min="0.01" max="9999999999.99" step="0.01" required')}${field('Fecha de inicio','start_date',`type="date" value="${today()}" required`)}<div class="ll-floating-two">${field('Interés mensual total %','rate_total','type="number" min="0" max="9999.99" step="0.01" required')}${field('Administración %','rate_mgmt','type="number" min="0" max="9999.99" step="0.01" required')}</div><label>Notas<input name="notes" placeholder="Notas opcionales"></label><div data-quick-funding></div>`;
  const loan='<label>Desembolso relacionado<select name="loan_id"><option value="">Cuenta general</option></select></label>';
  if(kind==='followup')return `<div class="ll-floating-two">${field('Fecha de seguimiento','due_date',`type="date" value="${today()}" required`)}<label>Prioridad<select name="priority"><option value="NORMAL">Normal</option><option value="LOW">Baja</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label></div>${loan}${installmentLinksMarkup()}<label>Motivo<textarea name="reason" rows="4" placeholder="Motivo o recordatorio" required></textarea></label>`;
  return `<div class="ll-floating-two"><label>Tipo de contacto<select name="contact_type">${[['NOTE','Nota'],['CALL','Llamada'],['TEXT','Texto'],['WHATSAPP','WhatsApp'],['EMAIL','Correo'],['IN_PERSON','En persona'],['OTHER','Otro']].map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>${field('Fecha de contacto','contact_date',`type="date" value="${today()}" required`)}</div>${loan}${installmentLinksMarkup()}${field('Resultado','outcome','placeholder="Ej.: prometió pagar el viernes"')}<label>Notas<textarea name="notes" rows="4" placeholder="Escribe la nota del contacto" required></textarea></label>`;
}

export async function openQuickAction(kind,{accounts=null,borrowerId='',trigger}={}){
  if(kind==='payment')return openRegisterDrawer({accounts,borrowerId});
  if(!Object.hasOwn(titles,kind))return;
  const owner=getPageSessionId();if(draftOwner!==owner){drafts.clear();draftOwner=owner;}
  let draft=drafts.get(kind);
  const title=titles[kind];
  const panel=openFloatingPanel({label:title,trigger,html:floatingHeader(title)+'<div class="ll-floating-scroll"><div data-quick-body></div><div data-inline-client hidden></div></div>',
    canClose:()=>!draft?.saving&&!draft?.creatingClient});
  if(!panel)return;
  if(!draft){
    const form=document.createElement('form');form.className='ll-floating-form';
    form.innerHTML=`<div class="ll-flow-picker"><label>Cliente<select name="borrower_id" required><option value="">Selecciona un cliente</option></select></label>${kind==='loan'?'<button type="button" class="ll-flow-link" data-quick-new-client disabled>+ Nuevo cliente</button>':''}</div>
      <p class="ll-floating-help" data-quick-account hidden></p>${fields(kind)}<p class="ll-floating-status" data-quick-status role="status"></p>
      <div class="ll-floating-actions"><button type="button" data-close-floating-panel>Cancelar</button><button type="submit" disabled>${saveLabels[kind]}</button></div>`;
    draft={form,saving:false,creatingClient:false,ready:false,accounts:[],borrowerSequence:0};drafts.set(kind,draft);
  }
  const {form}=draft,formHost=panel.body.querySelector('[data-quick-body]'),clientHost=panel.body.querySelector('[data-inline-client]');
  formHost.appendChild(form);
  const input=name=>form.querySelector(`[name="${name}"]`), value=name=>input(name)?.value?.trim()||'';
  const picker=input('borrower_id'),submit=form.querySelector('[type="submit"]'),newClient=form.querySelector('[data-quick-new-client]');
  const linkWidget=attachInstallmentLinks(form.querySelector('[data-installment-links]'),{load:id=>borrowerInstallmentRows(db,id)});
  const status=(text,error=false)=>{const node=form.querySelector('[data-quick-status]');node.textContent=text;node.className='ll-floating-status'+(error?' error':'');};
  async function borrowerChanged(){
    const id=value('borrower_id'),sequence=++draft.borrowerSequence,loanSelect=input('loan_id');
    const account=draft.accounts.find(row=>String(row.borrower_id)===id),context=form.querySelector('[data-quick-account]');
    context.hidden=!account;context.textContent=account?`Capital pendiente: ${money(account.principal_balance)}`:'';
    linkWidget?.set(id);
    if(!loanSelect)return;
    const prior=loanSelect.dataset.borrower===id?loanSelect.value:'';
    loanSelect.dataset.borrower=id;
    if(!prior)loanSelect.innerHTML='<option value="">Cuenta general</option>';
    if(!id)return;
    try{
      const result=await readPageQuery('quick-action-loans:'+id,()=>db.from('borrower_disbursements_view').select('id,start_date,principal_outstanding').eq('borrower_id',id).order('start_date',{ascending:false}),{ttl:45000});
      if(!panel.isCurrent()||sequence!==draft.borrowerSequence||id!==value('borrower_id'))return;
      if(result.error)throw result.error;
      loanSelect.innerHTML='<option value="">Cuenta general</option>'+(result.data||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.start_date)} · ${money(row.principal_outstanding)}</option>`).join('');
      if([...loanSelect.options].some(option=>option.value===prior))loanSelect.value=prior;
    }catch(error){if(panel.isCurrent())status(error.message||'No se pudieron consultar los desembolsos.',true);}
  }
  if(newClient)newClient.onclick=()=>{
    if(draft.saving||draft.creatingClient)return;
    formHost.hidden=true;clientHost.hidden=false;
    const back=()=>{
      if(!panel.isCurrent())return;
      clientHost.hidden=true;clientHost.replaceChildren();formHost.hidden=false;
      panel.focus('[name="borrower_id"]');
    };
    attachNewClientForm(clientHost,{db,inline:true,onCancel:back,
      onBusy:busy=>{draft.creatingClient=busy;panel.setBusy(busy);},
      onSave:client=>{
        if(!panel.isCurrent())return;
        draft.accounts=mergeClientAccount(draft.accounts,client);
        fillClientSelect(picker,draft.accounts,client.id);
        borrowerChanged();back();
      }}).focus();
  };
  form.onchange=event=>{if(event.target===picker)borrowerChanged();};
  form.oninput=event=>{if(event.target===input('principal'))draft.editor?.refresh();};
  form.onsubmit=async event=>{
    event.preventDefault();if(draft.saving||!draft.ready||!form.reportValidity())return;
    draft.saving=true;submit.disabled=true;panel.setBusy(true);status('Guardando…');
    try{
      const borrower_id=value('borrower_id');if(!borrower_id)throw new Error('Selecciona un cliente.');
      let result;
      if(kind==='loan'){
        const rate=name=>Number((Number(value(name))/100).toFixed(4));
        result=await db.rpc('create_funded_disbursement',{p_borrower_id:borrower_id,p_start_date:value('start_date'),
          p_principal:Number(value('principal')),p_rate_total:rate('rate_total'),p_rate_mgmt:rate('rate_mgmt'),p_notes:value('notes')||null,
          p_contributions:draft.editor.values()});
      }else{
        const created_by=await clientWriter(db);if(!panel.isCurrent())return;
        const common={borrower_id,created_by,loan_id:value('loan_id')||null,...readInstallmentLinkFields(form)};
        result=kind==='contact'?await db.from('borrower_contact_log').insert({...common,contact_date:value('contact_date'),contact_type:value('contact_type'),outcome:value('outcome')||null,notes:value('notes')}):
          await db.from('borrower_followups').insert({...common,due_date:value('due_date'),priority:value('priority'),reason:value('reason')});
      }
      if(result.error)throw result.error;
      if(!panel.isCurrent())return;
      drafts.delete(kind);invalidatePageReads();
      window.dispatchEvent(new CustomEvent('loan-ledger:account-changed',{detail:{borrowerId:borrower_id}}));
      form.innerHTML=`<p class="ll-floating-status success" role="status">${{loan:'Desembolso guardado.',contact:'Nota guardada.',followup:'Seguimiento creado.'}[kind]}</p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Listo</button></div>`;
      panel.focus('[data-close-floating-panel]');
    }catch(error){if(panel.isCurrent())status(error.message||String(error),true);}
    finally{draft.saving=false;submit.disabled=!draft.ready;panel.setBusy(false);}
  };
  draft.ready=false;submit.disabled=true;if(newClient)newClient.disabled=true;status('Consultando clientes…');
  try{
    const [accountResult,settings,profiles]=await Promise.all([
      readPageQuery('quick-action-accounts',()=>db.from('borrower_account_summary').select('borrower_id,full_name,principal_balance').order('full_name',{ascending:true}),{ttl:45000}),
      kind==='loan'&&!draft.editor?readPageQuery('quick-action-settings',()=>db.from('app_settings').select('setting_key,setting_value').in('setting_key',['loan_defaults','default_funding_split']),{ttl:45000}):Promise.resolve({data:[]}),
      kind==='loan'&&!draft.editor?readPageQuery('quick-action-profiles',()=>db.from('profiles').select('user_id,full_name').in('role',['ADMIN','PARTNER']).order('full_name'),{ttl:45000}):Promise.resolve({data:[]})
    ]);
    if(!panel.isCurrent())return;
    for(const result of [accountResult,settings,profiles])if(result.error)throw result.error;
    draft.accounts=accountResult.data||[];
    fillClientSelect(picker,draft.accounts,borrowerId||picker.value);
    if(kind==='loan'&&!draft.editor){
      const config=Object.fromEntries((settings.data||[]).map(row=>[row.setting_key,row.setting_value])),defaults=config.loan_defaults||{};
      input('rate_total').value=Number(defaults.default_total_monthly_rate??10).toFixed(2);input('rate_mgmt').value=Number(defaults.default_management_rate??3).toFixed(2);
      draft.editor=attachFundingEditor(form.querySelector('[data-quick-funding]'),{people:profiles.data||[],
        preset:Array.isArray(config.default_funding_split)?config.default_funding_split:[],total:()=>value('principal')});
    }
    if(newClient)newClient.disabled=false;
    draft.ready=true;submit.disabled=false;status('');borrowerChanged();panel.focus('[name="borrower_id"]');
  }catch(error){if(panel.isCurrent())status(error.message||'No se pudo preparar el formulario. Vuelve a abrirlo para reintentar.',true);}
}

window.addEventListener(CLIENT_CHANGED,event=>{
  if(draftOwner!==getPageSessionId()||!event.detail?.client)return;
  for(const draft of drafts.values()){
    draft.accounts=mergeClientAccount(draft.accounts,event.detail.client);
    fillClientSelect(draft.form.querySelector('[name="borrower_id"]'),draft.accounts);
  }
});
