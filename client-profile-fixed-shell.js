function ensureFixedClientShellStyle(){
  const href='./client-profile-fixed-shell.css?v=1';
  let link=document.getElementById('clientProfileFixedShellCss');
  if(link){if(link.getAttribute('href')!==href)link.setAttribute('href',href);return;}
  link=document.createElement('link');
  link.id='clientProfileFixedShellCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

function syncFixedClientShell(){
  ensureFixedClientShellStyle();
  const page=document.getElementById('borrowerAccountPage');
  const shell=document.querySelector('#borrowerAccountContent .ll-account-shell');
  const active=!!shell && !!page?.classList.contains('active-page');
  document.body.classList.toggle('ll-client-detail-fixed',active);
}

ensureFixedClientShellStyle();
const fixedShellObserver=new MutationObserver(()=>{
  clearTimeout(window.__llFixedClientShellTimer);
  window.__llFixedClientShellTimer=setTimeout(syncFixedClientShell,60);
});
fixedShellObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
document.addEventListener('DOMContentLoaded',syncFixedClientShell);
window.addEventListener('loan-ledger:account-rendered',()=>setTimeout(syncFixedClientShell,100));
window.addEventListener('loan-ledger:open-account',()=>setTimeout(syncFixedClientShell,100));
setInterval(syncFixedClientShell,1600);
setTimeout(syncFixedClientShell,150);
setTimeout(syncFixedClientShell,700);

console.log('fixed client detail shell active');