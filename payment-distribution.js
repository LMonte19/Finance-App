import { readPageQuery } from './page-read-runtime.js?v=1';
import { escapeText as esc } from './client-directory.js?v=1';

const widgets=new WeakMap();
export function paymentDistributionMarkup(){
  return `<fieldset class="ll-flow-fieldset" data-payment-distribution hidden><legend>Distribución de este pago</legend>
    <p class="ll-flow-help">La parte de socios se distribuye según los aportes de los desembolsos de las cuotas pagadas.</p>
    <label class="ll-flow-check"><input type="checkbox" data-distribution-manual> Elegir socios y porcentajes para este pago</label>
    <div data-distribution-choices hidden></div></fieldset>`;
}
export function attachPaymentDistribution(host,{db,readPayment}){
  if(!host)return null;
  if(widgets.has(host))return widgets.get(host);
  const manual=host.querySelector('[data-distribution-manual]'),choices=host.querySelector('[data-distribution-choices]');
  let account='',loaded=false,sequence=0,pending=null;
  function refresh(){
    const {borrowerId,type}=readPayment(),id=String(borrowerId||'');
    host.hidden=!id||['PRINCIPAL','PAYOFF'].includes(type);
    if(account!==id){
      account=id;sequence++;manual.checked=false;choices.hidden=true;choices.replaceChildren();pending=null;loaded=false;
    }
  }
  async function load(){
    if(pending)return pending;
    const request=++sequence,id=account;
    choices.innerHTML='<p class="ll-flow-help">Consultando socios de la cuenta…</p>';
    pending=(async()=>{
      try{
        const {data,error}=await readPageQuery('payment-funders:'+id,()=>db.rpc('get_borrower_payment_partners',{p_borrower_id:id}),{ttl:45000});
        if(request!==sequence)return;
        if(error)throw error;
        const people=data||[];
        choices.innerHTML=people.length?people.map(person=>`<label class="ll-flow-partner-weight"><span>${esc(person.full_name||'Socio')} (%)</span><input type="number" min="0" max="100" step="0.01" data-payment-weight="${esc(person.user_id)}" value="${people.length===1?100:0}"></label>`).join('')+
          '<p class="ll-flow-help">Usa 0% para excluir a un socio. La suma debe ser 100%. La administración se calcula por separado.</p>':
          '<p class="ll-flow-help">Este cliente no tiene socios registrados en sus desembolsos.</p>';
        loaded=true;
      }catch(error){if(request===sequence)choices.textContent='No se pudieron consultar los socios. Desmarca y vuelve a marcar para reintentar.';}
      finally{if(request===sequence)pending=null;}
    })();
    return pending;
  }
  manual.addEventListener('change',()=>{
    choices.hidden=!manual.checked;
    if(manual.checked&&!loaded)load();
  });
  const controller={refresh,reset(){manual.checked=false;choices.hidden=true;choices.replaceChildren();loaded=false;sequence++;pending=null;},
    async values(installment){
      refresh();
      if(host.hidden||!manual.checked||!(installment>0))return null;
      if(!loaded)await load();
      if(!manual.checked||!loaded)throw new Error('Revisa los socios de este pago.');
      const inputs=[...choices.querySelectorAll('[data-payment-weight]')];
      if(inputs.some(input=>!input.validity.valid))throw new Error('Usa porcentajes válidos con hasta dos decimales.');
      const split=inputs.map(input=>({partner_user_id:input.dataset.paymentWeight,weight:Number(input.value||0)})).filter(row=>row.weight>0);
      if(split.reduce((sum,row)=>sum+Math.round(row.weight*100),0)!==10000)throw new Error('Los porcentajes de este pago deben sumar 100%.');
      return split;
    }
  };
  widgets.set(host,controller);return controller;
}
