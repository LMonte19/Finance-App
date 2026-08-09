const ORIGINAL_ANIMATE = Element.prototype.animate;
let switchingBorrower = null;
let switchRoot = null;
let releaseTimer = null;

function cardTitle(element){
  return element?.closest?.('.ll-profile-card')?.querySelector('.ll-card-title')?.textContent?.trim() || '';
}

function isAllowedMotion(element){
  if(!element?.closest?.('#borrowerAccountContent .ll-account-shell')) return true;

  if(element.matches?.('.ll-client-title')) return true;

  if(element.matches?.('strong,small,.ll-status-pill') && element.closest('.ll-summary-stat-grid')) return true;
  if(element.matches?.('strong,.ll-status-pill') && element.closest('.ll-cycle-detail')) return true;
  if(element.matches?.('strong') && element.closest('.ll-account-facts')) return true;

  if(element.matches?.('.ll-activity-list') || element.closest?.('.ll-movements-card') && element.matches?.('.ll-activity-list')) return true;
  if(element.matches?.('.ll-record-list') && cardTitle(element) === 'Historial de pagos') return true;

  return false;
}

function instantAnimation(){
  return {
    finished: Promise.resolve(),
    ready: Promise.resolve(),
    cancel(){},
    finish(){},
    pause(){},
    play(){},
    reverse(){},
    commitStyles(){},
    persist(){},
    addEventListener(){},
    removeEventListener(){},
    currentTime:0,
    playState:'finished'
  };
}

Element.prototype.animate = function(keyframes, options){
  if(switchingBorrower && this.closest?.('#borrowerAccountContent .ll-account-shell') && !isAllowedMotion(this)){
    return instantAnimation();
  }
  return ORIGINAL_ANIMATE.call(this,keyframes,options);
};

function stripGlobalSwitchClasses(root){
  if(!root) return;
  root.classList.remove('ll-inplace-switching','ll-inplace-reveal');
}

function releaseSwitch(){
  switchingBorrower = null;
  switchRoot = null;
  clearTimeout(releaseTimer);
  releaseTimer = null;
}

function watchCompletion(root,targetId){
  const observer = new MutationObserver(()=>{
    stripGlobalSwitchClasses(root);
    if(String(root.dataset.liveProfileBorrower || '') === String(targetId)){
      observer.disconnect();
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(releaseSwitch,120);
    }
  });
  observer.observe(root,{attributes:true,attributeFilter:['class','data-live-profile-borrower']});
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(()=>{observer.disconnect();releaseSwitch();},12000);
}

window.addEventListener('loan-ledger:account-rendered',event=>{
  if(event.detail?.source !== 'inplace-profile-switch') return;
  const root=document.querySelector('#borrowerAccountContent .ll-account-shell');
  const id=event.detail?.borrowerId;
  if(!root || !id) return;
  switchingBorrower=String(id);
  switchRoot=root;
  stripGlobalSwitchClasses(root);
  watchCompletion(root,id);
},true);

const content=document.getElementById('borrowerAccountContent');
if(content){
  new MutationObserver(()=>{
    const root=content.querySelector('.ll-account-shell');
    stripGlobalSwitchClasses(root);
  }).observe(content,{subtree:true,attributes:true,attributeFilter:['class']});
}

/* The client name is updated directly by the identity renderer. Give only the new name
   the same soft entrance used by the calendar values, without moving its container. */
if(content){
  let lastName='';
  new MutationObserver(()=>{
    if(!switchingBorrower) return;
    const title=content.querySelector('.ll-client-title');
    if(!title) return;
    const current=title.textContent || '';
    if(!current || current===lastName) return;
    lastName=current;
    ORIGINAL_ANIMATE.call(title,[
      {opacity:.25,transform:'translateY(3px)'},
      {opacity:1,transform:'translateY(0)'}
    ],{duration:210,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});
  }).observe(content,{subtree:true,childList:true,characterData:true});
}

const style=document.createElement('style');
style.id='clientProfileMotionLockStyle';
style.textContent=`
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-workspace,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-client-header,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-profile-tabs-host,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-profile-panel,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-profile-card,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-panel-grid,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-panel-main,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-panel-side,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-cycle-calendar,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-cycle-date-row,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-cycle-detail,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-summary-stat-grid,
#borrowerAccountContent .ll-account-shell.ll-inplace-switching .ll-account-facts,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-workspace,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-client-header,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-profile-tabs-host,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-profile-panel,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-profile-card,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-panel-grid,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-panel-main,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-panel-side,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-cycle-calendar,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-cycle-date-row,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-cycle-detail,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-summary-stat-grid,
#borrowerAccountContent .ll-account-shell.ll-inplace-reveal .ll-account-facts{
  opacity:1!important;
  transform:none!important;
  animation:none!important;
  transition:none!important;
}
`;
document.head.appendChild(style);

console.log('client profile motion lock active');
