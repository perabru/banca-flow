/**
 * Real-browser integration tests for the unmodified inline application.
 * Uses an in-memory Firebase adapter and blocks every network request.
 * Optional dependencies: Playwright and a Chromium binary.
 * Run: BANCAFLOW_CHROMIUM=/path/to/chromium node --test tests/browser.test.cjs
 * For a serverless bundle, also set BANCAFLOW_CHROMIUM_MODULE to its entry point.
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
  boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Professor Um', t2: 'Professora Dois' }, startAt: 900000, durationMin: 30, room: 'Laboratório' } },
  groupBoards: { g1: 'b1' },
  grades: { b1: {
    t1: { s1: { presentation: 10, practice: 8, code: 6, time: 8 }, s2: { presentation: 0, practice: 0, code: 0, time: 0 } },
    t2: { s1: { presentation: 6, practice: 6, code: 6, time: 6 }, s2: { presentation: 10, practice: 10, code: 10, time: 10 } }
  } },
  deliveries: { b1: { s1: 9, s2: 0 } }, seals: {}, timers: { b1: { elapsedMs: 123456, startedAt: 0, updatedAt: 1, updatedBy: 't1', revision: 1 } }
};

function adapter(data) {
  return `
    const mock = globalThis.firebaseMock = {
      data: ${JSON.stringify(data)}, listeners: new Map(), writes: [], network: [],
      clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); },
      read(path) { if(path === '.info/connected')return true;if(path === '.info/serverTimeOffset')return 0;return path?path.split('/').reduce((v,k)=>v?.[k],this.data):this.data; },
      snapshot(path) { const value=this.clone(this.read(path)??null);return {val:()=>value,exists:()=>value!==null}; },
      resolved(value) {if(value&&typeof value==='object'){if(value['.sv']==='timestamp')return Date.now();return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.resolved(v)]));}return value;},
      write(path,value){const keys=path.split('/'),last=keys.pop(),parent=keys.reduce((v,k)=>v[k]||=( {} ),this.data);if(value===null)delete parent[last];else parent[last]=this.clone(this.resolved(value));},
      emit(path){for(const [registered,callbacks] of this.listeners)if(registered===path||registered.startsWith(path+'/')||path.startsWith(registered+'/'))for(const cb of callbacks)cb(this.snapshot(registered));}
    };
    const initializeApp = () => ({}), getAuth = () => ({currentUser:{uid:'t1'}}), getDatabase = () => ({});
    const onAuthStateChanged = () => () => {}, ref = (_db,path='')=>path;
    const onValue = (path,cb) => {if(!mock.listeners.has(path))mock.listeners.set(path,new Set());mock.listeners.get(path).add(cb);cb(mock.snapshot(path));return ()=>mock.listeners.get(path)?.delete(cb);};
    const get = async path=>mock.snapshot(path), serverTimestamp = ()=>({'.sv':'timestamp'});
    const set = async (path,value)=>{if(mock.deferSets)await new Promise(resolve=>mock.releaseSet=resolve);mock.writes.push({path,value:mock.clone(value)});mock.write(path,value);mock.emit(path);};
    const update = async (_path,changes)=>{mock.writes.push({changes:mock.clone(changes)});Object.entries(changes).forEach(([path,value])=>mock.write(path,value));Object.keys(changes).forEach(path=>mock.emit(path));};
    const runTransaction=async(path,cb)=>{const next=cb(mock.clone(mock.read(path)??null));if(next===undefined)return {committed:false,snapshot:mock.snapshot(path)};mock.write(path,next);mock.writes.push({path,value:mock.clone(next)});mock.emit(path);return {committed:true,snapshot:mock.snapshot(path)};};
    const signOut=async()=>{}, signInWithEmailAndPassword=async()=>{}, sendPasswordResetEmail=async()=>{};
  `;
}

async function openApp(t) {
  const args = process.env.BANCAFLOW_CHROMIUM_MODULE
    ? (await import(process.env.BANCAFLOW_CHROMIUM_MODULE)).default.args
    : ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await chromium.launch({ headless: true, executablePath: binary, args, env: process.env });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(markup);
  await page.addScriptTag({ content: adapter(fixture) + source + `
    globalThis.appTest = {state,go,render,buildEvaluationPdf,syncTeacherSubs,syncTimerSubs,resetAppData,
      mount(uid){clearListeners();resetAppData();state.user={uid,email:uid+'@example.test'};state.profile=mock.clone(mock.data.users[uid]);for(const key of ['users','groups','boards','groupBoards','grades','deliveries','seals','timers'])state[key]=mock.clone(mock.data[key]||{});state.connected=true;document.querySelector('#login-view').classList.add('hidden');document.querySelector('#app-view').classList.remove('hidden');if(isCoord())for(const key of ['grades','deliveries','seals'])listen(key,key);else syncTeacherSubs();syncTimerSubs();go('avaliar','b1');}
    };appTest.mount('t1');
  ` });
  return { page, errors, requests };
}

test('mobile browser runs actual grade, timer, close/reopen and PDF flows without production access', { skip }, async t => {
  const { page, errors, requests } = await openApp(t);

  const form = page.locator('[data-grade-form="b1"][data-student="s1"]');
  await assert.equal(await form.locator('input[name="presentation"]').inputValue(), '10');
  await assert.equal(await page.locator('[data-delivery-form]').count(), 0);
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
    if (process.env.BANCAFLOW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
      mkdirSync(process.env.BANCAFLOW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.BANCAFLOW_SCREENSHOT_DIR, `banca-flow-real-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // A shared timer snapshot must not replace the student's form or steal focus.
  const presentation = form.locator('input[name="presentation"]');
  await presentation.fill('9');
  await presentation.focus();
  await page.evaluate(() => {
    firebaseMock.write('timers/b1', { elapsedMs: 123499, startedAt: 0, updatedAt: Date.now(), updatedBy: 't2', revision: 2 });
    firebaseMock.emit('timers/b1');
  });
  assert.equal(await presentation.inputValue(), '9');
  assert.equal(await presentation.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator('[data-timer-display="b1"]').textContent(), '02:03,49');
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Salve as notas'));
  assert.equal(await page.evaluate(() => firebaseMock.data.seals.b1 || null), null);

  // Submit through the real event handler; the second evaluator's grades survive.
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => firebaseMock.data.grades.b1.t1.s1.presentation === 9);
  assert.equal(await page.evaluate(() => firebaseMock.data.grades.b1.t2.s1.presentation), 6);

  await page.locator('[data-timer-action="start"]').click();
  await page.waitForFunction(() => !!firebaseMock.data.timers.b1.startedAt);
  await page.locator('[data-timer-action="pause"]').click();
  await page.waitForFunction(() => firebaseMock.data.timers.b1.startedAt === 0);
  const elapsed = await page.evaluate(() => firebaseMock.data.timers.b1.elapsedMs);
  assert.ok(elapsed >= 123499);

  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-seal="b1"]').click();
  assert.equal(await page.evaluate(() => firebaseMock.data.seals.b1 || null), null);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(() => !!firebaseMock.data.seals.b1);
  assert.equal(await form.locator('input[name="presentation"]').isDisabled(), true);
  assert.equal(await page.locator('[data-timer-action="start"]').isDisabled(), true);

  // A second professor can reopen through the same button and saved data persists.
  await page.evaluate(() => appTest.mount('t2'));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-reopen="b1"]').click();
  await page.waitForFunction(() => !firebaseMock.data.seals.b1);
  assert.equal(await form.locator('input[name="presentation"]').isDisabled(), false);
  assert.equal(await form.locator('input[name="presentation"]').inputValue(), '6');
  assert.equal(await page.evaluate(() => firebaseMock.data.grades.b1.t1.s1.presentation), 9);

  // Coordinator is not an evaluator, but can launch deliveries and close/reopen.
  await page.evaluate(() => appTest.mount('coord'));
  await page.evaluate(() => appTest.go('entregas'));
  const deliveryForm = page.locator('[data-delivery-form="b1"][data-student="s1"]');
  await deliveryForm.locator('input[name="delivery"]').fill('9.5');
  await deliveryForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => firebaseMock.data.deliveries.b1.s1 === 9.5);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-seal="b1"]').click();
  await page.waitForFunction(() => !!firebaseMock.data.seals.b1);
  assert.equal(await deliveryForm.locator('input[name="delivery"]').isDisabled(), true);

  // Exercise the real PDF download, not a print dialog or substitute renderer.
  await page.evaluate(() => appTest.go('relatorios'));
  const downloading = page.waitForEvent('download');
  await page.locator('[data-print-one="b1"]').click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /^relatorio_tcc_b1_\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = readFileSync(await download.path(), 'ascii');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  for (const text of ['Ana', 'Bruno', 'Professor Um', 'Professora Dois', '9,50', '6,88', '4,13', '3,80', '7,93']) assert.ok(pdf.includes(text), text);
  const recorded = await page.evaluate(() => {
    const ms=firebaseMock.data.timers.b1.elapsedMs,cs=Math.floor(ms/10);
    return String(Math.floor(cs/6000)).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+','+String(cs%100).padStart(2,'0');
  });
  assert.ok(pdf.includes(recorded));
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => !/firebaseio\.com|firebasedatabase\.app|gstatic\.com\/firebasejs/.test(url)), 'production requests must never be attempted');
});

test('real inputs retain dirty work across snapshots, remote close/reopen and pending saves', { skip }, async t => {
  const { page, errors } = await openApp(t);
  const form = page.locator('[data-grade-form="b1"][data-student="s1"]');
  const input = form.locator('input[name="presentation"]');

  // Initial untouched blanks must accept the saved values as soon as they arrive.
  await page.evaluate(() => { appTest.state.grades.b1.t1 = {}; appTest.render(); });
  assert.equal(await input.inputValue(), '');
  await page.evaluate(() => firebaseMock.emit('grades/b1/t1'));
  assert.equal(await input.inputValue(), '10');
  assert.equal(await page.evaluate(() => appTest.state.drafts.size), 0);

  // A remote close disables edits but preserves the local dirty form for reopen.
  await input.fill('9');
  await page.evaluate(() => {
    firebaseMock.write('seals/b1', { by: 't2', at: Date.now() });
    firebaseMock.emit('seals/b1');
  });
  assert.equal(await input.isDisabled(), true);
  assert.equal(await page.evaluate(() => appTest.state.drafts.get('grade/b1/s1').presentation), '9');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-reopen="b1"]').click();
  await page.waitForFunction(() => !firebaseMock.data.seals.b1);
  assert.equal(await input.isDisabled(), false);
  assert.equal(await input.inputValue(), '9');
  assert.equal(await page.evaluate(() => firebaseMock.data.grades.b1.t1.s1.presentation), 10);

  // A save in flight must not discard another edit made before it acknowledges.
  await page.evaluate(() => firebaseMock.deferSets = true);
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => typeof firebaseMock.releaseSet === 'function');
  await input.fill('8');
  await page.evaluate(() => { firebaseMock.deferSets = false; firebaseMock.releaseSet(); });
  await page.waitForFunction(() => firebaseMock.data.grades.b1.t1.s1.presentation === 9);
  assert.equal(await input.inputValue(), '8');
  assert.equal(await page.evaluate(() => appTest.state.drafts.get('grade/b1/s1').presentation), '8');

  // Resetting the account removes both displayed work and cached form values.
  await page.evaluate(() => appTest.resetAppData());
  assert.equal(await page.locator('#view').innerHTML(), '');
  assert.equal(await page.evaluate(() => appTest.state.drafts.size), 0);
  assert.deepEqual(errors, []);
});
