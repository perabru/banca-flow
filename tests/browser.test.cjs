/** Actual inline app, original-permission Firebase mock and real localStorage.
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
  deliveries: { b1: { s1: 9, s2: 0 } }, seals: {}
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
      if(path.startsWith('seals/')&&(mock.uid!=='coord'||value===null||mock.read(path))){
        if(mock.optimisticSeal){const previous=mock.clone(mock.read(path)??null);mock.write(path,value);mock.emit(path);await Promise.resolve();mock.write(path,previous);mock.emit(path);}
        const e=Error('PERMISSION_DENIED');e.code='PERMISSION_DENIED';throw e;
      }
      mock.write(path,value);mock.emit(path);
    };
    const update=async(_path,changes)=>{mock.writes.push({changes:mock.clone(changes)});Object.entries(changes).forEach(([path,v])=>mock.write(path,v));Object.keys(changes).forEach(path=>mock.emit(path));};
    const signOut=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{};
  `;
}

async function openApp(t) {
  const args = process.env.BANCAFLOW_CHROMIUM_MODULE ? (await import(process.env.BANCAFLOW_CHROMIUM_MODULE)).default.args : ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await chromium.launch({ headless: true, executablePath: binary, args, env: process.env });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.request().url() === 'https://bancaflow.example.test/' ? route.fulfill({ contentType: 'text/html', body: markup }) : route.abort();
  });
  const bootstrap = adapter() + source + `
    globalThis.appTest={state,go,render,resetAppData,localTimerKey,storeLocalTimer,loadLocalTimer,syncLocalTimers,importTimerData,
      mount(uid){clearListeners();resetAppData();mock.uid=uid;state.user={uid,email:uid+'@example.test'};state.profile=mock.clone(mock.data.users[uid]);for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals'])state[key]=mock.clone(mock.data[key]||{});state.connected=true;document.querySelector('#login-view').classList.add('hidden');document.querySelector('#app-view').classList.remove('hidden');if(isCoord())for(const key of ['grades','deliveries','seals'])listen(key,key);else syncTeacherSubs();syncLocalTimers();go('avaliar','b1');}
    };appTest.mount('t1');
  `;
  const reload = async () => { await page.goto('https://bancaflow.example.test/'); await page.addScriptTag({ content: bootstrap }); };
  await reload();
  return { page, errors, requests, reload };
}

test('mobile UI uses account-local timers and original permissions, and exports actual weighted PDF', { skip }, async t => {
  const { page, errors, requests, reload } = await openApp(t);
  const form = page.locator('[data-grade-form="b1"][data-student="s1"]');
  assert.equal(await form.locator('input[name="presentation"]').inputValue(), '10');
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(), '00:00,00');
  assert.equal(await page.locator('[data-delivery-form]').count(), 0);
  await page.locator('[data-timer-action="start"]').click();
  await page.waitForFunction(() => !!appTest.state.timers.b1.startedAt);
  await reload();
  assert.equal(await page.locator('[data-timer-action="pause"]').count(), 1);
  await page.locator('[data-timer-action="pause"]').click();
  await page.evaluate(() => { appTest.storeLocalTimer('b1',{elapsedMs:123456,startedAt:0,revision:2});appTest.render(); });
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(), '02:03,45');

  // Denied optimistic Firebase updates must neither close the board nor pause time.
  await page.locator('[data-timer-action="start"]').click();
  const running = await page.evaluate(() => ({...appTest.state.timers.b1}));
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-seal="b1"]').click();
  assert.equal(await page.evaluate(() => firebaseMock.data.seals.b1 || null), null);
  await page.evaluate(() => firebaseMock.optimisticSeal = true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('não autorizam seu perfil'));
  assert.equal(await page.evaluate(() => firebaseMock.data.seals.b1 || null), null);
  assert.equal(await page.evaluate(() => appTest.state.seals.b1 || null), null);
  assert.equal(await page.evaluate(() => appTest.state.timers.b1.startedAt), running.startedAt);
  assert.equal(await page.evaluate(() => appTest.state.timers.b1.revision), running.revision);
  assert.equal(await form.locator('input[name="presentation"]').isDisabled(), false);
  await page.locator('[data-timer-action="pause"]').click();
  await page.evaluate(() => { appTest.storeLocalTimer('b1',{elapsedMs:123456,startedAt:0,revision:5});appTest.render(); });
  const exporting = page.waitForEvent('download');
  await page.locator('[data-export-timer="b1"]').click();
  const timeFile = await exporting;
  assert.equal(timeFile.suggestedFilename(), 'tempo_banca_b1.json');
  const record = JSON.parse(readFileSync(await timeFile.path(), 'utf8'));
  assert.equal(record.elapsedMs, 123456);

  // Another account cannot see the teacher's stopwatch without importing it.
  await page.evaluate(() => appTest.mount('coord'));
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(), '00:00,00');
  await page.locator('[data-timer-import="b1"]').setInputFiles({ name:'tempo_banca_b1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record)) });
  await page.waitForFunction(() => appTest.state.timers.b1?.source === 'imported');
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(), '02:03,45');
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
    if (process.env.BANCAFLOW_SCREENSHOT_DIR && [390,1440].includes(width)) {
      mkdirSync(process.env.BANCAFLOW_SCREENSHOT_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.BANCAFLOW_SCREENSHOT_DIR,`banca-flow-real-${width}.png`),fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => appTest.go('entregas'));
  const deliveries = page.locator('[data-delivery-form="b1"][data-student="s1"]');
  await deliveries.locator('input[name="delivery"]').fill('9.5');
  await deliveries.locator('button[type="submit"]').click();
  await page.waitForFunction(() => firebaseMock.data.deliveries.b1.s1 === 9.5);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(() => !!firebaseMock.data.seals.b1);
  assert.equal(await deliveries.locator('input[name="delivery"]').isDisabled(),true);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-reopen="b1"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('não autorizam a reabertura'));
  assert.equal(await page.evaluate(() => firebaseMock.data.seals.b1.by),'coord');
  await page.evaluate(() => appTest.go('avaliar','b1'));
  const manual = page.locator('[data-timer-form="b1"]');
  await manual.locator('input[name="duration"]').fill('12:34,56');
  await manual.locator('button[type="submit"]').click();
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(),'12:34,56');
  assert.equal(await page.evaluate(() => firebaseMock.data.grades.b1.t1.s1.presentation),10);
  await page.evaluate(() => appTest.go('relatorios'));
  const downloading = page.waitForEvent('download');
  await page.locator('[data-print-one="b1"]').click();
  const pdfFile = await downloading;
  assert.match(pdfFile.suggestedFilename(),/^relatorio_tcc_b1_\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = readFileSync(await pdfFile.path(),'ascii');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  for(const text of ['Ana','Bruno','Professor Um','Professora Dois','9,50','7,00','4,20','3,80','8,00','12:34,56'])assert.ok(pdf.includes(text),text);
  assert.equal(await page.evaluate(()=>[...firebaseMock.reads,...firebaseMock.listens,...firebaseMock.writes.map(w=>w.path||'')].some(path=>path.startsWith('timers/'))),false);
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>!/firebaseio\.com|firebasedatabase\.app|gstatic\.com\/firebasejs/.test(url)));
});

test('real drafts survive snapshots, denied reopen and delayed save acknowledgement', { skip }, async t => {
  const {page,errors}=await openApp(t);
  const form=page.locator('[data-grade-form="b1"][data-student="s1"]'),input=form.locator('input[name="presentation"]');
  await page.evaluate(()=>{appTest.state.grades.b1.t1={};appTest.render();});
  assert.equal(await input.inputValue(),'');
  await page.evaluate(()=>firebaseMock.emit('grades/b1/t1'));
  assert.equal(await input.inputValue(),'10');
  await input.fill('9');await input.focus();
  await page.evaluate(()=>{appTest.storeLocalTimer('b1',{elapsedMs:123499,startedAt:0,revision:1});window.dispatchEvent(new StorageEvent('storage',{key:appTest.localTimerKey('b1')}));});
  assert.equal(await input.inputValue(),'9');
  assert.equal(await input.evaluate(el=>document.activeElement===el),true);
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Salve as notas'));
  assert.equal(await page.evaluate(()=>firebaseMock.data.seals.b1||null),null);
  await page.evaluate(()=>{firebaseMock.write('seals/b1',{by:'coord',at:Date.now()});firebaseMock.emit('seals/b1');});
  assert.equal(await input.isDisabled(),true);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-reopen="b1"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('não autorizam a reabertura'));
  assert.equal(await input.isDisabled(),true);
  assert.equal(await page.evaluate(()=>appTest.state.drafts.get('grade/b1/s1').presentation),'9');
  // Test-fixture external update resumes draft tests without claiming UI permission.
  await page.evaluate(()=>{firebaseMock.write('seals/b1',null);firebaseMock.emit('seals/b1');});
  assert.equal(await input.inputValue(),'9');
  await page.evaluate(()=>firebaseMock.deferSets=true);
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>typeof firebaseMock.releaseSet==='function');
  await input.fill('8');
  await page.evaluate(()=>{firebaseMock.deferSets=false;firebaseMock.releaseSet();});
  await page.waitForFunction(()=>firebaseMock.data.grades.b1.t1.s1.presentation===9);
  assert.equal(await input.inputValue(),'8');
  assert.equal(await page.evaluate(()=>appTest.state.drafts.get('grade/b1/s1').presentation),'8');
  await page.evaluate(()=>appTest.mount('coord'));
  const manual=page.locator('[data-timer-form="b1"] input[name="duration"]');
  await manual.fill('12:34,56');
  await page.evaluate(()=>{firebaseMock.emit('grades/b1');window.dispatchEvent(new StorageEvent('storage',{key:appTest.localTimerKey('b1')}));});
  assert.equal(await manual.inputValue(),'12:34,56');
  await page.evaluate(()=>appTest.resetAppData());
  assert.equal(await page.locator('#view').innerHTML(),'');
  assert.equal(await page.evaluate(()=>appTest.state.drafts.size),0);
  assert.deepEqual(errors,[]);
});
