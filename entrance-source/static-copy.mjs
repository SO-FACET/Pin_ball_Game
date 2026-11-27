// Keep approved chapter copy readable while optional per-character animation
// loads after the first interaction. A text-animation failure never owns video.
export function createStaticLandingCopy(root=document.getElementById('story-copy')){
 const sections=[...root.querySelectorAll('.story-line')];
 let frame=240,scrolled=false,current;
 const paint=()=>{
  const active=!scrolled?sections[0]:sections.slice(1).find(section=>frame>=Number(section.dataset.from)&&frame<Number(section.dataset.until??Infinity));
  if(active===current)return;current=active;
  for(const section of sections){const visible=section===active;section.style.visibility=visible?'visible':'hidden';section.setAttribute('aria-hidden',String(!visible));}
 };
 const update=value=>{frame=value;paint()};
 update.setScrolled=distance=>{scrolled=distance>=300;paint()};update.destroy=()=>{};
 paint();return update;
}
