import { esc } from './combined-workspace-ui.js?v=2';
import { collectRows } from './report-exports.js?v=2';
import { getPageSessionId } from './page-read-runtime.js?v=1';

const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value||0)/100);
const cents = value => Math.round(Number(value||0)*100);
const day = value => value ? new Date(value+'T12:00:00').toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'}) : '—';
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4))>=1900;
function endOfMonth(month) {
  const [y,m] = month.split('-').map(Number);
  return month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate());
}

export function monthlySummary(month, workspaces, loans, funding, names, manager) {
  const dues=[], receipts=[], parties=new Map();
  let expected=0,paid=0,pending=0,cash=0,unassigned=0;
  const payout=(name,kind)=> {
    const key=JSON.stringify([kind,name]);
    if(!parties.has(key))parties.set(key,{name,kind,collected:0,projected:0});
    return parties.get(key);
  };
  for(const workspace of workspaces){
    const {rows,payments}=workspace;
    const accountLoans=loans.filter(l=>l.borrower_id===workspace.id&&!['VOIDED','VOID'].includes(l.status));
    const valid=payments.filter(p=>!p.is_voided);
    const moves=new Map();
    for(const p of valid) {
      const principal=p.principal_applications?.length?p.principal_applications:(cents(p.applied_principal)>0?[{loan_id:p.loan_id,amount:p.applied_principal}]:[]);
      for(const a of principal){
        if(!moves.has(a.loan_id))moves.set(a.loan_id,[]);
        moves.get(a.loan_id).push({date:p.paid_on,amount:cents(a.amount)});
      }
      if(p.paid_on?.startsWith(month)){
        cash+=cents(p.amount);receipts.push(p);
        for(const a of p.allocations||[]){
          if(a.is_voided)continue;
          const kind=a.allocation_type==='MANAGEMENT_FEE'?'Administración':'Socia / socio';
          payout(a.partner_name||'Sin nombre',kind).collected+=cents(a.amount);
        }
      }
    }
    for(const row of rows.filter(r=>r.due_date?.startsWith(month)&&r.status!=='CANCELLED')){
      const original=cents(row.expected_total), collected=cents(row.paid_total), left=cents(row.amount_due);
      if(!(original||collected||left))continue;
      const applied=valid.flatMap(p=>(p.due_applications||[]).filter(a=>a.due_date===row.due_date)
        .map(a=>({date:p.paid_on,amount:cents(a.applied_total)})));
      dues.push({...row,original,collected,left,applied});
      expected+=original;paid+=collected;pending+=left;
      if(left<=0)continue;
      const mgmt=Math.min(left,Math.max(0,cents(row.expected_mgmt)-cents(row.paid_mgmt)));
      if(mgmt>0){
        if(manager)payout(manager,'Administración').projected+=mgmt;
        else unassigned+=mgmt;
      }
      const funders=left-mgmt;
      if(!funders)continue;
      const weights=new Map();
      let incomplete=false;
      for(const loan of accountLoans.filter(l=>l.start_date<=row.due_date)){
        const originalPrincipal=cents(loan.principal_original);
        const capital=Math.max(0,originalPrincipal-(moves.get(loan.id)||[])
          .filter(m=>m.date<row.due_date&&loan.start_date<row.due_date).reduce((total,m)=>total+m.amount,0));
        const fee=capital*Math.max(0,Number(loan.monthly_rate_total??.10)-Number(loan.monthly_rate_mgmt??.03));
        if(!fee)continue;
        const shares=funding.filter(f=>f.loan_id===loan.id).map(f=>({
          id:f.partner_user_id,share:f.contributed_amount==null?Number(f.funding_percent):cents(f.contributed_amount)/originalPrincipal,
        }));
        if(Math.abs(1-shares.reduce((n,f)=>n+f.share,0))>.001){incomplete=true;break;}
        for(const f of shares)weights.set(f.id,(weights.get(f.id)||0)+fee*f.share);
      }
      const total=[...weights.values()].reduce((n,v)=>n+v,0);
      if(incomplete||!total){unassigned+=funders;continue;}
      let running=0,assigned=0;
      for(const [id,weight] of [...weights].sort(([a],[b])=>a.localeCompare(b))){
        running+=weight;
        const next=Math.round(funders*running/total);
        if(next>assigned)payout(names.get(id)||'Socio sin nombre','Socia / socio').projected+=next-assigned;
        assigned=next;
      }
    }
  }
  return {dues:dues.sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.borrower_name.localeCompare(b.borrower_name,'es')),
    receipts:receipts.sort((a,b)=>b.paid_on.localeCompare(a.paid_on)),parties:[...parties.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')),
    expected,paid,pending,cash,unassigned};
}

async function readMonth(db,month){
  const owner=getPageSessionId(),end=endOfMonth(month);
  const [accounts,loans,funding,profiles,admin]=await Promise.all([
    collectRows(()=>db.from('borrowers').select('id,full_name').order('id')),
    collectRows(()=>db.from('loans').select('id,borrower_id,start_date,status,principal_original,monthly_rate_total,monthly_rate_mgmt').lte('start_date',end).order('id')),
    collectRows(()=>db.from('loan_funding').select('loan_id,partner_user_id,funding_percent,contributed_amount').order('id')),
    collectRows(()=>db.from('profiles').select('user_id,full_name').order('user_id')),
    db.from('operational_administrators').select('full_name').eq('receives_management_fee',true).maybeSingle(),
  ]);
  if(admin.error)throw admin.error;
  const workspaces=[];
  for(let i=0;i<accounts.length;i+=8){
    if(getPageSessionId()!==owner)throw new Error('La sesión cambió.');
    workspaces.push(...await Promise.all(accounts.slice(i,i+8).map(async account=>{
      const {data,error}=await db.rpc('get_borrower_calendar_workspace',{p_borrower_id:account.id,p_end_date:end});
      if(error)throw error;
      if(!data)throw new Error('No se pudo consultar una cuenta.');
      return {id:account.id,rows:data.rows||[],payments:(data.payments||[]).map(p=>({...p,borrower_name:p.borrower_name||account.full_name}))};
    })));
  }
  return monthlySummary(month,workspaces,loans,funding,new Map(profiles.map(p=>[p.user_id,p.full_name])),admin.data?.full_name);
}

