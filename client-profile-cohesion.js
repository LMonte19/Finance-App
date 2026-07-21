function addStyle(id, href){
  const existing=document.getElementById(id);
  if(existing){
    if(existing.getAttribute('href')!==href)existing.setAttribute('href',href);
    return;
  }
  const link=document.createElement('link');
  link.id=id;
  link.rel='stylesheet';
  link.href=href;
  document.head.appendChild(link);
}

addStyle('clientProfileCohesionCss','./client-profile-cohesion.css?v=1');
addStyle('clientProfileCohesionFinalCss','./client-profile-cohesion-final.css?v=1');

console.log('client profile cohesion active');
