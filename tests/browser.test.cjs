/** Actual inline app with in-memory shared Firebase and intercepted share APIs.
 * Optional: BANCAFLOW_CHROMIUM=/path/to/chromium node --test tests/browser.test.cjs
 */
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}
const binary = process.env.BANCAFLOW_CHROMIUM;
const skip = !chromium ? 'Playwright is not installed' : !binary || !existsSync(binary) ? 'Set BANCAFLOW_CHROMIUM to a local Chromium binary' : false;
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import\s.+?;\s*$/gm, '');
const markup = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');
const fixture = {
  users: {
    coord: { name: 'Alberson', role: 'coordinator', key: 'alberson', active: true },
    t1: { name: 'Professor Um', role: 'teacher', active: true },
    t2: { name: 'Professora Dois', role: 'teacher', active: true }
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
    const mock=globalThis.firebaseMock={data:${JSON.stringify(fixture)},uid:'t1',listeners:new Map(),writes:[],reads:[],listens:[],
      clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));},
      read(path){if(path==='.info/connected')return true;if(path==='.info/serverTimeOffset')return 0;return path?path.split('/').reduce((v,k)=>v?.[k],this.data):this.data;},
      snapshot(path){const v=this.clone(this.read(path)??null);return {val:()=>v,exists:()=>v!==null};},
      resolved(v){if(v&&typeof v==='object'){if(v['.sv']==='timestamp')return Date.now();return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,this.resolved(x)]));}return v;},
      write(path,v){const keys=path.split('/'),last=keys.pop(),parent=keys.reduce((x,k)=>x[k]||={},this.data);if(v===null)delete parent[last];else parent[last]=this.clone(this.resolved(v));},
      emit(path){for(const [registered,cbs]of this.listeners)if(registered===path||registered.startsWith(path+'/')||path.startsWith(registered+'/'))for(const cb of cbs)cb(this.snapshot(registered));}
    };
    const initializeApp=()=>({}),getAuth=()=>({currentUser:{uid:'t1'}}),getDatabase=()=>({}),onAuthStateChanged=()=>()=>{},ref=(_db,path='')=>path;
    const onValue=(path,cb)=>{mock.listens.push(path);if(!mock.listeners.has(path))mock.listeners.set(path,new Set());mock.listeners.get(path).add(cb);cb(mock.snapshot(path));return()=>mock.listeners.get(path)?.delete(cb);};
    const get=async path=>{mock.reads.push(path);return mock.snapshot(path);},serverTimestamp=()=>({'.sv':'timestamp'});
    const set=async(path,value)=>{
      mock.writes.push({path,value:mock.clone(value)});
      if(mock.deferSets)await new Promise(resolve=>mock.releaseSet=resolve);
      mock.write(path,value);mock.emit(path);
    };
    const update=async(_path,changes)=>{mock.writes.push({changes:mock.clone(changes)});Object.entries(changes).forEach(([path,v])=>mock.write(path,v));Object.keys(changes).forEach(path=>mock.emit(path));};
    const runTransaction=async(path,updater)=>{const next=updater(mock.clone(mock.read(path)??null));if(next===undefined)return{committed:false,snapshot:mock.snapshot(path)};mock.write(path,next);mock.writes.push({path,value:mock.clone(next)});mock.emit(path);return{committed:true,snapshot:mock.snapshot(path)};};
    const signOut=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{};
  `;
}

async function openApp(t) {
  const args = process.env.BANCAFLOW_CHROMIUM_MODULE ? (await import(process.env.BANCAFLOW_CHROMIUM_MODULE)).default.args : ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await chromium.launch({ headless: true, executablePath: binary, args, env: process.env });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.request().url() === 'https://bancaflow.example.test/' ? route.fulfill({ contentType: 'text/html', body: markup }) : route.abort();
  });
  const bootstrap = adapter() + source + `
    globalThis.appTest={state,go,render,resetAppData,openBoardShare,closeBoardShare,
      mount(uid){clearListeners();resetAppData();mock.uid=uid;state.user={uid,email:uid+'@example.test'};state.profile=mock.clone(mock.data.users[uid]);for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])state[key]=mock.clone(mock.data[key]||{});state.connected=true;document.querySelector('#login-view').classList.add('hidden');document.querySelector('#app-view').classList.remove('hidden');if(isCoord())for(const key of ['grades','deliveries','seals'])listen(key,key);else syncTeacherSubs();syncTimerSubs();go('avaliar','b1');}
    };appTest.mount('t1');
  `;
  const reload = async () => { await page.goto('https://bancaflow.example.test/'); await page.addScriptTag({ content: bootstrap }); };
  await reload();
  return { page, errors, requests, downloads, reload };
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

