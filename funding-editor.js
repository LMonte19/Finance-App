import { escapeText as esc } from './client-directory.js?v=1';
import { openFloatingPanel, floatingHeader } from './floating-panel.js?v=1';
import { invalidatePageReads } from './page-read-runtime.js?v=1';

const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
function cents(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=9999999999.99&&Math.abs(n*100-Math.round(n*100))<.001?Math.round(n*100):null;
}
export function allocateContributionAmounts(total,shares) {
  const units=cents(total);if(!units)return [];
  const sum=shares.reduce((n,s)=>n+Number(s.funding_percent),0);if(!(sum>0))return [];
  let running=0,previous=0;
  return shares.map(share=>{
    running+=Number(share.funding_percent);
    const next=Math.round(units*running/sum),amount=(next-previous)/100;
    previous=next;
    return {partner_user_id:share.partner_user_id,amount};
  });
}
export function attachFundingEditor(host,{people,preset=[],total,initial=[]}){
  const options=new Map(people.map(person=>[String(person.user_id),person.full_name||'Socio']));
  const presetValid=preset.length&&new Set(preset.map(x=>x.partner_user_id)).size===preset.length&&
    preset.every(row=>options.has(String(row.partner_user_id))&&Number(row.funding_percent)>0)&&
    Math.abs(preset.reduce((sum,row)=>sum+Number(row.funding_percent),0)-1)<.001;
  host.innerHTML=`<fieldset class="ll-flow-fieldset"><legend>Distribución de inversión</legend><p class="ll-flow-help">Agrega solo a quienes aportan. Puedes asignar el 100% a una sola persona.</p>
    <div class="ll-funding-entries"></div><div class="ll-flow-tools"><button type="button" class="ll-flow-link" data-funding-add>+ Agregar socio</button>
    ${presetValid?'<button type="button" class="ll-flow-link" data-funding-preset>Usar distribución predeterminada</button>':''}</div><p class="ll-flow-help" data-funding-total aria-live="polite"></p></fieldset>`;
  const rows=host.querySelector('.ll-funding-entries'),totalLabel=host.querySelector('[data-funding-total]'),add=host.querySelector('[data-funding-add]');
  const entries=()=>[...rows.querySelectorAll('.ll-funding-entry')].map(row=>({row,select:row.querySelector('select'),amount:row.querySelector('input')}));
  function refresh(){
    const current=entries(),limit=cents(total()),sum=current.reduce((n,r)=>n+(cents(r.amount.value)||0),0);
    const selected=new Set(current.map(r=>r.select.value).filter(Boolean));
    current.forEach(({row,select,amount})=>{
      [...select.options].forEach(option=>{option.disabled=option.value!==select.value&&selected.has(option.value);});
      const c=cents(amount.value)||0,percent=limit?c/limit*100:0;
      row.querySelector('[data-funding-percent]').textContent=limit?(percent>0&&percent<.01?'<0.01%':percent.toFixed(2)+'%'):'—';
    });
    add.disabled=current.length>=options.size||current.length>=50;
    const difference=(limit??0)-sum;
    totalLabel.textContent=`Aportado: ${money(sum/100)} de ${money((limit??0)/100)}${difference>0?` · Falta ${money(difference/100)}`:difference<0?` · Excede por ${money(-difference/100)}`:''}`;
  }
  function addRow({partner_user_id='',amount=''}={},focus=false){
    const row=document.createElement('div');row.className='ll-funding-entry';
    row.innerHTML=`<label>Socio<select aria-label="Socio que aporta" required><option value="">Selecciona un socio</option>${[...options].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select></label>
      <label>Aporte<input type="number" aria-label="Monto aportado" min="0.01" step="0.01" value="${esc(amount)}" required></label><output data-funding-percent aria-label="Participación"></output><button type="button" class="ll-flow-remove" data-funding-remove aria-label="Quitar socio">×</button>`;
    row.querySelector('select').value=partner_user_id;rows.appendChild(row);refresh();
    if(focus)row.querySelector('select').focus();
  }
  add.onclick=()=>{const remaining=(cents(total())||0)-entries().reduce((n,r)=>n+(cents(r.amount.value)||0),0);addRow({amount:remaining>0?remaining/100:''},true);};
  host.querySelector('[data-funding-preset]')?.addEventListener('click',()=>{
    if(!cents(total())){totalLabel.textContent='Ingresa el capital desembolsado antes de usar la distribución predeterminada.';return;}
    rows.replaceChildren();allocateContributionAmounts(total(),preset).filter(row=>row.amount>0).forEach(row=>addRow(row));
    refresh();
  });
  rows.addEventListener('input',refresh);
  rows.addEventListener('change',refresh);
  rows.addEventListener('click',event=>{const button=event.target.closest('[data-funding-remove]');if(button){button.closest('.ll-funding-entry').remove();refresh();add.focus();}});
  initial.forEach(row=>addRow(row));refresh();
  return {refresh,values(){
    const current=entries().map(r=>({partner_user_id:r.select.value,cents:cents(r.amount.value)}));
    const sum=current.reduce((n,r)=>n+(r.cents||0),0);
    if(!current.length||current.some(r=>!options.has(r.partner_user_id)||!r.cents)||new Set(current.map(r=>r.partner_user_id)).size!==current.length)
      throw new Error('Selecciona socios distintos e indica cuánto aportó cada uno.');
    if(!cents(total())||sum!==cents(total()))throw new Error('Los aportes deben sumar exactamente el capital desembolsado.');
    return current.map(r=>({partner_user_id:r.partner_user_id,amount:r.cents/100}));
  }};
}

