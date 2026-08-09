const ORIGINAL_ANIMATE = Element.prototype.animate;

function cardTitle(element){
  return element?.closest?.('.ll-profile-card')?.querySelector('.ll-card-title')?.textContent?.trim() || '';
}

function isClientSwitchActive(element){
  const root=element?.closest?.('#borrowerAccountContent .ll-account-shell');
  return !!root?.classList.contains('ll-inplace-switching');
}

function isAllowedMotion(element){
  if(!element?.closest?.('#borrowerAccountContent .ll-account-shell')) return true;

  /* Same type of soft value motion already used by the calendar. */
  if(element.matches?.('.ll-client-title')) return true;
  if(element.matches?.('strong,small,.ll-status-pill') && element.closest('.ll-summary-stat-grid')) return true;
  if(element.matches?.('strong,.ll-status-pill') && element.closest('.ll-cycle-detail')) return true;
  if(element.matches?.('strong') && element.closest('.ll-account-facts')) return true;

  /* Only these record groups are allowed to transition as a group. */
  if(element.matches?.('.ll-activity-list') && element.closest('.ll-movements-card')) return true;
  if(element.matches?.('.ll-record-list') && cardTitle(element)==='Historial de pagos') return true;

  return false;
}

Element.prototype.animate=function(keyframes,options){
  if(isClientSwitchActive(this) && !isAllowedMotion(this)){
    /* Return a real Animation object so callers awaiting .finished keep working,
       but do not visually animate structural elements. */
    return ORIGINAL_ANIMATE.call(this,[],{duration:0});
  }
  return ORIGINAL_ANIMATE.call(this,keyframes,options);
};

/* Animate only the changed client name. Observe the title text itself, never classes
   or the profile subtree, so this cannot create a MutationObserver feedback loop. */
window.addEventListener('loan-ledger:account-rendered',event=>{
  if(event.detail?.source!=='inplace-profile-switch') return;
  const title=document.querySelector('#borrowerAccountContent .ll-client-title');
  if(!title) return;
  const previous=title.textContent || '';
  let done=false;
  const observer=new MutationObserver(()=>{
    if(done || title.textContent===previous) return;
    done=true;
    observer.disconnect();
    ORIGINAL_ANIMATE.call(title,[
      {opacity:.28,transform:'translateY(3px)'},
      {opacity:1,transform:'translateY(0)'}
    ],{duration:210,easing:'cubic-bezier(.22,.61,.36,1)',fill:'both'});
  });
  observer.observe(title,{childList:true,characterData:true,subtree:true});
  setTimeout(()=>{done=true;observer.disconnect();},5000);
});

console.log('non-blocking client profile motion guard active');
