import {createHmac} from 'node:crypto';

export function analyticsConfig(env=process.env){
 const enabled=env.ANALYTICS_ENABLED==='true';
 const gaId=/^G-[A-Z0-9]+$/.test(env.GA4_MEASUREMENT_ID||'')?env.GA4_MEASUREMENT_ID:'';
 let posthogHost='';
 try{const url=new URL(env.POSTHOG_HOST||'https://us.i.posthog.com');if(url.protocol==='https:'&&!url.username&&!url.password)posthogHost=url.origin}catch{}
 return {enabled,gaId:enabled?gaId:'',posthogKey:enabled&&posthogHost?env.POSTHOG_PUBLIC_KEY||'':'',posthogHost,
  sessionReplay:env.POSTHOG_SESSION_REPLAY==='true',environment:env.ANALYTICS_ENVIRONMENT||'production',release:env.RAILWAY_GIT_COMMIT_SHA||env.APP_RELEASE||''};
}

// Never expose the authentication cookie, customer ID, phone or a plain hash of them.
export function analyticsUserId(customerId,secret=process.env.ANALYTICS_ID_SECRET){
 return typeof customerId==='string'&&secret?.length>=32?'user_'+createHmac('sha256',secret).update('analytics:'+customerId).digest('hex'):null;
}
