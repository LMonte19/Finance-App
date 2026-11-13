import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPageSessionId, readPageQuery, watchPage, invalidatePageReads, isStalePageSession, loadingRows } from './page-read-runtime.js?v=1';
import { ACCESS_OWNER_ID } from './admin-access.js?v=2';
import { esc, roleName } from './combined-workspace-ui.js?v=2';
import { openPaymentDetails } from './payment-management.js?v=17';

const db=createClient('https://eatxkhhpjruwwibhcubf.supabase.co','sb_publishable_cPGND1hI2aEkXRJE5XfmUA_COxH8A7q',
  {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'loan-ledger-auth'}});
const qs=id=>document.getElementById(id);
const owner=()=>getPageSessionId()===ACCESS_OWNER_ID;
let approved=false,busy=false,current=null,sessionVersion=0;
const read=force=>readPageQuery('owner-review',()=>db.rpc('get_owner_review'),{force});
const section=(title,content)=>`<section class="cw-card"><h2>${title}</h2>${content}</section>`;

function reset(){
  approved=false;current=null;busy=false;sessionVersion++;
  if(qs('systemCheckPage')?.classList.contains('active-page'))document.querySelector('.tab-btn[data-page="dashboardPage"]')?.click();
  qs('menuSystemCheck')?.remove();qs('systemCheckPage')?.remove();
}
function mount(){
  if(!owner()||!approved||qs('systemCheckPage'))return;
  const app=qs('app'),menu=qs('sideMenu');if(!app||!menu)return;
  const page=document.createElement('div');page.id='systemCheckPage';page.className='page ll-combined-page';page.dataset.combinedWorkspace='true';
  page.innerHTML=`<div class="cw-header"><div><h1>Revisión del sistema</h1><p>Diagnóstico, registros que requieren atención y roles del equipo.</p></div><button type="button" class="cw-button" data-review-refresh>Actualizar</button></div><p data-review-status role="status"></p><div data-review-body>${loadingRows()}</div>`;
  const btn=document.createElement('button');btn.type='button';btn.id='menuSystemCheck';btn.className='menu-link';btn.dataset.page=page.id;btn.textContent='Revisión del sistema';
  btn.onclick=()=>{
    if(!owner()||!approved)return;
    document.querySelectorAll('.tab-btn.active,.page.active-page').forEach(el=>el.classList.remove('active','active-page'));
    page.classList.add('active-page');menu.classList.remove('open');qs('menuOverlay')?.classList.remove('open');
    refresh();
  };
  page.addEventListener('click',event=>{
    if(!owner()||!approved)return;
    if(event.target.closest('[data-review-refresh]')){refresh(true);return;}
    const target=event.target.closest('[data-review-issue]');
    const issue=target&&current?.issues[Number(target.dataset.reviewIssue)];
    if(!issue)return;
    if(issue.action==='payment'){openPaymentDetails(issue.payment_id);return;}
    window.dispatchEvent(new CustomEvent('loan-ledger:open-account',{detail:{borrowerId:issue.borrower_id,loanId:issue.loan_id,editFunding:issue.action==='funding',overdue:issue.action==='account'}}));
  });
  page.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form.matches('[data-review-role]'))return;
    event.preventDefault();if(!owner()||!approved)return;
    const profile=current?.profiles.find(p=>p.user_id===form.dataset.reviewRole);
    const select=form.querySelector('select'),save=form.querySelector('button'),status=form.querySelector('[role=status]');
    if(!profile||profile.user_id===ACCESS_OWNER_ID||!['AGENT','PARTNER'].includes(select.value))return;
    save.disabled=true;select.disabled=true;status.textContent='Guardando…';
    try{
      const {error}=await db.rpc('update_profile_admin',{p_user_id:profile.user_id,p_full_name:profile.full_name,p_role:select.value});
      if(error)throw error;
      if(!owner()||!approved)return;
      invalidatePageReads();
      window.dispatchEvent(new CustomEvent('loan-ledger:profile-updated',{detail:{userId:profile.user_id}}));
      await refresh();
      if(owner()&&qs(page.id)===page)page.querySelector('[data-review-status]').textContent='Rol guardado.';
    }catch(error){if(form.isConnected)status.textContent=error.message||'No se pudo guardar el rol.';}
    finally{save.disabled=false;select.disabled=false;}
  });
  menu.append(btn);app.append(page);
}
function render(page,data){
  const issues=data.issues||[];
  const labels={payment:'Abrir detalle del pago',account:'Abrir calendario del cliente',funding:'Editar aportes',loan:'Abrir desembolso'};
  const issueList=entries=>entries.map(({issue,i})=>`<article class="compact-card"><strong>${esc(issue.borrower_name||'Sin cliente')} · ${esc(issue.title)}</strong><p>${esc(issue.details)}</p><button type="button" class="cw-button" data-review-issue="${i}">${labels[issue.action]}</button></article>`).join('');
  const all=issues.map((issue,i)=>({issue,i}));
  const body=page.querySelector('[data-review-body]');
  const html=section('Roles de acceso',`<p>Cambia quién entra como socio o administrador operativo. La cuenta propietaria está protegida.</p>${(data.profiles||[]).map(p=>p.user_id===ACCESS_OWNER_ID
    ? `<div class="ll-review-role"><strong>${esc(p.full_name)}</strong><span>Propietaria de la app</span></div>`
    : `<form class="ll-review-role" data-review-role="${esc(p.user_id)}"><strong>${esc(p.full_name||'Sin nombre')}</strong><select aria-label="Rol de ${esc(p.full_name||'usuario')}">${['PARTNER','AGENT'].map(role=>`<option value="${role}" ${p.role===role?'selected':''}>${roleName(role)}</option>`).join('')}</select><button type="submit" class="cw-button">Guardar rol</button><span role="status"></span></form>`).join('')}`)
    +section('Resultados',`<p>${issues.length?issues.length+' registros para revisar.':'No se detectaron incidencias.'}</p>${(data.checks||[]).map(c=>{
      const matches=all.filter(x=>x.issue.check_code===c.check_code);
      return `<details class="ll-review-check" ${matches.length?'open':''}><summary><strong>${esc(c.summary)}</strong><span>${c.status==='PASS'?(matches.length?'Ver cuentas':'Bien'):c.status==='WARN'?'Revisar':'Falla'}</span></summary><p>${esc(c.details||'')}</p>${issueList(matches)}${c.check_code==='VIRTUAL_CALENDAR'?'<button type="button" class="cw-button" data-review-due>Ver cuotas y vencimientos</button>':''}</details>`;
    }).join('')}`)
    +`<details class="cw-card"><summary><strong>Permisos por rol</strong></summary>${['ADMIN','AGENT','PARTNER'].map(role=>`<h3>${roleName(role)}</h3><ul>${(data.permissions||[]).filter(p=>p.role===role).map(p=>`<li>${esc(p.capability)}: ${p.allowed?'Sí':'No'}</li>`).join('')}<li>Revisión del sistema: ${role==='ADMIN'?'Sí':'No'}</li></ul>`).join('')}</details>`;
  if(body.dataset.markup!==html){body.innerHTML=html;body.dataset.markup=html;body.querySelector('[data-review-due]')?.addEventListener('click',()=>qs('menuDueOverdue')?.click());}
}
async function refresh(force=false){
  if(!owner()||busy)return;
  busy=true;const request=sessionVersion;
  try{
    const {data,error}=await read(force);
    if(!owner()||request!==sessionVersion)return;
    if(error)throw error;
    approved=true;current=data;mount();
    const page=qs('systemCheckPage');
    if(page?.classList.contains('active-page'))render(page,data);
  }catch(error){
    if(!owner()||request!==sessionVersion||isStalePageSession(error))return;
    const status=qs('systemCheckPage')?.querySelector('[data-review-status]');
    if(status)status.textContent='No se pudo actualizar la revisión. Inténtalo de nuevo.';
  }finally{if(request===sessionVersion)busy=false;}
}

watchPage('systemCheckPage',refresh,{reset:()=>{reset();if(owner())queueMicrotask(()=>refresh());}});
if(owner())refresh();
