function ensureExactRailStyle(){
  const href='./client-profile-rail-exact.css?v=1';
  let link=document.getElementById('clientProfileRailExactCss');
  if(link){if(link.getAttribute('href')!==href)link.setAttribute('href',href);return;}
  link=document.createElement('link');
  link.id='clientProfileRailExactCss';
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

ensureExactRailStyle();
console.log('client profile exact rail style active');
