const mixedWidgets=new WeakMap();
const splitMoney=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value||0));
const splitCents=value=>{if(value===''||value==null)return null;const n=Number(value);return Number.isFinite(n)&&n>=0&&Math.abs(n*100-Math.round(n*100))<.000001?Math.round(n*100):null;};

export function mixedPaymentMarkup(prefix){
  return `<section class="ll-mixed-payment" data-mixed-payment hidden aria-labelledby="${prefix}Title"><div class="ll-mixed-head"><h3 id="${prefix}Title">Distribución del pago</h3><button type="button" data-split-reset>Restablecer sugerencia</button></div><p class="ll-mixed-reference" data-split-reference></p><div class="ll-mixed-fields"><label for="${prefix}Installment">Cuota / interés<input id="${prefix}Installment" data-split-part="installment" type="number" min="0" step="0.01" inputmode="decimal" value="0" required disabled></label><label for="${prefix}Principal">Abono al capital<input id="${prefix}Principal" data-split-part="principal" type="number" min="0" step="0.01" inputmode="decimal" value="0" required disabled></label></div><div class="ll-mixed-sum"><span>Total distribuido</span><strong data-split-sum>—</strong></div><p class="ll-mixed-status" data-split-status role="status" aria-live="polite"></p><p class="ll-mixed-help">Elige en el calendario qué cuotas cubrirá este pago. El abono al capital se aplica por separado.</p></section>`;
}

export function mixedContextFromCalendar(data,paidOn){
  if(!data||!/^\d{4}-\d{2}-\d{2}$/.test(paidOn||''))return null;
  const [year,month,day]=paidOn.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).getUTCDate();
  const cycle=String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day<=15?15:last).padStart(2,'0');
  const through=String(year+1)+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,new Date(Date.UTC(year+1,month,0)).getUTCDate())).padStart(2,'0');
  const rows=data.calendarRows||[];
  if(!rows.length||rows[rows.length-1].due_date<through)return null;
  return {cycle_due_date:cycle,cycle_amount:Number(rows.find(r=>r.due_date===cycle)?.amount_due||0),
    pending_interest:rows.filter(r=>r.due_date<=through).reduce((sum,r)=>sum+Number(r.amount_due||0),0),
    principal_balance:(data.disbursements||[]).filter(l=>l.status==='ACTIVE'&&l.start_date<=paidOn).reduce((sum,l)=>sum+Number(l.principal_outstanding||0),0)};
}

export function attachMixedPaymentSplit(host,{readPayment,loadContext}){
  if(!host)return null;
  if(mixedWidgets.has(host))return mixedWidgets.get(host);
  const installment=host.querySelector('[data-split-part="installment"]'),principal=host.querySelector('[data-split-part="principal"]');
  const status=host.querySelector('[data-split-status]'),sum=host.querySelector('[data-split-sum]'),reference=host.querySelector('[data-split-reference]');
  const state={key:null,context:null,pending:null,sequence:0,manual:null,total:null,error:''};
  const keyOf=p=>`${p.borrowerId||''}:${p.paidOn||''}`;
  function validate(payment){
    if(!state.context)return state.error||'Calculando distribución…';
    const total=splitCents(payment.amount),fee=splitCents(installment.value),capital=splitCents(principal.value);
    if(total===null||total<=0)return 'Escribe un monto total mayor que cero, con un máximo de dos decimales.';
    if(fee===null||capital===null)return 'Usa importes positivos o cero, con un máximo de dos decimales.';
    if(fee+capital!==total)return 'La cuota y el capital deben sumar el monto total del pago.';
    if(capital>Math.round(Number(state.context.principal_balance||0)*100))return 'El abono supera el capital pendiente de '+splitMoney(state.context.principal_balance)+'.';
    if(!payment.targeted&&fee>Math.round(Number(state.context.pending_interest||0)*100))return 'La parte de cuota supera las cuotas pendientes disponibles. Ajusta el desglose.';
    return '';
  }
  function render(){
    const payment=readPayment();
    if(payment.type!=='MIXED'||keyOf(payment)!==state.key)return;
    const total=splitCents(payment.amount),validTotal=total!==null?total:0;
    if(state.context){
      if(!state.manual){const fee=Math.min(validTotal,Math.max(0,Math.round(Number(state.context.cycle_amount||0)*100)));installment.value=String(fee/100);principal.value=String((validTotal-fee)/100);}
      else if(state.total!==total){
        const fixed=splitCents(state.manual==='installment'?installment.value:principal.value);
        if(fixed!==null)(state.manual==='installment'?principal:installment).value=String(Math.max(0,validTotal-fixed)/100);
      }
    }
    state.total=total;installment.max=principal.max=String(validTotal/100);
    const fee=splitCents(installment.value),capital=splitCents(principal.value),error=validate(payment);
    sum.textContent=fee===null||capital===null?'—':`${splitMoney(fee/100)} + ${splitMoney(capital/100)} = ${splitMoney((fee+capital)/100)}`;
    reference.textContent=state.context?'Sugerencia: una cuota de '+splitMoney(state.context.cycle_amount)+' y el resto al capital.':'Calculando la cuota de referencia…';
    status.textContent=error||'Distribución completa.';host.dataset.invalid=String(!!error);
    installment.disabled=principal.disabled=!state.context;
  }
  async function refresh({reset=false,force=false}={}){
    const payment=readPayment(),key=keyOf(payment);
    host.hidden=payment.type!=='MIXED';
    if(host.hidden){installment.disabled=principal.disabled=true;return;}
    if(reset||key!==state.key){state.manual=null;state.total=null;installment.value=principal.value='0';}
    if(key!==state.key||force){
      state.key=key;state.context=null;state.error='';const sequence=++state.sequence;
      host.setAttribute('aria-busy','true');render();
      state.pending=(async()=>{
        try{
          if(!payment.borrowerId||!payment.paidOn)throw new Error('Selecciona el cliente y la fecha del pago.');
          const context=await loadContext(payment.borrowerId,payment.paidOn);
          if(!context)throw new Error('No se pudo consultar la distribución de esta cuenta.');
          if(sequence===state.sequence)state.context=context;
        }catch(error){if(sequence===state.sequence)state.error=error.message||String(error);}
        finally{if(sequence===state.sequence){host.removeAttribute('aria-busy');render();}}
      })();
    }
    await state.pending;render();
  }
  host.addEventListener('input',event=>{
    const part=event.target.dataset.splitPart;if(!part)return;
    state.manual=part;
    const fixed=splitCents(event.target.value),total=splitCents(readPayment().amount);
    if(fixed!==null&&total!==null)(part==='installment'?principal:installment).value=String(Math.max(0,total-fixed)/100);
    state.total=total;render();
  });
  host.querySelector('[data-split-reset]').addEventListener('click',()=>{state.manual=null;if(!state.context)refresh({reset:true,force:true});else render();});
  const controller={refresh,reset(){state.manual=null;state.total=null;state.key=null;state.sequence++;state.context=null;return refresh({reset:true});},async values(){
    const before=readPayment();await refresh({force:!!state.error});const after=readPayment();
    if(keyOf(before)!==keyOf(after)||before.amount!==after.amount||after.type!=='MIXED')throw new Error('El pago cambió mientras se calculaba. Revisa los importes.');
    const error=validate(after);if(error)throw new Error(error);
    return {installment:splitCents(installment.value)/100,principal:splitCents(principal.value)/100};
  }};
  mixedWidgets.set(host,controller);return controller;
}
