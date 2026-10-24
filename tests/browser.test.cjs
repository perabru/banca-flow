/** Actual inline app with in-memory shared Firebase and intercepted share APIs.
 * Optional: BANCAFLOW_CHROMIUM=/path/to/chromium node --test tests/browser.test.cjs
 */
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}
const binary = process.env.BANCAFLOW_CHROMIUM;
const skip = !chromium ? 'Playwright is not installed' : !binary || !existsSync(binary) ? 'Set BANCAFLOW_CHROMIUM to a local Chromium binary' : false;
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import\s.+?;\s*$/gm, '');
const markup = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');
const XLSX=require('../assets/vendor/xlsx-0.20.3.full.min.js');
const localAssetPaths=['/assets/account-config.js','/assets/academic-years.js','/assets/account-security.js','/assets/account-security.css','/assets/vendor/xlsx-0.20.3.full.min.js','/assets/roster-import.js','/assets/analytics.js','/assets/analytics-pdf.js','/assets/analytics.css','/assets/report-center.css','/assets/coordinator-report.js','/assets/coordinator-report-pdf.js','/assets/board-chat.js','/assets/board-chat.css','/assets/board-import.js','/assets/chat-notifications.js','/assets/weighted-model.js','/assets/weighted-report-ui.js','/assets/weighted-report.css','/assets/weighted-report-pdf.js','/assets/weighted-workbench.js','/assets/board-assignment.js','/manifest.webmanifest','/chat-sw.js','/assets/app-icon-180.png','/assets/app-icon-192.png','/assets/app-icon-512.png','/assets/notification-badge.png'];
const assetContentType=path=>path.endsWith('.png')?'image/png':path.endsWith('.webmanifest')?'application/manifest+json':path.endsWith('.css')?'text/css':'text/javascript';
const readLocalAsset=path=>readFileSync(join(__dirname,'..',path.slice(1)));
const fixture = {
  users: {
    coord: { name: 'Alberson', email:'coord@example.test', role: 'coordinator', key: 'alberson', active: true },
    t1: { name: 'Professor Um', email:'one@example.test', key:'one', role: 'teacher', active: true },
    t2: { name: 'Professora Dois', email:'two@example.test', key:'two', role: 'teacher', active: true }
  },
  groups: { g1: { id: 'g1', name: 'Grupo de teste', title: 'Projeto de integração', className: '2A', advisorUid: 't1', students: { s1: 'Ana', s2: 'Bruno' } } },
  boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Professor Um', t2: 'Professora Dois' }, startAt: 1792321200000, durationMin: 30, room: 'Laboratório' } },
  groupBoards: { g1: 'b1' },
  grades: { b1: {
    t1: { s1: { presentation: 10, practice: 8, code: 6, time: 8 }, s2: { presentation: 0, practice: 0, code: 0, time: 0 } },
    t2: { s1: { presentation: 6, practice: 6, code: 6, time: 6 }, s2: { presentation: 10, practice: 10, code: 10, time: 10 } }
  } },
  deliveries: { b1: { s1: 9, s2: 0 } }, seals: {}, timers: { b1: {elapsedMs:123456,startedAt:0,updatedAt:1,updatedBy:'t1',revision:1} }
};

function adapter() {
  return `
    const notificationMock=globalThis.notificationMock={permission:localStorage.getItem('bancaflow-test-notification-permission')||'default',requestResult:'granted',requests:0,shown:[],registrations:[],workerMessages:[],workerListeners:new Set(),hidden:false,
      show(title,options={}){const record={title:String(title),options:JSON.parse(JSON.stringify(options)),closed:false};this.shown.push(record);return record;},
      setHidden(value){this.hidden=!!value;document.dispatchEvent(new Event('visibilitychange'));},
      dispatchWorkerMessage(data){for(const callback of this.workerListeners)callback({data});}
    };
    class MockNotification{
      static get permission(){return notificationMock.permission;}
      static async requestPermission(){notificationMock.requests++;if(notificationMock.requestError)throw Error(notificationMock.requestError);notificationMock.permission=notificationMock.requestResult;localStorage.setItem('bancaflow-test-notification-permission',notificationMock.permission);return notificationMock.permission;}
      constructor(title,options){this.record=notificationMock.show(title,options);}
      close(){this.record.closed=true;}
    }
    globalThis.Notification=MockNotification;
    const mockWorker={postMessage(value){notificationMock.workerMessages.push(value);}},mockRegistration={scope:location.origin+'/',active:mockWorker,waiting:null,installing:null,
      async showNotification(title,options){notificationMock.show(title,options);},
      async getNotifications(){return notificationMock.shown.filter(record=>!record.closed).map(record=>({tag:record.options.tag,data:record.options.data,close(){record.closed=true;}}));},
      async update(){},addEventListener(){}
    };
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:mockWorker,ready:Promise.resolve(mockRegistration),
      async register(url,options){notificationMock.registrations.push({url:String(url),options});return mockRegistration;},
      async getRegistration(){return mockRegistration;},addEventListener(type,callback){if(type==='message')notificationMock.workerListeners.add(callback);}
    }});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>notificationMock.hidden});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>notificationMock.hidden?'hidden':'visible'});
    const mock=globalThis.firebaseMock={data:${JSON.stringify(fixture)},uid:'t1',listeners:new Map(),writes:[],reads:[],listens:[],pushCount:0,
      clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));},
      path(target){return typeof target==='string'?target:(target?.path||'');},
      queryValue(target){const path=this.path(target),value=this.read(path);if(typeof target==='string'||!target?.constraints)return value;const child=target.constraints.find(c=>c.kind==='order')?.key;let rows=Object.entries(value||{}).sort(([ak,a],[bk,b])=>{const av=child?a?.[child]:ak,bv=child?b?.[child]:bk;return av===bv?(ak<bk?-1:ak>bk?1:0):av<bv?-1:1;});for(const c of target.constraints){if(c.kind==='before')rows=rows.filter(([key,item])=>{const v=child?item?.[child]:key;return v<c.value||(v===c.value&&c.key!==undefined&&key<c.key);});if(c.kind==='start')rows=rows.filter(([key,item])=>{const v=child?item?.[child]:key;return v>c.value||(v===c.value&&(c.key===undefined||key>=c.key));});if(c.kind==='last')rows=rows.slice(-c.count);}return Object.fromEntries(rows);},
      read(path){if(path==='.info/connected')return this.connected!==false;if(path==='.info/serverTimeOffset')return this.serverOffset||0;return path?path.split('/').reduce((v,k)=>v?.[k],this.data):this.data;},
      snapshot(target){const v=this.clone(this.queryValue(target)??null),snap=(value,key=null)=>({key,val:()=>this.clone(value),exists:()=>value!==null&&value!==undefined,forEach(cb){for(const[k,item]of Object.entries(value||{}))if(cb(snap(item,k))===true)return true;return false;}});return snap(v);},
      resolved(v){if(v&&typeof v==='object'){if(v['.sv']==='timestamp')return Date.now();return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,this.resolved(x)]));}return v;},
      write(path,v){const keys=path.split('/'),last=keys.pop(),parent=keys.reduce((x,k)=>x[k]||={},this.data);if(v===null)delete parent[last];else parent[last]=this.clone(this.resolved(v));},
      emit(path){for(const [registered,cbs]of this.listeners){const p=this.path(registered);if(p===path||p.startsWith(path+'/')||path.startsWith(p+'/'))for(const cb of cbs)cb(this.snapshot(registered));}}
    };
    const accountCalls=mock.accountCalls={resets:[],changes:[],reauthentications:[],reloads:[],confirmations:[],requests:[]};
    const mockUser=uid=>({uid,email:mock.data.users[uid]?.email||uid+'@example.test',emailVerified:false,async getIdToken(){return'test-token';},async getIdTokenResult(){return{claims:{email:this.email,email_verified:this.emailVerified,...mock.authClaims}};}});
    const authMock={currentUser:mockUser('t1'),languageCode:'pt-BR'};
    const initializeApp=()=>({}),getAuth=()=>authMock,getDatabase=()=>({}),onAuthStateChanged=()=>()=>{},ref=(_db,path='')=>path;
    const onValue=(target,cb,error)=>{const path=mock.path(target);mock.listens.push(path);if(!mock.listeners.has(target))mock.listeners.set(target,new Set());mock.listeners.get(target).add(cb);if(mock.chatReadError&&path.startsWith('chat')){mock.listeners.get(target).delete(cb);error?.(Object.assign(Error('chat permission denied'),{code:'PERMISSION_DENIED'}));}else cb(mock.snapshot(target));return()=>mock.listeners.get(target)?.delete(cb);};
    const query=(target,...constraints)=>({path:mock.path(target),constraints}),orderByChild=key=>({kind:'order',key}),limitToLast=count=>({kind:'last',count}),endBefore=(value,key)=>({kind:'before',value,key}),startAt=(value,key)=>({kind:'start',value,key});
    const onDisconnect=target=>({remove:async()=>{mock.disconnects||=[];mock.disconnects.push({kind:'remove',path:mock.path(target)});},cancel:async()=>{mock.disconnects||=[];mock.disconnects.push({kind:'cancel',path:mock.path(target)});}});
    const chatChannel=new BroadcastChannel('bancaflow-chat-test');chatChannel.onmessage=event=>{const{path,value}=event.data||{};if(typeof path==='string'&&path.startsWith('chat')){mock.write(path,value);mock.emit(path);}};
    const remove=async target=>{const path=mock.path(target);mock.write(path,null);mock.writes.push({path,value:null});mock.emit(path);if(path.startsWith('chat'))chatChannel.postMessage({path,value:null});};
    const get=async target=>{const path=mock.path(target);mock.reads.push(path);await mock.beforeRead?.(path);return mock.snapshot(target);},serverTimestamp=()=>({'.sv':'timestamp'});
    const set=async(target,value)=>{
      const path=mock.path(target);
      mock.writes.push({path,value:mock.clone(value)});
      if(mock.optimisticChatWrites&&path.startsWith('chatMessages/')){
        const previous=mock.clone(mock.read(path));mock.write(path,value);mock.emit(path);
        if(mock.deferChatSets)await new Promise(resolve=>mock.releaseChatSet=resolve);
        if(mock.chatSetError||mock.setError){mock.write(path,previous??null);mock.emit(path);throw Object.assign(Error(mock.chatSetError||mock.setError),{code:mock.chatSetErrorCode||'PERMISSION_DENIED'});}
        chatChannel.postMessage({path,value:mock.read(path)});return;
      }
      if(mock.deferSets)await new Promise(resolve=>mock.releaseSet=resolve);
      if(mock.setError)throw Error(mock.setError);
      mock.write(path,value);mock.emit(path);if(path.startsWith('chat'))chatChannel.postMessage({path,value:mock.read(path)});
    };
    const update=async(base,changes)=>{mock.writes.push({base:mock.path(base),changes:mock.clone(changes)});if(mock.deferUpdates)await new Promise(resolve=>mock.releaseUpdate=resolve);if(mock.updateError)throw Object.assign(Error(mock.updateError),{code:mock.updateErrorCode||'PERMISSION_DENIED'});Object.entries(changes).forEach(([path,v])=>mock.write(base?base+'/'+path:path,v));Object.keys(changes).forEach(path=>mock.emit(base?base+'/'+path:path));};
    const runTransaction=async(target,updater,options)=>{const path=mock.path(target);mock.transactions||=[];mock.transactions.push({path,options:mock.clone(options)});if(mock.transactionError)throw Object.assign(Error(mock.transactionError),{code:mock.transactionErrorCode||'PERMISSION_DENIED'});if(mock.deferTransactions)await new Promise(resolve=>mock.releaseTransaction=resolve);const next=updater(mock.clone(mock.read(path)??null));if(next===undefined)return{committed:false,snapshot:mock.snapshot(path)};mock.write(path,next);mock.writes.push({path,value:mock.clone(next)});mock.emit(path);if(path.startsWith('chat'))chatChannel.postMessage({path,value:mock.read(path)});return{committed:true,snapshot:mock.snapshot(path)};};
    const signOut=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async(_auth,email,settings)=>{accountCalls.resets.push({email,settings});if(mock.resetEmailError)throw Object.assign(Error(mock.resetEmailError),{code:mock.resetEmailError});};
    const EmailAuthProvider={credential:(email,password)=>({email,password})},reauthenticateWithCredential=async(user,credential)=>{accountCalls.reauthentications.push({uid:user.uid,...credential});if(mock.reauthenticateError)throw Object.assign(Error(mock.reauthenticateError),{code:mock.reauthenticateError});},verifyBeforeUpdateEmail=async(user,email,settings)=>{accountCalls.changes.push({uid:user.uid,email,settings});if(mock.emailChangeError)throw Object.assign(Error(mock.emailChangeError),{code:mock.emailChangeError});};
    const reload=async user=>{accountCalls.reloads.push(user.uid);},getIdToken=async(user,force)=>user.getIdToken(force),getIdTokenResult=async(user,force)=>user.getIdTokenResult(force),validatePassword=async(_auth,password)=>({isValid:password.length>=8,passwordPolicy:{customStrengthOptions:{minPasswordLength:8}}}),confirmPasswordReset=async(_auth,code,password)=>{accountCalls.confirmations.push({code,password});if(mock.confirmPasswordError)throw Object.assign(Error(mock.confirmPasswordError),{code:mock.confirmPasswordError});};
    const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(url,options={})=>{if(String(url).includes('cloudfunctions.net')){const body=options.body?JSON.parse(options.body):{};accountCalls.requests.push(body);const result=mock.accountResponses?.[body.action]||{ok:true,emailAvailable:false,smsAvailable:false};return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});}return originalFetch(url,options);};
    const initializeAuth=()=>({secondary:true}),inMemoryPersistence={},createUserWithEmailAndPassword=async()=>({user:{uid:'new-teacher'}}),deleteUser=async()=>{},deleteApp=async()=>{},push=target=>{const path=mock.path(target),key=path.startsWith('chat')?'chat-'+mock.uid+'-'+(++mock.pushCount):'new-group-'+(++mock.pushCount);return{key,path:path?path+'/'+key:key};};
  `;
}

async function openApp(t,{timezoneId='UTC'}={}) {
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)mkdirSync(process.env.BANCAFLOW_SCREENSHOT_DIR,{recursive:true});
  const args = process.env.BANCAFLOW_CHROMIUM_MODULE ? (await import(process.env.BANCAFLOW_CHROMIUM_MODULE)).default.args : ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await chromium.launch({ headless: true, executablePath: binary, args, env: process.env });
  t.after(() => browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId});
  const page=await context.newPage();
  const errors = [], requests = [], downloads = [], cspErrors=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|violates.*directive|Refused to execute/i.test(message.text()))cspErrors.push(message.text());});
  page.on('download', file => downloads.push(file.suggestedFilename()));
  let servedMarkup;
  const assets=new Map(localAssetPaths.filter(path=>existsSync(join(__dirname,'..',path.slice(1)))).map(path=>[path,readLocalAsset(path)]));
  const requestHandler=route => {
    requests.push(route.request().url());
    const url=new URL(route.request().url());
    if(url.origin==='https://bancaflow.example.test'&&assets.has(url.pathname))return route.fulfill({contentType:assetContentType(url.pathname),body:assets.get(url.pathname)});
    return route.request().url() === 'https://bancaflow.example.test/' ? route.fulfill({ contentType: 'text/html', body: servedMarkup }) : route.abort();
  };
  await page.route('**/*',requestHandler);
  const bootstrap = adapter() + source + `
    globalThis.appTest={state,auth,verificarAcesso,beginLoading:typeof beginLoading==='function'?beginLoading:null,resetLoading:typeof resetLoading==='function'?resetLoading:null,withLoading:typeof withLoading==='function'?withLoading:null,printReports,printCsv:typeof printCsv==='function'?printCsv:null,exportSchedulePdf,replicateGrade:typeof replicateGrade==='function'?replicateGrade:null,saveGrade,accountSecurity:typeof accountSecurity!=='undefined'?accountSecurity:null,openAccountSecurity:typeof openAccountSecurity==='function'?openAccountSecurity:null,openRecoveryDialog:typeof openRecoveryDialog==='function'?openRecoveryDialog:null,syncVerifiedAccountEmail:typeof syncVerifiedAccountEmail==='function'?syncVerifiedAccountEmail:null,getAccessRevision:()=>accessRevision,go,render,resetAppData,openBoardAssignment:typeof openBoardAssignment==='function'?openBoardAssignment:null,saveBoardAssignment:typeof saveBoardAssignment==='function'?saveBoardAssignment:null,closeBoardAssignment:typeof closeBoardAssignment==='function'?closeBoardAssignment:null,promoteTeacher:typeof promoteTeacher==='function'?promoteTeacher:null,prepareAdministratorRegistration:typeof prepareAdministratorRegistration==='function'?prepareAdministratorRegistration:null,createBoards,makeBoard,openBoardImport,closeBoardImport,confirmBoardImport,timerIsOverrun:typeof timerIsOverrun==='function'?timerIsOverrun:null,updateTimerDisplays:typeof updateTimerDisplays==='function'?updateTimerDisplays:null,chatRooms,chatView,openChatRoom,openGeneralChat:typeof openGeneralChat==='function'?openGeneralChat:null,isChatVisible:typeof isChatVisible==='function'?isChatVisible:null,toggleChatWidget:typeof toggleChatWidget==='function'?toggleChatWidget:null,closeChatWidget:typeof closeChatWidget==='function'?closeChatWidget:null,retryChat,sendChatMessage,beginChatEdit:typeof beginChatEdit==='function'?beginChatEdit:null,beginChatDelete:typeof beginChatDelete==='function'?beginChatDelete:null,cancelChatMutation:typeof cancelChatMutation==='function'?cancelChatMutation:null,submitChatEdit:typeof submitChatEdit==='function'?submitChatEdit:null,confirmChatDelete:typeof confirmChatDelete==='function'?confirmChatDelete:null,loadOlderChat,syncChat,stopChat,startChatPresence,stopChatPresence,toggleChatMuted:typeof toggleChatMuted==='function'?toggleChatMuted:null,requestChatNotifications:typeof requestChatNotifications==='function'?requestChatNotifications:null,syncChatAlerts:typeof syncChatAlerts==='function'?syncChatAlerts:null,stopChatAlerts:typeof stopChatAlerts==='function'?stopChatAlerts:null,getChatAlertsState:typeof getChatAlertsState==='function'?getChatAlertsState:null,weightedWorkbench:typeof weightedWorkbench!=='undefined'?weightedWorkbench:null,weightedReportsView:typeof weightedReportsView==='function'?weightedReportsView:null,buildWeightedReportPdf:typeof buildWeightedReportPdf==='function'?buildWeightedReportPdf:null,openBoardShare,closeBoardShare,analyticsBoards,analyticsView,printAnalytics,buildAnalyticsPdf,buildEvaluationPdf,coordinatorReportBoards,buildCoordinatorReportPdf,exportCoordinatorReport,coordinatorBoardRecord,filteredNotesBoards,boardNotesHtml,allNotesView,evaluatorBoards,myEvaluationsView,
      mount(uid){clearListeners();resetAppData();mock.uid=uid;state.user=mockUser(uid);authMock.currentUser=state.user;state.profile=mock.clone(mock.data.users[uid]);for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])state[key]=mock.clone(mock.data[key]||{});state.connected=true;document.querySelector('#login-view').classList.add('hidden');document.querySelector('#app-view').classList.remove('hidden');if(isCoord())for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])listen(key,key);else syncTeacherSubs();syncTimerSubs();go('avaliar','b1');}
    };appTest.mount('t1');
  `;
  const fixtureHash=createHash('sha256').update(bootstrap).digest('base64');
  servedMarkup=markup.replace(/(script-src[^;]*?)'sha256-[^']+'/,(all,prefix)=>prefix+`'sha256-${fixtureHash}'`).replace('</body>',`<script type="module">${bootstrap}</script></body>`);
  const reload = async () => { await page.goto('https://bancaflow.example.test/');await page.waitForFunction(()=>!!globalThis.appTest?.state.user);assert.deepEqual(cspErrors,[]); };
  await reload();
  const createPeer=async uid=>{const peer=await page.context().newPage();peer.on('pageerror',e=>errors.push(e.message));await peer.route('**/*',requestHandler);await peer.goto('https://bancaflow.example.test/');await peer.waitForFunction(()=>!!globalThis.appTest?.state.user);const data=await page.evaluate(()=>firebaseMock.data);await peer.evaluate(({data,uid})=>{firebaseMock.data=data;appTest.mount(uid);},{data,uid});return peer;};
  return { page, errors, requests, downloads, cspErrors, reload, createPeer };
}

