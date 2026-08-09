const style=document.createElement('style');
style.id='clientProfileEntryMotionStyle';
style.textContent=`
@media (min-width:900px){
  /* The persistent client rail is created only once. On that first mount it emerges
     from behind the left edge/global navigation while the workspace keeps its own entry. */
  #borrowerAccountContent .ll-account-shell > .ll-client-rail{
    animation:llClientRailInitialFromLeft .42s cubic-bezier(.22,.72,.22,1) both;
  }
  @keyframes llClientRailInitialFromLeft{
    from{transform:translateX(-70px);opacity:.72}
    to{transform:translateX(0);opacity:1}
  }
}
@media (prefers-reduced-motion:reduce){
  #borrowerAccountContent .ll-account-shell > .ll-client-rail{animation:none!important}
}
`;
document.head.appendChild(style);

console.log('client profile left rail entry motion active');
