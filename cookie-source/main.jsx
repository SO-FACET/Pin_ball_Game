import {noticeMarkup} from './notice.js';

if(window.top===window){
 const container=document.createElement('div');container.id='sf-cookie-root';document.body.append(container);
 container.innerHTML=noticeMarkup;
 const notice=container.querySelector('#sf-cookie-notice'),settings=document.createElement('div'),status=document.createElement('p');
 settings.id='sf-cookie-settings-host';
 const pending=document.createElement('dialog');pending.className='cookie-panel preferences';pending.id='sf-cookie-pending';pending.setAttribute('aria-labelledby','sf-cookie-pending-title');
 pending.innerHTML='<h2 id="sf-cookie-pending-title">Cookie preferences</h2><p>Loading cookie preferences…</p><div class="actions"><button class="button outline" type="button">Cancel</button></div>';
 status.className='sr-only';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 container.append(settings,status,pending);
 let latest,loading,renderSettings;
 notice.querySelector('[data-accept]').onclick=()=>latest.save(true,true,true);
 notice.querySelector('[data-reject]').onclick=()=>latest.save(false,false,false);
 notice.querySelector('[data-manage]').onclick=()=>latest.open();
 pending.querySelector('button').onclick=()=>latest.close();pending.oncancel=event=>{event.preventDefault();latest.close()};
 const paint=props=>{
  latest=props;notice.hidden=!props.showNotice;
  status.textContent=props.persisted?'':'Your choice applies to this visit only.';
  if(!props.settingsOpen&&pending.open)pending.close();
  if(renderSettings){renderSettings(props);return;}
  if(!props.settingsOpen)return;
  if(!pending.open)pending.showModal();
  if(loading)return;
  status.textContent='Loading cookie preferences…';
  loading=import(__COOKIE_SETTINGS_MODULE__).then(module=>{
   if(pending.open)pending.close();renderSettings=module.mountSettings(settings);renderSettings(latest);status.textContent='';
  }).catch(()=>{
   loading=null;latest.close();status.textContent='Cookie preferences could not load. Please try again.';
  });
 };
 window.sofacetCookiePreferences.mount(paint);
}