// As opções avançadas ficam recolhidas no uso diário e são abertas pelo mesmo
// controle nativo que um coordenador utiliza no navegador.
async function openDetails(page, ...ids) {
  for (const id of ids) {
    const section = page.locator('#' + id);
    if (await section.count() && !await section.evaluate(element => element.open)) await section.locator(':scope > summary').click();
  }
}
async function openOfficialReports(page, analytics = false) {
  await openDetails(page, 'report-official-options');
  if (analytics) await openDetails(page, 'report-analytics-options');
}

test('actual mobile grading, shared timer and teacher/coordinator close/reopen preserve data and weighted PDF', {skip}, async t=>{
  const {page,errors,requests}=await openApp(t);
  const form=page.locator('[data-grade-form="b1"][data-student="s1"]'),input=form.locator('input[name="presentation"]');
  assert.equal(await input.inputValue(),'10');
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(),'02:03,45');
  for(const width of [320,390,640,768,1024,1440]){
    await page.setViewportSize({width,height:920});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}px`);
    if(process.env.BANCAFLOW_SCREENSHOT_DIR&&[390,1440].includes(width)){
      mkdirSync(process.env.BANCAFLOW_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,`banca-flow-real-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await input.fill('9');await input.focus();
  await page.evaluate(()=>{firebaseMock.write('timers/b1',{elapsedMs:123499,startedAt:0,updatedAt:Date.now(),updatedBy:'t2',revision:2});firebaseMock.emit('timers/b1');});
  assert.equal(await input.inputValue(),'9');assert.equal(await input.evaluate(el=>document.activeElement===el),true);
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Salve as notas'));
  await form.locator('button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.grades.b1.t1.s1.presentation===9);
  await page.locator('[data-timer-action="start"]').click();await page.waitForFunction(()=>!!firebaseMock.data.timers.b1.startedAt);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-seal="b1"]').click();
  assert.equal(await page.evaluate(()=>firebaseMock.data.seals.b1||null),null);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-seal="b1"]').click();await page.waitForFunction(()=>!!firebaseMock.data.seals.b1);
  assert.equal(await input.isDisabled(),true);assert.equal(await page.evaluate(()=>firebaseMock.data.timers.b1.startedAt),0);
  const elapsed=await page.evaluate(()=>firebaseMock.data.timers.b1.elapsedMs);
  await page.evaluate(()=>appTest.mount('t2'));
  assert.equal(await page.evaluate(()=>appTest.state.timers.b1.elapsedMs),elapsed);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reopen="b1"]').click();await page.waitForFunction(()=>!firebaseMock.data.seals.b1);
  assert.equal(await input.inputValue(),'6');assert.equal(await input.isDisabled(),false);
  assert.equal(await page.evaluate(()=>firebaseMock.data.grades.b1.t1.s1.presentation),9);
  await page.evaluate(()=>appTest.mount('coord'));await page.evaluate(()=>appTest.go('entregas'));
  const delivery=page.locator('[data-delivery-form="b1"][data-student="s1"]');
  await delivery.locator('input[name="delivery"]').fill('9.5');await delivery.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.deliveries.b1.s1===9.5);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-seal="b1"]').click();await page.waitForFunction(()=>!!firebaseMock.data.seals.b1);
  await page.evaluate(()=>appTest.go('relatorios'));await openOfficialReports(page);
  const pending=page.waitForEvent('download');await page.locator('[data-print-one="b1"]').click();const file=await pending;
  const pdf=readFileSync(await file.path(),'ascii');assert.ok(pdf.startsWith('%PDF-1.4'));
  for(const value of ['Ana','Bruno','Professor Um','Professora Dois','6,88','4,13','3,80','7,93'])assert.ok(pdf.includes(value),value);
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>!/firebaseio\.com|firebasedatabase\.app|gstatic\.com\/firebasejs/.test(url)));
});

test('sharing prepares private individual PDF and notes then uses native share or explicit WhatsApp fallback', {skip}, async t=>{
  const {page,errors,downloads}=await openApp(t);
  await page.evaluate(()=>{
    globalThis.shareMock={native:[],urls:[],clipboard:[],cancel:false,noClipboard:false,synchronousError:false,support:true};
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>shareMock.support});
    Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
      const item={name:data.files[0].name,type:data.files[0].type,text:data.text,active:navigator.userActivation.isActive,isFile:data.files[0]instanceof File};shareMock.native.push(item);
      if(shareMock.synchronousError)throw Error('Device rejected');
      if(shareMock.cancel)return Promise.reject(new DOMException('Canceled','AbortError'));
      return data.files[0].text().then(pdf=>item.pdf=pdf);
    }});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{shareMock.clipboard.push(value);return shareMock.noClipboard?Promise.reject(Error('Denied')):Promise.resolve();}}});
    document.addEventListener('click',event=>{const link=event.target.closest('a[href^="https://wa.me/"]');if(link){event.preventDefault();shareMock.urls.push(link.href);}},true);
  });
  await page.locator('[data-share-board="b1"][data-share-student="s1"]').click();
  await page.locator('#board-share-dialog').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>shareMock.native.length+shareMock.urls.length),0,'preparing never sends or opens WhatsApp');
  assert.equal(downloads.length,0,'preparing does not download automatically');
  const preview=page.locator('#board-share-preview');
  const teacherText=await preview.inputValue();
  assert.ok(teacherText.includes('parcial'));assert.ok(teacherText.includes('Ana'));assert.ok(teacherText.includes('Apresentação: 10,00'));
  for(const leak of ['Bruno','Professora Dois','Entregas (0–10)','Nota final (0–10)'])assert.ok(!teacherText.includes(leak),leak);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:844});
    const size=await page.locator('#board-share-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
    assert.ok(size.width<=width);assert.ok(size.scroll<=size.client+1);
    if(process.env.BANCAFLOW_SCREENSHOT_DIR&&width===390)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-share-390.png'),fullPage:true});
  }
  await page.locator('[data-share-native]').click();await page.waitForFunction(()=>!!shareMock.native[0]?.pdf);
  const native=await page.evaluate(()=>shareMock.native[0]);
  assert.equal(native.active,true);assert.equal(native.isFile,true);assert.equal(native.type,'application/pdf');assert.ok(native.pdf.startsWith('%PDF-1.4'));
  assert.ok(native.name.endsWith('_Ana.pdf'));assert.ok(!native.pdf.includes('Professora Dois'));assert.equal(native.text,teacherText);
  await page.evaluate(()=>shareMock.cancel=true);await page.locator('[data-share-native]').click();
  await page.waitForFunction(()=>document.querySelector('[data-share-status]').textContent.includes('cancelado'));
  assert.equal(await page.evaluate(()=>shareMock.urls.length),0);
  assert.equal(downloads.length,0,'cancel does not download automatically');
  await page.evaluate(()=>{shareMock.cancel=false;shareMock.synchronousError=true;});await page.locator('[data-share-native]').click();
  assert.equal(await page.locator('[data-share-download]').isEnabled(),true);
  await page.locator('[data-share-whatsapp]').click();
  const url=await page.evaluate(()=>shareMock.urls[0]);assert.equal(new URL(url).searchParams.get('text'),teacherText);
  assert.ok(!url.includes('phone='),'recipient is selected by user');
  await page.evaluate(()=>shareMock.noClipboard=true);await page.locator('[data-share-copy]').click();
  await page.waitForFunction(()=>document.querySelector('[data-share-status]').textContent.includes('selecionado'));
  assert.equal(await preview.evaluate(el=>el.selectionEnd-el.selectionStart),teacherText.length);
  const pending=page.waitForEvent('download');await page.locator('[data-share-download]').click();const partialFile=await pending;
  const partialPdf=readFileSync(await partialFile.path(),'ascii');assert.ok(partialPdf.includes('PARCIAL'));assert.ok(!partialPdf.includes('Professora Dois'));
  await page.evaluate(()=>appTest.mount('coord'));assert.equal(await page.locator('#board-share-dialog').count(),0);
  await page.evaluate(()=>{shareMock.support=false;firebaseMock.write('seals/b1',{by:'t1',at:Date.now()});firebaseMock.emit('seals/b1');});
  await page.locator('[data-share-board="b1"]').click();await page.locator('#board-share-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-share-native]').isDisabled(),true,'unsupported file sharing retains manual choices');
  assert.equal(await page.locator('[data-share-download]').isEnabled(),true);
  assert.equal(await page.locator('#board-share-student option').count(),3);
  await page.locator('#board-share-student').selectOption('s1');
  const official=await preview.inputValue();
  for(const text of ['Resultado oficial','Professor Um','Professora Dois','Banca × 60% (0–6): 4,20','Entregas × 40% (0–4): 3,60','Nota final (0–10): 7,80'])assert.ok(official.includes(text),text);
  assert.ok(!official.includes('Bruno'));
  await page.evaluate(()=>{firebaseMock.write('seals/b1',null);firebaseMock.emit('seals/b1');});
  await page.locator('[data-share-download]').click();assert.equal(await page.locator('[data-share-download]').isDisabled(),true);
  assert.ok((await page.locator('[data-share-status]').textContent()).includes('mudaram'));
  await page.evaluate(()=>{appTest.mount('t1');appTest.state.groups.g1.title='Projeto de nome longo '.repeat(1600);});
  await page.locator('[data-share-board="b1"][data-share-student="s1"]').click();await page.locator('#board-share-dialog').waitFor({state:'visible'});
  const longText=await preview.inputValue(),urlCount=await page.evaluate(()=>shareMock.urls.length);
  assert.ok(longText.length>24000);assert.equal(await page.locator('[data-share-paste]').isVisible(),true);
  await page.locator('[data-share-whatsapp]').click();
  assert.equal(await page.evaluate(()=>shareMock.urls.length),urlCount,'long messages must not truncate into a link');
  assert.equal(await preview.inputValue(),longText);
  await page.locator('[data-share-paste]').click();assert.equal(await page.evaluate(()=>shareMock.urls.at(-1)),'https://wa.me/?text=');
  assert.deepEqual(errors,[]);
});

test('drafts survive shared timer snapshots, remote close/reopen and pending save acknowledgements', {skip}, async t=>{
  const {page,errors}=await openApp(t);
  const form=page.locator('[data-grade-form="b1"][data-student="s1"]'),input=form.locator('input[name="presentation"]');
  await page.evaluate(()=>{appTest.state.grades.b1.t1={};appTest.render();});assert.equal(await input.inputValue(),'');
  await page.evaluate(()=>firebaseMock.emit('grades/b1/t1'));assert.equal(await input.inputValue(),'10');
  await input.fill('9');
  await page.evaluate(()=>{firebaseMock.write('seals/b1',{by:'t2',at:Date.now()});firebaseMock.emit('seals/b1');});assert.equal(await input.isDisabled(),true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reopen="b1"]').click();await page.waitForFunction(()=>!firebaseMock.data.seals.b1);
  assert.equal(await input.inputValue(),'9');
  await page.evaluate(()=>firebaseMock.deferSets=true);await form.locator('button[type="submit"]').click();await page.waitForFunction(()=>typeof firebaseMock.releaseSet==='function');
  await input.fill('8');await page.evaluate(()=>{firebaseMock.deferSets=false;firebaseMock.releaseSet();});await page.waitForFunction(()=>firebaseMock.data.grades.b1.t1.s1.presentation===9);
  assert.equal(await input.inputValue(),'8');assert.equal(await page.evaluate(()=>appTest.state.drafts.get('grade/b1/s1').presentation),'8');
  await page.evaluate(()=>appTest.resetAppData());assert.equal(await page.locator('#view').innerHTML(),'');assert.equal(await page.evaluate(()=>appTest.state.drafts.size),0);
  assert.deepEqual(errors,[]);
});

test('production CSP includes the exact executable inline source hashes',()=>{
  const policy=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  for(const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
    if(/\bsrc=|application\/json/.test(attrs))continue;
    assert.ok(policy.includes(`'sha256-${createHash('sha256').update(body).digest('base64')}'`));
  }
  assert.ok(!policy.match(/script-src[^;]*'unsafe-inline'/));
});