export function openFundingEditor(db,{loan,people,trigger}){
  let saving=false;
  const panel=openFloatingPanel({label:'Editar aportes',trigger,canClose:()=>!saving,
    html:floatingHeader('Editar aportes','Desembolso del '+loan.start_date)+`<div class="ll-floating-scroll"><form class="ll-floating-form"><p class="ll-flow-help">Capital desembolsado: <strong>${money(Number(loan.principal_original))}</strong>. Los pagos ya registrados conservan su distribución.</p><div data-edit-contributions></div><p class="ll-floating-status" role="status"></p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Cancelar</button><button type="submit">Guardar aportes</button></div></form></div>`});
  if(!panel)return;
  const initial=loan.funding?.length?(loan.funding.every(row=>row.contributed_amount!=null)
    ? loan.funding.map(row=>({...row,amount:row.contributed_amount}))
    : allocateContributionAmounts(loan.principal_original,loan.funding)):[];
  const form=panel.body.querySelector('form'),status=form.querySelector('[role="status"]');
  const editor=attachFundingEditor(form.querySelector('[data-edit-contributions]'),{people,total:()=>loan.principal_original,initial});
  form.onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const button=form.querySelector('[type="submit"]');
    saving=true;panel.setBusy(true);button.disabled=true;status.classList.remove('error');status.textContent='Guardando aportes…';
    try{
      const {error}=await db.rpc('update_loan_contributions',{p_loan_id:loan.id,p_contributions:editor.values()});
      if(error)throw error;
      invalidatePageReads();
      window.dispatchEvent(new CustomEvent('loan-ledger:account-changed',{detail:{borrowerId:loan.borrower_id}}));
      if(panel.isCurrent()){
        form.innerHTML='<p class="ll-floating-status success" role="status">Aportes actualizados.</p><div class="ll-floating-actions"><button type="button" data-close-floating-panel>Listo</button></div>';
        panel.focus('[data-close-floating-panel]');
      }
    }catch(error){if(panel.isCurrent()){status.classList.add('error');status.textContent=error.message||'No se pudieron guardar los aportes.';}}
    finally{saving=false;panel.setBusy(false);button.disabled=false;}
  };
}
