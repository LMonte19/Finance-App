const widgets = new WeakMap();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value || 0));
const cents = value => Math.max(0, Math.round(Number(value || 0) * 100));
const today = () => new Date().toISOString().slice(0,10);
const dateLabel = iso => new Date(iso + 'T00:00:00').toLocaleDateString('es', {day:'numeric',month:'short',year:'numeric'}).replace('.','');
const addYear = iso => { const [y,m,d] = iso.split('-').map(Number); return `${y+1}-${String(m).padStart(2,'0')}-${String(Math.min(d,new Date(y+1,m,0).getDate())).padStart(2,'0')}`; };

export function paymentCalendarEnd(paidOn = today()) {
  const now=new Date(),date=new Date(Date.UTC(now.getFullYear(),now.getMonth()+19,0));
  return [addYear(paidOn),date.toISOString().slice(0,10)].sort().pop();
}

export function installmentState(row, asOf = today()) {
  if (!row || row.status === 'CANCELLED' || (cents(row.expected_total) === 0 && cents(row.paid_total) === 0)) return {tone:'none',label:'Sin cuota'};
  if (cents(row.amount_due) === 0) return {tone:'paid',label:'Saldada'};
  if (row.due_date < asOf) return {tone:'overdue',label:cents(row.paid_total) > 0 ? 'Atrasada · parcial' : 'Atrasada'};
  return {tone:'pending',label:cents(row.paid_total) > 0 ? 'Pendiente · parcial' : 'Pendiente'};
}

export function currentInstallmentDate(paidOn = today()) {
  const [year,month,day]=paidOn.split('-').map(Number);
  return `${year}-${String(month).padStart(2,'0')}-${day<=15?'15':new Date(Date.UTC(year,month,0)).getUTCDate()}`;
}

export function paymentTargetDates(mode,paidOn,dates=[]) {
  if(mode==='current')return [currentInstallmentDate(paidOn||today())];
  if(mode==='selected')return [...new Set(dates)].sort();
  return null;
}

// Mirror the write function's budget, date restriction, and oldest-first order.
export function planInstallmentPayment(rows, payment, asOf = today()) {
  const type = payment.type || 'INSTALLMENT';
  const budget = ['PRINCIPAL','PAYOFF'].includes(type) ? 0 : cents(type === 'MIXED' ? payment.installment : payment.amount);
  let left = budget;
  const bookedThrough = rows.filter(row => row.source_event_id).reduce((max,row) => row.due_date > max ? row.due_date : max, '');
  const through = type === 'MIXED' ? addYear(payment.paidOn || asOf) : [asOf,currentInstallmentDate(payment.paidOn || asOf),bookedThrough].sort().pop();
  const applications = [];
  for (const row of [...rows].sort((a,b) => a.due_date.localeCompare(b.due_date))) {
    if (!left) break;
    if (row.status === 'CANCELLED' || (payment.dueDates ? !payment.dueDates.includes(row.due_date) : row.due_date > through) || cents(row.amount_due) === 0) continue;
    const applied = Math.min(cents(row.amount_due), left);
    left -= applied;
    applications.push({row,amount:applied / 100,remaining:(cents(row.amount_due)-applied)/100});
  }
  return {applications,budget:budget/100,unapplied:left/100};
}

export function paymentCalendarMarkup(prefix) {
  return `<section class="ll-payment-calendar" data-payment-calendar aria-labelledby="${prefix}Title"><div class="ll-pcal-heading"><h3 id="${prefix}Title">Cuotas del cliente</h3><span data-pcal-summary></span></div><label class="ll-pcal-target" data-pcal-target-field hidden>Aplicar cuota a<select data-pcal-target><option value="oldest">Cuotas más antiguas</option><option value="current">Solo la cuota del ciclo actual</option><option value="selected">Elegir fechas</option></select></label><div data-pcal-body><p class="ll-pcal-help">Selecciona un cliente para consultar sus cuotas.</p></div></section>`;
}