test('Alberson manages teachers and groups and imports a real Excel sheet only after preview and confirmation', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);
  await page.evaluate(()=>{appTest.mount('coord');appTest.go('professores');});
  await page.setViewportSize({width:320,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#teacher-name').fill('Docente Nova');await page.locator('#teacher-email').fill('nova@example.test');
  await page.locator('#teacher-key').fill('nova');await page.locator('#teacher-password').fill('strongpass');
  await page.locator('#teacher-form button[type="submit"]').click();await page.waitForFunction(()=>!!firebaseMock.data.users['new-teacher']);
  assert.equal(await page.evaluate(()=>appTest.state.user.uid),'coord');
  await page.locator('[data-edit-teacher="new-teacher"]').click();await page.locator('#teacher-edit-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#teacher-edit-login').getAttribute('readonly'),'');
  assert.equal(await page.locator('#teacher-edit-key').inputValue(),'nova');
  await page.locator('#teacher-edit-name').fill('Docente Atualizada');await page.locator('#teacher-edit-contact').fill('contato@example.test');
  await page.locator('#teacher-edit-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.users['new-teacher'].name==='Docente Atualizada');
  assert.equal(await page.evaluate(()=>firebaseMock.data.users['new-teacher'].email),'nova@example.test');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-remove-teacher="new-teacher"]').click();await page.waitForFunction(()=>firebaseMock.data.users['new-teacher'].active===false);
  await page.locator('.teacher-archive > summary').click();
  await page.locator('[data-restore-teacher="new-teacher"]').click();await page.waitForFunction(()=>firebaseMock.data.users['new-teacher'].active===true);

  await page.evaluate(()=>appTest.go('grupos'));
  await page.locator('#group-name').fill('Grupo Redes');await page.locator('#group-course').fill('Redes de Computadores');await page.locator('#group-class').fill('1A');
  await page.locator('#group-advisor').selectOption('t1');await page.locator('#group-title').fill('Rede segura');
  await page.locator('[data-remove-group-student="s3"]').click();
  await page.locator('#group-student-s1').fill('Carla');await page.locator('#group-student-s2').fill('Daniel');
  await page.locator('#group-form button[type="submit"]').click();await page.waitForFunction(()=>!!firebaseMock.data.groups['new-group-1']);
  assert.equal(await page.evaluate(()=>firebaseMock.data.groups['new-group-1'].students.s1),'Carla');
  await page.locator('[data-edit-group="new-group-1"]').click();await page.locator('#group-title').fill('Rede segura atualizada');
  await page.locator('#group-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.groups['new-group-1'].title==='Rede segura atualizada'||document.querySelector('#toast').textContent.includes('outra sessão'));
  assert.equal(await page.evaluate(()=>firebaseMock.data.groups['new-group-1'].title),'Rede segura atualizada',JSON.stringify(await page.evaluate(()=>({message:document.querySelector('#toast').textContent,stored:firebaseMock.data.groups['new-group-1'],local:appTest.state.groups['new-group-1']}))));
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-remove-group="new-group-1"]').click();await page.waitForFunction(()=>firebaseMock.data.groups['new-group-1'].active===false);
  await page.locator('#group-show-archived').check();page.once('dialog',dialog=>dialog.accept());await page.locator('[data-restore-group="new-group-1"]').click();
  await page.waitForFunction(()=>firebaseMock.data.groups['new-group-1'].active===true);
  await page.locator('[data-edit-group="new-group-1"]').click();await page.locator('#group-title').fill('Rede segura restaurada');
  await page.locator('#group-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.groups['new-group-1'].title==='Rede segura restaurada'||document.querySelector('#toast').textContent.includes('outra sessão'));
  assert.equal(await page.evaluate(()=>firebaseMock.data.groups['new-group-1'].title),'Rede segura restaurada','restore followed by immediate edit uses canonical database metadata');
  await page.evaluate(()=>scrollTo(0,scrollY));
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-groups-diagnostic-320.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,scrollX,overflows:[...document.querySelectorAll('*')].filter(el=>{const box=el.getBoundingClientRect();return box.width&&box.right+scrollX>innerWidth+1;}).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right+scrollX,text:el.textContent.slice(0,70)})).slice(0,12)}))));
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-groups-320.png'),fullPage:true});

  const rows=[['Curso','Turma','Grupo','Título','Orientador','Aluno'],['Engenharia','1E','Grupo Engenharia','Sensores','one@example.test','Eva'],['Engenharia','1E','Grupo Engenharia','Sensores','one@example.test','Fabio']];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Novos grupos');
  const bytes=Buffer.from(XLSX.write(workbook,{type:'array',bookType:'xlsx'}));
  const upload=()=>page.locator('#excel-import-file').setInputFiles({name:'grupos-engenharia.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
  const groupsBefore=await page.evaluate(()=>Object.keys(firebaseMock.data.groups).length);
  await page.locator('[data-open-excel-import]').click();await upload();await page.waitForFunction(()=>!document.querySelector('#excel-import-confirm').disabled);
  assert.ok((await page.locator('#excel-import-preview').textContent()).includes('Grupo Engenharia'));
  assert.equal(await page.evaluate(()=>Object.keys(firebaseMock.data.groups).length),groupsBefore);
  const dimensions=await page.locator('#excel-import-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
  assert.ok(dimensions.width<=320);assert.ok(dimensions.scroll<=dimensions.client+1);
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-excel-320.png'),fullPage:true});
  await page.locator('#excel-import-cancel').click();assert.equal(await page.evaluate(()=>Object.keys(firebaseMock.data.groups).length),groupsBefore);
  await page.locator('[data-open-excel-import]').click();await upload();await page.waitForFunction(()=>!document.querySelector('#excel-import-confirm').disabled);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#excel-import-confirm').click();await page.waitForFunction(()=>!!firebaseMock.data.groups['new-group-2']);
  assert.equal(await page.evaluate(()=>firebaseMock.data.groups['new-group-2'].courseName),'Engenharia');
  assert.equal(await page.evaluate(()=>firebaseMock.data.groups.g1.students.s1),'Ana');assert.equal(await page.evaluate(()=>firebaseMock.data.grades.b1.t1.s1.presentation),10);
  await page.locator('[data-open-excel-import]').click();await upload();await page.waitForFunction(()=>document.querySelector('#excel-import-preview').textContent.includes('Já cadastrado'));
  assert.equal(await page.locator('#excel-import-confirm').isDisabled(),true,'reimport preserves existing group');
  assert.equal(await page.evaluate(()=>Object.keys(firebaseMock.data.groups).length),groupsBefore+1);
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('unmodified production HTML loads local Excel and analytics assets and Firebase modules under its published CSP', {skip}, async t=>{
  const args=process.env.BANCAFLOW_CHROMIUM_MODULE?(await import(process.env.BANCAFLOW_CHROMIUM_MODULE)).default.args:['--no-sandbox','--disable-dev-shm-usage'];
  const browser=await chromium.launch({headless:true,executablePath:binary,args,env:process.env});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],cspErrors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|violates.*directive|Refused to execute/i.test(message.text()))cspErrors.push(message.text());});
  const modules={
    'firebase-app.js':`export const initializeApp=()=>({}),deleteApp=async()=>{};`,
    'firebase-auth.js':`export const EmailAuthProvider={credential:(email,password)=>({email,password})},reauthenticateWithCredential=async()=>{},verifyBeforeUpdateEmail=async()=>{},updateProfile=async()=>{},reload=async()=>{},getIdToken=async()=>'',getIdTokenResult=async()=>({claims:{}}),validatePassword=async()=>({isValid:true}),confirmPasswordReset=async()=>{},getAuth=()=>({currentUser:null}),initializeAuth=()=>({}),inMemoryPersistence={},onAuthStateChanged=(_auth,callback)=>{queueMicrotask(()=>callback(null));return()=>{};},signOut=async()=>{},sendPasswordResetEmail=async()=>{},createUserWithEmailAndPassword=async()=>({user:{uid:'fixture'}}),deleteUser=async()=>{},signInWithEmailAndPassword=async()=>{const e=Error('Fixture credentials rejected');e.code='auth/invalid-credential';throw e;};`,
    'firebase-database.js':`export const query=(target,...constraints)=>({path:target,constraints}),orderByChild=key=>({key}),limitToLast=count=>({count}),endBefore=(value,key)=>({value,key}),startAt=(value,key)=>({value,key}),onDisconnect=()=>({remove:async()=>{},cancel:async()=>{}}),remove=async()=>{},getDatabase=()=>({}),ref=(_db,path='')=>path,get=async()=>({val:()=>null,exists:()=>false}),set=async()=>{},update=async()=>{},onValue=()=>()=>{},push=()=>({key:'fixture'}),serverTimestamp=()=>({'.sv':'timestamp'}),runTransaction=async()=>({committed:false,snapshot:{val:()=>null}});`
  };
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.href==='https://bancaflow.production.test/')return route.fulfill({contentType:'text/html',body:html});
    if(url.origin==='https://bancaflow.production.test'&&localAssetPaths.includes(url.pathname))return route.fulfill({contentType:assetContentType(url.pathname),body:readLocalAsset(url.pathname)});
    if(url.origin==='https://bancaflow-csp-fixture.firebaseio.com'&&url.pathname==='/.lp')return route.fulfill({contentType:'text/javascript',body:'parent.__fixtureLongPollLoaded=true;'});
    const name=url.pathname.split('/').at(-1);if(url.origin==='https://www.gstatic.com'&&modules[name])return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:modules[name]});
    return route.abort();
  });
  await page.goto('https://bancaflow.production.test/');
  await page.waitForFunction(()=>globalThis.XLSX?.version==='0.20.3'&&!!globalThis.BancaFlowImport&&!!globalThis.BancaAnalytics&&!!globalThis.BancaAnalyticsPdf&&!!globalThis.BancaCoordinatorReport&&!!globalThis.BancaCoordinatorPdf&&!!globalThis.BancaChat&&!!globalThis.BancaBoardImport&&!!globalThis.BancaChatAlerts);
  const pwa=await page.evaluate(async()=>{
    const manifestResponse=await fetch(document.querySelector('link[rel="manifest"]').href),manifest=await manifestResponse.json();
    const paths=['assets/app-icon-180.png','assets/app-icon-192.png','assets/app-icon-512.png','assets/notification-badge.png'];
    const icons=await Promise.all(paths.map(async path=>{const response=await fetch(path),bytes=new Uint8Array(await response.arrayBuffer()),image=new Image();image.src=path;await image.decode();return{path,status:response.status,type:response.headers.get('content-type'),signature:[...bytes.slice(0,8)],width:image.naturalWidth,height:image.naturalHeight};}));
    const worker=await fetch('chat-sw.js');return{manifest,manifestType:manifestResponse.headers.get('content-type'),icons,workerStatus:worker.status,workerType:worker.headers.get('content-type'),workerSource:await worker.text()};
  });
  assert.match(pwa.manifestType,/application\/manifest\+json/);assert.equal(pwa.manifest.scope,'./');assert.equal(pwa.manifest.start_url,'./');assert.equal(pwa.manifest.display,'standalone');
  for(const icon of pwa.manifest.icons){assert.ok(icon.src.startsWith('assets/'));assert.equal(new URL(icon.src,'https://bancaflow.production.test/manifest.webmanifest').origin,'https://bancaflow.production.test');}
  for(const icon of pwa.icons){assert.equal(icon.status,200);assert.match(icon.type,/image\/png/);assert.deepEqual(icon.signature,[137,80,78,71,13,10,26,10]);assert.ok(icon.width>0&&icon.height>0);}
  for(const size of [180,192,512]){const icon=pwa.icons.find(item=>item.path===`assets/app-icon-${size}.png`);assert.equal(icon.width,size);assert.equal(icon.height,size);}
  assert.equal(pwa.workerStatus,200);assert.match(pwa.workerType,/javascript/);assert.match(pwa.workerSource,/notificationclick/);
  await page.locator('#email').fill('fixture@example.test');await page.locator('#password').fill('password123');await page.locator('#toggle-password').click();
  assert.equal(await page.locator('#password').getAttribute('type'),'text');
  await page.locator('#login-button').click();await page.waitForFunction(()=>document.querySelector('#login-status').textContent.includes('E-mail ou senha incorretos'));
  await page.evaluate(()=>{
    const frame=document.createElement('iframe');frame.src='about:blank';frame.hidden=true;document.body.appendChild(frame);
    const script=frame.contentDocument.createElement('script');script.src='https://bancaflow-csp-fixture.firebaseio.com/.lp?fixture=1';frame.contentDocument.head.appendChild(script);
  });
  await page.waitForFunction(()=>globalThis.__fixtureLongPollLoaded===true);
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('mobile date filters use local midnight, combine course/class, scope every export and retain mobile group navigation', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t,{timezoneId:'America/Sao_Paulo'});
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{
    const copy=value=>JSON.parse(JSON.stringify(value)),original=copy(firebaseMock.data.boards.b1),template=copy(firebaseMock.data.groups.g1),scores=copy(firebaseMock.data.grades.b1),delivery=copy(firebaseMock.data.deliveries.b1);
    const entries=[['b1','BEFORE_DAY','ADS','2A','2026-10-18T02:59:59Z',true],['b2','AFTER_DAY','ADS','2A','2026-10-18T03:00:00Z',true],['b3','ENGINEERING_DAY','Engenharia','2A','2026-10-18T04:00:00Z',true],['b4','PRIVATE_DAY','ADS','2A','2026-10-18T05:00:00Z',false],['b5','OTHER_CLASS','ADS','3A','2026-10-18T06:00:00Z',true]];
    const data=firebaseMock.data;data.groups={};data.boards={};data.groupBoards={};data.grades={};data.deliveries={};data.seals={};data.timers={};
    for(const[bid,name,courseName,className,at,assigned]of entries){
      const gid='g'+bid.slice(1);data.groups[gid]={...copy(template),id:gid,name,courseName,className};
      data.boards[bid]={...copy(original),groupId:gid,startAt:Date.parse(at),members:assigned?{t1:true,t2:true}:{t2:true,coord:true}};
      data.groupBoards[gid]=bid;data.grades[bid]=assigned?copy(scores):{t2:copy(scores.t1),coord:copy(scores.t2)};data.deliveries[bid]=copy(delivery);data.seals[bid]={by:'coord',at:Date.now()};
    }
    data.groups.unscheduled={...copy(template),id:'unscheduled',name:'UNSCHEDULED_DAY',courseName:'ADS',className:'2A'};
    appTest.mount('t1');appTest.go('bancas');
  });
  await page.locator('#filter-course').selectOption('ADS');await page.locator('#filter-class').selectOption('2A');
  await page.locator('#filter-date').fill('2026-10-17');
  assert.deepEqual(await page.locator('.board-card h4').allTextContents(),['BEFORE_DAY'],'23:59:59 local stays on the prior day');
  await page.locator('#filter-date').fill('2026-10-18');
  assert.deepEqual(await page.locator('.board-card h4').allTextContents(),['AFTER_DAY'],'00:00:00 local moves to the next day; unassigned stays hidden');
  await page.locator('[data-date-today="boards"]').click();
  const today=await page.evaluate(()=>{const date=new Date();return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');});
  assert.equal(await page.locator('#filter-date').inputValue(),today);
  await page.locator('[data-date-clear="boards"]').click();assert.equal(await page.locator('#filter-date').inputValue(),'');
  assert.deepEqual(await page.locator('.board-card h4').allTextContents(),['BEFORE_DAY','AFTER_DAY']);

  await page.evaluate(()=>{appTest.mount('coord');appTest.go('bancas');});
  assert.equal(await page.locator('#filter-date').inputValue(),'','account reset clears the previous date');
  await page.locator('#filter-course').selectOption('ADS');await page.locator('#filter-class').selectOption('2A');await page.locator('#filter-date').fill('2026-10-18');
  assert.deepEqual(await page.locator('.board-card h4').allTextContents(),['AFTER_DAY','PRIVATE_DAY']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'date toolbar fits 320px');
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-date-filter-320.png'),fullPage:true});
  let downloading=page.waitForEvent('download');await page.locator('[data-pdf-agenda]').click();let file=await downloading;
  const agenda=readFileSync(await file.path(),'ascii');
  for(const name of ['AFTER_DAY','PRIVATE_DAY'])assert.ok(agenda.includes(name));
  for(const name of ['BEFORE_DAY','ENGINEERING_DAY','OTHER_CLASS','UNSCHEDULED_DAY'])assert.ok(!agenda.includes(name),name);
  await page.evaluate(()=>appTest.go('relatorios'));await openOfficialReports(page);await page.locator('#report-course-filter').selectOption('ADS');await page.locator('#report-filter').selectOption('2A');await page.locator('#report-date-filter').fill('2026-10-18');
  assert.equal(await page.locator('[data-print-all]').isEnabled(),true,'unscheduled groups do not block a day-specific report');
  downloading=page.waitForEvent('download');await page.locator('[data-print-all]').click();file=await downloading;
  const report=readFileSync(await file.path(),'ascii');
  for(const name of ['AFTER_DAY','PRIVATE_DAY'])assert.ok(report.includes(name));
  for(const name of ['BEFORE_DAY','ENGINEERING_DAY','OTHER_CLASS','UNSCHEDULED_DAY'])assert.ok(!report.includes(name),name);
  downloading=page.waitForEvent('download');await page.locator('[data-export-csv]').click();file=await downloading;
  const csv=readFileSync(await file.path(),'utf8');
  for(const name of ['AFTER_DAY','PRIVATE_DAY'])assert.ok(csv.includes(name));
  for(const name of ['BEFORE_DAY','ENGINEERING_DAY','OTHER_CLASS','UNSCHEDULED_DAY'])assert.ok(!csv.includes(name),name);
  await page.locator('[data-date-today="reports"]').click();assert.equal(await page.locator('#report-date-filter').inputValue(),today);
  await page.locator('[data-date-clear="reports"]').click();assert.equal(await page.locator('[data-print-all]').isDisabled(),true,'all-dates report retains the unscheduled-group guard');
  await page.locator('#mobile-nav [data-open-menu]').click();await page.locator('#mobile-menu [data-route="grupos"]').click();
  assert.equal(await page.evaluate(()=>appTest.state.route),'grupos');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});


test('coordinator analytics render responsive accessible charts with filtered zero/missing times and export real vector PDFs', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t,{timezoneId:'America/Sao_Paulo'});
  await page.evaluate(()=>{
    const copy=value=>JSON.parse(JSON.stringify(value)),original=copy(firebaseMock.data.boards.b1),group=copy(firebaseMock.data.groups.g1),grades=copy(firebaseMock.data.grades.b1),deliveries=copy(firebaseMock.data.deliveries.b1),data=firebaseMock.data;
    Object.assign(data,{groups:{},boards:{},groupBoards:{},grades:{},deliveries:{},seals:{},timers:{}});
    const entries=[['b1','GRUPO_ALFA','ADS','2026-10-18T13:00:00Z',true,0],['b2','GRUPO_BETA','ADS','2026-10-18T14:00:00Z',true,null],['b3','PENDENTE','ADS','2026-10-18T15:00:00Z',false,123456],['b4','OUTRO_DIA','ADS','2026-10-19T13:00:00Z',true,123456],['b5','OUTRO_CURSO','Engenharia','2026-10-18T13:00:00Z',true,123456]];
    for(const[bid,name,courseName,at,sealed,elapsedMs]of entries){
      const gid='g'+bid.slice(1);data.groups[gid]={...copy(group),id:gid,name,courseName,className:'2A'};
      data.boards[bid]={...copy(original),groupId:gid,startAt:Date.parse(at)};data.groupBoards[gid]=bid;
      data.grades[bid]=copy(grades);data.deliveries[bid]=copy(deliveries);
      if(sealed)data.seals[bid]={by:'coord',at:Date.now()};if(elapsedMs!==null)data.timers[bid]={elapsedMs,startedAt:0,revision:1};
    }
    appTest.mount('coord');appTest.go('relatorios');
  });
  await openOfficialReports(page,true);
  await page.locator('#report-course-filter').selectOption('ADS');await page.locator('#report-filter').selectOption('2A');await page.locator('#report-date-filter').fill('2026-10-18');
  const panel=page.locator('.analytics-panel');
  assert.equal(await panel.locator('svg[role="img"]').count(),3);
  assert.equal(await panel.locator('svg title').count(),3);assert.equal(await panel.locator('svg desc').count(),3);
  const text=await panel.textContent();
  for(const included of ['GRUPO_ALFA','GRUPO_BETA','00:00,00','Não registrado'])assert.ok(text.includes(included),included);
  for(const excluded of ['PENDENTE','OUTRO_DIA','OUTRO_CURSO'])assert.ok(!text.includes(excluded),excluded);
  assert.equal(await page.locator('#analytics-board-filter option').count(),3);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:950});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`analytics overflow at ${width}px`);
    if(process.env.BANCAFLOW_SCREENSHOT_DIR&&[320,390,1440].includes(width))await panel.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,`banca-flow-analytics-${width}.png`),style:'.topbar,.mobile-nav{visibility:hidden!important}'});
  }
  const qa=process.env.BANCAFLOW_QA_DIR;if(qa)mkdirSync(qa,{recursive:true});
  let downloading=page.waitForEvent('download');await page.locator('[data-print-analytics]').click();let file=await downloading;
  if(qa)await file.saveAs(join(qa,'analytics-overview.pdf'));
  const overviewPdf=readFileSync(await file.path(),'ascii');
  for(const included of ['%PDF-1.4','GRUPO_ALFA','GRUPO_BETA','Notas por banca','Tempo de apresenta','Professor Um'])assert.ok(overviewPdf.includes(included),included);
  for(const excluded of ['PENDENTE','OUTRO_DIA','OUTRO_CURSO','/Subtype /Image'])assert.ok(!overviewPdf.includes(excluded),excluded);
  await page.locator('#analytics-board-filter').selectOption('b1');
  assert.ok((await panel.textContent()).includes('Notas dos avaliadores'));assert.ok((await panel.textContent()).includes('Ana'));
  assert.ok((await panel.textContent()).includes('Professora Dois'));
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await panel.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-analytics-detail-1440.png'),style:'.topbar,.mobile-nav{visibility:hidden!important}'});
  downloading=page.waitForEvent('download');await page.locator('[data-print-analytics]').click();file=await downloading;
  if(qa)await file.saveAs(join(qa,'analytics-selected.pdf'));
  const selectedPdf=readFileSync(await file.path(),'ascii');assert.ok(selectedPdf.includes('GRUPO_ALFA'));assert.ok(!selectedPdf.includes('GRUPO_BETA'));
  downloading=page.waitForEvent('download');await page.locator('[data-print-one="b1"]').click();file=await downloading;
  if(qa)await file.saveAs(join(qa,'official-with-graphs.pdf'));
  assert.ok(readFileSync(await file.path(),'ascii').includes('Notas por banca'));
  await page.locator('#report-charts').uncheck();
  downloading=page.waitForEvent('download');await page.locator('[data-print-one="b1"]').click();file=await downloading;
  assert.ok(!readFileSync(await file.path(),'ascii').includes('Notas por banca'));
  await page.evaluate(()=>{appTest.mount('t1');appTest.go('relatorios');});
  assert.equal(await page.locator('.analytics-panel').count(),0);assert.equal(await page.locator('[data-print-analytics]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('analytics empty state disables PDF and fully removes stale detail selection after filter changes', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t);
  await page.evaluate(()=>{appTest.mount('coord');appTest.go('relatorios');});await openOfficialReports(page,true);
  assert.equal(await page.locator('[data-print-analytics]').isDisabled(),true);
  assert.equal(await page.locator('.analytics-panel svg[role="img"]').count(),0);
  assert.ok((await page.locator('.analytics-panel').textContent()).includes('Nenhuma banca completa'));
  await page.evaluate(()=>{firebaseMock.write('seals/b1',{by:'coord',at:Date.now()});firebaseMock.emit('seals/b1');});
  await page.locator('#analytics-board-filter').selectOption('b1');
  assert.ok((await page.locator('.analytics-panel').textContent()).includes('Notas dos avaliadores'));
  await page.locator('#report-date-filter').fill('2099-01-01');
  assert.equal(await page.locator('[data-print-analytics]').isDisabled(),true);assert.equal(await page.locator('.analytics-panel svg[role="img"]').count(),0);
  await page.locator('[data-date-clear="reports"]').click();
  assert.equal(await page.locator('#analytics-board-filter').inputValue(),'','stale selected board is reset when the report filters change');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});


