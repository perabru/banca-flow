const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const api = require('../assets/account-action.js');
function harness(mode='resetPassword') {
  const calls=[],changes=[],user={uid:'teacher-one'},auth={currentUser:user};
  const behavior={info:{operation:api.MODES[mode],data:{email:'new@example.test',previousEmail:'old@example.test'}},policy:{isValid:true},email:'teacher@example.test'};
  const sdk={verifyPasswordResetCode:async(a,code)=>{calls.push(['verifyReset',a,code]);if(behavior.verifyError)throw behavior.verifyError;return behavior.email;},checkActionCode:async(a,code)=>{calls.push(['check',a,code]);if(behavior.verifyError)throw behavior.verifyError;return behavior.info;},validatePassword:async(a,password)=>{calls.push(['policy',password]);return behavior.policy;},confirmPasswordReset:async(a,code,password)=>{calls.push(['reset',code,password]);await behavior.beforeReset?.();if(behavior.saveError)throw behavior.saveError;},applyActionCode:async(a,code)=>{calls.push(['apply',code]);await behavior.beforeApply?.();if(behavior.saveError)throw behavior.saveError;},reload:async()=>{calls.push(['reload']);if(behavior.reloadError)throw behavior.reloadError;},getIdToken:async(u,force)=>calls.push(['token',u.uid,force])};
  const controller=api.createController({auth,params:{mode,code:'valid-code'},api:sdk,onChange:s=>changes.push(s)});
  return{controller,calls,changes,behavior,sdk,auth};
}
test('action input accepts only supported unambiguous code payloads and ignores arbitrary continue URLs',()=>{
 const base='https://perabru.github.io/banca-flow/account-action.html';
 assert.deepEqual(api.parseActionInput(base+'?mode=resetPassword&oobCode=abc&continueUrl=https://evil.test&apiKey=public','public'),{mode:'resetPassword',code:'abc'});
 for(const suffix of ['','?mode=other&oobCode=x','?mode=resetPassword','?mode=resetPassword&mode=verifyEmail&oobCode=x','?mode=resetPassword&oobCode=x&oobCode=y','?mode=resetPassword&oobCode=a%20b','?mode=resetPassword&oobCode=x&apiKey=wrong','?mode=resetPassword&oobCode=x&tenantId=other'])assert.equal(api.parseActionInput(base+suffix,'public'),null,suffix);
});
test('verifying a reset link never changes a password until explicit confirmation',async()=>{
 const h=harness();assert.equal((await h.controller.start()).phase,'ready');assert.equal(h.controller.view().email,'teacher@example.test');assert.equal(h.calls.some(c=>c[0]==='reset'),false);
 await h.controller.finish('New password!42','New password!42');assert.equal(h.controller.view().phase,'success');assert.deepEqual(h.calls.find(c=>c[0]==='reset'),['reset','valid-code','New password!42']);assert.deepEqual(h.calls.find(c=>c[0]==='token'),['token','teacher-one',true]);
});
test('confirmation mismatch and length limits are checked before SDK mutation',async()=>{
 const h=harness();await h.controller.start();for(const values of [['short','short'],['Good pass!42','different'],['x'.repeat(129),'x'.repeat(129)]]){await h.controller.finish(...values);assert.equal(h.controller.view().phase,'ready');assert.ok(h.controller.view().error);}assert.equal(h.calls.some(c=>c[0]==='reset'),false);
});
test('Firebase password policy is enforced and rendered as specific local feedback',async()=>{
 const h=harness();await h.controller.start();h.behavior.policy={isValid:false,meetsMinPasswordLength:false,containsUppercaseLetter:false,containsNonAlphanumericCharacter:false,passwordPolicy:{customStrengthOptions:{minPasswordLength:14}}};await h.controller.finish('password123','password123');assert.match(h.controller.view().policy,/14 caracteres/);assert.match(h.controller.view().policy,/maiúscula/);assert.match(h.controller.view().policy,/símbolo/);assert.equal(h.calls.some(c=>c[0]==='reset'),false);
});
test('all three email actions check the exact operation and require explicit confirmation',async()=>{
 for(const mode of ['verifyAndChangeEmail','verifyEmail','recoverEmail']){const h=harness(mode);await h.controller.start();assert.equal(h.controller.view().phase,'ready');assert.equal(h.calls.some(c=>c[0]==='apply'),false);await h.controller.finish();assert.equal(h.controller.view().phase,'success');assert.equal(h.calls.filter(c=>c[0]==='apply').length,1);assert.equal(h.calls.filter(c=>c[0]==='check').length,2);}
});
test('an email action cannot apply a code for a different operation or a changed target',async()=>{
 const h=harness('verifyAndChangeEmail');h.behavior.info.operation='VERIFY_EMAIL';await h.controller.start();assert.equal(h.controller.view().phase,'error');assert.match(h.controller.view().error,/corresponde/);assert.equal(h.calls.some(c=>c[0]==='apply'),false);
 const h2=harness('verifyAndChangeEmail');await h2.controller.start();h2.behavior.info.data.email='changed@example.test';await h2.controller.finish();assert.equal(h2.controller.view().phase,'ready');assert.match(h2.controller.view().error,/mudou/);assert.equal(h2.calls.some(c=>c[0]==='apply'),false);
});
test('expired, reused and incomplete links get actionable messages without user enumeration',async()=>{
 for(const code of ['auth/expired-action-code','auth/invalid-action-code','auth/user-not-found']){const h=harness();h.behavior.verifyError={code};await h.controller.start();assert.equal(h.controller.view().phase,'error');assert.match(h.controller.view().error,/expirou ou já foi utilizado/);}
 const c=api.createController({params:null});await c.start();assert.equal(c.view().phase,'error');assert.match(c.view().error,/incompleto/);
});
test('failed writes are retryable while a completed action cannot run twice',async()=>{
 const h=harness();await h.controller.start();h.behavior.saveError={code:'auth/network-request-failed'};await h.controller.finish('New password!42','New password!42');assert.equal(h.controller.view().phase,'ready');assert.match(h.controller.view().error,/internet/);delete h.behavior.saveError;await h.controller.finish('New password!42','New password!42');await h.controller.finish('New password!42','New password!42');assert.equal(h.calls.filter(c=>c[0]==='reset').length,2);assert.equal(h.controller.view().completed,true);
});
test('busy duplicate submissions produce exactly one mutation',async()=>{
 const h=harness();await h.controller.start();let release;h.behavior.beforeReset=()=>new Promise(r=>{release=r;});const pending=h.controller.finish('New password!42','New password!42');await new Promise(r=>setImmediate(r));await h.controller.finish('New password!42','New password!42');assert.equal(h.calls.filter(c=>c[0]==='reset').length,1);release();await pending;assert.equal(h.controller.view().completed,true);
});
test('failed session reload after a committed action does not invite applying it again',async()=>{
 const h=harness('verifyAndChangeEmail');await h.controller.start();h.behavior.reloadError={code:'auth/user-token-expired'};await h.controller.finish();assert.equal(h.controller.view().phase,'success');assert.equal(h.controller.view().refreshNeeded,true);assert.equal(h.controller.view().error,'');
});
test('disposing during policy validation prevents any password mutation or late render',async()=>{
 const h=harness();let release;h.sdk.validatePassword=()=>new Promise(r=>{release=r;});await h.controller.start();const pending=h.controller.finish('New password!42','New password!42');const count=h.changes.length;h.controller.dispose();release({isValid:true});await pending;assert.equal(h.changes.length,count);assert.equal(h.calls.some(c=>c[0]==='reset'),false);
});
test('rendered account metadata, errors and policy are text escaped and navigation stays fixed',()=>{
 const html=api.render({phase:'ready',mode:'verifyAndChangeEmail',email:'<img src=x onerror=alert(1)>',previousEmail:'<script>x</script>',error:'<svg onload=x>',policy:'<b>policy</b>'});assert.doesNotMatch(html,/<img|<script|<svg|<b>policy/);assert.match(html,/&lt;img/);assert.match(html,/href="\.\/index.html"/);assert.doesNotMatch(html,/continueUrl/);
 const deleted=api.render({phase:'success',mode:'verifyAndChangeEmail',email:'new@example.test'});assert.match(deleted,/bancas e todas as notas foram preservadas/);assert.doesNotMatch(deleted,/account-action-form/);
});
test('auth action page has exact inline CSP, no referrer, no fixed year and canonical public Firebase config',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','account-action.html'),'utf8'),main=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],hash=createHash('sha256').update(script).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"));assert.match(html,/<meta name="referrer" content="no-referrer">/);assert.match(html,/history\.replaceState\(null, '', location\.pathname\)/);assert.doesNotMatch(html,/2026|localStorage|sessionStorage/);
 const getConfig=s=>s.match(/const firebaseConfig = (\{[\s\S]*?\});/)[1];assert.equal(getConfig(html),getConfig(main));
 const capture=script.indexOf('history.replaceState'),network=script.indexOf('await Promise.all');assert.ok(capture>=0&&capture<network,'codes removed before external SDK network request');
});