export function attachPaymentCalendar(host, {readPayment,loadCalendar}) {
  if (!host) return null;
  if (widgets.has(host)) return widgets.get(host);
  const body = host.querySelector('[data-pcal-body]'), summary = host.querySelector('[data-pcal-summary]');
  const target=host.querySelector('[data-pcal-target]'),targetField=target.closest('label');
  const state = {borrower:null,data:null,month:null,selected:null,dates:[],sequence:0,pending:null,end:null,error:false};
  const datedPayment=()=>{const p=readPayment();return {...p,dueDates:paymentTargetDates(target.value,p.paidOn,state.dates)};};
  const monthOf = iso => String(iso).slice(0,7);
  function render() {
    const payment = datedPayment();
    if (state.error || !state.data || String(payment.borrowerId) !== state.borrower) return;
    const rows = state.data.rows || [], asOf = state.data.as_of_date || today();
    const feeType=!['PRINCIPAL','PAYOFF'].includes(payment.type);
    targetField.hidden=!feeType;
    const plan = planInstallmentPayment(rows, payment, asOf);
    const first = rows.find(row=>row.due_date===payment.dueDates?.[0]) || plan.applications[0]?.row || rows.find(row => cents(row.amount_due)>0 && row.status!=='CANCELLED');
    if (!state.month) state.month = monthOf(first?.due_date || payment.paidOn || asOf);
    if (!state.selected) state.selected = first?.due_date || null;
    const [year,month] = state.month.split('-').map(Number), count = new Date(year,month,0).getDate();
    const offset = (new Date(year,month-1,1).getDay()+6)%7;
    const monthRows = new Map(rows.filter(row => monthOf(row.due_date)===state.month).map(row => [Number(row.due_date.slice(8)),row]));
    const applied = new Map(plan.applications.map(item => [item.row.due_date,item]));
    const chosen = rows.find(row => row.due_date === state.selected), chosenPlan = applied.get(state.selected);
    const overdue = rows.filter(row => installmentState(row,asOf).tone==='overdue');
    const focused=body.contains(document.activeElement)?document.activeElement:null;
    const focusSelector=focused?.dataset.pcalDate?`[data-pcal-date="${focused.dataset.pcalDate}"]`:focused?.dataset.pcalMove?`[data-pcal-move="${focused.dataset.pcalMove}"]`:focused?.hasAttribute('data-pcal-first')?'[data-pcal-first]':focused?.hasAttribute('data-pcal-use-date')?'[data-pcal-use-date]':null;
    summary.textContent = overdue.length ? `${overdue.length} atrasada${overdue.length===1?'':'s'}` : 'Sin atrasos';
    const days = Array.from({length:offset},()=>'<span aria-hidden="true"></span>').join('') + Array.from({length:count},(_,index)=>{
      const day=index+1,row=monthRows.get(day);
      if (!row) return `<span class="ll-pcal-day" aria-hidden="true">${day}</span>`;
      const status=installmentState(row,asOf), app=applied.get(row.due_date), targeted=feeType&&payment.dueDates?.includes(row.due_date);
      if(status.tone==='none')return `<span class="ll-pcal-day" aria-hidden="true">${day}</span>`;
      return `<button type="button" class="ll-pcal-date ${status.tone}${row.due_date===state.selected?' selected':''}${app?' will-apply':''}${targeted?' is-targeted':''}" data-pcal-date="${esc(row.due_date)}" aria-pressed="${row.due_date===state.selected}" aria-label="${esc(dateLabel(row.due_date)+' · '+status.label+' · Pendiente '+money(row.amount_due)+(app?' · Este pago aplicará '+money(app.amount):targeted?' · Elegida para este pago':''))}">${day}${app?'<i aria-hidden="true"></i>':''}</button>`;
    }).join('');
    const applicationLine = item => `<li><span><strong>${dateLabel(item.row.due_date)}</strong><small>${installmentState(item.row,asOf).label}${item.remaining>0?' · Quedarán '+money(item.remaining):' · Se salda'}</small></span><b>${money(item.amount)}</b></li>`;
    const targeting=feeType&&target.value==='current'?'<p class="ll-pcal-help">Cuota del ciclo según la fecha del pago: <strong>'+esc(dateLabel(payment.dueDates[0]))+'</strong>.</p>':
      feeType&&target.value==='selected'?`<p class="ll-pcal-help">Abre una cuota pendiente y márcala para aplicar este pago. Puedes elegir varias fechas.</p>
        ${state.dates.length?`<div class="ll-pcal-targets" aria-label="Fechas elegidas">${state.dates.map(iso=>`<button type="button" data-pcal-remove="${esc(iso)}" aria-label="Quitar cuota del ${esc(dateLabel(iso))}">${esc(dateLabel(iso))} ×</button>`).join('')}</div>`:''}`:'';
    const canChoose=feeType&&target.value==='selected'&&chosen&&cents(chosen.amount_due)>0&&chosen.status!=='CANCELLED';
    const selectedDetails=chosen?`<div class="ll-pcal-selected"><div><strong>Cuota del ${dateLabel(chosen.due_date)}</strong><span class="${installmentState(chosen,asOf).tone}">${installmentState(chosen,asOf).label}</span></div><dl><div><dt>Cuota original</dt><dd>${money(chosen.expected_total)}</dd></div><div><dt>Ya pagado</dt><dd>${money(chosen.paid_total)}</dd></div><div><dt>Pendiente</dt><dd>${money(chosen.amount_due)}</dd></div>${chosenPlan?`<div><dt>Este pago aplicará</dt><dd>${money(chosenPlan.amount)}</dd></div><div><dt>Quedará pendiente</dt><dd>${money(chosenPlan.remaining)}</dd></div>`:''}</dl>
      ${canChoose?`<label class="ll-pcal-choose"><input type="checkbox" data-pcal-use-date value="${esc(chosen.due_date)}"${state.dates.includes(chosen.due_date)?' checked':''}> Aplicar a esta cuota</label>`:''}</div>`:'';
    const applications=plan.applications.length?`<button type="button" class="ll-pcal-link" data-pcal-first>Ver primera cuota que cubre</button><ul>${plan.applications.slice(0,4).map(applicationLine).join('')}</ul>${plan.applications.length>4?`<details><summary>Ver ${plan.applications.length-4} cuotas más</summary><ul>${plan.applications.slice(4).map(applicationLine).join('')}</ul></details>`:''}`:
      plan.budget?'<p class="ll-pcal-help">No hay saldo pendiente en las cuotas elegidas.</p>':'<p class="ll-pcal-help">Escribe el monto para ver qué cuotas cubrirá.</p>';
    body.innerHTML = `${targeting}<div class="ll-pcal-nav"><button type="button" data-pcal-move="-1" aria-label="Mes anterior">‹</button><strong>${new Date(year,month-1,1).toLocaleDateString('es',{month:'long',year:'numeric'})}</strong><button type="button" data-pcal-move="1" aria-label="Mes siguiente">›</button></div><div class="ll-pcal-week" aria-hidden="true">${['L','M','X','J','V','S','D'].map(day=>`<span>${day}</span>`).join('')}</div><div class="ll-pcal-days">${days}</div><div class="ll-pcal-legend"><span class="paid">Saldadas</span><span class="overdue">Atrasadas</span><span class="pending">Pendientes</span></div>
      ${selectedDetails}<div class="ll-pcal-plan"><h4>Aplicación de este pago</h4>${feeType?applications:'<p class="ll-pcal-help">Este abono va al capital.</p>'}
      ${plan.unapplied>0?`<p class="ll-pcal-error">Quedan ${money(plan.unapplied)} sin aplicar. Revisa el monto o elige más cuotas.</p>`:''}</div>`;
    const months=rows.map(row=>monthOf(row.due_date)).sort();
    body.querySelector('[data-pcal-move="-1"]').disabled=!months.length||state.month<=months[0];
    body.querySelector('[data-pcal-move="1"]').disabled=!months.length||state.month>=months.at(-1);
    if(focusSelector)body.querySelector(focusSelector)?.focus({preventScroll:true});
  }
  async function refresh({force=false}={}) {
    const payment=readPayment(), borrower=String(payment.borrowerId||'');
    if (!borrower) { state.sequence++;state.borrower=null;state.data=null;state.month=null;state.selected=null;state.pending=null;state.end=null;state.error=false;state.dates=[];target.value='oldest';targetField.hidden=true;host.removeAttribute('aria-busy');summary.textContent='';body.innerHTML='<p class="ll-pcal-help">Selecciona un cliente para consultar sus cuotas.</p>';return; }
    const end=addYear(payment.paidOn||today());
    if (borrower!==state.borrower || force || !state.end || state.end<end || (!state.data && !state.pending)) {
      const changed=borrower!==state.borrower;
      const sequence=++state.sequence;
      state.borrower=borrower;state.end=end;state.error=false;
      if(changed){state.data=null;state.month=null;state.selected=null;state.dates=[];target.value='oldest';targetField.hidden=true;}
      host.setAttribute('aria-busy','true');
      if(!state.data){summary.textContent='';body.innerHTML='<p class="ll-pcal-help">Consultando cuotas…</p>';}
      state.pending=(async()=>{
        try{const data=await loadCalendar(borrower,payment.paidOn||today(),force);if(sequence!==state.sequence)return;if(!data||!Array.isArray(data.rows))throw new Error('No se pudo consultar el calendario.');state.data=data;render();}
        catch(error){if(sequence===state.sequence){state.end=null;state.error=true;summary.textContent='';body.innerHTML=`<p class="ll-pcal-error">${esc(error.message||'No se pudo consultar el calendario.')}</p><button class="ll-pcal-link" type="button" data-pcal-retry>Reintentar</button>`;}}
        finally{if(sequence===state.sequence){state.pending=null;host.removeAttribute('aria-busy');}}
      })();
    }
    await state.pending;
    if(!force&&target.value==='current'&&payment.paidOn&&state.currentPaidOn!==payment.paidOn){
      state.selected=currentInstallmentDate(payment.paidOn);state.month=monthOf(state.selected);
    }
    state.currentPaidOn=payment.paidOn;render();
  }
  host.addEventListener('change',event=>{
    if(event.target===target){
      if(readPayment().type==='MIXED')host.dispatchEvent(new CustomEvent('loan-ledger:payment-target-changed',{bubbles:true}));
      if(target.value==='current'){
        state.selected=currentInstallmentDate(readPayment().paidOn||today());state.month=monthOf(state.selected);
      }
      render();return;
    }
    if(event.target.matches('[data-pcal-use-date]')){
      const {value,checked}=event.target;
      state.dates=checked?[...new Set([...state.dates,value])].sort():state.dates.filter(date=>date!==value);
      render();
    }
  });
  host.addEventListener('click',event=>{
    const remove=event.target.closest('[data-pcal-remove]');
    if(remove){state.dates=state.dates.filter(iso=>iso!==remove.dataset.pcalRemove);render();target.focus();return;}
    if(event.target.closest('[data-pcal-retry]')){refresh({force:true});return;}
    const move=event.target.closest('[data-pcal-move]');
    if(move&&state.month){const [y,m]=state.month.split('-').map(Number),d=new Date(y,m-1+Number(move.dataset.pcalMove),1);state.month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;render();return;}
    const date=event.target.closest('[data-pcal-date]');
    if(date){state.selected=date.dataset.pcalDate;render();return;}
    if(event.target.closest('[data-pcal-first]')){const first=planInstallmentPayment(state.data?.rows||[],datedPayment(),state.data?.as_of_date||today()).applications[0];if(first){state.month=monthOf(first.row.due_date);state.selected=first.row.due_date;render();}}
  });
  const controller={refresh,reset(){
    state.dates=[];state.selected=null;state.month=null;target.value='oldest';render();
  }, async values(installment){
    const payment=datedPayment(),budget=payment.type==='MIXED'?installment:payment.amount;
    if(['PRINCIPAL','PAYOFF'].includes(payment.type)||!(budget>0))return null;
    await refresh();
    const requested=datedPayment();
    if(String(requested.borrowerId)!==String(payment.borrowerId)||requested.paidOn!==payment.paidOn||requested.type!==payment.type)
      throw new Error('El cliente o la fecha cambió. Revisa el pago.');
    if(!state.data||state.error)throw new Error('No se pudo comprobar el calendario de cuotas.');
    if(requested.dueDates&&!requested.dueDates.length)throw new Error('Elige al menos una cuota en el calendario.');
    if(requested.dueDates?.some(iso=>!state.data.rows.some(row=>row.due_date===iso&&row.status!=='CANCELLED'&&cents(row.amount_due)>0)))
      throw new Error('Alguna cuota elegida no está disponible. Revisa el calendario.');
    const plan=planInstallmentPayment(state.data.rows,{...requested,installment},state.data.as_of_date);
    if(plan.unapplied>0)throw new Error('El monto de cuota supera el saldo de las fechas elegidas.');
    return requested.dueDates;
  }};
  widgets.set(host,controller);return controller;
}