test('Alberson consults all saved scores including pending and historical boards through mobile and desktop navigation', {skip}, async t=>{
  const{page,errors,cspErrors,requests}=await openApp(t);
  await page.evaluate(()=>{
    const baseGroup=firebaseMock.clone(firebaseMock.data.groups.g1),baseBoard=firebaseMock.clone(firebaseMock.data.boards.b1),baseGrades=firebaseMock.clone(firebaseMock.data.grades.b1),baseDeliveries=firebaseMock.clone(firebaseMock.data.deliveries.b1);
    const rows=[['b1','g1','ABERTA_COMPLETA','ADS','2A','2026-10-18',false,false],['b2','g2','ENCERRADA_HISTORICA','Engenharia','3A','2026-10-19',true,true],['b3','g3','ABERTA_PENDENTE','ADS','2A','2026-10-18',false,false],['b4','g4','ENCERRADA_PENDENTE','Redes','4A','2026-10-20',true,false]];
    firebaseMock.data.users.disabled={name:'Professor Histórico',role:'teacher',active:false};
    for(const[id,gid,name,courseName,className,date,sealed,archived]of rows){
      firebaseMock.data.groups[gid]={...firebaseMock.clone(baseGroup),id:gid,name,courseName,className,active:!archived};
      firebaseMock.data.boards[id]={...firebaseMock.clone(baseBoard),groupId:gid,startAt:Date.parse(date+'T15:00:00Z')};
      firebaseMock.data.grades[id]=firebaseMock.clone(baseGrades);firebaseMock.data.deliveries[id]=firebaseMock.clone(baseDeliveries);firebaseMock.data.groupBoards[gid]=id;
      if(sealed)firebaseMock.data.seals[id]={by:'coord',at:Date.now()};
    }
    firebaseMock.data.boards.b2.members={t1:true,disabled:true};firebaseMock.data.boards.b2.memberNames={t1:'Professor Um',disabled:'Professor Histórico'};
    firebaseMock.data.grades.b2.disabled=firebaseMock.data.grades.b2.t2;delete firebaseMock.data.grades.b2.t2;
    delete firebaseMock.data.grades.b3.t2.s1.code;delete firebaseMock.data.deliveries.b3.s2;
    firebaseMock.data.grades.b4={};firebaseMock.data.deliveries.b4={};
    appTest.mount('coord');Object.assign(appTest.state,{courseFilter:'NO_MATCH',filter:'NO_MATCH',boardDateFilter:'2099-01-01',reportCourseFilter:'NO_MATCH',reportFilter:'NO_MATCH',reportDateFilter:'2099-01-01'});appTest.go('inicio');
  });
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#desktop-nav [data-route="notas"]').click();
  assert.equal(await page.locator('#page-title').textContent(),'Todas as notas');
  assert.equal(await page.locator('[data-notes-board]').count(),4,'consultation is independent of agenda and PDF filters');
  assert.equal(await page.locator('[data-grade-form]').count(),0);assert.ok(await page.locator('[data-delivery-form]').count()>0);
  await page.locator('[data-notes-expand]').click();
  const firstBoard=page.locator('[data-notes-board="b1"]'),ana=firstBoard.locator('[data-notes-student="s1"]'),historic=page.locator('[data-notes-board="b2"]');
  assert.equal(await firstBoard.getAttribute('open'),'');
  for(const text of ['Ana','Professor Um','Professora Dois','7,80'])assert.ok((await ana.textContent()).includes(text),text);
  assert.ok((await firstBoard.locator('[data-notes-student="s2"]').textContent()).includes('0,00'),'zero grades are preserved');
  assert.ok((await historic.textContent()).includes('Professor Histórico'),'removed teachers remain visible in existing evaluations');
  assert.equal(await firstBoard.locator('.notes-table').count(),2);
  assert.equal(await firstBoard.locator('input[type="number"]').count(),2,'only individual monograph controls are editable');
  const savedBefore=await page.evaluate(()=>JSON.stringify(firebaseMock.data));
  for(const width of [320,390,640,768,1024,1440]){
    await page.setViewportSize({width,height:920});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`all notes overflow at ${width}px`);
    if(process.env.BANCAFLOW_SCREENSHOT_DIR&&[320,390,1440].includes(width))await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,`banca-flow-all-notes-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:720});
  const logout=await page.locator('#logout').boundingBox();assert.ok(logout&&logout.y>=0&&logout.y+logout.height<=720,'desktop logout remains within a 720px-tall viewport');
  if(process.env.BANCAFLOW_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-all-notes-sidebar-720.png')});
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data)),savedBefore,'consultation and responsive rendering are read only');
  await page.locator('#notes-search').fill('Busca ainda não aplicada');await page.locator('#notes-search').focus();await page.locator('#notes-search').evaluate(el=>el.setSelectionRange(5,12));
  await page.evaluate(()=>{firebaseMock.write('grades/b1/t2/s1/presentation',2);firebaseMock.emit('grades/b1/t2/s1');});
  await page.waitForFunction(()=>document.querySelector('[data-notes-board="b1"] [data-notes-student="s1"]').textContent.includes('7,50'));
  assert.equal(await firstBoard.getAttribute('open'),'','a saved score snapshot preserves expanded details');
  assert.equal(await page.locator('#notes-search').inputValue(),'Busca ainda não aplicada');assert.equal(await page.locator('[data-notes-board]').count(),4,'typing does not apply an incomplete search');
  assert.deepEqual(await page.locator('#notes-search').evaluate(el=>({focused:el===document.activeElement,start:el.selectionStart,end:el.selectionEnd})),{focused:true,start:5,end:12});
  assert.equal(await historic.getAttribute('open'),'','unrelated expanded details are also preserved');
  await page.locator('[data-notes-collapse]').click();assert.equal(await firstBoard.getAttribute('open'),null);
  await firstBoard.locator('summary').click();assert.equal(await firstBoard.getAttribute('open'),'');
  await page.evaluate(()=>{firebaseMock.write('grades/b1/t2/s1/time',8);firebaseMock.emit('grades/b1/t2/s1');});
  await page.waitForFunction(()=>document.querySelector('[data-notes-board="b1"] [data-notes-student="s1"]').textContent.includes('7,65'));
  assert.equal(await firstBoard.getAttribute('open'),'','manually expanded details persist after a Firebase update');

  await page.locator('#notes-course-filter').selectOption('ADS');await page.locator('#notes-class-filter').selectOption('2A');await page.locator('#notes-date-filter').fill('2026-10-18');await page.locator('#notes-status-filter').selectOption('pendentes');
  assert.deepEqual(await page.locator('[data-notes-board]').evaluateAll(els=>els.map(el=>el.dataset.notesBoard)),['b3']);
  await page.locator('[data-notes-reset]').click();assert.equal(await page.locator('[data-notes-board]').count(),4);
  assert.equal(await page.locator('#notes-date-filter').inputValue(),'');assert.equal(await page.locator('#notes-status-filter').inputValue(),'todas');
  await page.locator('#notes-search').fill('histórica');await page.locator('#notes-search').press('Enter');
  assert.deepEqual(await page.locator('[data-notes-board]').evaluateAll(els=>els.map(el=>el.dataset.notesBoard)),['b2']);
  await page.locator('[data-notes-reset]').click();assert.equal(await page.locator('#notes-search').inputValue(),'');
  await page.locator('#notes-status-filter').selectOption('encerradas');
  assert.deepEqual(await page.locator('[data-notes-board]').evaluateAll(els=>els.map(el=>el.dataset.notesBoard)),['b2','b4']);
  await page.locator('[data-notes-reset]').click();

  await page.setViewportSize({width:320,height:844});await page.evaluate(()=>appTest.go('inicio'));
  await page.locator('#mobile-nav [data-route="notas"]').click();
  assert.equal(await page.locator('#page-title').textContent(),'Todas as notas');assert.equal(await page.locator('#mobile-menu').isVisible(),false);
  await page.evaluate(()=>appTest.go('avaliar','b1'));
  assert.equal(await page.locator('[data-grade-form]').count(),0,'coordinator nonmember cannot edit evaluator notes');
  for(const text of ['Ana','Bruno','Professor Um','Professora Dois','7,65'])assert.ok((await page.locator('#view').textContent()).includes(text),text);
  assert.equal(await page.locator('.notes-table').count(),2,'coordinator detail includes all evaluator grades');

  await page.evaluate(()=>{appTest.mount('t1');appTest.go('notas');});
  assert.equal(await page.locator('[data-notes-board]').count(),0);assert.equal(await page.locator('.notes-table').count(),0);
  assert.equal(await page.locator('[data-route="notas"]').count(),0);
  const direct=await page.evaluate(()=>({table:appTest.boardNotesHtml('b1'),view:appTest.allNotesView(),filtered:appTest.filteredNotesBoards(),expanded:appTest.state.notesExpanded.size}));
  assert.equal(direct.table,'');assert.deepEqual(direct.filtered,[]);assert.equal(direct.expanded,0);
  for(const leaked of ['Professora Dois','7,65','notes-table'])assert.ok(!direct.view.includes(leaked),leaked);
  await page.evaluate(()=>appTest.go('avaliar','b1'));
  assert.equal(await page.locator('[data-grade-form]').count(),2);assert.equal(await page.locator('.notes-table').count(),0);
  assert.ok(!(await page.locator('#view').textContent()).includes('Professor Histórico'),'teachers retain their own assigned evaluation scope');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
  assert.ok(requests.every(url=>!/firebaseio\.com|firebasedatabase\.app|gstatic\.com\/firebasejs/.test(url)));
});

test('Alberson grades as an assigned evaluator through direct desktop/mobile navigation while retaining coordinator controls', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t);
  await page.evaluate(()=>{
    firebaseMock.data.boards.b1.members.coord=true;firebaseMock.data.boards.b1.memberNames.coord='Alberson';
    firebaseMock.data.grades.b1.coord={s1:{presentation:8,practice:8,code:8,time:8},s2:{presentation:5,practice:5,code:5,time:5}};
    firebaseMock.data.groups.g2={...firebaseMock.clone(firebaseMock.data.groups.g1),id:'g2',name:'Banca sem Alberson'};
    firebaseMock.data.boards.b2={...firebaseMock.clone(firebaseMock.data.boards.b1),groupId:'g2',startAt:1792300000000,members:{t1:true,t2:true},memberNames:{t1:'Professor Um',t2:'Professora Dois'}};
    firebaseMock.data.grades.b2={t1:firebaseMock.clone(firebaseMock.data.grades.b1.t1),t2:firebaseMock.clone(firebaseMock.data.grades.b1.t2)};
    firebaseMock.data.deliveries.b2={s1:9,s2:0};firebaseMock.data.groupBoards.g2='b2';
    firebaseMock.data.groups.g3={...firebaseMock.clone(firebaseMock.data.groups.g1),id:'g3',name:'Grupo para agendar'};
    appTest.mount('coord');appTest.go('avaliar','b2');
  });
  assert.equal(await page.locator('[data-grade-form]').count(),0,'unassigned detail remains readonly');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#desktop-nav [data-route="minhasavaliacoes"]').click();
  assert.equal(await page.locator('#page-title').textContent(),'Minhas avaliações');
  assert.equal(await page.locator('#my-grade-heading').textContent(),'Minha avaliação');
  assert.deepEqual(await page.locator('#board-switch option').evaluateAll(els=>els.map(el=>el.value)),['b1']);
  assert.equal(await page.locator('[data-grade-form="b1"]').count(),2,'coordinator has one own form per student');
  assert.equal(await page.locator('[data-grade-form="b2"]').count(),0);
  assert.equal(await page.locator('[data-delivery-form]').count(),2,'coordinator keeps separate monograph forms beside read-only consultation');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-grade-form]').compareDocumentPosition(document.querySelector('.notes-table'))&Node.DOCUMENT_POSITION_FOLLOWING),4,'own forms appear before the all-evaluator comparison');
  const previous=await page.evaluate(()=>({others:firebaseMock.clone({t1:firebaseMock.data.grades.b1.t1,t2:firebaseMock.data.grades.b1.t2}),deliveries:firebaseMock.clone(firebaseMock.data.deliveries),boards:firebaseMock.clone(firebaseMock.data.boards)}));
  const own=page.locator('[data-grade-form="b1"][data-student="s1"]');
  for(const[key,value]of Object.entries({presentation:'0',practice:'9.5',code:'7.5',time:'8'}))await own.locator(`input[name="${key}"]`).fill(value);
  await own.locator('button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.grades.b1.coord.s1.presentation===0&&firebaseMock.data.grades.b1.coord.s1.practice===9.5);
  const saved=await page.evaluate(()=>({score:firebaseMock.data.grades.b1.coord.s1,others:{t1:firebaseMock.data.grades.b1.t1,t2:firebaseMock.data.grades.b1.t2},deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,path:firebaseMock.writes.at(-1).path}));
  assert.deepEqual(saved.score,{presentation:0,practice:9.5,code:7.5,time:8});assert.equal(saved.path,'grades/b1/coord/s1');
  assert.deepEqual(saved.others,previous.others);assert.deepEqual(saved.deliveries,previous.deliveries);assert.deepEqual(saved.boards,previous.boards);
  const rows=page.locator('[data-notes-student="s1"] .notes-table tbody tr');
  const coordinatorRow=rows.filter({hasText:'Alberson'});assert.equal(await coordinatorRow.count(),1);
  for(const value of ['0,00','9,50','7,50','8,00','6,25'])assert.ok((await coordinatorRow.textContent()).includes(value),value);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`coordinator grading overflow at ${width}px`);
    if(process.env.BANCAFLOW_SCREENSHOT_DIR){
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,`banca-flow-coordinator-grading-${width}.png`),fullPage:true});
      if(width===320){
        await page.locator('#my-grade-heading').evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-90,behavior:'instant'}));
        await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,'banca-flow-coordinator-own-form-320.png')});
      }
    }
  }
  await page.setViewportSize({width:320,height:844});await page.evaluate(()=>appTest.go('inicio'));
  await page.locator('#mobile-nav [data-route="minhasavaliacoes"]').click();
  assert.equal(await page.locator('#my-grade-heading').textContent(),'Minha avaliação');assert.equal(await own.locator('input[name="presentation"]').inputValue(),'0');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-seal="b1"]').click();await page.waitForFunction(()=>!!firebaseMock.data.seals.b1);
  assert.equal(await own.locator('input[name="presentation"]').isDisabled(),true);assert.equal(await own.locator('button[type="submit"]').count(),0);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reopen="b1"]').click();await page.waitForFunction(()=>!firebaseMock.data.seals.b1);
  assert.equal(await own.locator('input[name="presentation"]').isEnabled(),true);
  await own.locator('input[name="presentation"]').fill('1');await own.locator('button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.grades.b1.coord.s1.presentation===1);
  await page.locator('#mobile-nav [data-open-menu]').click();await page.locator('#mobile-menu [data-route="entregas"]').click();
  assert.equal(await page.locator('[data-delivery-form="b1"]').count(),2,'coordinator keeps all delivery controls');
  await page.locator('#mobile-nav [data-open-menu]').click();await page.locator('#mobile-menu [data-route="notas"]').click();
  const assigned=page.locator('[data-notes-board="b1"]');await assigned.locator('summary').click();
  assert.equal(await assigned.locator('[data-my-grades="b1"]').count(),1);
  await assigned.locator('[data-my-grades="b1"]').click();assert.equal(await page.locator('#page-title').textContent(),'Minhas avaliações');
  await page.evaluate(()=>appTest.go('bancas'));assert.equal(await page.locator('[data-my-grades="b1"]').count(),1);assert.equal(await page.locator('[data-my-grades="b2"]').count(),0);
  await page.evaluate(()=>appTest.go('relatorios'));await openOfficialReports(page);assert.equal(await page.locator('[data-my-grades="b1"]').count(),1);assert.equal(await page.locator('[data-my-grades="b2"]').count(),0);
  await page.setViewportSize({width:1440,height:900});await page.locator('#desktop-nav [data-route="sortear"]').click();await page.locator('#manual-group').selectOption('g3');
  assert.equal(await page.locator('#manual-members input[name="evaluator"][value="coord"]').count(),1,'coordinator remains selectable as a future evaluator');
  const after=await page.evaluate(()=>({others:{t1:firebaseMock.data.grades.b1.t1,t2:firebaseMock.data.grades.b1.t2},deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards}));
  assert.deepEqual(after.others,previous.others);assert.deepEqual(after.deliveries,previous.deliveries);assert.deepEqual(after.boards,previous.boards);
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('coordinator completes monograph notes inline and exports all students, incomplete banks and global charts', {skip}, async t=>{
  const{page,errors,cspErrors,downloads}=await openApp(t),qa=process.env.BANCAFLOW_QA_DIR||'/tmp/bancaflow-complete-qa';mkdirSync(qa,{recursive:true});
  await page.evaluate(()=>{
    const data=firebaseMock.data,copy=firebaseMock.clone.bind(firebaseMock),group=copy(data.groups.g1),board=copy(data.boards.b1),grades=copy(data.grades.b1),delivery=copy(data.deliveries.b1);
    const rows=[['b1','g1','GERAL_ABERTA',false,false],['b2','g2','GERAL_ARQUIVADA',true,true],['b3','g3','GERAL_PENDENTE',false,false]];
    for(const[bid,gid,name,sealed,archived]of rows){
      data.groups[gid]={...copy(group),id:gid,name,courseName:'ADS',active:!archived};
      data.boards[bid]={...copy(board),groupId:gid,startAt:board.startAt+Number(bid.slice(1))*86400000};data.groupBoards[gid]=bid;
      data.grades[bid]=copy(grades);data.deliveries[bid]=copy(delivery);if(sealed)data.seals[bid]={by:'coord',at:Date.now()};
    }
    delete data.grades.b3.t2.s1.code;delete data.deliveries.b3.s2;
    data.groups.g4={...copy(group),id:'g4',name:'GERAL_SEM_BANCA',students:{eva:'EVA_SEM_BANCA'},courseName:'Direito'};
    appTest.mount('coord');appTest.go('notas');
  });
  await page.setViewportSize({width:1440,height:900});
  const board=page.locator('[data-notes-board="b1"]');await board.locator('summary').click();
  const form=board.locator('[data-delivery-form="b1"][data-student="s1"]');assert.equal(await form.count(),1);
  const original=await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades));
  await form.locator('input[name="delivery"]').fill('0');
  await page.locator('[data-coordinator-export="csv"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Salve as notas'));assert.equal(downloads.length,0,'pending monograph draft blocks stale export');
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.deliveries.b1.s1===0);
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),original,'monograph saving preserves every evaluator criteria');
  assert.ok((await board.locator('[data-notes-student="s1"]').textContent()).includes('4,20'),'final uses monograph zero rather than treating it as pending');
  assert.equal(await board.locator('[data-grade-form]').count(),0,'consultation never edits evaluator scores');
  const archived=page.locator('[data-notes-board="b2"]');await archived.locator('summary').click();
  const archivedEditable=await archived.locator('[data-delivery-form] input:not(:disabled)').count();assert.equal(archivedEditable,0,'archived and sealed history remains protected');
  const charts=page.locator('[data-coordinator-charts]');assert.equal(await charts.count(),1);await charts.locator(':scope > summary').click();
  assert.ok(await charts.locator('svg[role="img"]').count()>0,'global charts include available notes from open banks');
  assert.ok((await charts.textContent()).includes('EVA_SEM_BANCA'),'unassigned student remains accounted for in chart data');
  await page.locator('#notes-chart-board').selectOption('b3');
  assert.ok((await charts.textContent()).includes('GERAL_PENDENTE'));
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:920});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`complete coordinator screen overflows at ${width}px`);
    await page.screenshot({path:join(qa,`coordinator-complete-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:320,height:920});await form.screenshot({path:join(qa,'coordinator-monograph-form-320.png')});
  await page.setViewportSize({width:1440,height:900});await page.locator('#notes-chart-board').selectOption('');
  const screenshotStyle=await page.addStyleTag({content:'.topbar,.mobile-nav,#toast{visibility:hidden!important}'});
  await charts.locator('figure').first().screenshot({path:join(qa,'coordinator-all-students-chart-1440.png')});await screenshotStyle.evaluate(el=>el.remove());
  await page.locator('#notes-search').fill('GERAL_ABERTA');await page.locator('#notes-search').press('Enter');assert.equal(await page.locator('[data-notes-board]').count(),1);
  for(const[kind,filename]of [['pdf','all-students.pdf'],['csv','all-students.csv'],['charts','all-students-charts.pdf']]){
    const downloading=page.waitForEvent('download');await page.locator(`[data-coordinator-export="${kind}"]`).click();const file=await downloading;await file.saveAs(join(qa,filename));
    const content=readFileSync(await file.path(),'utf8');
    for(const marker of ['GERAL_ABERTA','GERAL_ARQUIVADA','GERAL_PENDENTE','EVA_SEM_BANCA'])assert.ok(content.includes(marker),`${kind}: ${marker} is included despite consultation filter`);
    if(kind!=='csv'){assert.ok(content.startsWith('%PDF-1.4'));assert.match(content,/%%EOF\s*$/);}
    else assert.ok(content.includes('0,00'),'CSV includes saved monograph zero');
  }
  const readRoots=await page.evaluate(()=>firebaseMock.reads);for(const root of ['users','groups','boards','grades','deliveries','seals','timers'])assert.ok(readRoots.includes(root),root);
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),original);
  await page.evaluate(()=>{appTest.mount('t1');appTest.go('notas');});
  assert.equal(await page.locator('[data-coordinator-export],[data-coordinator-charts]').count(),0,'complete export and global notes stay coordinator-only');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('coordinators download complete reports through the compact hub and default mean without opening advanced settings', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-reports-simple-qa';mkdirSync(qa,{recursive:true});
  await page.evaluate(()=>{appTest.mount('coord');appTest.go('relatorios');});
  const before=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['users','groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]]))));
  assert.equal(await page.locator('#report-center').isVisible(),true);
  assert.equal(await page.locator('#report-official-options').evaluate(element=>element.open),false);
  for(const width of [320,1440]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`report hub overflow at ${width}px`);
    await page.screenshot({path:join(qa,`reports-hub-${width}.png`),fullPage:true});
  }
  const download=async(selector,name)=>{const pending=page.waitForEvent('download');await page.locator(selector).click();const file=await pending;await file.saveAs(join(qa,name));return readFileSync(await file.path(),'utf8');};
  const globalPdf=await download('#report-center [data-coordinator-export="pdf"]','reports-all-students.pdf');
  assert.match(globalPdf,/^%PDF-1\.4/);assert.match(globalPdf,/Ana/);assert.match(globalPdf,/Bruno/);
  assert.equal(await page.locator('#report-official-options').evaluate(element=>element.open),false,'a fast report does not open the official workflow');
  await page.locator('#report-center [data-route="personalizados"]').click();
  const ids=['weighted-filters-options','weighted-model-options','weighted-content-options','weighted-individual-options','weighted-charts-options','weighted-formula-options'];
  for(const id of ids)assert.equal(await page.locator('#'+id).evaluate(element=>element.open),false,id+' begins collapsed');
  assert.equal(await page.locator('#weighted-criterion-presentation').isVisible(),false);
  assert.equal(await page.locator('.weighted-table:not(.weighted-evaluator-table) .weighted-final').first().textContent(),'7,80');
  assert.equal(await page.locator('[data-weighted-export="pdf"]').isVisible(),true);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`simplified report overflow at ${width}px`);
    await page.screenshot({path:join(qa,`reports-simple-${width}.png`),fullPage:true});
  }
  const pdf=await download('[data-weighted-export="pdf"]','reports-default.pdf');
  for(const value of ['%PDF-1.4','Ana','Bruno','60%','40%'])assert.ok(pdf.includes(value),value);
  const csv=await download('[data-weighted-export="csv"]','reports-default.csv');assert.match(csv,/Ana/);assert.match(csv,/Bruno/);assert.match(csv,/7,8/);
  assert.match(await download('[data-weighted-export="charts"]','reports-default-charts.pdf'),/^%PDF-1\.4/);
  assert.equal(await page.locator('#weighted-model-options').evaluate(element=>element.open),false,'default exports need no advanced model setup');
  await openDetails(page,'weighted-filters-options');await page.locator('#weighted-search').fill('Ana sem aplicar');
  await page.evaluate(()=>firebaseMock.emit('groups'));
  assert.equal(await page.locator('#weighted-search').inputValue(),'Ana sem aplicar','unsubmitted search survives live updates');
  assert.equal(await page.locator('.weighted-table:not(.weighted-evaluator-table) tbody tr').count(),2,'typing search does not silently filter a report');
  await page.locator('#weighted-search').fill('Ana');await page.locator('#weighted-filter-form button[type="submit"]').click();
  assert.equal(await page.locator('.weighted-table:not(.weighted-evaluator-table) tbody tr').count(),1);
  await openDetails(page,'weighted-content-options');await page.locator('#weighted-summary').uncheck();await page.locator('#weighted-charts').uncheck();
  assert.equal(await page.locator('.weighted-table:not(.weighted-evaluator-table) tbody tr').count(),1,'PDF section choices leave the on-screen preview usable');
  const selectedPdf=await download('[data-weighted-export="pdf"]','reports-selected-without-summary.pdf');assert.match(selectedPdf,/Ana/);assert.doesNotMatch(selectedPdf,/Bruno/);
  const chartsWithoutPdfFlag=await download('[data-weighted-export="charts"]','reports-charts-independent.pdf');
  for(const title of ['Resultados por aluno','Composi','Notas registradas por crit','Tempo de apresenta'])assert.ok(chartsWithoutPdfFlag.includes(title),title+' remains in the explicit charts export');
  await openDetails(page,'weighted-individual-options','weighted-charts-options','weighted-formula-options');
  await page.locator('.weighted-student > summary').first().click();
  assert.equal(await page.locator('.weighted-evaluator-table').isVisible(),true);assert.equal(await page.locator('.weighted-chart-grid svg[role="img"]').count(),4);
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['users','groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]])))),before,'report simplification cannot change academic data');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('coordinator configures custom weighted reports, preserves edits across chat and navigation, and exports saved notes', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer,reload}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{appTest.mount('coord');appTest.go('personalizados');});
  const before=await page.evaluate(()=>JSON.stringify({users:firebaseMock.data.users,groups:firebaseMock.data.groups,boards:firebaseMock.data.boards,grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,seals:firebaseMock.data.seals,timers:firebaseMock.data.timers}));
  const rows=page.locator('.weighted-table:not(.weighted-evaluator-table) tbody tr'),ana=rows.filter({hasText:'Ana'}),bruno=rows.filter({hasText:'Bruno'});
  assert.equal(await ana.locator('.weighted-final').textContent(),'7,80');
  await openDetails(page,'weighted-model-options');
  await page.locator('#weighted-model-name').fill('MODELO_INTEGRACAO');await page.locator('#weighted-report-title-input').fill('RELATORIO_PERSONALIZADO');
  await page.locator('#weighted-board-weight').fill('75');await page.locator('#weighted-monograph-weight').fill('25');
  for(const[key,value]of [['presentation','50'],['practice','25'],['code','25'],['time','0']])await page.locator(`#weighted-criterion-${key}`).fill(value);
  await openDetails(page,'weighted-evaluator-options');await page.locator('[data-weighted-evaluator="t1"]').fill('3');await page.locator('[data-weighted-evaluator="t2"]').fill('1');await page.locator('#weighted-decimals').selectOption('3');
  await page.locator('#chat-fab').click();const peer=await createPeer('t2');await peer.locator('#open-chat').click();await peer.locator('#chat-message').fill('Conversa sem perder o modelo em edição.');await peer.locator('#chat-message').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);
  assert.equal(await page.locator('#weighted-board-weight').inputValue(),'75');assert.equal(await page.locator('#weighted-model-name').inputValue(),'MODELO_INTEGRACAO');
  await page.evaluate(()=>firebaseMock.emit('groups'));assert.equal(await page.locator('#weighted-criterion-presentation').inputValue(),'50','an unrelated Firebase refresh preserves the unsaved model');
  await page.locator('#desktop-nav [data-route="notas"]').click();await page.locator('#desktop-nav [data-route="relatorios"]').click();await page.locator('#report-center [data-route="personalizados"]').press('Enter');
  assert.equal(await page.locator('#chat-widget').isVisible(),true);assert.equal(await page.locator('#weighted-board-weight').inputValue(),'75');assert.equal(await page.locator('#weighted-model-name').inputValue(),'MODELO_INTEGRACAO');await page.locator('[data-chat-minimize]').click();
  for(const id of ['weighted-model-options','weighted-evaluator-options'])assert.equal(await page.locator('#'+id).evaluate(element=>element.open),true,'advanced settings remain open after navigation');
  await page.locator('#weighted-model-name').focus();await page.locator('#weighted-model-name').evaluate(element=>element.setSelectionRange(2,6));await page.evaluate(()=>firebaseMock.emit('groups'));
  assert.deepEqual(await page.locator('#weighted-model-name').evaluate(element=>({focused:document.activeElement===element,start:element.selectionStart,end:element.selectionEnd})),{focused:true,start:2,end:6},'live refresh preserves the focused model text and cursor');
  await page.locator('#weighted-model-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.weighted-final')?.textContent==='8,156');
  assert.equal(await ana.locator('.weighted-final').textContent(),'8,156');assert.equal(await bruno.locator('.weighted-final').textContent(),'1,875');
  assert.ok(Math.abs(await page.evaluate(()=>appTest.coordinatorReportBoards()[0].students.find(student=>student.id==='s1').result.final)-7.8)<1e-12);
  await page.locator('[data-weighted-save]').click();await page.waitForFunction(()=>!!document.querySelector('#weighted-model-select').value);const modelId=await page.locator('#weighted-model-select').inputValue();
  const modelDownloading=page.waitForEvent('download');await page.locator('[data-weighted-export-model]').click();const modelFile=await modelDownloading,modelJson=readFileSync(await modelFile.path(),'utf8');await modelFile.saveAs(join(qa,'weighted-model.json'));assert.equal(JSON.parse(modelJson).model.boardWeight,75);
  await page.locator('[data-weighted-reset]').click();assert.equal(await page.locator('#weighted-board-weight').inputValue(),'60');await page.locator('#weighted-model-select').selectOption(modelId);assert.equal(await page.locator('#weighted-board-weight').inputValue(),'75','selecting a saved model replaces the previous form draft');
  await page.locator('[data-weighted-reset]').click();await page.locator('#weighted-model-import').setInputFiles({name:'modelo.json',mimeType:'application/json',buffer:Buffer.from(modelJson)});await page.waitForFunction(()=>document.querySelector('#weighted-model-name').value==='MODELO_INTEGRACAO');
  assert.equal(await ana.locator('.weighted-final').textContent(),'8,156');await page.locator('#weighted-board-weight').fill('70');await page.locator('#weighted-model-form button[type="submit"]').click();await page.locator('#weighted-report-error').waitFor();assert.match(await page.locator('#weighted-report-error').textContent(),/100%/);
  await page.locator('#weighted-board-weight').fill('75');await page.locator('#weighted-model-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#weighted-report-error'));
  await openDetails(page,'weighted-content-options');
  await page.locator('#weighted-report-notes').fill('OBSERVACAO_INTEGRACAO');for(const section of ['summary','details','charts'])await page.locator(`#weighted-${section}`).check();
  const fullDownloading=page.waitForEvent('download');await page.locator('[data-weighted-export="pdf"]').click();const fullFile=await fullDownloading;await fullFile.saveAs(join(qa,'weighted-full.pdf'));const pdf=readFileSync(await fullFile.path(),'utf8');assert.match(pdf,/^%PDF-1\.4/);assert.match(pdf,/RELATORIO_PERSONALIZADO/);assert.match(pdf,/MODELO_INTEGRACAO/);assert.match(pdf,/75%/);assert.match(pdf,/Ana/);assert.match(pdf,/Bruno/);assert.match(pdf,/OBSERVACAO_INTEGRACAO/);
  await openDetails(page,'weighted-filters-options');
  await page.locator('#weighted-search').fill('Ana');await page.locator('#weighted-filter-form button[type="submit"]').click();assert.equal(await rows.count(),1);
  const csvDownloading=page.waitForEvent('download');await page.locator('[data-weighted-export="csv"]').click();const csvFile=await csvDownloading;await csvFile.saveAs(join(qa,'weighted-ana.csv'));const csv=readFileSync(await csvFile.path(),'utf8');assert.match(csv,/8,15625/);assert.match(csv,/8,156/);assert.doesNotMatch(csv,/Bruno/);
  const chartsDownloading=page.waitForEvent('download');await page.locator('[data-weighted-export="charts"]').click();const chartsFile=await chartsDownloading;await chartsFile.saveAs(join(qa,'weighted-charts.pdf'));assert.match(readFileSync(await chartsFile.path(),'utf8'),/^%PDF-1\.4/);
  await page.locator('#weighted-search').fill('');await page.locator('#weighted-filter-form button[type="submit"]').click();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`custom report overflows at ${width}px`);await page.screenshot({path:join(qa,`weighted-report-${width}.png`),fullPage:true});}
  for(const path of ['users','groups','boards','grades','deliveries','seals','timers'])assert.ok((await page.evaluate(()=>firebaseMock.reads)).includes(path),path);
  assert.equal(await page.evaluate(()=>JSON.stringify({users:firebaseMock.data.users,groups:firebaseMock.data.groups,boards:firebaseMock.data.boards,grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,seals:firebaseMock.data.seals,timers:firebaseMock.data.timers})),before);
  await reload();await page.evaluate(()=>{appTest.mount('coord');appTest.go('personalizados');});await openDetails(page,'weighted-model-options');await page.locator('#weighted-model-select').selectOption(modelId);assert.equal(await page.locator('#weighted-board-weight').inputValue(),'75','saved coordinator models survive a reload');
  await page.evaluate(()=>{appTest.mount('t1');appTest.go('personalizados');});assert.equal(await page.locator('#weighted-model-form').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('floating chat stays open across workspace tabs and minimizing preserves drafts, grading focus and unread messages', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  const grade=page.locator('[data-grade-form="b1"][data-student="s1"] input[name="presentation"]');await grade.fill('9.25');
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,timers:firebaseMock.data.timers}));
  await page.locator('#chat-fab').click();await page.locator('#chat-widget').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>appTest.state.route),'avaliar');assert.equal(await page.locator('#chat-widget').getAttribute('aria-modal'),'false');assert.equal(await grade.inputValue(),'9.25');
  await page.locator('#chat-room-select').selectOption('b1');await page.locator('#chat-message').fill('Pergunta que ainda não enviei.');
  const peer=await createPeer('t2');await peer.evaluate(()=>appTest.openChatRoom('b1'));
  const reads=await page.evaluate(()=>firebaseMock.listens.filter(path=>path==='chatMessages/b1').length);
  await page.locator('#mobile-nav [data-route="bancas"]').click();assert.equal(await page.evaluate(()=>appTest.state.route),'bancas');assert.equal(await page.locator('#chat-widget').isVisible(),true);assert.equal(await page.locator('#chat-message').inputValue(),'Pergunta que ainda não enviei.');
  await page.locator('#mobile-nav [data-route="avaliar"]').click();assert.equal(await grade.inputValue(),'9.25');
  assert.equal(await page.evaluate(()=>firebaseMock.listens.filter(path=>path==='chatMessages/b1').length),reads,'workspace navigation keeps the live conversation subscription');
  await grade.focus();await page.evaluate(()=>{globalThis.gradeNodeBeforeChat=document.querySelector('[data-grade-form="b1"][data-student="s1"] input[name="presentation"]');});
  await peer.locator('#chat-message').fill('Recebida durante a avaliação.');await peer.locator('#chat-message').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);
  assert.equal(await grade.inputValue(),'9.25');assert.equal(await grade.evaluate(el=>el===globalThis.gradeNodeBeforeChat&&document.activeElement===el),true,'a chat message updates the drawer without replacing or blurring the grading input');
  assert.equal(await page.locator('#chat-message').inputValue(),'Pergunta que ainda não enviei.');
  await page.locator('[data-chat-minimize]').click();assert.equal(await page.locator('#chat-widget').isVisible(),false);
  await peer.locator('#chat-message').fill('Recebida enquanto minimizado.');await peer.locator('#chat-message').press('Enter');await page.locator('#chat-fab-badge').waitFor({state:'visible'});
  await page.locator('#mobile-nav [data-route="bancas"]').click();await page.locator('#chat-fab').click();await page.locator('#chat-widget').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>appTest.state.route),'bancas');assert.equal(await page.locator('#chat-room-select').inputValue(),'b1');assert.equal(await page.locator('#chat-message').inputValue(),'Pergunta que ainda não enviei.');assert.equal(await page.locator('[data-chat-message]').count(),2);
  await page.waitForFunction(()=>document.querySelector('#chat-fab-badge').hidden);
  assert.equal(await page.locator('#chat-notification-banner').isVisible(),false,'reopening the notified room dismisses its already-read banner');
  await page.locator('#chat-message').press('Enter');await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===3);
  await page.locator('#chat-message').fill('Outro rascunho para continuar depois.');await page.locator('[data-chat-close]').click();assert.equal(await page.locator('#chat-widget').isVisible(),false);await page.locator('#chat-fab').click();
  assert.equal(await page.locator('#chat-message').inputValue(),'Outro rascunho para continuar depois.');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const box=await page.locator('#chat-widget').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.width<=width&&box.y+box.height<=920);await page.screenshot({path:join(qa,`chat-floating-${width}.png`),fullPage:true});}
  await page.locator('#desktop-nav [data-route="inicio"]').click();assert.equal(await page.evaluate(()=>appTest.state.route),'inicio');assert.equal(await page.locator('#chat-widget').isVisible(),true);
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,timers:firebaseMock.data.timers})),before);
  await page.evaluate(()=>appTest.go('chat'));assert.equal(await page.locator('#chat-widget').isVisible(),false);assert.equal(await page.locator('#view [data-chat-panel]').count(),1,'the legacy full-page chat remains available without duplicate composers');assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('two professors exchange live bank chat messages, preserve drafts, online presence and evaluation privacy', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries}));
  await page.locator('[data-chat-board="b1"]').first().click();
  await page.waitForFunction(()=>appTest.isChatVisible()&&!appTest.state.chatLoading);
  assert.equal(await page.locator('#chat-room-select').inputValue(),'b1');
  const peer=await createPeer('t2');await peer.evaluate(()=>appTest.openChatRoom('b1'));
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);
  await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);
  assert.equal(await page.locator('[data-chat-person="t1"]').count(),1);assert.equal(await page.locator('[data-chat-person="t2"]').count(),1);
  const input=page.locator('#chat-message');await input.fill('Podemos iniciar?');await input.press('Shift+Enter');await input.type('Cronômetro preparado.');
  assert.equal(await peer.locator('[data-chat-message]').count(),0,'Shift+Enter adds a line without sending');
  await input.press('Enter');await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);
  assert.match(await peer.locator('[data-chat-message]').textContent(),/Professor Um/);assert.match(await peer.locator('[data-chat-message] p').textContent(),/iniciar\?\nCronômetro/);
  assert.equal(await input.inputValue(),'');
  const attack='<img src=x onerror="globalThis.chatXss=true"> <script>globalThis.chatXss=true</script>';
  await peer.locator('#chat-message').fill(attack);await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);
  assert.equal(await page.locator('[data-chat-message] p').last().textContent(),attack);assert.equal(await page.locator('[data-chat-message] img,[data-chat-message] script').count(),0);assert.equal(await page.evaluate(()=>globalThis.chatXss),undefined);
  await input.fill('Minha próxima pergunta');await input.focus();await input.evaluate(el=>el.setSelectionRange(3,8));
  await peer.locator('#chat-message').fill('A banca pode continuar.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===3);
  assert.equal(await input.inputValue(),'Minha próxima pergunta');assert.equal(await input.evaluate(el=>document.activeElement===el),true);assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,8]);
  await page.locator('#chat-room-select').selectOption('geral');assert.equal(await page.locator('[data-chat-message]').count(),0,'bank messages do not leak into the common room');
  await input.fill('Rascunho da sala geral');await page.locator('#chat-room-select').selectOption('b1');assert.equal(await input.inputValue(),'Minha próxima pergunta');
  await page.evaluate(()=>{firebaseMock.setError='Falha temporária de envio';});await input.fill('Mensagem que deve permanecer');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Falha temporária'));
  assert.equal(await input.inputValue(),'Mensagem que deve permanecer');assert.equal(await peer.locator('[data-chat-message]').count(),3);
  await page.evaluate(()=>{firebaseMock.setError=null;firebaseMock.connected=false;firebaseMock.emit('.info/connected');});
  await page.waitForFunction(()=>!appTest.state.connected);await input.fill('Rascunho offline');assert.equal(await page.locator('#chat-form button[type="submit"]').isDisabled(),true);
  await page.evaluate(()=>{firebaseMock.connected=true;firebaseMock.emit('.info/connected');});await page.waitForFunction(()=>appTest.state.connected);
  assert.equal(await peer.locator('[data-chat-message]').count(),3,'reconnection never sends a draft automatically');assert.equal(await input.inputValue(),'Rascunho offline');
  await input.fill('');await page.locator('#chat-room-select').selectOption('geral');assert.equal(await input.inputValue(),'Rascunho da sala geral');await page.locator('#chat-room-select').selectOption('b1');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`chat overflow at ${width}px`);
    if(width!==768)await page.screenshot({path:join(qa,`chat-bank-${width}.png`),fullPage:true});
  }
  const disconnects=await page.evaluate(()=>firebaseMock.disconnects||[]);assert.ok(disconnects.some(item=>item.kind==='remove'&&item.path.startsWith('chatPresence/t1/')),'disconnect cleanup registered before use');
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})),before);
  await page.evaluate(()=>{firebaseMock.data.users.outsider={name:'Outro Professor',role:'teacher',active:true};appTest.mount('outsider');appTest.go('chat');});
  assert.deepEqual(await page.locator('#chat-room-select option').evaluateAll(nodes=>nodes.map(n=>n.value)),['geral']);assert.equal(await page.locator('[data-chat-message]').count(),0);
  await page.evaluate(()=>appTest.mount('coord'));await page.locator('#open-chat').click();await page.locator('#chat-room-select').selectOption('b1');assert.equal(await page.locator('[data-chat-message]').count(),3,'coordinator can consult bank chat without being an evaluator');
  await page.evaluate(()=>{appTest.state.chatDrafts.set('b1','Rascunho anterior');appTest.mount('t2');appTest.go('chat');});
  assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>appTest.state.chatDrafts.has('b1')),false,'changing account clears old drafts');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('chat distinguishes pending server delivery, rejected optimistic sends and confirmed conversation between two professors', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  await page.locator('#open-chat').click();const peer=await createPeer('t2');await peer.locator('#open-chat').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers}));
  await page.evaluate(()=>{firebaseMock.optimisticChatWrites=true;firebaseMock.deferChatSets=true;firebaseMock.chatSetError='Permission denied';});
  const input=page.locator('#chat-message'),text='Mensagem que precisa chegar ao outro professor.';
  await input.fill(text);await input.press('Enter');await page.locator('[data-chat-delivery="pending"]').waitFor();
  assert.equal(await page.locator('[data-chat-delivery="sent"]').count(),0);assert.equal(await peer.locator('[data-chat-message]').count(),0,'a local optimistic event does not prove server delivery');
  assert.equal(await page.locator('[data-chat-edit],[data-chat-delete]').count(),0,'pending messages cannot be changed before the server confirms them');
  await input.press('Enter');assert.equal(await page.evaluate(()=>firebaseMock.writes.filter(item=>item.path?.startsWith('chatMessages/')).length),1);
  await page.evaluate(()=>firebaseMock.releaseChatSet());await page.locator('[data-chat-send-error]').waitFor();
  assert.equal(await page.locator('[data-chat-message]').count(),0,'the rejected optimistic message is removed');assert.equal(await peer.locator('[data-chat-message]').count(),0);
  assert.equal(await input.inputValue(),text);assert.equal(await page.evaluate(()=>appTest.state.chatPendingIds.size),0);
  await page.evaluate(()=>{const toast=document.querySelector('#toast');toast.textContent='';toast.className='';});
  await peer.locator('#chat-message').fill('Estou online e recebo mensagens confirmadas.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);
  assert.equal(await page.locator('[data-chat-send-error]').count(),1,'the send error survives another message and an unrelated render');
  await page.screenshot({path:join(qa,'chat-rejected-send-390.png'),fullPage:true});
  await page.evaluate(()=>{firebaseMock.chatSetError=null;});await input.press('Enter');await page.locator('[data-chat-delivery="pending"]').waitFor();
  assert.equal(await peer.locator('[data-chat-message]').count(),1,'retry remains pending until the server acknowledgement');
  await input.fill('Próxima pergunta ainda em edição.');await page.evaluate(()=>firebaseMock.releaseChatSet());
  await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);await page.locator('[data-chat-delivery="sent"]').waitFor();
  assert.equal(await page.locator('[data-chat-delivery="pending"]').count(),0);assert.equal(await page.locator('[data-chat-send-error]').count(),0);assert.equal(await input.inputValue(),'Próxima pergunta ainda em edição.');
  assert.equal(await peer.locator('[data-chat-message] p').filter({hasText:text}).count(),1,'one manual retry creates exactly one delivered message');
  const presenceReads=await page.evaluate(()=>firebaseMock.listens.filter(path=>path==='chatPresence').length);
  await page.locator('[data-chat-refresh]').click();await page.waitForFunction(()=>!appTest.state.chatLoading);
  assert.equal(await page.locator('[data-chat-message]').count(),2);assert.equal(await page.evaluate(()=>firebaseMock.listens.filter(path=>path==='chatPresence').length),presenceReads,'message refresh leaves healthy presence connected');
  await page.locator('#chat-message-list').evaluate(el=>{el.style.height='55px';el.style.minHeight='55px';el.scrollTop=0;});await page.locator('[data-chat-latest]').click();
  assert.ok(await page.locator('#chat-message-list').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));
  await page.locator('#chat-message-list').evaluate(el=>{el.style.removeProperty('height');el.style.removeProperty('min-height');});
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,`chat-delivery-confirmed-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers})),before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('professors edit and delete only their own messages in both sessions, with mobile confirmation and no extra alerts', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers}));
  await page.locator('#open-chat').click();const peer=await createPeer('t2');await peer.locator('#open-chat').click();
  await page.locator('#chat-message').fill('Podemos começar às 14h.');await page.locator('#chat-message').press('Enter');
  await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);await page.locator('[data-chat-delivery="sent"]').waitFor();
  const id=await page.locator('[data-chat-message]').first().getAttribute('data-chat-message'),original=await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id],id);
  assert.equal(await peer.locator(`[data-chat-edit="${id}"],[data-chat-delete="${id}"]`).count(),0,'another professor cannot manage the author’s message');
  await peer.locator('#chat-message').fill('Confirmo minha presença.');await peer.locator('#chat-message').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);
  assert.equal(await page.locator('[data-chat-edit]').count(),1);assert.equal(await page.locator('[data-chat-delete]').count(),1);
  await page.locator(`[data-chat-edit="${id}"]`).click();await page.locator('#chat-edit-message').fill('Alteração cancelada.');await page.locator('[data-chat-mutation-cancel]').click();
  assert.equal(await page.locator('#chat-edit-form').count(),0);assert.equal(await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id].text,id),original.text);
  await peer.locator('[data-chat-minimize]').click();assert.equal(await peer.evaluate(()=>appTest.getChatAlertsState().unread),0);
  await page.locator(`[data-chat-edit="${id}"]`).click();await page.locator('#chat-edit-message').fill('Podemos começar às 14h30.');await page.locator('#chat-edit-form button[type="submit"]').click();
  await page.waitForFunction(()=>!appTest.state.chatMutation);await peer.waitForFunction(id=>firebaseMock.data.chatMessages.geral[id].text==='Podemos começar às 14h30.',id);
  const edited=await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id],id);assert.equal(edited.uid,original.uid);assert.equal(edited.name,original.name);assert.equal(edited.at,original.at);assert.equal(edited.revision,1);assert.equal(typeof edited.editedAt,'number');
  assert.match(await page.locator(`[data-chat-message="${id}"]`).textContent(),/editada/i);assert.equal(await peer.evaluate(()=>appTest.getChatAlertsState().unread),0,'an edit keeps the original message id without counting a new message');
  assert.equal(await peer.locator('[data-chat-notification-room]').count(),0);
  await page.locator(`[data-chat-delete="${id}"]`).click();await page.locator('[data-chat-mutation-cancel]').click();assert.equal(await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id].text,id),edited.text);
  await page.locator(`[data-chat-delete="${id}"]`).click();
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`delete confirmation fits ${width}px`);await page.screenshot({path:join(qa,`chat-delete-confirm-${width}.png`),fullPage:true});}
  await page.locator(`[data-chat-delete-confirm="${id}"]`).click();await page.waitForFunction(()=>!appTest.state.chatMutation);await peer.waitForFunction(id=>!!firebaseMock.data.chatMessages.geral[id].deletedAt,id);
  await peer.locator('#chat-fab').click();
  for(const view of [page,peer]){const message=view.locator(`[data-chat-message="${id}"]`);assert.match(await message.textContent(),/Mensagem apagada/);assert.doesNotMatch(await message.textContent(),/14h30/);assert.equal(await message.locator('[data-chat-edit],[data-chat-delete]').count(),0);assert.equal(await view.locator('[data-chat-message]').count(),2);}
  const deleted=await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id],id);assert.equal(deleted.text,'');assert.equal(deleted.uid,original.uid);assert.equal(deleted.at,original.at);assert.equal(deleted.revision,2);assert.equal(deleted.editedAt,edited.editedAt);assert.equal(typeof deleted.deletedAt,'number');
  assert.equal(await page.evaluate(()=>firebaseMock.transactions.filter(item=>item.path.startsWith('chatMessages/')).every(item=>item.options.applyLocally===false)),true,'changes wait for server acknowledgement');
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers})),before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('message editing preserves the composer, selection and workspace while incoming messages and failed saves leave the text recoverable', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  await page.locator('#open-chat').click();const peer=await createPeer('t2');await peer.locator('#open-chat').click();
  await page.locator('#chat-message').fill('Texto original salvo.');await page.locator('#chat-message').press('Enter');await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===1);
  const id=await page.locator('[data-chat-message]').first().getAttribute('data-chat-message');
  await page.locator('#chat-message').fill('Rascunho de uma nova mensagem.');await page.locator(`[data-chat-edit="${id}"]`).click();const editor=page.locator('#chat-edit-message');
  await editor.fill('Texto em revisão que precisa ser preservado.');await editor.focus();await editor.evaluate(el=>el.setSelectionRange(6,15));
  await peer.locator('#chat-message').fill('Outra mensagem durante a revisão.');await peer.locator('#chat-message').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);
  assert.equal(await editor.inputValue(),'Texto em revisão que precisa ser preservado.');assert.equal(await editor.evaluate(el=>document.activeElement===el),true);assert.deepEqual(await editor.evaluate(el=>[el.selectionStart,el.selectionEnd]),[6,15]);assert.equal(await page.locator('#chat-message').inputValue(),'Rascunho de uma nova mensagem.');
  await page.evaluate(()=>appTest.go('bancas'));assert.equal(await page.evaluate(()=>appTest.state.route),'bancas');assert.equal(await page.locator('#chat-widget').isVisible(),true);assert.equal(await editor.inputValue(),'Texto em revisão que precisa ser preservado.');assert.deepEqual(await editor.evaluate(el=>[el.selectionStart,el.selectionEnd]),[6,15]);assert.equal(await page.locator('#view').evaluate(el=>document.activeElement===el),true,'intentional workspace navigation focuses the newly opened view');
  await page.evaluate(()=>{firebaseMock.transactionError='Permission denied';});await page.locator('#chat-edit-form button[type="submit"]').click();await page.waitForFunction(()=>!!appTest.state.chatMutation?.error&&!appTest.state.chatMutation.busy);
  assert.equal(await editor.inputValue(),'Texto em revisão que precisa ser preservado.');assert.equal(await page.locator('#chat-message').inputValue(),'Rascunho de uma nova mensagem.');assert.equal(await page.evaluate(id=>firebaseMock.data.chatMessages.geral[id].text,id),'Texto original salvo.');assert.equal(await peer.evaluate(id=>firebaseMock.data.chatMessages.geral[id].text,id),'Texto original salvo.');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`edit and failure fit ${width}px`);await page.screenshot({path:join(qa,`chat-edit-retry-${width}.png`),fullPage:true});}
  await page.evaluate(()=>{firebaseMock.transactionError=null;});await page.locator('#chat-edit-form button[type="submit"]').click();await page.waitForFunction(()=>!appTest.state.chatMutation);await peer.waitForFunction(id=>firebaseMock.data.chatMessages.geral[id].text==='Texto em revisão que precisa ser preservado.',id);
  assert.equal(await page.locator('#chat-message').inputValue(),'Rascunho de uma nova mensagem.');assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('mobile chat alerts require a permission gesture and mute persists by account without blocking messages', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer,reload}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  assert.equal(await page.evaluate(()=>notificationMock.requests),0,'opening the app never requests notification permission');
  const peer=await createPeer('t2');await peer.locator('#open-chat').click();
  await peer.locator('#chat-message').fill('Há uma nova mensagem na sala geral.');await peer.locator('#chat-message').press('Enter');
  await page.locator('[data-chat-notification-room="geral"]').waitFor();
  assert.equal(await page.evaluate(()=>notificationMock.shown.length),0,'foreground messages use an in-page alert before permission is granted');
  assert.equal(await page.evaluate(()=>notificationMock.requests),0);
  assert.ok(await page.evaluate(()=>appTest.getChatAlertsState().unread)>0);
  await page.locator('[data-chat-notification-room="geral"]').click();await page.waitForFunction(()=>appTest.isChatVisible()&&appTest.state.chatRoom==='geral');assert.equal(await page.evaluate(()=>appTest.state.route),'avaliar','opening a message alert preserves the current workspace');
  assert.equal(await page.locator('[data-chat-message]').count(),1);assert.equal(await page.evaluate(()=>appTest.getChatAlertsState().unread),0);
  await page.locator('[data-chat-notify]').click();await page.waitForFunction(()=>notificationMock.requests===1&&appTest.getChatAlertsState().enabled);
  assert.equal(await page.evaluate(()=>notificationMock.permission),'granted');
  await page.evaluate(()=>{appTest.go('inicio');notificationMock.setHidden(true);});
  await peer.locator('#chat-message').fill('Aviso com o aplicativo em segundo plano.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>notificationMock.shown.length===1);
  assert.ok(await page.evaluate(()=>notificationMock.registrations.length)>0,'mobile notifications use a registered service worker');
  await page.evaluate(()=>{notificationMock.setHidden(false);appTest.closeChatWidget();notificationMock.dispatchWorkerMessage({type:'bancaflow-open-chat',room:'b1',accountId:'t2'});});
  assert.equal(await page.evaluate(()=>appTest.state.chatOpen),false,'a notification from another signed-in account cannot open the current conversation');
  await page.evaluate(()=>notificationMock.dispatchWorkerMessage({type:'bancaflow-open-chat',...notificationMock.shown[0].options.data}));await page.waitForFunction(()=>appTest.isChatVisible()&&appTest.state.chatRoom==='geral');
  await page.locator('[data-chat-mute]').click();assert.equal(await page.locator('[data-chat-mute]').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{appTest.go('inicio');notificationMock.setHidden(true);});
  await peer.locator('#chat-message').fill('Mensagem recebida com avisos silenciados.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>Object.values(firebaseMock.data.chatMessages?.geral||{}).some(message=>message.text==='Mensagem recebida com avisos silenciados.'));
  assert.equal(await page.evaluate(()=>notificationMock.shown.length),1,'mute suppresses system alerts while messages continue to arrive');
  await page.evaluate(()=>notificationMock.setHidden(false));
  await peer.locator('#chat-message').fill('A página recebe sem abrir um aviso enquanto silenciada.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>Object.values(firebaseMock.data.chatMessages?.geral||{}).some(message=>message.text==='A página recebe sem abrir um aviso enquanto silenciada.'));
  assert.equal(await page.locator('[data-chat-notification-room]').count(),0,'mute also suppresses foreground banners');
  await page.evaluate(()=>{notificationMock.setHidden(false);appTest.openGeneralChat();});
  assert.equal(await page.locator('[data-chat-message]').count(),4);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,`chat-alerts-muted-${width}.png`),fullPage:true});}
  await reload();await page.locator('#open-chat').click();assert.equal(await page.locator('[data-chat-mute]').getAttribute('aria-pressed'),'true','mute survives reloading the same account on this device');
  await page.evaluate(()=>{appTest.mount('t2');appTest.openGeneralChat();});assert.equal(await page.locator('[data-chat-mute]').getAttribute('aria-pressed'),'false','another account keeps its own preference');
  await page.evaluate(()=>{appTest.mount('t1');appTest.openGeneralChat();});assert.equal(await page.locator('[data-chat-mute]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-chat-mute]').click();assert.equal(await page.locator('[data-chat-mute]').getAttribute('aria-pressed'),'false');assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('denied mobile notification permission leaves in-page chat alerts and message delivery available', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t);await page.locator('#open-chat').click();
  await page.evaluate(()=>{notificationMock.requestResult='denied';});await page.locator('[data-chat-notify]').click();await page.waitForFunction(()=>notificationMock.requests===1);
  assert.equal(await page.evaluate(()=>appTest.getChatAlertsState().permission),'denied');assert.equal(await page.evaluate(()=>appTest.getChatAlertsState().enabled),false);
  assert.match(await page.locator('#chat-alerts-permission').textContent(),/permiss|navegador|configura/i);
  const peer=await createPeer('t2');await peer.locator('#open-chat').click();await page.evaluate(()=>{appTest.closeChatWidget();appTest.go('inicio');});
  await peer.locator('#chat-message').fill('A conversa funciona sem permissão de notificação.');await peer.locator('#chat-message').press('Enter');
  await page.locator('[data-chat-notification-room="geral"]').waitFor();assert.equal(await page.evaluate(()=>notificationMock.shown.length),0);
  await page.locator('[data-chat-notification-room="geral"]').click();
  await page.locator('#chat-message').fill('Mensagem de resposta entregue.');await page.locator('#chat-message').press('Enter');
  await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);
  assert.equal(await page.evaluate(()=>notificationMock.requests),1,'chat navigation and sending never retry the permission prompt');assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('legacy and newly registered teachers without banks recover denied general chat and converse without reloading', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  await page.setViewportSize({width:1440,height:900});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers}));
  await page.evaluate(()=>{firebaseMock.data.users.legacy={name:'Professor já cadastrado',role:'teacher'};appTest.mount('coord');appTest.go('professores');});
  await page.locator('#teacher-name').fill('Professora Nova Chat');await page.locator('#teacher-email').fill('nova-chat@example.test');await page.locator('#teacher-key').fill('nova-chat');await page.locator('#teacher-role').selectOption('teacher');await page.locator('#teacher-password').fill('strongpass');
  await page.locator('#teacher-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.users['new-teacher']?.role==='teacher');
  assert.equal(await page.evaluate(()=>appTest.state.user.uid),'coord');
  const peer=await createPeer('new-teacher');
  await page.evaluate(()=>{appTest.mount('legacy');appTest.state.chatRoom='b1';firebaseMock.chatReadError=true;globalThis.chatDocumentMarker='same document';});
  await page.locator('#open-chat').click();
  assert.equal(await page.locator('#chat-room-select').inputValue(),'geral','header always enters the common room even after a stale private selection');
  assert.deepEqual(await page.locator('#chat-room-select option').evaluateAll(nodes=>nodes.map(n=>n.value)),['geral']);
  assert.ok(await page.evaluate(()=>!!appTest.state.chatError));assert.equal(await page.locator('#chat-form button[type="submit"]').isDisabled(),true);
  const failedReads=await page.evaluate(()=>firebaseMock.listens.filter(path=>path==='chatMessages/geral').length);
  await page.evaluate(()=>{firebaseMock.chatReadError=false;});
  await page.waitForFunction(()=>!appTest.state.chatError&&!appTest.state.chatLoading,{},{timeout:15000});
  assert.ok(await page.evaluate(count=>firebaseMock.listens.filter(path=>path==='chatMessages/geral').length>count,failedReads),'a denied subscription must be re-created automatically');
  assert.equal(await page.evaluate(()=>globalThis.chatDocumentMarker),'same document');
  await peer.locator('#open-chat').click();await peer.waitForFunction(()=>!appTest.state.chatError&&!appTest.state.chatLoading);
  assert.deepEqual(await peer.locator('#chat-room-select option').evaluateAll(nodes=>nodes.map(n=>n.value)),['geral']);
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);await peer.waitForFunction(()=>document.querySelectorAll('[data-chat-person]').length===2);
  await page.locator('#chat-message').fill('Todos os professores já têm acesso?');await page.locator('#chat-message').press('Enter');
  await peer.waitForFunction(()=>[...document.querySelectorAll('[data-chat-message] p')].some(el=>el.textContent==='Todos os professores já têm acesso?'));
  await peer.locator('#chat-message').fill('Sim, entrei agora sem estar em uma banca.');await peer.locator('#chat-message').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===2);
  assert.match(await page.locator('[data-chat-message]').last().textContent(),/Professora Nova Chat/);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,`chat-all-teachers-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,boards:firebaseMock.data.boards,timers:firebaseMock.data.timers})),before);
  assert.equal(await peer.evaluate(()=>Object.values(firebaseMock.data.boards).some(board=>board.members?.['new-teacher'])),false);
  await page.evaluate(()=>{firebaseMock.data.users.legacy.active=false;appTest.mount('legacy');appTest.go('chat');});
  assert.equal(await page.locator('#chat-form').count(),0,'inactive teachers do not retain the conversation UI');
  await page.evaluate(()=>{appTest.stopChat();appTest.state.user=null;appTest.state.profile=null;appTest.render();});
  assert.equal(await page.locator('#chat-form').count(),0,'anonymous sessions do not expose a composer');
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('chat paginates saved history and keeps a read-access failure separate from grading', {skip}, async t=>{
  const{page,errors}=await openApp(t);
  await page.evaluate(()=>{
    firebaseMock.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Histórico '+i,at:Date.now()-200000+i}]))};appTest.openChatRoom('geral');
  });
  assert.equal(await page.locator('[data-chat-message]').count(),100);await page.locator('[data-chat-older]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===130);
  assert.match(await page.locator('[data-chat-message]').first().textContent(),/Histórico 0/);assert.equal(await page.locator('[data-chat-older]').count(),0);
  await page.evaluate(()=>{appTest.stopChat();firebaseMock.chatReadError=true;appTest.openChatRoom('b1');});
  assert.match(await page.locator('[data-chat-panel]').textContent(),/Não foi possível abrir o chat/);assert.equal(await page.locator('#chat-form button[type="submit"]').isDisabled(),true);
  await page.evaluate(()=>{firebaseMock.chatReadError=false;});await page.locator('[data-chat-retry]').first().click();await page.waitForFunction(()=>!appTest.state.chatError&&!appTest.state.chatLoading);
  await page.locator('#mobile-nav [data-route="avaliar"]').click();assert.equal(await page.locator('[data-grade-form="b1"]').count(),2);assert.equal(await page.locator('[data-grade-form="b1"][data-student="s1"] input[name="presentation"]').inputValue(),'10');
  assert.deepEqual(errors,[]);
});

test('Alberson creates a coordinator who manages groups and schedules a bank manually with chat integrated', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-coordinators-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries}));
  await page.evaluate(()=>{appTest.mount('coord');appTest.go('professores');});await page.setViewportSize({width:390,height:920});
  await page.locator('#teacher-name').fill('Coordenadora Nova');await page.locator('#teacher-email').fill('coord2@example.test');await page.locator('#teacher-key').fill('coord-nova');
  await page.locator('#teacher-role').selectOption('coordinator');await page.locator('#teacher-password').fill('strongpass');
  await page.locator('#teacher-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.users['new-teacher']?.role==='coordinator');
  assert.equal(await page.evaluate(()=>appTest.state.user.uid),'coord','creating access keeps Alberson logged in');
  await page.locator('[data-edit-teacher="new-teacher"]').click();await page.locator('#teacher-edit-dialog').waitFor({state:'visible'});
  assert.match(await page.locator('#teacher-edit-role').inputValue(),/Coordenador/);await page.locator('#teacher-edit-name').fill('Coordenadora Atualizada');await page.locator('#teacher-edit-form button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.users['new-teacher'].name==='Coordenadora Atualizada');
  await page.evaluate(()=>{appTest.mount('new-teacher');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),1,'new coordinators share access administration');
  await page.evaluate(()=>appTest.go('grupos'));
  await page.locator('#group-name').fill('Grupo da nova coordenação');await page.locator('#group-course').fill('ADS');await page.locator('#group-class').fill('3A');await page.locator('#group-title').fill('Banca organizada por outra coordenação');await page.locator('#group-advisor').selectOption('t1');
  await page.locator('[data-remove-group-student="s3"]').click();await page.locator('[data-group-student="s1"] input').fill('Carla');await page.locator('[data-group-student="s2"] input').fill('Daniel');
  await page.locator('#group-form button[type="submit"]').click();await page.waitForFunction(()=>Object.values(firebaseMock.data.groups).some(g=>g.name==='Grupo da nova coordenação'));
  const gid=await page.evaluate(()=>Object.keys(firebaseMock.data.groups).find(id=>firebaseMock.data.groups[id].name==='Grupo da nova coordenação'));
  await page.evaluate(()=>appTest.go('sortear'));await page.locator('#manual-group').selectOption(gid);await page.locator('#manual-size').selectOption('2');await page.locator('#manual-duration').selectOption('30');
  const datetime=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+2);d.setHours(10,0,0,0);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T10:00';});
  await page.locator('#manual-date').fill(datetime);await page.locator('#manual-room').fill('Sala Coordenação');await page.locator('#manual-members input[value="new-teacher"]').check();
  await page.locator('#manual-form button[type="submit"]').click();await page.waitForFunction(gid=>!!firebaseMock.data.groupBoards[gid],gid);
  const bid=await page.evaluate(gid=>firebaseMock.data.groupBoards[gid],gid),record=await page.evaluate(bid=>firebaseMock.data.boards[bid],bid);
  assert.equal(record.createdBy,'new-teacher');assert.equal(record.members['new-teacher'],true);assert.equal(record.members.t1,true);
  assert.ok(await page.evaluate(bid=>Object.values(firebaseMock.data.locks||{}).some(slice=>slice['new-teacher']===bid),bid));assert.ok(await page.evaluate(bid=>Object.values(firebaseMock.data.roomLocks||{}).some(slice=>Object.values(slice).includes(bid)),bid));
  await page.evaluate(bid=>appTest.go('minhasavaliacoes',bid),bid);assert.equal(await page.locator('[data-grade-form]').count(),2);
  await page.locator(`[data-chat-board="${bid}"]`).click();await page.locator('#chat-message').fill('Banca manual pronta.');await page.locator('#chat-message').press('Enter');
  await page.waitForFunction(bid=>Object.values(firebaseMock.data.chatMessages?.[bid]||{}).some(m=>m.text==='Banca manual pronta.'),bid);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,`new-coordinator-chat-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})),before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('additional coordinator imports real scheduled-bank Excel only after preview and rejects conflicts and reimport', {skip}, async t=>{
  const{page,errors,cspErrors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-coordinators-qa';mkdirSync(qa,{recursive:true});
  const info=await page.evaluate(()=>{
    firebaseMock.data.users.coord2={name:'Coordenadora Planilha',email:'coord2@example.test',key:'coord-planilha',role:'coordinator',active:true};
    firebaseMock.data.groups.g2={id:'g2',name:'Grupo Excel Banca',courseName:'Engenharia',className:'1E',title:'Agenda importada',advisorUid:'t1',active:true,students:{s3:'Eva',s4:'Fabio'}};
    appTest.mount('coord2');appTest.go('bancas');const d=new Date();d.setDate(d.getDate()+3);d.setHours(10,0,0,0);return{date:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),before:JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})};
  });
  const rows=[['Curso','Turma','Grupo','Data','Hora','Duração','Sala','Avaliador 1','Avaliador 2'],['Engenharia','1E','Grupo Excel Banca',info.date,'10:00',30,'Sala Excel','one@example.test','coord2@example.test']];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Bancas');const bytes=Buffer.from(XLSX.write(workbook,{type:'array',bookType:'xlsx'}));
  const upload=()=>page.locator('#board-import-file').setInputFiles({name:'bancas-agendadas.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
  await page.locator('[data-open-board-import]').first().click();await upload();await page.waitForFunction(()=>!document.querySelector('#board-import-confirm').disabled);
  assert.match(await page.locator('#board-import-preview').textContent(),/Grupo Excel Banca/);assert.match(await page.locator('#board-import-preview').textContent(),/Coordenadora Planilha/);assert.equal(await page.evaluate(()=>!!firebaseMock.data.groupBoards.g2),false);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});const shape=await page.locator('#board-import-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(shape.width<=width);assert.ok(shape.scroll<=shape.client+1);await page.screenshot({path:join(qa,`bank-excel-preview-${width}.png`),fullPage:true});}
  await page.locator('#board-import-cancel').click();assert.equal(await page.evaluate(()=>!!firebaseMock.data.groupBoards.g2),false);
  await page.locator('[data-open-board-import]').first().click();await upload();await page.waitForFunction(()=>!document.querySelector('#board-import-confirm').disabled);
  const model=page.waitForEvent('download');await page.locator('.excel-import-help > summary').click();await page.locator('#board-import-model').click();const modelFile=await model;assert.match(modelFile.suggestedFilename(),/\.xlsx$/);
  const modelWorkbook=XLSX.read(readFileSync(await modelFile.path()),{type:'buffer'});assert.ok(modelWorkbook.SheetNames.includes('Bancas'));assert.ok(modelWorkbook.SheetNames.includes('Instruções'));
  page.once('dialog',dialog=>dialog.accept());await page.locator('#board-import-confirm').click();await page.waitForFunction(()=>!!firebaseMock.data.groupBoards.g2);
  const bid=await page.evaluate(()=>firebaseMock.data.groupBoards.g2);assert.equal(await page.evaluate(bid=>firebaseMock.data.boards[bid].createdBy,bid),'coord2');assert.equal(await page.evaluate(bid=>firebaseMock.data.boards[bid].members.coord2,bid),true);
  await page.locator('[data-open-board-import]').first().click();await upload();await page.waitForFunction(()=>document.querySelector('#board-import-confirm').disabled&&document.querySelector('#board-import-preview').textContent.includes('agend'));
  assert.equal(await page.evaluate(()=>Object.keys(firebaseMock.data.boards).length),2,'reimport does not overwrite or duplicate banks');await page.locator('#board-import-cancel').click();
  await page.evaluate(()=>{firebaseMock.data.groups.g3={...firebaseMock.clone(firebaseMock.data.groups.g2),id:'g3',name:'Grupo Excel Conflito'};firebaseMock.emit('groups');});
  const conflictRows=rows.map(row=>row.slice());conflictRows[1][2]='Grupo Excel Conflito';const badBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(badBook,XLSX.utils.aoa_to_sheet(conflictRows),'Bancas');
  await page.locator('[data-open-board-import]').first().click();await page.locator('#board-import-file').setInputFiles({name:'conflito.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(badBook,{type:'array',bookType:'xlsx'}))});
  await page.waitForFunction(()=>document.querySelector('#board-import-preview').textContent.includes('conflit')||document.querySelector('#board-import-preview').textContent.includes('ocupad')||document.querySelector('#board-import-preview').textContent.includes('sobrep'));
  assert.equal(await page.locator('#board-import-confirm').isDisabled(),true);assert.equal(await page.evaluate(()=>!!firebaseMock.data.groupBoards.g3),false);
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})),info.before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('timer warning becomes red after fifteen minutes, survives pause and closure, and resets without losing grades', {skip}, async t=>{
  const{page,errors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-coordinators-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),display=page.locator('[data-timer-display="b1"]'),panel=page.locator('[data-timer-panel="b1"]');
  await page.evaluate(()=>{firebaseMock.write('timers/b1',{elapsedMs:900000,startedAt:0,updatedAt:Date.now(),updatedBy:'t1',revision:2});firebaseMock.emit('timers/b1');});
  assert.equal(await display.textContent(),'15:00,00');assert.equal(await display.evaluate(el=>el.classList.contains('timer-overrun')),false);assert.equal(await panel.locator('[data-timer-warning]').isVisible(),false);
  await page.evaluate(()=>{firebaseMock.write('timers/b1',{elapsedMs:899990,startedAt:Date.now(),updatedAt:Date.now(),updatedBy:'t1',revision:3});firebaseMock.emit('timers/b1');});
  await page.waitForFunction(()=>document.querySelector('[data-timer-display="b1"]').classList.contains('timer-overrun'));
  assert.equal(await display.evaluate(el=>getComputedStyle(el).color),'rgb(179, 18, 45)');assert.equal(await panel.locator('[data-timer-warning]').isVisible(),true);
  await page.locator('[data-timer-action="pause"]').click();assert.equal(await display.evaluate(el=>el.classList.contains('timer-overrun')),true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-seal="b1"]').click();await page.waitForFunction(()=>!!firebaseMock.data.seals.b1);assert.equal(await panel.evaluate(el=>el.classList.contains('timer-overrun')),true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-reopen="b1"]').click();await page.waitForFunction(()=>!firebaseMock.data.seals.b1);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:join(qa,`timer-overrun-${width}.png`)});}
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-timer-action="reset"]').click();await page.waitForFunction(()=>firebaseMock.data.timers.b1.elapsedMs===0);
  assert.equal(await display.textContent(),'00:00,00');assert.equal(await display.evaluate(el=>el.classList.contains('timer-overrun')),false);assert.equal(await panel.locator('[data-timer-warning]').isVisible(),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),before);assert.deepEqual(errors,[]);
});

test('Wagner and every coordinator share access administration; administrator creation and all report families preserve saved academics', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-administration-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>{
    firebaseMock.data.users.coord2={name:'Coordenação da equipe',email:'coord2@example.test',key:'coord-equipe',role:'coordinator',active:true};
    Object.assign(firebaseMock.data.users.t1,{name:'Wagner',key:'wagner'});
    appTest.mount('coord2');appTest.go('professores');
    return JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]])));
  });
  assert.equal(await page.locator('#teacher-form').count(),1);assert.equal(await page.locator('[data-remove-teacher="coord"]').count(),0);
  page.once('dialog',dialog=>{assert.match(dialog.message(),/Wagner/);assert.match(dialog.message(),/one@example.test/);return dialog.accept();});
  await page.locator('[data-promote-teacher="t1"]').click();await page.waitForFunction(()=>firebaseMock.data.users.t1.role==='coordinator');
  assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.members.t1),true);assert.equal(await page.evaluate(()=>firebaseMock.data.grades.b1.t1.s1.presentation),10);
  await page.locator('[data-prepare-administrator]').click();
  assert.equal(await page.locator('#teacher-email').inputValue(),'admin@univap.br');assert.equal(await page.locator('#teacher-key').inputValue(),'admin');assert.equal(await page.locator('#teacher-role').inputValue(),'coordinator');assert.equal(await page.locator('#teacher-password').inputValue(),'');
  await page.locator('#teacher-password').fill('initial-test-pass');await page.locator('#teacher-form button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.users['new-teacher']?.email==='admin@univap.br');assert.equal(await page.evaluate(()=>appTest.state.user.uid),'coord2');
  assert.equal(await page.evaluate(()=>firebaseMock.data.users['new-teacher'].role),'coordinator');assert.equal(await page.evaluate(()=>Object.hasOwn(firebaseMock.data.users['new-teacher'],'password')),false);
  await page.evaluate(()=>{appTest.mount('t1');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),1,'Wagner retains his UID and has coordinator administration');
  await page.locator('#teacher-name').fill('Avaliadora da equipe');await page.locator('#teacher-email').fill('extra@example.test');await page.locator('#teacher-key').fill('extra');
  await page.locator('#teacher-method').selectOption('existing');await page.locator('#teacher-uid').fill('extra-teacher');await page.locator('#teacher-form button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.users['extra-teacher']?.createdBy==='t1');
  await page.locator('[data-edit-teacher="extra-teacher"]').click();await page.locator('#teacher-edit-dialog').waitFor({state:'visible'});await page.locator('#teacher-edit-name').fill('Avaliadora Atualizada');await page.locator('#teacher-edit-form button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.users['extra-teacher'].name==='Avaliadora Atualizada');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-remove-teacher="extra-teacher"]').click();await page.waitForFunction(()=>firebaseMock.data.users['extra-teacher'].active===false);
  await page.locator('.teacher-archive>summary').click();await page.locator('[data-restore-teacher="extra-teacher"]').click();await page.waitForFunction(()=>firebaseMock.data.users['extra-teacher'].active===true);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,`coordinator-permissions-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]])))),before);
  await page.evaluate(()=>{firebaseMock.data.seals.b1={by:'t1',at:Date.now()};appTest.mount('new-teacher');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),1,'administrator has the same coordinator permissions');
  const sealedBefore=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]]))));
  const exportPdf=async selector=>{const downloading=page.waitForEvent('download');await page.locator(selector).click();const file=await downloading;const content=readFileSync(await file.path(),'utf8');assert.match(content,/^%PDF-1\.4/);assert.match(content,/%%EOF\s*$/);assert.match(content,/Ana/);return content;};
  await page.evaluate(()=>appTest.go('bancas'));await exportPdf('[data-pdf-agenda]');
  await page.evaluate(()=>appTest.go('relatorios'));await openOfficialReports(page);await exportPdf('[data-print-one="b1"]');await openOfficialReports(page,true);await exportPdf('[data-print-analytics]');
  await page.evaluate(()=>appTest.go('notas'));await exportPdf('[data-coordinator-export="pdf"]');await exportPdf('[data-coordinator-export="charts"]');
  await page.evaluate(()=>appTest.go('personalizados'));await exportPdf('[data-weighted-export="pdf"]');await exportPdf('[data-weighted-export="charts"]');
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals','timers'].map(key=>[key,firebaseMock.data[key]])))),sealedBefore);
  await page.evaluate(()=>{firebaseMock.data.users.disabled={name:'Inativo',email:'disabled@example.test',key:'disabled',role:'coordinator',active:false};appTest.mount('disabled');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),0);
  await page.evaluate(()=>{appTest.mount('t2');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),0);assert.equal(await page.locator('[data-promote-teacher]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('coordinators assign evaluators to an existing bank with atomic reservations and preserve all recorded notes', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);
  const before=await page.evaluate(()=>{
    firebaseMock.data.users.coord2={name:'Coordenadora responsável',email:'coord2@example.test',key:'coord-equipe',role:'coordinator',active:true};
    appTest.mount('coord2');appTest.go('avaliar','b1');
    return firebaseMock.clone({board:firebaseMock.data.boards.b1,grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,timers:firebaseMock.data.timers,groups:firebaseMock.data.groups,groupBoards:firebaseMock.data.groupBoards});
  });
  await page.locator('[data-board-assignment="b1"]').click();await page.locator('#board-assignment-dialog').waitFor({state:'visible'});
  for(const uid of ['t1','t2']){assert.equal(await page.locator(`#board-assignment-form input[value="${uid}"]`).isChecked(),true);assert.equal(await page.locator(`#board-assignment-form input[value="${uid}"]`).isDisabled(),true,'an author with saved grades cannot be removed');}
  await page.locator('#board-assignment-form input[value="coord2"]').check();await page.locator('#board-assignment-form button[type="submit"]').click();
  await page.waitForFunction(()=>firebaseMock.data.boards.b1.members.coord2===true);assert.equal(await page.locator('#board-assignment-dialog').count(),0);
  assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.assignmentRevision),1);
  const slots=await page.evaluate(()=>{const b=firebaseMock.data.boards.b1;return Array.from({length:b.durationMin/15},(_,i)=>String(b.startAt+i*900000));});
  for(const slot of slots){assert.equal(await page.evaluate(slot=>firebaseMock.data.locks[slot].coord2,slot),'b1');assert.equal(await page.evaluate(slot=>appTest.state.locks?.[slot]?.coord2,slot),'b1');}
  await page.evaluate(()=>appTest.go('minhasavaliacoes','b1'));assert.equal(await page.locator('[data-grade-form="b1"]').count(),2,'a newly assigned coordinator gets the evaluator forms');
  await page.locator('[data-board-assignment="b1"]').click();await page.locator('#board-assignment-dialog').waitFor({state:'visible'});await page.locator('#board-assignment-form input[value="coord2"]').uncheck();await page.locator('#board-assignment-form button[type="submit"]').click();
  await page.waitForFunction(()=>!firebaseMock.data.boards.b1.members.coord2);assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.assignmentRevision),2);
  for(const slot of slots){assert.equal(await page.evaluate(slot=>firebaseMock.data.locks?.[slot]?.coord2??null,slot),null);assert.equal(await page.evaluate(slot=>appTest.state.locks?.[slot]?.coord2??null,slot),null,'released slots are immediately reusable by the scheduler');}
  const after=await page.evaluate(()=>firebaseMock.clone({board:firebaseMock.data.boards.b1,grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries,timers:firebaseMock.data.timers,groups:firebaseMock.data.groups,groupBoards:firebaseMock.data.groupBoards}));
  delete after.board.assignmentRevision;assert.deepEqual(after,before);
  await page.evaluate(()=>{firebaseMock.data.users.blocked={name:'Docente ocupado',email:'blocked@example.test',key:'blocked',role:'teacher',active:true};firebaseMock.data.boards.b2={...firebaseMock.clone(firebaseMock.data.boards.b1),members:{blocked:true,t2:true},memberNames:{blocked:'Docente ocupado',t2:'Professora Dois'}};appTest.go('avaliar','b1');});
  await page.locator('[data-board-assignment="b1"]').click();await page.locator('#board-assignment-dialog').waitFor({state:'visible'});await page.locator('#board-assignment-form input[value="blocked"]').check();await page.locator('#board-assignment-form button[type="submit"]').click();
  await page.waitForFunction(()=>/outra banca|reserva/.test(document.querySelector('#board-assignment-status')?.textContent||''));assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.members.blocked??null),null);
  await page.locator('#board-assignment-dialog [data-assignment-close]').first().click();
  await page.locator('[data-board-assignment="b1"]').click();await page.locator('#board-assignment-dialog').waitFor({state:'visible'});await page.locator('#board-assignment-form input[value="coord2"]').check();
  await page.evaluate(()=>firebaseMock.write('boards/b1/room','Sala atualizada em outra janela'));await page.locator('#board-assignment-form button[type="submit"]').click();
  await page.waitForFunction(()=>/outra janela/.test(document.querySelector('#board-assignment-status')?.textContent||''));assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.members.coord2??null),null);
  await page.locator('#board-assignment-dialog [data-assignment-close]').first().click();
  await page.evaluate(()=>{firebaseMock.data.users.t1.active=false;appTest.go('avaliar','b1');});
  await page.locator('[data-board-assignment="b1"]').click();await page.locator('#board-assignment-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#board-assignment-form input[value="t1"]').isChecked(),true);assert.equal(await page.locator('#board-assignment-form input[value="t1"]').isDisabled(),true);
  await page.locator('#board-assignment-form input[value="coord2"]').check();await page.locator('#board-assignment-form button[type="submit"]').click();await page.waitForFunction(()=>firebaseMock.data.boards.b1.members.coord2===true);
  assert.equal(await page.evaluate(()=>firebaseMock.data.boards.b1.members.t1),true);assert.deepEqual(await page.evaluate(()=>firebaseMock.data.grades),before.grades);
  await page.evaluate(()=>{firebaseMock.data.seals.b1={by:'coord2',at:Date.now()};appTest.mount('coord2');appTest.go('avaliar','b1');});assert.equal(await page.locator('[data-board-assignment="b1"]').count(),0);
  const blocked=await page.evaluate(async()=>{try{await appTest.openBoardAssignment('b1');return false;}catch(error){return /Reabra|encerrad/.test(error.message);}});assert.equal(blocked,true);
  await page.evaluate(()=>{appTest.mount('t2');appTest.go('avaliar','b1');});assert.equal(await page.locator('[data-board-assignment="b1"]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('teachers manage their own email through a branded responsive dialog with verification, preserved drafts and canonical refresh', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);const qa=process.env.BANCAFLOW_QA_DIR||'/tmp/bancaflow-account-year-qa';mkdirSync(qa,{recursive:true});
  const academics=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]]))));
  const gradeInput=page.locator('[data-grade-form="b1"][data-student="s1"] input[name="presentation"]');await gradeInput.fill('9');
  await page.locator('#open-account').click();await page.locator('#account-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>!appTest.accountSecurity.getState().loading);
  assert.match(await page.locator('.account-greeting').textContent(),/Professor Um/);assert.match(await page.locator('.account-help').allTextContents().then(x=>x.join(' ')),/SMS ainda não está disponível/);
  assert.equal(await page.locator('#account-security-channel option[value="sms"]').count(),0);
  await page.locator('#account-new-email').fill('new.one@example.test');await page.locator('#account-email-password').fill('CurrentPassword!12');await page.locator('#account-email-form button[type="submit"]').click();
  await page.waitForFunction(()=>!!appTest.accountSecurity.getState().success);
  assert.match(await page.locator('.account-success').textContent(),/Professor Um.*new\.one@example\.test/);
  const sent=await page.evaluate(()=>({calls:firebaseMock.accountCalls,uid:appTest.state.user.uid,email:appTest.state.user.email,profile:firebaseMock.data.users.t1.email}));
  assert.equal(sent.calls.reauthentications.length,1);assert.equal(sent.calls.changes.length,1);assert.equal(sent.uid,'t1');assert.equal(sent.email,'one@example.test');assert.equal(sent.profile,'one@example.test');
  assert.equal(await page.locator('#account-email-password').inputValue(),'');assert.equal(await gradeInput.inputValue(),'9');
  await page.evaluate(()=>firebaseMock.reauthenticateError='auth/invalid-credential');await page.locator('#account-email-password').fill('IncorrectPassword!12');await page.locator('#account-email-form button[type="submit"]').click();
  await page.waitForFunction(()=>!!appTest.accountSecurity.getState().error);assert.match(await page.locator('.account-error').textContent(),/senha atual não foi confirmada/);assert.equal(await page.evaluate(()=>firebaseMock.accountCalls.changes.length),1);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});const shape=await page.locator('#account-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(shape.width<=width);assert.ok(shape.scroll<=shape.client+1);await page.screenshot({path:join(qa,`account-email-${width}.png`),fullPage:true});}
  await page.evaluate(()=>{firebaseMock.reauthenticateError='';appTest.auth.currentUser.email='new.one@example.test';appTest.auth.currentUser.emailVerified=true;});await page.locator('[data-account-refresh]').click();
  await page.waitForFunction(()=>firebaseMock.data.users.t1.email==='new.one@example.test');assert.equal(await page.locator('.account-current-email').textContent(),'new.one@example.test');assert.equal(await gradeInput.inputValue(),'9');
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]])))),academics);
  await page.locator('[data-account-close]').click();assert.equal(await page.locator('#account-dialog').isVisible(),false);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('login recovery offers safe personalized feedback and native email delivery without account enumeration or fake SMS', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);const qa=process.env.BANCAFLOW_QA_DIR||'/tmp/bancaflow-account-year-qa';mkdirSync(qa,{recursive:true});
  const academics=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]]))));
  await page.evaluate(()=>{appTest.resetAppData();appTest.state.user=null;appTest.state.profile=null;document.querySelector('#login-view').classList.remove('hidden');document.querySelector('#app-view').classList.add('hidden');});
  await page.locator('#email').fill('one@example.test');await page.locator('#reset-password').click();await page.locator('#account-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#account-recovery-email').inputValue(),'one@example.test');assert.equal(await page.locator('#account-recovery-channel option').count(),1);
  await page.locator('#account-recovery-form button[type="submit"]').click();await page.waitForFunction(()=>!!appTest.accountSecurity.getState().success);
  const success=await page.locator('.account-success').textContent();assert.match(success,/Se os dados corresponderem.*BancaFlow/);assert.equal(await page.evaluate(()=>firebaseMock.accountCalls.resets[0].email),'one@example.test');
  await page.evaluate(()=>firebaseMock.resetEmailError='auth/user-not-found');await page.locator('#account-recovery-email').fill('unknown@example.test');await page.locator('#account-recovery-form button[type="submit"]').click();await page.waitForFunction(()=>!appTest.accountSecurity.getState().busy);
  assert.equal(await page.locator('.account-success').textContent(),success);assert.equal(await page.locator('.account-error').count(),0);
  await page.evaluate(()=>firebaseMock.resetEmailError='auth/network-request-failed');await page.locator('#account-recovery-form button[type="submit"]').click();await page.waitForFunction(()=>!!appTest.accountSecurity.getState().error);assert.match(await page.locator('.account-error').textContent(),/internet|conectar/i);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});const shape=await page.locator('#account-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(shape.width<=width);assert.ok(shape.scroll<=shape.client+1);await page.screenshot({path:join(qa,`account-recovery-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]])))),academics);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('year selection keeps prior bank grades intact and makes another academic year available to future groups and reports', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);
  await page.evaluate(()=>{const group={...firebaseMock.clone(firebaseMock.data.groups.g1),id:'g2027',name:'Grupo 2027',academicYear:2027};firebaseMock.data.groups.g1.academicYear=2026;firebaseMock.write('groups/g2027',group);firebaseMock.write('boards/b2027',{...firebaseMock.clone(firebaseMock.data.boards.b1),groupId:'g2027',startAt:Date.UTC(2027,9,20,15)});firebaseMock.write('groupBoards/g2027','b2027');firebaseMock.write('grades/b2027',firebaseMock.clone(firebaseMock.data.grades.b1));firebaseMock.emit('groups');firebaseMock.emit('boards');firebaseMock.emit('grades');appTest.mount('coord');appTest.go('bancas');});
  const grades=await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades));const selector=page.locator('#academic-year-filter');
  assert.ok((await selector.locator('option').allTextContents()).some(x=>x.includes('2027')));await selector.selectOption('2026');assert.equal(await page.locator('[data-open-board="b1"]').count()>0,true);assert.equal(await page.locator('[data-open-board="b2027"]').count(),0);
  await selector.selectOption('2027');assert.equal(await page.locator('[data-open-board="b1"]').count(),0);assert.equal(await page.locator('[data-open-board="b2027"]').count()>0,true);
  await page.evaluate(()=>appTest.go('grupos'));assert.equal(await page.locator('#group-year').inputValue(),'2027');assert.equal(await page.locator('.group-admin-card h4').allTextContents().then(x=>x.includes('Grupo de teste')),false);
  await page.locator('#academic-year-filter').selectOption('todos');await page.evaluate(()=>appTest.go('notas'));assert.equal(await page.locator('[data-notes-board]').count(),2);
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),grades);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('a connected SMS service verifies the recovery phone before issuing a one-use reset proof without exposing passwords to the service', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);const qa=process.env.BANCAFLOW_QA_DIR||'/tmp/bancaflow-account-year-qa';mkdirSync(qa,{recursive:true});
  const academics=await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]]))));
  await page.evaluate(()=>{globalThis.BancaAccountConfig={enabled:true,serviceUrl:'https://southamerica-east1-avaliadortcc.cloudfunctions.net/accountService',timeoutMs:15000};firebaseMock.accountResponses={getCapabilities:{ok:true,emailAvailable:true,smsAvailable:true},getAccount:{ok:true,emailAvailable:true,smsAvailable:true,phoneVerified:false},enrollPhoneStart:{ok:true},enrollPhoneConfirm:{ok:true},requestPasswordResetSms:{ok:true},confirmPasswordResetSms:{ok:true,oobCode:'verified-sms-proof'}};});
  await page.locator('#open-account').click();await page.waitForFunction(()=>!appTest.accountSecurity.getState().loading);
  await page.locator('#account-phone').fill('+55 12 99999-9999');await page.locator('#account-phone-password').fill('CurrentPassword!12');await page.locator('#account-phone-form button[type="submit"]').click();
  await page.locator('#account-phone-confirm-form').waitFor({state:'visible'});assert.equal(await page.locator('#account-security-channel').count(),0);
  await page.locator('#account-phone-code').fill('654321');await page.locator('#account-phone-confirm-form button[type="submit"]').click();await page.waitForFunction(()=>appTest.accountSecurity.getState().phoneVerified);
  await page.locator('#account-security-channel').selectOption('sms');await page.locator('[data-account-reset]').click();await page.locator('#account-sms-reset-form').waitFor({state:'visible'});
  await page.setViewportSize({width:320,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(qa,'account-sms-reset-320.png'),fullPage:true});
  await page.locator('#account-reset-code').fill('123456');await page.locator('#account-reset-password').fill('NewPassword!123');await page.locator('#account-reset-confirm').fill('NewPassword!123');await page.locator('#account-sms-reset-form button[type="submit"]').click();
  await page.waitForFunction(()=>appTest.accountSecurity.getState().panel==='complete');assert.match(await page.locator('.account-success').textContent(),/senha foi redefinida/);
  const calls=await page.evaluate(()=>firebaseMock.accountCalls);assert.equal(calls.confirmations.length,1);assert.equal(calls.confirmations[0].code,'verified-sms-proof');assert.equal(calls.resets.length,0);
  const actions=calls.requests.map(request=>request.action);for(const action of ['getCapabilities','getAccount','enrollPhoneStart','enrollPhoneConfirm','requestPasswordResetSms','confirmPasswordResetSms'])assert.ok(actions.includes(action),action);
  assert.ok(calls.requests.every(request=>!('password'in request)&&!('confirm'in request)));assert.equal(calls.requests.find(request=>request.action==='requestPasswordResetSms').phone,'+5512999999999');
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(['groups','boards','grades','deliveries','seals'].map(key=>[key,firebaseMock.data[key]])))),academics);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('Replicar Nota confirms one atomic copy of current unsaved criteria and zero to this author across the same board on mobile', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);const qa=process.env.BANCAFLOW_QA_DIR||'/tmp/bancaflow-replicate-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>firebaseMock.clone(firebaseMock.data));const source=page.locator('[data-grade-form="b1"][data-student="s1"]'),target=page.locator('[data-grade-form="b1"][data-student="s2"]');
  const button=source.locator('[data-replicate-grade="b1"][data-source-student="s1"]');assert.equal(await button.textContent(),'Replicar Nota');assert.equal(await button.getAttribute('type'),'button');assert.equal(await page.locator('[data-replicate-grade]').count(),2);
  for(const[name,value]of Object.entries({presentation:'0',practice:'9.5',code:'8',time:'10'}))await source.locator(`input[name="${name}"]`).fill(value);await target.locator('input[name="presentation"]').fill('2');
  page.once('dialog',dialog=>dialog.dismiss());await button.click();assert.equal(await page.evaluate(()=>firebaseMock.writes.filter(write=>write.changes&&write.base==='grades/b1/t1').length),0);assert.equal(await target.locator('input[name="presentation"]').inputValue(),'2');
  let prompt='';page.once('dialog',async dialog=>{prompt=dialog.message();await dialog.accept();});await button.click();await page.waitForFunction(()=>firebaseMock.data.grades.b1.t1.s2.practice===9.5);
  assert.match(prompt,/Ana|alunos|grupo|banca/i);const result=await page.evaluate(()=>({data:firebaseMock.data,updates:firebaseMock.writes.filter(write=>write.changes&&write.base==='grades/b1/t1')}));assert.equal(result.updates.length,1);assert.deepEqual(result.updates[0].changes,{s1:{presentation:0,practice:9.5,code:8,time:10},s2:{presentation:0,practice:9.5,code:8,time:10}});
  assert.deepEqual(result.data.grades.b1.t2,before.grades.b1.t2);assert.deepEqual(result.data.deliveries,before.deliveries);assert.deepEqual(result.data.boards,before.boards);assert.deepEqual(result.data.groups,before.groups);
  for(const form of [source,target])for(const[name,value]of Object.entries({presentation:'0',practice:'9.5',code:'8',time:'10'}))assert.equal(await form.locator(`input[name="${name}"]`).inputValue(),value);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:920});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`replication controls fit ${width}px`);await page.screenshot({path:join(qa,`replicar-nota-${width}.png`),fullPage:true});}
  await page.evaluate(()=>appTest.mount('coord'));assert.equal(await page.locator('[data-replicate-grade]').count(),0,'nonmember coordinator cannot replicate another evaluator');assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('Replicar Nota locks grade controls during the shared write and preserves all form drafts after a rejected update before explicit retry', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t);const source=page.locator('[data-grade-form="b1"][data-student="s1"]'),target=page.locator('[data-grade-form="b1"][data-student="s2"]'),button=source.locator('[data-replicate-grade]');
  const before=await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades));for(const[name,value]of Object.entries({presentation:'9',practice:'0',code:'7',time:'6'}))await source.locator(`input[name="${name}"]`).fill(value);await target.locator('input[name="presentation"]').fill('2');
  await page.evaluate(()=>{firebaseMock.deferUpdates=true;firebaseMock.updateError='PERMISSION_DENIED';});page.once('dialog',dialog=>dialog.accept());await button.click();await page.waitForFunction(()=>typeof firebaseMock.releaseUpdate==='function');
  assert.equal(await button.isDisabled(),true);assert.equal(await source.locator('input[name="presentation"]').isDisabled(),true);assert.equal(await target.locator('input[name="presentation"]').isDisabled(),true);assert.equal(await source.locator('button[type="submit"]').isDisabled(),true);
  await page.evaluate(()=>firebaseMock.releaseUpdate());await page.waitForFunction(()=>!appTest.state.busyBoards.has('b1'));
  assert.equal(await page.evaluate(()=>JSON.stringify(firebaseMock.data.grades)),before);assert.equal(await source.locator('input[name="presentation"]').inputValue(),'9');assert.equal(await source.locator('input[name="practice"]').inputValue(),'0');assert.equal(await target.locator('input[name="presentation"]').inputValue(),'2');assert.equal(await button.isEnabled(),true);
  await page.evaluate(()=>{firebaseMock.deferUpdates=false;firebaseMock.updateError='';});page.once('dialog',dialog=>dialog.accept());await button.click();await page.waitForFunction(()=>firebaseMock.data.grades.b1.t1.s2.presentation===9);
  assert.equal(await target.locator('input[name="practice"]').inputValue(),'0');assert.equal(await page.evaluate(()=>firebaseMock.data.grades.b1.t2.s1.presentation),6);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('profile loader is centered, accessible and honors reduced motion on mobile and desktop, then restores access on success and failure', {skip}, async t=>{
  const {page,errors,cspErrors}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-loading-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries}));
  await page.evaluate(()=>{
    firebaseMock.beforeRead=path=>path==='users/t1'?new Promise(resolve=>firebaseMock.releaseProfile=resolve):undefined;
    globalThis.profileLoadingTask=appTest.verificarAcesso(appTest.auth.currentUser);
  });
  await page.waitForFunction(()=>typeof firebaseMock.releaseProfile==='function');
  assert.equal(await page.locator('#app-loading').isVisible(),true);assert.match(await page.locator('#app-loading-text').textContent(),/Carregando perfil/);
  const busy=await page.evaluate(()=>({role:document.querySelector('#app-loading').getAttribute('role'),focus:document.activeElement.id,inert:document.querySelector('#login-view').inert,aria:document.querySelector('#login-view').getAttribute('aria-busy'),color:getComputedStyle(document.querySelector('.loader'),'::before').borderTopColor,animation:getComputedStyle(document.querySelector('.loader'),'::after').animationName}));
  assert.equal(busy.role,'status');assert.equal(busy.focus,'app-loading');assert.equal(busy.inert,true);assert.equal(busy.aria,'true');assert.equal(busy.color,'rgb(0, 123, 255)');assert.match(busy.animation,/spin/);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    const box=await page.locator('#app-loading').boundingBox();assert.equal(box.x,0);assert.equal(box.y,0);assert.equal(box.width,width);assert.equal(box.height,900);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(qa,'loading-profile-'+width+'.png')});
  }
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.loader').evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  await page.evaluate(async()=>{firebaseMock.releaseProfile();await globalThis.profileLoadingTask;firebaseMock.beforeRead=null;});
  assert.equal(await page.locator('#app-loading').isVisible(),false);assert.equal(await page.locator('#app-view').evaluate(el=>el.inert),false);assert.equal(await page.locator('#app-view').isVisible(),true);
  await page.evaluate(async()=>{firebaseMock.beforeRead=async()=>{throw Error('network-unavailable');};await appTest.verificarAcesso(appTest.auth.currentUser);firebaseMock.beforeRead=null;});
  assert.equal(await page.locator('#app-loading').isVisible(),false);assert.equal(await page.locator('#login-view').isVisible(),true);assert.equal(await page.locator('#login-view').evaluate(el=>el.inert),false);
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})),before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});