const table=(head,rows,empty)=>rows.length?`<div class="ll-month-table"><table><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p>${empty}</p>`;
const cells=(...values)=>`<tr>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
function reportHtml(r){
  const metrics=[['Cuotas del mes',r.expected],['Aplicado a esas cuotas',r.paid],['Pendiente de esas cuotas',r.pending],['Cobrado en el mes',r.cash]];
  return `<div class="ll-month-metrics">${metrics.map(([label,value])=>`<div><small>${label}</small><strong>${money(value)}</strong></div>`).join('')}</div>
    <section><h3>Distribución por persona</h3><p>Lo cobrado se agrupa por fecha de pago; la proyección solo incluye lo pendiente de las cuotas de este mes. Los abonos a capital se muestran por separado. Las asignaciones no confirman transferencias.</p>
    ${table(['Persona','Concepto','Asignado en cobros del mes','Previsto por cobrar','Total estimado'],[
      ...r.parties.map(p=>cells(esc(p.name),p.kind,money(p.collected),money(p.projected),money(p.collected+p.projected))),
      ...(r.unassigned?[cells('Por asignar','Distribución incompleta','—',money(r.unassigned),money(r.unassigned))]:[])
    ],'No hay distribuciones para este mes.')}</section>
    <section><h3>Cuotas con vencimiento en el mes</h3>${table(['Vence','Cliente','Cuota','Aplicado','Pendiente','Pagos aplicados'],r.dues.map(d=>cells(day(d.due_date),esc(d.borrower_name),money(d.original),money(d.collected),money(d.left),d.applied.map(a=>`${day(a.date)} · ${money(a.amount)}`).join('<br>')||(d.collected?'Sin recibo vinculado':'—'))),'No hay cuotas en este mes.')}</section>
    <section><h3>Pagos cobrados en el mes</h3>${table(['Fecha','Cliente','Pago','Capital','Cuotas cubiertas'],r.receipts.map(p=>cells(day(p.paid_on),esc(p.borrower_name||'Cliente'),money(cents(p.amount)),money(cents(p.applied_principal)),(p.due_applications||[]).map(a=>`<span title="${esc(a.due_date)}">${day(a.due_date)} · ${money(cents(a.applied_total))}</span>`).join('<br>')||'—')),'No hay pagos cobrados en este mes.')}</section>`;
}

export function openMonthlySummary(db,trigger,month){
  const app=document.getElementById('app'),owner=getPageSessionId();
  if(!app||!owner||app.querySelector('.ll-month-dialog'))return;
  const dialog=document.createElement('dialog');
  dialog.className='ll-month-dialog';dialog.setAttribute('aria-labelledby','llMonthlyTitle');
  dialog.innerHTML=`<header><h2 id="llMonthlyTitle">Resumen mensual</h2><button type="button" data-month-close aria-label="Cerrar" autofocus>×</button></header>
    <div class="ll-month-scroll"><div class="ll-month-controls"><button type="button" data-month-step="-1" aria-label="Mes anterior">‹</button><label>Mes <input type="month" value="${esc(month)}" aria-label="Mes del resumen"></label><button type="button" data-month-step="1" aria-label="Mes siguiente">›</button></div>
    <p data-month-status role="status"></p><div data-month-report></div></div>`;
  const report=dialog.querySelector('[data-month-report]'),status=dialog.querySelector('[data-month-status]');
  let sequence=0;
  const observer=new MutationObserver(()=>{if(getPageSessionId()!==owner)dialog.close();});
  dialog.querySelector('[data-month-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{sequence++;observer.disconnect();dialog.remove();trigger?.focus({preventScroll:true});},{once:true});
  async function load(value){
    const request=++sequence;
    report.replaceChildren();
    if(!validMonth(value)){status.textContent='Selecciona un mes válido.';return;}
    status.textContent='Consultando cuotas y pagos…';
    try{
      const summary=await readMonth(db,value);
      if(request!==sequence||owner!==getPageSessionId())return;
      status.textContent='';report.innerHTML=reportHtml(summary);
    }catch{
      if(request===sequence&&owner===getPageSessionId())status.textContent='No se pudo cargar el resumen. Cierra la ventana y vuelve a intentarlo.';
    }
  }
  const input=dialog.querySelector('input');
  input.onchange=()=>load(input.value);
  for(const button of dialog.querySelectorAll('[data-month-step]'))button.onclick=()=>{
    const [year,selected]=(validMonth(input.value)?input.value:month).split('-').map(Number);
    const target=new Date(Date.UTC(year,selected-1+Number(button.dataset.monthStep),1));
    const next=target.toISOString().slice(0,7);
    if(validMonth(next)){input.value=next;load(next);}
  };
  app.append(dialog);
  observer.observe(app,{attributes:true,attributeFilter:['style']});
  dialog.showModal();
  load(month);
}
