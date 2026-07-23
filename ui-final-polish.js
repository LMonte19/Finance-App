function ensureUiFinalPolishStyle(){
  const href='./ui-final-polish.css?v=2';
  let link=document.getElementById('uiFinalPolishCss');
  if(link){ if(link.getAttribute('href')!==href) link.setAttribute('href',href); return; }
  link=document.createElement('link');
  link.id='uiFinalPolishCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

const PERSON_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-4.4 2.8-6.6 6.5-6.6s5.9 2.2 6.5 6.6"/></svg>';
const MONEY_INPUT_RE=/(amount|monto|principal|capital|balance|payment|pago|cuota|fee|desembolso|recuperado|recover)/i;
const NON_MONEY_INPUT_RE=/(rate|tasa|percent|porcentaje|interest|interes|mgmt|administr)/i;
const CURRENCY_RE=/\$-?[\d,]+(?:\.\d+)?/g;

function wholeDollar(raw){
  const numeric=Number(String(raw).replace(/[$,]/g,''));
  if(!Number.isFinite(numeric)) return raw;
  return `$${Math.round(numeric).toLocaleString('en-US',{maximumFractionDigits:0})}`;
}

function formatCurrencyString(text){
  return String(text||'').replace(CURRENCY_RE,match=>wholeDollar(match));
}

function formatTextNodes(root){
  if(!root) return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    const parent=node.parentElement;
    if(!parent || ['SCRIPT','STYLE','TEXTAREA','OPTION'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
    return node.nodeValue?.includes('$') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  }});
  const nodes=[];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const next=formatCurrencyString(node.nodeValue);
    if(next!==node.nodeValue) node.nodeValue=next;
  });
}

function isMoneyInput(input){
  if(!(input instanceof HTMLInputElement)) return false;
  const key=[input.id,input.name,input.placeholder,input.className,input.getAttribute('aria-label')].filter(Boolean).join(' ');
  if(NON_MONEY_INPUT_RE.test(key)) return false;
  if(MONEY_INPUT_RE.test(key)) return true;
  return !!input.closest('.ll-summary-quick-pay,.ll-payment-form,.ll-payment-layout');
}

function normalizeMoneyInput(input){
  if(!isMoneyInput(input)) return;
  input.step='1';
  input.inputMode='numeric';
  if(input.value==='') return;
  const numeric=Number(String(input.value).replace(/,/g,''));
  if(Number.isFinite(numeric)) input.value=String(Math.round(numeric));
}

function bindMoneyInputs(root){
  (root||document).querySelectorAll?.('input').forEach(input=>{
    if(!isMoneyInput(input)) return;
    input.step='1';
    input.inputMode='numeric';
    if(input.dataset.wholeDollarBound!=='1'){
      input.dataset.wholeDollarBound='1';
      input.addEventListener('blur',()=>normalizeMoneyInput(input));
      input.addEventListener('change',()=>normalizeMoneyInput(input));
    }
    normalizeMoneyInput(input);
  });
}

function ensureCollapsedClientMarker(){
  const rail=document.querySelector('#borrowerAccountContent .ll-client-rail');
  if(!rail) return;
  let marker=rail.querySelector('.ll-collapsed-client-marker');
  if(!marker){
    marker=document.createElement('div');
    marker.className='ll-collapsed-client-marker';
    marker.setAttribute('aria-label','Clientes');
    marker.setAttribute('title','Clientes');
    marker.innerHTML=PERSON_ICON;
    const list=rail.querySelector('.ll-client-list');
    if(list) rail.insertBefore(marker,list); else rail.appendChild(marker);
  }
}

function applyUiFinalPolish(){
  ensureUiFinalPolishStyle();
  ensureCollapsedClientMarker();
  const app=document.getElementById('app');
  if(app){
    formatTextNodes(app);
    bindMoneyInputs(app);
  }
}

let polishQueued=false;
function queueUiFinalPolish(){
  if(polishQueued) return;
  polishQueued=true;
  requestAnimationFrame(()=>{
    polishQueued=false;
    applyUiFinalPolish();
  });
}

ensureUiFinalPolishStyle();
const polishObserver=new MutationObserver(mutations=>{
  if(mutations.some(m=>m.type==='childList'||m.type==='characterData')) queueUiFinalPolish();
});
polishObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
document.addEventListener('click',()=>setTimeout(queueUiFinalPolish,0),true);
document.addEventListener('DOMContentLoaded',queueUiFinalPolish);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(queueUiFinalPolish,120));
window.addEventListener('loan-ledger:open-account',()=>setTimeout(queueUiFinalPolish,120));
setTimeout(queueUiFinalPolish,180);
setTimeout(queueUiFinalPolish,800);

console.log('final UI polish active');
