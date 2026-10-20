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
    const mock=globalThis.firebaseMock={data:${JSON.stringify(fixture)},uid:'t1',listeners:new Map(),writes:[],reads:[],listens:[],pushCount:0,
      clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));},
      path(target){return typeof target==='string'?target:(target?.path||'');},
      queryValue(target){const path=this.path(target),value=this.read(path);if(typeof target==='string'||!target?.constraints)return value;const child=target.constraints.find(c=>c.kind==='order')?.key;let rows=Object.entries(value||{}).sort(([ak,a],[bk,b])=>{const av=child?a?.[child]:ak,bv=child?b?.[child]:bk;return av===bv?(ak<bk?-1:ak>bk?1:0):av<bv?-1:1;});for(const c of target.constraints){if(c.kind==='before')rows=rows.filter(([key,item])=>{const v=child?item?.[child]:key;return v<c.value||(v===c.value&&c.key!==undefined&&key<c.key);});if(c.kind==='last')rows=rows.slice(-c.count);}return Object.fromEntries(rows);},
      read(path){if(path==='.info/connected')return this.connected!==false;if(path==='.info/serverTimeOffset')return this.serverOffset||0;return path?path.split('/').reduce((v,k)=>v?.[k],this.data):this.data;},
      snapshot(target){const v=this.clone(this.queryValue(target)??null),snap=(value,key=null)=>({key,val:()=>this.clone(value),exists:()=>value!==null&&value!==undefined,forEach(cb){for(const[k,item]of Object.entries(value||{}))if(cb(snap(item,k))===true)return true;return false;}});return snap(v);},
      resolved(v){if(v&&typeof v==='object'){if(v['.sv']==='timestamp')return Date.now();return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,this.resolved(x)]));}return v;},
      write(path,v){const keys=path.split('/'),last=keys.pop(),parent=keys.reduce((x,k)=>x[k]||={},this.data);if(v===null)delete parent[last];else parent[last]=this.clone(this.resolved(v));},
      emit(path){for(const [registered,cbs]of this.listeners){const p=this.path(registered);if(p===path||p.startsWith(path+'/')||path.startsWith(p+'/'))for(const cb of cbs)cb(this.snapshot(registered));}}
    };
    const initializeApp=()=>({}),getAuth=()=>({currentUser:{uid:'t1'}}),getDatabase=()=>({}),onAuthStateChanged=()=>()=>{},ref=(_db,path='')=>path;
    const onValue=(target,cb,error)=>{const path=mock.path(target);mock.listens.push(path);if(!mock.listeners.has(target))mock.listeners.set(target,new Set());mock.listeners.get(target).add(cb);if(mock.chatReadError&&path.startsWith('chat'))error?.(Object.assign(Error('chat permission denied'),{code:'PERMISSION_DENIED'}));else cb(mock.snapshot(target));return()=>mock.listeners.get(target)?.delete(cb);};
    const query=(target,...constraints)=>({path:mock.path(target),constraints}),orderByChild=key=>({kind:'order',key}),limitToLast=count=>({kind:'last',count}),endBefore=(value,key)=>({kind:'before',value,key});
    const onDisconnect=target=>({remove:async()=>{mock.disconnects||=[];mock.disconnects.push({kind:'remove',path:mock.path(target)});},cancel:async()=>{mock.disconnects||=[];mock.disconnects.push({kind:'cancel',path:mock.path(target)});}});
    const chatChannel=new BroadcastChannel('bancaflow-chat-test');chatChannel.onmessage=event=>{const{path,value}=event.data||{};if(typeof path==='string'&&path.startsWith('chat')){mock.write(path,value);mock.emit(path);}};
    const remove=async target=>{const path=mock.path(target);mock.write(path,null);mock.writes.push({path,value:null});mock.emit(path);if(path.startsWith('chat'))chatChannel.postMessage({path,value:null});};
    const get=async target=>{mock.reads.push(mock.path(target));return mock.snapshot(target);},serverTimestamp=()=>({'.sv':'timestamp'});
    const set=async(target,value)=>{
      const path=mock.path(target);
      mock.writes.push({path,value:mock.clone(value)});
      if(mock.deferSets)await new Promise(resolve=>mock.releaseSet=resolve);
      if(mock.setError)throw Error(mock.setError);
      mock.write(path,value);mock.emit(path);if(path.startsWith('chat'))chatChannel.postMessage({path,value:mock.read(path)});
    };
    const update=async(base,changes)=>{mock.writes.push({changes:mock.clone(changes)});Object.entries(changes).forEach(([path,v])=>mock.write(base?base+'/'+path:path,v));Object.keys(changes).forEach(path=>mock.emit(base?base+'/'+path:path));};
    const runTransaction=async(path,updater)=>{const next=updater(mock.clone(mock.read(path)??null));if(next===undefined)return{committed:false,snapshot:mock.snapshot(path)};mock.write(path,next);mock.writes.push({path,value:mock.clone(next)});mock.emit(path);return{committed:true,snapshot:mock.snapshot(path)};};
    const signOut=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{};
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
  const assets=new Map(['/assets/vendor/xlsx-0.20.3.full.min.js','/assets/roster-import.js','/assets/analytics.js','/assets/analytics-pdf.js','/assets/analytics.css','/assets/coordinator-report.js','/assets/coordinator-report-pdf.js','/assets/board-chat.js','/assets/board-chat.css','/assets/board-import.js'].map(path=>[path,readFileSync(join(__dirname,'..',path.slice(1)),'utf8')]));
  const requestHandler=route => {
    requests.push(route.request().url());
    const url=new URL(route.request().url());
    if(url.origin==='https://bancaflow.example.test'&&assets.has(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:assets.get(url.pathname)});
    return route.request().url() === 'https://bancaflow.example.test/' ? route.fulfill({ contentType: 'text/html', body: servedMarkup }) : route.abort();
  };
  await page.route('**/*',requestHandler);
  const bootstrap = adapter() + source + `
    globalThis.appTest={state,go,render,resetAppData,createBoards,makeBoard,openBoardImport,closeBoardImport,confirmBoardImport,timerIsOverrun:typeof timerIsOverrun==='function'?timerIsOverrun:null,updateTimerDisplays:typeof updateTimerDisplays==='function'?updateTimerDisplays:null,chatRooms,chatView,openChatRoom,sendChatMessage,loadOlderChat,syncChat,stopChat,startChatPresence,stopChatPresence,openBoardShare,closeBoardShare,analyticsBoards,analyticsView,printAnalytics,buildAnalyticsPdf,buildEvaluationPdf,coordinatorReportBoards,buildCoordinatorReportPdf,exportCoordinatorReport,coordinatorBoardRecord,filteredNotesBoards,boardNotesHtml,allNotesView,evaluatorBoards,myEvaluationsView,
      mount(uid){clearListeners();resetAppData();mock.uid=uid;state.user={uid,email:uid+'@example.test'};state.profile=mock.clone(mock.data.users[uid]);for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])state[key]=mock.clone(mock.data[key]||{});state.connected=true;document.querySelector('#login-view').classList.add('hidden');document.querySelector('#app-view').classList.remove('hidden');if(isCoord())for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])listen(key,key);else syncTeacherSubs();syncTimerSubs();go('avaliar','b1');}
    };appTest.mount('t1');
  `;
  const fixtureHash=createHash('sha256').update(bootstrap).digest('base64');
  servedMarkup=markup.replace(/(script-src[^;]*?)'sha256-[^']+'/,(all,prefix)=>prefix+`'sha256-${fixtureHash}'`).replace('</body>',`<script type="module">${bootstrap}</script></body>`);
  const reload = async () => { await page.goto('https://bancaflow.example.test/');await page.waitForFunction(()=>!!globalThis.appTest?.state.user);assert.deepEqual(cspErrors,[]); };
  await reload();
  const createPeer=async uid=>{const peer=await page.context().newPage();peer.on('pageerror',e=>errors.push(e.message));await peer.route('**/*',requestHandler);await peer.goto('https://bancaflow.example.test/');await peer.waitForFunction(()=>!!globalThis.appTest?.state.user);const data=await page.evaluate(()=>firebaseMock.data);await peer.evaluate(({data,uid})=>{firebaseMock.data=data;appTest.mount(uid);},{data,uid});return peer;};
  return { page, errors, requests, downloads, cspErrors, reload, createPeer };
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
  await page.evaluate(()=>appTest.go('relatorios'));
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
    'firebase-auth.js':`export const getAuth=()=>({currentUser:null}),initializeAuth=()=>({}),inMemoryPersistence={},onAuthStateChanged=(_auth,callback)=>{queueMicrotask(()=>callback(null));return()=>{};},signOut=async()=>{},sendPasswordResetEmail=async()=>{},createUserWithEmailAndPassword=async()=>({user:{uid:'fixture'}}),deleteUser=async()=>{},signInWithEmailAndPassword=async()=>{const e=Error('Fixture credentials rejected');e.code='auth/invalid-credential';throw e;};`,
    'firebase-database.js':`export const query=(target,...constraints)=>({path:target,constraints}),orderByChild=key=>({key}),limitToLast=count=>({count}),endBefore=(value,key)=>({value,key}),onDisconnect=()=>({remove:async()=>{},cancel:async()=>{}}),remove=async()=>{},getDatabase=()=>({}),ref=(_db,path='')=>path,get=async()=>({val:()=>null,exists:()=>false}),set=async()=>{},update=async()=>{},onValue=()=>()=>{},push=()=>({key:'fixture'}),serverTimestamp=()=>({'.sv':'timestamp'}),runTransaction=async()=>({committed:false,snapshot:{val:()=>null}});`
  };
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.href==='https://bancaflow.production.test/')return route.fulfill({contentType:'text/html',body:html});
    if(url.origin==='https://bancaflow.production.test'&&['/assets/vendor/xlsx-0.20.3.full.min.js','/assets/roster-import.js','/assets/analytics.js','/assets/analytics-pdf.js','/assets/analytics.css','/assets/coordinator-report.js','/assets/coordinator-report-pdf.js','/assets/board-chat.js','/assets/board-chat.css','/assets/board-import.js'].includes(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join(__dirname,'..',url.pathname.slice(1)),'utf8')});
    if(url.origin==='https://bancaflow-csp-fixture.firebaseio.com'&&url.pathname==='/.lp')return route.fulfill({contentType:'text/javascript',body:'parent.__fixtureLongPollLoaded=true;'});
    const name=url.pathname.split('/').at(-1);if(url.origin==='https://www.gstatic.com'&&modules[name])return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:modules[name]});
    return route.abort();
  });
  await page.goto('https://bancaflow.production.test/');
  await page.waitForFunction(()=>globalThis.XLSX?.version==='0.20.3'&&!!globalThis.BancaFlowImport&&!!globalThis.BancaAnalytics&&!!globalThis.BancaAnalyticsPdf&&!!globalThis.BancaCoordinatorReport&&!!globalThis.BancaCoordinatorPdf&&!!globalThis.BancaChat&&!!globalThis.BancaBoardImport);
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
  await page.evaluate(()=>appTest.go('relatorios'));await page.locator('#report-course-filter').selectOption('ADS');await page.locator('#report-filter').selectOption('2A');await page.locator('#report-date-filter').fill('2026-10-18');
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
  await page.evaluate(()=>{appTest.mount('coord');appTest.go('relatorios');});
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
  await page.evaluate(()=>appTest.go('relatorios'));assert.equal(await page.locator('[data-my-grades="b1"]').count(),1);assert.equal(await page.locator('[data-my-grades="b2"]').count(),0);
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

