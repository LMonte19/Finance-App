import { escapeText as esc } from './client-directory.js?v=1';
import { readPageQuery } from './page-read-runtime.js?v=1';

const widgets=new WeakMap();
const dateLabel=iso=>new Date(iso+'T00:00:00').toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'}).replace('.','');
export function installmentLinksMarkup(){
  return `<div data-installment-links>
    <label>Fecha de ejecución <small>(opcional)</small><input name="execution_date" type="date"></label>
    <details class="ll-flow-details"><summary>Cuotas vinculadas <span data-link-count></span></summary><div data-link-dates class="ll-flow-date-list"></div></details>
  </div>`;
}
export function readInstallmentLinkFields(host){
  return {execution_date:host.querySelector('[name="execution_date"]')?.value||null,
    installment_dates:[...host.querySelectorAll('[data-link-date]:checked')].map(input=>input.value).sort()};
}
export function describeInstallmentLinks(row){
  const details=[];
  if(row.execution_date)details.push('Ejecución: '+dateLabel(row.execution_date));
  if(row.installment_dates?.length)details.push('Cuotas: '+row.installment_dates.map(dateLabel).join(', '));
  return details.join(' · ');
}
export function borrowerInstallmentRows(db,borrowerId){
  const now=new Date(),end=new Date(Date.UTC(now.getUTCFullYear()+1,now.getUTCMonth()+1,0)).toISOString().slice(0,10);
  return readPageQuery('installment-links:'+borrowerId+':'+end,()=>db.rpc('get_borrower_due_calendar',
    {p_borrower_id:borrowerId,p_start_date:null,p_end_date:end}),{ttl:45000}).then(({data,error})=>{if(error)throw error;return data||[];});
}
export function attachInstallmentLinks(host,{load}){
  if(!host)return null;
  if(widgets.has(host))return widgets.get(host);
  const list=host.querySelector('[data-link-dates]'),count=host.querySelector('[data-link-count]');
  let sequence=0,account=null,selected=[];
  function updateCount(){count.textContent=selected.length?' · '+selected.length:'';}
  const controller={
    async set(borrowerId,rows=null,{force=false}={}){
      if(!force&&borrowerId===account&&rows===null)return;
      const request=++sequence;
      if(account!==borrowerId)selected=[];
      account=borrowerId;
      list.innerHTML=borrowerId?'<p class="ll-flow-help">Consultando cuotas…</p>':'<p class="ll-flow-help">Selecciona un cliente.</p>';
      updateCount();if(!borrowerId)return;
      try{
        const data=(rows??await load(borrowerId)).filter(row=>row.status!=='CANCELLED');
        if(request!==sequence)return;
        selected=selected.filter(iso=>data.some(row=>row.due_date===iso));updateCount();
        const now=Date.now(),distance=row=>Math.abs(Date.parse(row.due_date)-now);
        list.innerHTML=data.length?[...data].sort((a,b)=>distance(a)-distance(b)||a.due_date.localeCompare(b.due_date)).map(row=>
          `<label><input type="checkbox" data-link-date value="${esc(row.due_date)}"${selected.includes(row.due_date)?' checked':''}><span>${esc(dateLabel(row.due_date))}</span></label>`).join('')
          :'<p class="ll-flow-help">Este cliente aún no tiene cuotas.</p>';
      }catch(error){
        if(request!==sequence)return;
        account=null;list.innerHTML='<p class="ll-flow-help">No se pudieron consultar las cuotas. <button type="button" class="ll-flow-link" data-link-retry>Reintentar</button></p>';
        list.querySelector('[data-link-retry]').onclick=()=>controller.set(borrowerId);
      }
    },
    reset(){selected=[];list.querySelectorAll('[data-link-date]').forEach(input=>{input.checked=false;});updateCount();}
  };
  host.addEventListener('change',event=>{
    if(event.target.matches('[data-link-date]')){selected=[...list.querySelectorAll(':checked')].map(input=>input.value);updateCount();}
  });
  widgets.set(host,controller);return controller;
}
