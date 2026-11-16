import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsConfig,posthogPublicKey} from '../analytics-config.mjs';
import {createServerTelemetry} from '../server-telemetry.mjs';

test('public analytics config accepts project ingestion keys and rejects private/malformed keys without exposing credentials',()=>{
 for(const key of ['phc_test','phc_localtest','phc_Project-A_2']){
  assert.equal(posthogPublicKey(key),key);
  assert.equal(analyticsConfig({ANALYTICS_ENABLED:'true',POSTHOG_PUBLIC_KEY:key}).posthogKey,key);
 }
 for(const key of [undefined,null,7,{},'', 'phc_','phx_PRIVATE_TEST_ONLY',' phc_test','phc_test\n','phc_test?token=private']){
  const config=analyticsConfig({ANALYTICS_ENABLED:'true',GA4_MEASUREMENT_ID:'G-TEST',POSTHOG_PUBLIC_KEY:key,POSTHOG_CLI_API_KEY:'phx_OTHER_PRIVATE_TEST_ONLY',POSTHOG_CLI_PROJECT_ID:'9876'});
  assert.equal(config.posthogKey,'');assert.equal(config.gaId,'G-TEST','rejecting PostHog credentials preserves configured GA4');
  assert.doesNotMatch(JSON.stringify(config),/PRIVATE_TEST_ONLY|9876|phx_|CLI_API_KEY/);
 }
});

test('backend telemetry uses the same public ingestion key validation and never initializes with private credentials',async()=>{
 let calls=0;
 for(const key of ['phx_PRIVATE_TEST_ONLY','phc_','phc_test\n']){
  const telemetry=createServerTelemetry({env:{POSTHOG_SERVER_ERRORS:'true',POSTHOG_PUBLIC_KEY:key,POSTHOG_CLI_API_KEY:'phx_OTHER_PRIVATE_TEST_ONLY'},clientFactory(){calls++;assert.fail('private credentials must not initialize a client')}});
  assert.equal(telemetry.enabled,false);assert.equal(telemetry.capture(new Error('ignored')),false);await telemetry.shutdown();
 }
 assert.equal(calls,0);
 const telemetry=createServerTelemetry({env:{POSTHOG_SERVER_ERRORS:'true',POSTHOG_PUBLIC_KEY:'phc_test'},clientFactory(key){calls++;assert.equal(key,'phc_test');return {shutdown:async()=>{}}}});
 assert.equal(telemetry.enabled,true);await telemetry.shutdown();assert.equal(calls,1);
});