test('two professors exchange live bank chat messages, preserve drafts, online presence and evaluation privacy', {skip}, async t=>{
  const{page,errors,cspErrors,createPeer}=await openApp(t),qa=process.env.BANCAFLOW_SCREENSHOT_DIR||'/tmp/bancaflow-chat-qa';mkdirSync(qa,{recursive:true});
  const before=await page.evaluate(()=>JSON.stringify({grades:firebaseMock.data.grades,deliveries:firebaseMock.data.deliveries}));
  await page.locator('[data-chat-board="b1"]').first().click();
  await page.waitForFunction(()=>appTest.state.route==='chat'&&!appTest.state.chatLoading);
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

test('chat paginates saved history and keeps a read-access failure separate from grading', {skip}, async t=>{
  const{page,errors}=await openApp(t);
  await page.evaluate(()=>{
    firebaseMock.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Histórico '+i,at:Date.now()-200000+i}]))};appTest.openChatRoom('geral');
  });
  assert.equal(await page.locator('[data-chat-message]').count(),100);await page.locator('[data-chat-older]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message]').length===130);
  assert.match(await page.locator('[data-chat-message]').first().textContent(),/Histórico 0/);assert.equal(await page.locator('[data-chat-older]').count(),0);
  await page.evaluate(()=>{appTest.stopChat();firebaseMock.chatReadError=true;appTest.openChatRoom('b1');});
  assert.match(await page.locator('[data-chat-panel]').textContent(),/Não foi possível abrir o chat/);assert.equal(await page.locator('#chat-form button[type="submit"]').isDisabled(),true);
  await page.evaluate(()=>{firebaseMock.chatReadError=false;});await page.locator('[data-chat-retry]').click();await page.waitForFunction(()=>!appTest.state.chatError&&!appTest.state.chatLoading);
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
  await page.evaluate(()=>{appTest.mount('new-teacher');appTest.go('professores');});assert.equal(await page.locator('#teacher-form').count(),0,'new coordinator cannot mint other accounts');
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