test('report buttons keep the loader through fresh data and actual PDF or CSV downloads, and recover cleanly after a failed export', {skip}, async t=>{
  const {page,errors,cspErrors,downloads}=await openApp(t);
  await page.evaluate(()=>{appTest.mount('coord');firebaseMock.write('seals/b1',{by:'coord',at:Date.now()});firebaseMock.emit('seals/b1');appTest.go('relatorios');});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries}));
  async function downloadWhileLoading(selector,readPath){
    await page.evaluate(path=>{firebaseMock.releaseReport=null;firebaseMock.beforeRead=current=>current===path?new Promise(resolve=>firebaseMock.releaseReport=resolve):undefined;},readPath);
    const count=downloads.length;await page.locator(selector).click();
    await page.waitForFunction(()=>typeof firebaseMock.releaseReport==='function');
    assert.equal(await page.locator('#app-loading').isVisible(),true);assert.match(await page.locator('#app-loading-text').textContent(),/Gerando relatório/);
    assert.equal(await page.locator('#app-view').evaluate(el=>el.inert),true);assert.equal(downloads.length,count);
    const downloading=page.waitForEvent('download');await page.evaluate(()=>firebaseMock.releaseReport());const file=await downloading;
    const body=readFileSync(await file.path(),'utf8');assert.match(body,file.suggestedFilename().endsWith('.csv')?/Ana/:/^%PDF-1\.4/);
    await page.waitForFunction(()=>document.querySelector('#app-loading').hidden);
    assert.equal(await page.locator('#app-view').evaluate(el=>el.inert),false);
    await page.evaluate(()=>firebaseMock.beforeRead=null);
  }
  await openOfficialReports(page,true);
  await downloadWhileLoading('[data-print-one="b1"]','grades/b1');
  await openOfficialReports(page,true);await downloadWhileLoading('[data-print-analytics]','grades/b1');
  await openOfficialReports(page);await downloadWhileLoading('[data-export-csv]','grades/b1');
  for(const kind of ['pdf','csv','charts']){
    await page.evaluate(()=>appTest.go('relatorios'));
    await downloadWhileLoading('#report-center [data-coordinator-export="'+kind+'"]','grades');
  }
  for(const kind of ['pdf','csv','charts']){
    await page.evaluate(()=>appTest.go('personalizados'));
    await downloadWhileLoading('[data-weighted-export="'+kind+'"]','grades');
  }
  await page.evaluate(()=>{appTest.go('relatorios');firebaseMock.beforeRead=async()=>{throw Error('report-network-failure');};});
  const count=downloads.length;await page.locator('#report-center [data-coordinator-export="pdf"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('report-network-failure'));
  assert.equal(await page.locator('#app-loading').isVisible(),false);assert.equal(await page.locator('#app-view').evaluate(el=>el.inert),false);assert.equal(downloads.length,count);
  await page.evaluate(()=>firebaseMock.beforeRead=null);
  assert.equal(await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries})),before);assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
});
