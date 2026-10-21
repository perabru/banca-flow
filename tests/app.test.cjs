/**
 * Behavior tests for the actual inline app, with in-memory DOM/Firebase adapters.
 * No network, production access, or npm dependencies: node --test tests/app.test.cjs
 * Database authorization is tested separately in rules.test.mjs with the emulator.
 */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s.+?;\s*$/gm, '');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const grade = (presentation = 8, practice = 8, code = 8, time = 8) => ({ presentation, practice, code, time });
const customWeightedModel = () => ({version:1,name:'MODELO_INTEGRACAO',title:'RELATORIO_PERSONALIZADO',boardWeight:75,monographWeight:25,criteriaWeights:{presentation:50,practice:25,code:25,time:0},evaluatorWeights:{t1:3,t2:1},decimals:3});
const fixture = () => ({
  users: {
    coord: { name: 'Alberson', email:'coord@example.test', role: 'coordinator', key: 'alberson', active: true },
    t1: { name: 'Professor Um', email:'one@example.test', key:'one', role: 'teacher', active: true },
    t2: { name: 'Professora Dois', email:'two@example.test', key:'two', role: 'teacher', active: true },
    outsider: { name: 'Outro Professor', role: 'teacher', active: true },
    disabled: { name: 'Desativado', role: 'teacher', active: false }
  },
  groups: { g1: { id: 'g1', name: 'Grupo Árvore', title: 'Projeto de TCC', className: '2A', advisorUid: 't1', students: { s1: 'Ana', s2: 'Bruno' } } },
  boards: { b1: { groupId: 'g1', advisorUid: 't1', advisorName: 'Professor Um', members: { t1: true, t2: true }, memberNames: { t1: 'Professor Um', t2: 'Professora Dois' }, startAt: 900000, durationMin: 30, room: 'Laboratório' } },
  grades: { b1: { t1: { s1: grade(10, 8, 6, 8), s2: grade(0, 0, 0, 0) }, t2: { s1: grade(6, 6, 6, 6), s2: grade(10, 10, 10, 10) } } },
  deliveries: { b1: { s1: 9, s2: 0 } },
  seals: {}, timers: {},
});

function harness(uid = 't1') {
  let now = 1_800_000_000_000;
  const data = fixture();
  const calls = { reads: [], sets: [], updates: [], updateBases: [], transactions: [], confirmations: [], authCreates:[], authDeletes:[], appDeletes:[], listens:[], disconnects:[], removals:[], pushCount:0, notificationRequests:0, notifications:[], passwordResets:[], emailChanges:[], reauthentications:[], tokenRefreshes:[], authReloads:[], passwordConfirmations:[], accountRequests:[] };
  const options = { confirm: true, setError: null, updateError: null, transactionError: null };
  const elements = new Map(), pendingTimeouts = new Map();
  let timeoutId = 0;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', innerHTML: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      setAttribute() {}, focus() {}, scrollIntoView() {}, remove() {}, querySelector(selector) { return element(selector); },querySelectorAll() { return []; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(selector);
  };
  const pathOf = target => typeof target==='string'?target:(target?.path||'');
  const read = path => path ? path.split('/').reduce((value, key) => value?.[key], data) : data;
  const resolveTimestamp = value => {
    if (value && typeof value === 'object') {
      if (value['.sv'] === 'timestamp') return now;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTimestamp(item)]));
    }
    return value;
  };
  const write = (path, value) => {
    const parts = path.split('/'), key = parts.pop();
    const parent = parts.reduce((obj, part) => obj[part] ||= {}, data);
    if (value === null) delete parent[key];
    else parent[key] = clone(resolveTimestamp(value));
  };
  const snapshot = (value,key=null) => ({ key, val: () => clone(value), exists: () => value !== undefined && value !== null, forEach(callback){for(const[k,v]of Object.entries(value||{}))if(callback(snapshot(v,k))===true)return true;return false;} });
  const queryValue = target => {
    let value=read(pathOf(target));if(typeof target==='string'||!target?.constraints)return value;
    const child=target.constraints.find(c=>c.kind==='order')?.key;
    let rows=Object.entries(value||{}).sort(([ak,a],[bk,b])=>{const av=child?a?.[child]:ak,bv=child?b?.[child]:bk;return av===bv?(ak<bk?-1:ak>bk?1:0):av<bv?-1:1;});
    for(const c of target.constraints){if(c.kind==='before')rows=rows.filter(([key,item])=>{const v=child?item?.[child]:key;return v<c.value||(v===c.value&&c.key!==undefined&&key<c.key);});if(c.kind==='start')rows=rows.filter(([key,item])=>{const v=child?item?.[child]:key;return v>c.value||(v===c.value&&(c.key===undefined||key>=c.key));});if(c.kind==='last')rows=rows.slice(-c.count);}
    return Object.fromEntries(rows);
  };
  const listeners=new Map(),listenerErrors=new Map();
  const emitError=path=>{for(const[target,cb]of listenerErrors)if(pathOf(target)===path){listeners.delete(target);listenerErrors.delete(target);cb?.(Object.assign(Error('Permission denied'),{code:'PERMISSION_DENIED'}));}};
  const emit = path => {for(const[target,cb]of listeners)if(pathOf(target)===path||pathOf(target).startsWith(path+'/')||path.startsWith(pathOf(target)+'/'))cb(snapshot(queryValue(target)));};

  class Clock extends Date { static now() { return now; } }
  class FormDataAdapter {
    constructor(form) { this.values = form.values || {}; }
    get(key) { return this.values[key] ?? null; }
    getAll(key) { return [].concat(this.values[key] || []); }
  }
  const storage = new Map(), localStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  class NotificationAdapter {
    static get permission(){return options.notificationPermission||'default';}
    static async requestPermission(){calls.notificationRequests++;options.notificationPermission=options.notificationResult||'granted';return options.notificationPermission;}
    constructor(title,config){calls.notifications.push({title,config:clone(config)});}
    close(){}
  }
  const notificationRegistration = {showNotification:async(title,config)=>calls.notifications.push({title,config:clone(config)}),getNotifications:async()=>[]};
  const navigator = {serviceWorker:{register:async()=>notificationRegistration,ready:Promise.resolve(notificationRegistration),getRegistration:async()=>notificationRegistration,addEventListener(){}}};
  const location = {href:'https://bancaflow.example.test/',origin:'https://bancaflow.example.test',pathname:'/'};
  const authUser = {uid,email:data.users[uid]?.email||uid+'@example.test',emailVerified:false,getIdToken:async force=>{calls.tokenRefreshes.push({uid,force});return'test-token';},getIdTokenResult:async force=>{calls.tokenRefreshes.push({uid,force});return{claims:{email:authUser.email,email_verified:authUser.emailVerified,...options.authClaims}};}};
  const authAdapter={currentUser:authUser,languageCode:'pt-BR'};
  const context = vm.createContext({
    console, Date: Clock, Blob, File, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    FormData: FormDataAdapter, URL, URLSearchParams, AbortController, atob, btoa, crypto:{randomUUID:()=> 'test-uuid'},
    window: { scrollTo() {}, addEventListener() {},localStorage,Notification:NotificationAdapter,navigator,location }, navigator, localStorage,Notification:NotificationAdapter,location,
    document: {
      hidden: false, visibilityState:'visible',addEventListener(){}, body: { classList: { add() {}, remove() {} } },
      querySelector: element, querySelectorAll: () => [],
      createElement: () => ({ getContext: () => ({ font: '10px Arial', measureText(value) { return { width: String(value).length * (parseFloat(this.font.match(/[\d.]+/)?.[0]) || 10) * .55 }; } }) }),
      getElementById: id => id === 'roster-criptografado' ? { textContent: '{}' } : element('#' + id)
    },
    setInterval() {}, clearInterval() {},
    setTimeout(callback, delay=0) { const id=++timeoutId;pendingTimeouts.set(id,{callback,delay});return id; },
    clearTimeout(id) { pendingTimeouts.delete(id); },
    confirm(message) { calls.confirmations.push(message); return options.confirm; },
    initializeApp: (_config,name='main') => ({name}), getAuth: () => authAdapter, getDatabase: () => ({}),
    initializeAuth: app => ({app}), inMemoryPersistence:{},
    createUserWithEmailAndPassword: async (_auth,email,password) => {calls.authCreates.push({email,password});if(options.authCreateError)throw options.authCreateError;return{user:{uid:options.newAuthUid||'new-teacher'}};},
    deleteUser: async user => {calls.authDeletes.push(user.uid);if(options.authDeleteError)throw options.authDeleteError;},
    deleteApp: async app => {calls.appDeletes.push(app.name);}, signOut:async()=>{},
    sendPasswordResetEmail:async (_auth,email,settings)=>{calls.passwordResets.push({email,settings:clone(settings)});await options.beforeResetEmail?.(email,settings);if(options.resetEmailError)throw options.resetEmailError;},
    EmailAuthProvider:{credential:(email,password)=>({email,password})},
    reauthenticateWithCredential:async(user,credential)=>{calls.reauthentications.push({uid:user.uid,...credential});await options.beforeReauthenticate?.(user);if(options.reauthenticateError)throw options.reauthenticateError;},
    verifyBeforeUpdateEmail:async(user,email,settings)=>{calls.emailChanges.push({uid:user.uid,email,settings:clone(settings)});await options.beforeEmailChange?.(user,email,settings);if(options.emailChangeError)throw options.emailChangeError;},
    reload:async user=>{calls.authReloads.push(user.uid);await options.beforeAuthReload?.(user);if(options.authReloadError)throw options.authReloadError;},
    getIdToken:async(user,force)=>user.getIdToken(force),getIdTokenResult:async(user,force)=>user.getIdTokenResult(force),
    validatePassword:async(_auth,password)=>options.passwordStatus||{isValid:password.length>=8,passwordPolicy:{customStrengthOptions:{minPasswordLength:8}}},
    confirmPasswordReset:async(_auth,code,password)=>{calls.passwordConfirmations.push({code,password});if(options.confirmPasswordError)throw options.confirmPasswordError;},
    fetch:async(url,request={})=>{const body=request.body?JSON.parse(request.body):{};calls.accountRequests.push({url:String(url),body,headers:request.headers});if(options.accountRequestError)throw options.accountRequestError;const payload=await options.accountResponse?.(body)||{ok:true,emailAvailable:false,smsAvailable:false};return{ok:true,status:200,json:async()=>payload};},
    onAuthStateChanged: () => () => {}, onValue: (target,callback,error) => {calls.listens.push(pathOf(target));listeners.set(target,callback);listenerErrors.set(target,error);if(pathOf(target).startsWith('chat')){if(options.chatReadError){listeners.delete(target);listenerErrors.delete(target);error?.(Object.assign(Error('Permission denied'),{code:'PERMISSION_DENIED'}));}else if(!options.deferChatMessages||!pathOf(target).startsWith('chatMessages/'))callback(snapshot(queryValue(target)));}return()=>{listeners.delete(target);listenerErrors.delete(target);};},
    query:(target,...constraints)=>({path:pathOf(target),constraints}),orderByChild:key=>({kind:'order',key}),limitToLast:count=>({kind:'last',count}),endBefore:(value,key)=>({kind:'before',value,key}),startAt:(value,key)=>({kind:'start',value,key}),
    onDisconnect: target => ({remove:async()=>{calls.disconnects.push({kind:'remove',path:pathOf(target)});if(options.disconnectError)throw options.disconnectError;},cancel:async()=>calls.disconnects.push({kind:'cancel',path:pathOf(target)})}),
    remove: async target => {const path=pathOf(target);calls.removals.push(path);write(path,null);emit(path);},
    ref: (_db, path = '') => path,
    push: target => {const path=pathOf(target),key=path.startsWith('chat')?'chat-'+(++calls.pushCount):'new-group';return{key,path:path?path+'/'+key:key};},
    serverTimestamp: () => ({ '.sv': 'timestamp' }),
    get: async target => {const path=pathOf(target);calls.reads.push(path); options.onRead?.(path, calls.reads);await options.beforeRead?.(path,target);return snapshot(queryValue(target));},
    set: async (target, value) => {
      const path=pathOf(target);
      calls.sets.push([path, clone(value)]);
      if(options.optimisticChatWrites&&path.startsWith('chatMessages/')){
        const previous=clone(read(path));write(path,value);emit(path);
        await options.beforeSet?.(path,value);
        if(options.setError){write(path,previous??null);emit(path);throw options.setError;}
        return;
      }
      if (options.setError) throw options.setError;
      await options.beforeSet?.(path,value);
      write(path, value);if(!options.suppressChatMessageEmits||!path.startsWith('chatMessages/'))emit(path);
    },
    update: async (base, changes) => {
      calls.updates.push(clone(changes));calls.updateBases.push(base);
      await options.beforeUpdate?.(base,changes);
      if (options.updateError) throw options.updateError;
      Object.entries(changes).forEach(([path, value]) => write(base?`${base}/${path}`:path, value));
      await options.afterUpdate?.(base,changes);
    },
    runTransaction: async (path, updater, config) => {
      calls.transactions.push({ path, config });
      await options.beforeTransaction?.(path,updater);
      if (options.transactionError) throw options.transactionError;
      let candidate;
      for (const value of options.transactionRetries || [clone(read(path) ?? null)]) candidate = updater(value);
      if (candidate === undefined) return { committed: false, snapshot: snapshot(read(path) ?? null) };
      write(path, candidate);
      if(path.startsWith('chatMessages/')&&!options.suppressChatMessageEmits)emit(path);
      return { committed: true, snapshot: snapshot(read(path)) };
    }
  });
  for(const asset of ['academic-years.js','account-security.js','roster-import.js','analytics.js','analytics-pdf.js','coordinator-report.js','coordinator-report-pdf.js','board-chat.js','board-import.js','chat-notifications.js','weighted-model.js','weighted-report-ui.js','weighted-report-pdf.js','weighted-workbench.js','board-assignment.js'].filter(asset=>require('node:fs').existsSync(join(__dirname,'..','assets',asset))))vm.runInContext(readFileSync(join(__dirname,'..','assets',asset),'utf8'),context,{filename:'assets/'+asset});
  vm.runInContext(source + `
    render = () => {};
    refreshTimerUi = () => {};
    globalThis.testDownloads = [];
    downloadBlob = (blob, filename) => globalThis.testDownloads.push({blob,filename});
    globalThis.appTest = { state, auth, accountSecurity:typeof accountSecurity!=='undefined'?accountSecurity:null,
      syncVerifiedAccountEmail:typeof syncVerifiedAccountEmail==='function'?syncVerifiedAccountEmail:null,openAccountSecurity:typeof openAccountSecurity==='function'?openAccountSecurity:null,openRecoveryDialog:typeof openRecoveryDialog==='function'?openRecoveryDialog:null,closeAccountSecurity:typeof closeAccountSecurity==='function'?closeAccountSecurity:null,setAcademicYear:typeof setAcademicYear==='function'?setAcademicYear:null,exportAcademicBackup:typeof exportAcademicBackup==='function'?exportAcademicBackup:null,
      getAccessRevision:()=>accessRevision,setAccessRevision:value=>accessRevision=value,
      CRITERIOS, notaValida, mediaAvaliador, situacao, resultadoAluno,
      chatRooms,chatView,openChatRoom,openGeneralChat:typeof openGeneralChat==='function'?openGeneralChat:null,isChatVisible:typeof isChatVisible==='function'?isChatVisible:null,toggleChatWidget:typeof toggleChatWidget==='function'?toggleChatWidget:null,closeChatWidget:typeof closeChatWidget==='function'?closeChatWidget:null,retryChat,sendChatMessage,loadOlderChat,syncChat,stopChat,startChatPresence,stopChatPresence,
      beginChatEdit:typeof beginChatEdit==='function'?beginChatEdit:null,beginChatDelete:typeof beginChatDelete==='function'?beginChatDelete:null,cancelChatMutation:typeof cancelChatMutation==='function'?cancelChatMutation:null,submitChatEdit:typeof submitChatEdit==='function'?submitChatEdit:null,confirmChatDelete:typeof confirmChatDelete==='function'?confirmChatDelete:null,
      requestChatNotifications:typeof requestChatNotifications==='function'?requestChatNotifications:null,toggleChatMuted:typeof toggleChatMuted==='function'?toggleChatMuted:null,syncChatAlerts:typeof syncChatAlerts==='function'?syncChatAlerts:null,stopChatAlerts:typeof stopChatAlerts==='function'?stopChatAlerts:null,getChatAlertsState:typeof getChatAlertsState==='function'?getChatAlertsState:null,
      weightedWorkbench:typeof weightedWorkbench!=='undefined'?weightedWorkbench:null,weightedReportsView:typeof weightedReportsView==='function'?weightedReportsView:null,buildWeightedReportPdf:typeof buildWeightedReportPdf==='function'?buildWeightedReportPdf:null,
      elapsedAt, formatElapsed, boardElapsed, timerRecord, controlTimer, closeBoard, reopenBoard,
      createBoardShareSnapshot, assertShareSnapshotCurrent, buildSharePdf, buildBoardShareText, whatsappTextUrl, boardShareFilename,
      assertBoardAccess, hasUnsavedDrafts, saveGrade,replicateGrade:typeof replicateGrade==='function'?replicateGrade:null, saveDelivery, reportHtml, refreshReportData,
      printReports, exportCsv, csvCell, boardActions, timerHtml,timerIsOverrun:typeof timerIsOverrun==='function'?timerIsOverrun:null,updateTimerDisplays:typeof updateTimerDisplays==='function'?updateTimerDisplays:null,
      analyticsBoards,analyticsView,printAnalytics,buildAnalyticsPdf,coordinatorReportBoards,buildCoordinatorReportPdf,exportCoordinatorReport,
      localDayKey,boardMatchesDay,filteredBoards,filteredReportBoards,reportGroups,setBancaDateFilter,resetAppData,boardsView,reportsView,exportSchedulePdf,
      openBoardAssignment:typeof openBoardAssignment==='function'?openBoardAssignment:null,saveBoardAssignment:typeof saveBoardAssignment==='function'?saveBoardAssignment:null,closeBoardAssignment:typeof closeBoardAssignment==='function'?closeBoardAssignment:null,canManageTeachers:typeof canManageTeachers==='function'?canManageTeachers:null,promoteTeacher:typeof promoteTeacher==='function'?promoteTeacher:null,prepareAdministratorRegistration:typeof prepareAdministratorRegistration==='function'?prepareAdministratorRegistration:null,canManageGroups:typeof canManageGroups==='function'?canManageGroups:null,teachersView,createBoards,makeBoard,teacherIdentity,teacherEditIdentity,teacherProfileFingerprint,addTeacher,changeTeacherAccess,saveTeacherEdit,
      validatedGroupDraft,groupRelatedBoards,groupAdminFingerprint,resetGroupAdmin,editGroup,saveGroup,changeGroupAccess,addGroupStudentRow,removeGroupStudentRow,
      confirmExcelImport,confirmBoardImport,openBoardImport,closeBoardImport,renderBoardImportCard,downloadBoardImportModel,coordinatorBoardRecord,filteredNotesBoards,boardNotesHtml,allNotesView,gradeView,myEvaluationsView,evaluatorBoards,navItems,setNotesFilter,resetNotesFilters,
      startBoardAssignment(bid){const paths=['users','groups','boards','grades','seals','locks'],catalog=Object.fromEntries(paths.map(key=>[key,state[key]||{}]));boardAssignmentSession={bid,uid:state.user.uid,revision:accessRevision,busy:false,fingerprint:assignmentFingerprint(catalog,bid),dialog:{open:false,remove(){},querySelectorAll(){return[];},querySelector(){return{textContent:''};}}};return boardAssignmentSession;},
      startTeacherEdit(uid){teacherEditSession={uid,ownerUid:state.user.uid,revision:accessRevision,profileFingerprint:teacherProfileFingerprint(state.users[uid]),dialog:{open:false,remove(){},querySelectorAll(){return[];}},saving:false};},
      prepareBankImport(rows){const catalog={users:state.users,groups:state.groups,boards:state.boards,groupBoards:state.groupBoards,locks:state.locks,roomLocks:state.roomLocks},preview=BancaBoardImport.parseRows(rows,{...catalog,now:Date.now()});boardImportState={uid:state.user.uid,revision:accessRevision,busy:false,rows,catalog,preview,fingerprint:boardImportFingerprint(preview)};return boardImportState;},
      prepareImport(rows){const catalog={users:state.users,existingGroups:state.groups,boards:state.boards},academicYear=BancaAcademicYears.newGroupYear(state.academicYear),preview=parseAcademicExcelRows(rows,catalog,'',academicYear);excelImportState={uid:state.user.uid,revision:accessRevision,academicYear,busy:false,rows,defaultCourse:'',catalog,preview,fingerprint:excelPreviewFingerprint(preview)};return excelImportState;},
      buildEvaluationPdf: typeof buildEvaluationPdf === 'function' ? buildEvaluationPdf : null };
  `, context, { filename: 'index.html.inline-module.js' });
  const app = context.appTest;
  Object.assign(app.state, clone(data), { user: authUser, profile: clone(data.users[uid]), connected: true });
  const runTimeouts = (maxDelay=Infinity) => { for(const[id,timer]of [...pendingTimeouts])if(timer.delay<=maxDelay&&pendingTimeouts.delete(id))timer.callback(); };
  return { app, data, calls, options, elements, context, downloads: context.testDownloads, now: () => now, advance: ms => { now += ms; }, read, write, emit, emitError, runTimeouts, pendingTimeouts };
}

test('individual averages require all four valid grades, including valid zeroes', () => {
  const { app } = harness();
  assert.equal(app.mediaAvaliador(grade(10, 8, 6, 8)), 8);
  assert.equal(app.mediaAvaliador(grade(0, 0, 0, 0)), 0);
  for (const bad of [undefined, {}, grade(8, 8, 8, null), grade(11), grade(-1), grade(NaN), grade('8')]) {
    assert.equal(app.mediaAvaliador(bad), null);
  }
});

test('weighted result keeps every evaluator and applies the existing 60%/40% formula', () => {
  const { app, data } = harness();
  const result = app.resultadoAluno(data.boards.b1, 's1', data.grades.b1, data.deliveries.b1);
  assert.equal(result.banca, 7);
  assert.equal(result.entrega, 9);
  assert.equal(result.parcelaBanca, 4.2);
  assert.equal(result.parcelaEntrega, 3.6);
  assert.ok(Math.abs(result.final - 7.8) < 1e-12);
  assert.equal(app.resultadoAluno(data.boards.b1, 's2', data.grades.b1, data.deliveries.b1).final, 3);
});

test('missing individual or delivery grades prevent a final result and identify pending data', () => {
  const { app, data } = harness();
  delete data.grades.b1.t2.s1.code;
  delete data.deliveries.b1.s2;
  assert.equal(app.resultadoAluno(data.boards.b1, 's1', data.grades.b1, data.deliveries.b1), null);
  const status = app.situacao(data.boards.b1, data.groups.g1, data.grades.b1, data.deliveries.b1);
  assert.equal(status.pronta, false);
  assert.deepEqual(clone(status.pendencias), [{ aluno: 's1', membro: 't2', tipo: 'banca' }, { aluno: 's2', tipo: 'entregas' }]);
  assert.equal(app.situacao({ members: {} }, data.groups.g1, {}, data.deliveries.b1).pronta, false);
});

test('centiseconds truncate milliseconds and roll over seconds and minutes', () => {
  const { app } = harness();
  for (const [ms, display] of [[0, '00:00,00'], [9, '00:00,00'], [10, '00:00,01'], [999, '00:00,99'], [1000, '00:01,00'], [59999, '00:59,99'], [60000, '01:00,00'], [3723456, '62:03,45'], [-500, '00:00,00']]) {
    assert.equal(app.formatElapsed(ms), display);
  }
});

test('cancelling close or reopen performs no reads or writes', async () => {
  const h = harness(), { app } = h;
  h.options.confirm = false;
  await app.closeBoard('b1');
  await app.reopenBoard('b1');
  assert.equal(h.calls.confirmations.length, 2);
  assert.deepEqual(h.calls.reads, []);
  assert.deepEqual(h.calls.updates, []);
});

test('unsaved grade or delivery drafts block closing before confirmation', async () => {
  const h = harness(), { app } = h;
  app.state.drafts.set('grade/b1/s1', { presentation: '9', practice: '8', code: '6', time: '8' });
  await assert.rejects(app.closeBoard('b1'), /Salve as notas/);
  app.state.drafts.clear();
  app.state.drafts.set('delivery/b1/s1', { delivery: '10' });
  await assert.rejects(app.closeBoard('b1'), /Salve as notas/);
  assert.equal(h.calls.confirmations.length, 0);
  assert.equal(h.calls.updates.length, 0);
});

test('unassigned, disabled and unauthenticated users cannot close, reopen or control time', async () => {
  for (const uid of ['outsider', 'disabled', 't1']) {
    const h = harness(uid);
    if (uid === 't1') h.app.state.user = null;
    for (const action of [() => h.app.closeBoard('b1'), () => h.app.reopenBoard('b1'), () => h.app.controlTimer('b1', 'start')]) {
      await assert.rejects(action(), /Somente os avaliadores/);
    }
    assert.equal(h.calls.confirmations.length, 0);
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.calls.transactions.length, 0);
  }
});

test('status changes detect an already closed or reopened remote board', async () => {
  const h = harness(), { app } = h;
  h.write('seals/b1', { by: 't2', at: h.now() });
  await assert.rejects(app.closeBoard('b1'), /O estado da banca mudou/);
  h.write('seals/b1', null);
  await assert.rejects(app.reopenBoard('b1'), /O estado da banca mudou/);
  assert.equal(h.calls.updates.length, 0);
  assert.equal(app.state.busyBoards.has('b1'), false);
});

test('individual grading stays assigned to the signed-in evaluator and is blocked after close', async () => {
  const h = harness(), { app } = h;
  const form = { dataset: { gradeForm: 'b1', student: 's1' }, values: { presentation: '9', practice: '8', code: '7', time: '6' } };
  await app.saveGrade(form);
  assert.equal(h.calls.sets[0][0], 'grades/b1/t1/s1');
  assert.deepEqual(h.data.grades.b1.t2.s1, grade(6, 6, 6, 6));
  app.state.seals.b1 = { by: 't2', at: h.now() };
  await assert.rejects(app.saveGrade(form), /Banca não disponível/);
  app.state.seals.b1 = null;
  form.values.code = '';
  await assert.rejects(app.saveGrade(form), /Preencha todos os critérios/);
});

test('HTML report lists individual grades, weighted portions, final result and centiseconds', () => {
  const h = harness('coord'), { app } = h;
  app.state.seals.b1 = { by: 't1', at: h.now() };
  app.state.timers.b1 = { elapsedMs: 123456, startedAt: 0 };
  const report = app.reportHtml(['b1']);
  for (const text of ['Ana', 'Bruno', 'Professor Um', 'Professora Dois', '10,00', '7,00', '4,20', '3,60', '7,80', '02:03,45', 'Banca × 60%', 'Entregas × 40%']) assert.ok(report.includes(text), text);
  delete app.state.deliveries.b1.s1;
  assert.throws(() => app.reportHtml(['b1']), /notas pendentes/);
});

test('report refresh rejects an empty selection, an open board and reopening during reads', async () => {
  const h = harness('coord'), { app } = h;
  await assert.rejects(app.refreshReportData([]), /Não há bancas completas/);
  assert.equal(h.calls.reads.length, 0);
  await assert.rejects(app.refreshReportData(['b1']), /banca está aberta/);
  assert.deepEqual(h.calls.reads, ['seals/b1']);
  h.calls.reads.length = 0;
  h.write('seals/b1', { by: 't1', at: h.now() });
  h.data.grades.b1.t1.s1.code = 0;
  h.options.onRead = (path, reads) => {
    if (path === 'seals/b1' && reads.filter(item => item === path).length === 2) h.write(path, null);
  };
  await assert.rejects(app.refreshReportData(['b1']), /mudou durante a emissão/);
  assert.equal(app.state.grades.b1.t1.s1.code, 6);
  assert.equal(app.state.seals.b1, undefined);
});

test('report and delivery views remain coordinator-only actions', async () => {
  const { app } = harness();
  await assert.rejects(app.printReports(['b1']), /Acesso restrito/);
  assert.throws(() => app.exportCsv(['b1']), /Acesso restrito/);
});

test('native evaluation PDF includes individual grades, weighted totals and recorded centiseconds', async () => {
  const h = harness('coord'), { app } = h;
  app.state.seals.b1 = { by: 't1', at: h.now() };
  app.state.timers.b1 = { elapsedMs: 123456, startedAt: 0 };
  const blob = app.buildEvaluationPdf(['b1']);
  assert.equal(blob.type, 'application/pdf');
  const pdf = await blob.text();
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /%%EOF\s*$/);
  for (const text of ['Ana', 'Bruno', 'Professor Um', 'Professora Dois', '10,00', '7,00', '4,20', '3,60', '7,80', '02:03,45']) assert.ok(pdf.includes(text), text);
  assert.ok(!pdf.includes('Agenda de bancas confirmadas'));
  assert.match(pdf, /\/Type \/Pages \/Count [1-9]\d*/);
});

test('native evaluation PDF supports legacy data and blocks open, incomplete or unauthorized reports', async () => {
  const h = harness('coord'), { app } = h;
  assert.throws(() => app.buildEvaluationPdf(['b1']), /bancas concluídas/);
  app.state.seals.b1 = { by: 't1', at: h.now() };
  const legacy = await app.buildEvaluationPdf(['b1']).text();
  assert.ok(legacy.includes('N\\343o registrado'));
  delete app.state.deliveries.b1.s1;
  assert.throws(() => app.buildEvaluationPdf(['b1']), /notas pendentes/);
  assert.throws(() => harness().app.buildEvaluationPdf(['b1']), /Somente a coordenação/);
  assert.throws(() => app.buildEvaluationPdf([]), /pelo menos uma banca/);
});

test('elapsed timer uses server offset, paused duration and sealed cutoff', () => {
  const h = harness(), { app } = h;
  app.state.serverOffset = 500;
  app.state.timers.b1 = { elapsedMs: 1234, startedAt: h.now() - 3000 };
  assert.equal(app.boardElapsed('b1'), 4734);
  app.state.seals.b1 = { by: 't2', at: h.now() - 1000 };
  assert.equal(app.boardElapsed('b1'), 3234);
  h.advance(60000);
  assert.equal(app.boardElapsed('b1'), 3234);
  assert.equal(app.elapsedAt({ elapsedMs: 1234, startedAt: 0 }), 1234);
});

test('shared timer starts, pauses and resumes without losing milliseconds', async () => {
  const h = harness(), { app } = h;
  await app.controlTimer('b1', 'start');
  assert.equal(h.data.timers.b1.startedAt, h.now());
  h.advance(12345);
  await app.controlTimer('b1', 'pause');
  assert.equal(h.data.timers.b1.elapsedMs, 12345);
  assert.equal(h.data.timers.b1.startedAt, 0);
  h.advance(10000);
  await app.controlTimer('b1', 'start');
  h.advance(555);
  assert.equal(app.boardElapsed('b1'), 12900);
  await app.controlTimer('b1', 'pause');
  assert.equal(h.data.timers.b1.elapsedMs, 12900);
  assert.equal(h.data.timers.b1.revision, 4);
  assert.ok(h.calls.transactions.every(call => call.config.applyLocally === false));
});

test('transaction retries respect another evaluator already starting or pausing', async () => {
  const h = harness(), { app } = h;
  h.options.transactionRetries = [null, { elapsedMs: 500, startedAt: h.now(), revision: 3 }];
  await app.controlTimer('b1', 'start');
  assert.equal(h.read('timers/b1'), undefined);
  h.options.transactionRetries = [{ elapsedMs: 0, startedAt: h.now() - 5000, revision: 3 }, { elapsedMs: 5000, startedAt: 0, revision: 4 }];
  await app.controlTimer('b1', 'pause');
  assert.equal(h.read('timers/b1'), undefined);
  assert.equal(app.state.busyBoards.has('b1'), false);
});

test('reset and status cancellation leave every saved grade untouched', async () => {
  const h = harness(), { app } = h;
  const saved = clone(h.data.grades);
  h.write('timers/b1', { elapsedMs: 12345, startedAt: 0, revision: 1 });
  h.options.confirm = false;
  await app.controlTimer('b1', 'reset');
  assert.equal(h.calls.transactions.length, 0);
  assert.equal(h.data.timers.b1.elapsedMs, 12345);
  h.options.confirm = true;
  await app.controlTimer('b1', 'reset');
  assert.equal(h.data.timers.b1.elapsedMs, 0);
  assert.deepEqual(h.data.grades, saved);
});

test('assigned teacher closes atomically, freezes time and another teacher reopens without deleting grades', async () => {
  const h = harness(), { app } = h;
  const original = clone(h.data.grades);
  h.write('timers/b1', { elapsedMs: 12345, startedAt: h.now() - 1555, revision: 2 });
  await app.closeBoard('b1');
  assert.equal(h.data.seals.b1.by, 't1');
  assert.equal(h.data.timers.b1.elapsedMs, 13900);
  assert.equal(h.data.timers.b1.startedAt, 0);
  assert.deepEqual(Object.keys(h.calls.updates[0]).sort(), ['seals/b1', 'timers/b1']);
  app.state.user.uid = 't2'; app.state.profile = clone(h.data.users.t2);
  await app.reopenBoard('b1');
  assert.equal(h.data.seals.b1, undefined);
  assert.equal(h.data.timers.b1.elapsedMs, 13900);
  assert.equal(h.data.timers.b1.startedAt, 0);
  assert.deepEqual(h.data.grades, original);
});

test('coordinator may close incomplete board then reopen to finish delivery grades', async () => {
  const h = harness('coord'), { app } = h;
  delete h.data.deliveries.b1.s1; delete app.state.deliveries.b1.s1;
  await app.closeBoard('b1');
  assert.equal(h.data.seals.b1.by, 'coord');
  await assert.rejects(app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}}),/Banca já concluída/);
  await app.reopenBoard('b1');
  await app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}});
  assert.equal(h.data.deliveries.b1.s1, 9.5);
  await assert.rejects(harness().app.saveDelivery({dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'9.5'}}),/Acesso restrito/);
});

test('reopening does not discard a draft made before another evaluator closed', async () => {
  const h = harness(), { app } = h;
  const draft = { presentation:'9',practice:'8',code:'6',time:'8' };
  app.state.drafts.set('grade/b1/s1',draft);
  h.write('seals/b1',{by:'t2',at:h.now()});app.state.seals.b1=clone(h.data.seals.b1);
  await app.reopenBoard('b1');
  assert.equal(h.data.seals.b1,undefined);
  assert.deepEqual(clone(app.state.drafts.get('grade/b1/s1')),draft);
});

test('offline, sealed and failed writes do not fabricate state or leave actions busy', async () => {
  const h = harness(), { app } = h;
  app.state.connected=false;
  await assert.rejects(app.closeBoard('b1'),/Conecte-se/);
  await assert.rejects(app.controlTimer('b1','start'),/Conecte-se/);
  app.state.connected=true;app.state.seals.b1={by:'t2',at:h.now()};
  await assert.rejects(app.controlTimer('b1','start'),/Reabra/);
  app.state.seals.b1=null;
  h.options.updateError=Error('permission-denied');
  await assert.rejects(app.closeBoard('b1'),/permission-denied/);
  assert.equal(app.state.seals.b1,undefined);
  assert.equal(app.state.busyBoards.has('b1'),false);
  h.options.transactionError=Error('offline');
  await assert.rejects(app.controlTimer('b1','start'),/offline/);
  assert.equal(app.state.busyBoards.has('b1'),false);
});

test('official snapshot includes every individual note and exact weighted totals from refreshed data', async () => {
  const h=harness('coord'),{app}=h;
  h.write('seals/b1',{by:'t1',at:h.now()});h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  const result=await app.createBoardShareSnapshot('b1');
  assert.equal(result.scope,'official');assert.equal(result.students.length,2);
  assert.equal(result.students[0].evaluators.length,2);
  assert.ok(Math.abs(result.students[0].result.final-7.8)<1e-12);
  assert.equal(result.elapsedMs,123456);
  app.assertShareSnapshotCurrent(result);
  const message=app.buildBoardShareText(result);
  for(const text of ['Ana','Bruno','Professor Um','Professora Dois','Apresentação: 10,00','Média da banca (0–10): 7,00','Banca × 60% (0–6): 4,20','Entregas × 40% (0–4): 3,60','Nota final (0–10): 7,80','02:03,45'])assert.ok(message.includes(text),text);
  assert.equal(new URL(app.whatsappTextUrl(message)).searchParams.get('text'),message);
  const pdf=await app.buildSharePdf(result).text();
  for(const text of ['Ana','Bruno','4,20','3,60','7,80','02:03,45'])assert.ok(pdf.includes(text),text);
});

test('teacher single-student snapshot works when another student is pending and never reads other grades or deliveries', async () => {
  const h=harness(),{app}=h;
  delete h.data.grades.b1.t1.s2;
  h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  const result=await app.createBoardShareSnapshot('b1',{studentId:'s1'});
  assert.equal(result.scope,'teacher');assert.equal(result.students.length,1);
  assert.equal(result.students[0].name,'Ana');assert.equal(result.students[0].evaluators.length,1);
  assert.equal(result.students[0].evaluators[0].uid,'t1');assert.equal(result.students[0].result,null);
  assert.deepEqual(h.calls.reads.sort(),['grades/b1/t1','seals/b1','timers/b1']);
  const message=app.buildBoardShareText(result),pdf=await app.buildSharePdf(result).text();
  assert.ok(message.includes('parcial'));assert.ok(message.includes('Apresentação: 10,00'));
  for(const leak of ['Professora Dois','Bruno','Entregas (0–10)','Nota final (0–10)']){assert.ok(!message.includes(leak),leak);assert.ok(!pdf.includes(leak),leak);}
  assert.ok(pdf.includes('PARCIAL'));
  await assert.rejects(app.createBoardShareSnapshot('b1'),/quatro notas de Bruno/);
});

test('share preparation blocks official open/incomplete results, unsaved work, offline and unknown students', async () => {
  const h=harness('coord'),{app}=h;
  await assert.rejects(app.createBoardShareSnapshot('b1'),/banca está aberta/);
  h.write('seals/b1',{by:'t1',at:h.now()});delete h.data.deliveries.b1.s1;
  await assert.rejects(app.createBoardShareSnapshot('b1'),/todas as notas completas/);
  app.state.connected=false;await assert.rejects(app.createBoardShareSnapshot('b1'),/Conecte-se/);
  app.state.connected=true;await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'missing'}),/Aluno não encontrado/);
  app.state.drafts.set('delivery/b1/s1',{delivery:'8'});
  await assert.rejects(app.createBoardShareSnapshot('b1'),/Salve as notas/);
});

test('share fingerprints reject edited grades, timer, reopened status and another session', async () => {
  const h=harness('coord'),{app}=h;
  h.write('seals/b1',{by:'t1',at:h.now()});h.write('timers/b1',{elapsedMs:123456,startedAt:0,revision:1});
  for(const change of [()=>app.state.grades.b1.t1.s1.presentation=1,()=>app.state.timers.b1.elapsedMs++,()=>app.state.seals.b1=null]){
    const result=await app.createBoardShareSnapshot('b1');change();assert.throws(()=>app.assertShareSnapshotCurrent(result),/mudaram/);
  }
  const result=await app.createBoardShareSnapshot('b1');app.state.user.uid='t2';
  assert.throws(()=>app.assertShareSnapshotCurrent(result),/sessão mudou/);
});

test('account changes during asynchronous refresh cannot produce another account snapshot', async () => {
  const h=harness(),{app}=h;
  h.options.onRead=()=>{app.state.user.uid='t2';};
  await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'s1'}),/sessão mudou/);
});

test('snapshot uses refreshed group metadata and rejects a student removed during preparation', async () => {
  const h=harness(),{app}=h;
  h.options.onRead=()=>{app.state.groups.g1={...app.state.groups.g1,title:'Título atualizado',students:{s1:'Ana atualizada',s2:'Bruno'}};};
  const snapshot=await app.createBoardShareSnapshot('b1',{studentId:'s1'});
  assert.equal(snapshot.projectTitle,'Título atualizado');
  assert.equal(snapshot.students[0].name,'Ana atualizada');
  app.assertShareSnapshotCurrent(snapshot);
  h.options.onRead=()=>{app.state.groups.g1={...app.state.groups.g1,students:{s2:'Bruno'}};};
  await assert.rejects(app.createBoardShareSnapshot('b1',{studentId:'s1'}),/Aluno não encontrado/);
});

function adminForm(values,dataset={}){
  return{values,dataset,querySelector:()=>({disabled:false}),querySelectorAll:()=>[],reset(){this.wasReset=true;}};
}
function groupForm(draft){
  return{dataset:{},elements:{namedItem:name=>({value:draft[name]||''})},querySelectorAll:selector=>selector==='[data-group-student]'?draft.students.map(student=>({dataset:{groupStudent:student.sid},querySelector:()=>({value:student.name})})):[]};
}
const newGroupDraft=()=>({name:'Grupo do novo curso',className:'1A',courseName:'Redes de Computadores',title:'Rede segura',advisorUid:'t1',students:[{sid:'s1',name:'Carla'},{sid:'s2',name:'Daniel'}]});
const importRows=()=>[['Curso','Turma','Grupo','Título','Orientador','Aluno'],['Engenharia','1E','Grupo novo','Sensores','one@example.test','Carla'],['Engenharia','1E','Grupo novo','Sensores','one@example.test','Daniel']];

test('only active coordinators manage access profiles; teachers and inactive sessions cannot manage groups or coordinators',async()=>{
  for(const scenario of ['teacher','inactive','no-session']){
    const h=harness(scenario==='teacher'?'t1':'coord');
    if(scenario==='inactive')h.app.state.profile.active=false;
    if(scenario==='no-session')h.app.state.user=null;
    await assert.rejects(h.app.addTeacher(adminForm({name:'Nova',email:'new@example.test',key:'nova',method:'new',password:'strongpass',role:'coordinator'})),/coordena|permissão|acesso|Somente/i);
    await assert.rejects(h.app.changeTeacherAccess('t2',false),/coordena|permissão|acesso|Somente/i);
    await assert.rejects(h.app.saveGroup(groupForm(newGroupDraft())),/coordena|restrito|Somente/i);
    await assert.rejects(h.app.changeGroupAccess('g1',false),/coordena|restrito|Somente/i);
    assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
  }
});

test('new teacher uses a secondary Auth account and preserves the coordinator session and stored data',async()=>{
  const h=harness('coord'),before=clone(h.data),form=adminForm({name:'  Nova Docente  ',email:'NOVA@EXAMPLE.TEST',key:'nova',method:'new',password:'strongpass'});
  await h.app.addTeacher(form);
  assert.equal(h.data.users['new-teacher'].name,'Nova Docente');assert.equal(h.data.users['new-teacher'].email,'nova@example.test');assert.equal(h.data.users['new-teacher'].role,'teacher');
  assert.equal(h.app.state.user.uid,'coord');assert.equal(h.calls.authCreates.length,1);assert.equal(h.calls.authDeletes.length,0);
  assert.equal(form.wasReset,true);assert.equal(h.app.state.teacherBusy,false);
  assert.equal('password'in h.data.users['new-teacher'],false);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
});

test('teacher creation checks fresh duplicates before Auth and rolls back only its own account on profile collision',async()=>{
  const values={name:'Nova',email:'new@example.test',key:'nova',method:'new',password:'strongpass'};
  const duplicate=harness('coord');duplicate.data.users.hidden={name:'Outra',email:'new@example.test',key:'other',role:'teacher',active:true};
  await assert.rejects(duplicate.app.addTeacher(adminForm(values)),/Já existe/);assert.equal(duplicate.calls.authCreates.length,0);
  const conflict=harness('coord');conflict.options.transactionRetries=[{name:'Cadastro concorrente',email:'concurrent@example.test',key:'other',role:'teacher',active:true}];
  await assert.rejects(conflict.app.addTeacher(adminForm(values)),/outra janela/);
  assert.deepEqual(conflict.calls.authDeletes,['new-teacher']);assert.equal(conflict.app.state.teacherBusy,false);assert.equal(conflict.data.users['new-teacher'],undefined);
  const existing=harness('coord');await existing.app.addTeacher(adminForm({...values,method:'existing',uid:'linked-uid'}));
  assert.equal(existing.calls.authCreates.length,0);assert.equal(existing.data.users['linked-uid'].role,'teacher');
});

test('teacher edit changes name/contact only and retains login identity and historical evaluator labels',async()=>{
  const h=harness('coord'),{app}=h;app.startTeacherEdit('t1');
  await app.saveTeacherEdit(adminForm({name:' Nome Atualizado ',contactEmail:'CONTATO@EXAMPLE.TEST'},{teacherUid:'t1'}));
  assert.equal(h.data.users.t1.name,'Nome Atualizado');assert.equal(h.data.users.t1.contactEmail,'contato@example.test');
  assert.equal(h.data.users.t1.email,'one@example.test');assert.equal(h.data.users.t1.key,'one');assert.equal(h.data.users.t1.role,'teacher');
  assert.equal(h.data.boards.b1.memberNames.t1,'Professor Um');assert.equal(h.data.grades.b1.t1.s1.presentation,10);
  const data=new h.context.FormData({values:{name:'Nome',email:'new@example.test'}});
  assert.throws(()=>app.teacherEditIdentity(data,h.data.users.t1),/não podem ser alterados/);
});

test('teacher edit detects stale profiles and disabling preserves open board history',async()=>{
  const h=harness('coord'),{app}=h;app.startTeacherEdit('t1');h.data.users.t1.name='Mudou em outra janela';
  await assert.rejects(app.saveTeacherEdit(adminForm({name:'Sobrescrever',contactEmail:''},{teacherUid:'t1'})),/outra janela/);
  assert.equal(h.data.users.t1.name,'Mudou em outra janela');
  app.state.boards={};const preserved=academicSnapshot(h);await app.changeTeacherAccess('t1',false);assert.equal(h.data.users.t1.active,false);assert.deepEqual(academicSnapshot(h),preserved);await app.changeTeacherAccess('t1',true);
  h.write('seals/b1',{by:'coord',at:h.now()});const grades=clone(h.data.grades);
  await app.changeTeacherAccess('t1',false);assert.equal(h.data.users.t1.active,false);assert.deepEqual(h.data.grades,grades);
  await app.changeTeacherAccess('t1',true);assert.equal(h.data.users.t1.active,true);assert.equal(h.data.users.t1.disabledAt,undefined);
});

test('manual group creation for another course appends stable student identities without modifying existing evaluations',async()=>{
  const h=harness('coord'),before=clone(h.data);h.app.resetGroupAdmin();
  await h.app.saveGroup(groupForm(newGroupDraft()));
  assert.equal(h.data.groups['new-group'].courseName,'Redes de Computadores');assert.deepEqual(h.data.groups['new-group'].students,{s1:'Carla',s2:'Daniel'});
  assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
});

test('group validation rejects inactive advisors, duplicate names and unsafe student IDs',()=>{
  const {app}=harness('coord');
  for(const change of [draft=>draft.advisorUid='disabled',draft=>draft.students[1].name='Cárla',draft=>draft.students[0].sid='invalid/id',draft=>draft.students=[]]){
    const draft=newGroupDraft();change(draft);assert.throws(()=>app.validatedGroupDraft(draft),/orientador|mesmo nome|identificadores|1 a 20/);
  }
});

test('manual addition does not duplicate an existing or archived course/class/group identity',async()=>{
  const h=harness('coord'),draft={...newGroupDraft(),academicYear:2026};h.data.groups.old={id:'old',...draft,students:{s1:'Outra pessoa'},active:false};h.app.resetGroupAdmin();
  await assert.rejects(h.app.saveGroup(groupForm(draft)),/já existe|já cadastrado|cadastrado|duplicado/i);
  assert.equal(h.calls.sets.length,0);assert.equal(h.data.groups.old.active,false);
});

test('scheduled group metadata stays protected while closed groups can be archived and restored without data deletion',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data);
  assert.throws(()=>app.editGroup('g1'),/já possui uma banca/);
  await assert.rejects(app.changeGroupAccess('g1',false),/banca em aberto/);
  h.write('seals/b1',{by:'coord',at:h.now()});await app.changeGroupAccess('g1',false);
  assert.equal(h.data.groups.g1.active,false);assert.deepEqual(h.data.groups.g1.students,before.groups.g1.students);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
  await app.changeGroupAccess('g1',true);assert.equal(h.data.groups.g1.active,true);
});

test('unscheduled group edit keeps student IDs and refuses a fresh schedule or concurrent metadata change',async()=>{
  const h=harness('coord'),{app}=h;
  const group={id:'g2',name:'Grupo sem banca',className:'2A',courseName:'ADS',title:'Antes',advisorUid:'t1',students:{s10:'Carla',s20:'Daniel'},active:true};
  h.write('groups/g2',group);app.state.groups.g2=clone(group);app.resetGroupAdmin();app.editGroup('g2');
  await app.saveGroup(groupForm({...newGroupDraft(),students:[{sid:'s10',name:'Carla Atualizada'},{sid:'s20',name:'Daniel'}]}));
  assert.deepEqual(h.data.groups.g2.students,{s10:'Carla Atualizada',s20:'Daniel'});
  app.editGroup('g2');h.write('boards/b2',{groupId:'g2',members:{t1:true,t2:true}});
  await assert.rejects(app.saveGroup(groupForm(newGroupDraft())),/recebeu uma banca/);
  h.write('boards/b2',null);app.editGroup('g2');h.data.groups.g2.title='Concorrente';
  await assert.rejects(app.saveGroup(groupForm(newGroupDraft())),/outra sessão/);
  assert.equal(h.data.groups.g2.title,'Concorrente');
});

test('Excel commit requires confirmation and appends groups atomically while preserving the existing catalog',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),session=app.prepareImport(importRows());
  h.options.confirm=false;await app.confirmExcelImport(session);assert.equal(h.calls.updates.length,0);
  h.options.confirm=true;await app.confirmExcelImport(session);
  assert.equal(h.data.groups['new-group'].courseName,'Engenharia');assert.deepEqual(h.data.groups['new-group'].students,{s001:'Carla',s002:'Daniel'});
  assert.equal(h.calls.updates.length,1);assert.deepEqual(Object.keys(h.calls.updates[0]),['groups/new-group']);assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);
});

test('Excel confirmation refreshes advisor/catalog and refuses stale previews or partial writes after errors',async()=>{
  const h=harness('coord'),{app}=h,session=app.prepareImport(importRows());h.data.users.t1.active=false;
  await assert.rejects(app.confirmExcelImport(session),/cadastro de grupos ou professores mudou/);assert.equal(h.calls.updates.length,0);
  h.data.users.t1.active=true;app.state.users.t1.active=true;const next=app.prepareImport(importRows());h.options.updateError=Error('permission-denied');
  await assert.rejects(app.confirmExcelImport(next),/permission-denied/);assert.equal(h.data.groups['new-group'],undefined);assert.ok(h.data.groups.g1);
});

test('CSV exports quote literal metadata and neutralize spreadsheet formula prefixes',()=>{
  const{app}=harness('coord');
  for(const value of ['=1+1',' +SUM(A1:A2)','-2+3','@SUM(A1:A2)','\tNome','\uFEFF=1'])assert.ok(app.csvCell(value).startsWith('"\''),value);
  assert.equal(app.csvCell('Ana "Silva"; Engenharia'),'"Ana ""Silva""; Engenharia"');
  assert.equal(app.csvCell('8,50'),'"8,50"');assert.equal(app.csvCell('Ana Silva'),'"Ana Silva"');
});

function installDateCatalog(h){
  const{app}=h,original=clone(h.data.boards.b1),group=clone(h.data.groups.g1),grades=clone(h.data.grades.b1),deliveries=clone(h.data.deliveries.b1);
  const entries=[['b1','DAY18','ADS','2A',18,true],['b2','DAY19','ADS','2A',19,true],['b3','ENGINEERING18','Engenharia','2A',18,true],['b4','CLASS3A18','ADS','3A',18,true],['b5','OTHERTEACHER18','ADS','2A',18,false]];
  const groups={},boards={},groupBoards={},allGrades={},allDeliveries={},seals={};
  entries.forEach(([bid,name,courseName,className,day,assigned],index)=>{
    const gid='g'+bid.slice(1);groups[gid]={...clone(group),id:gid,name,courseName,className};
    boards[bid]={...clone(original),groupId:gid,startAt:new Date(2026,9,day,10,index,0).getTime(),members:assigned?{t1:true,t2:true}:{t2:true,outsider:true}};
    groupBoards[gid]=bid;allGrades[bid]=assigned?clone(grades):{t2:clone(grades.t1),outsider:clone(grades.t2)};allDeliveries[bid]=clone(deliveries);seals[bid]={by:'coord',at:h.now()};
  });
  groups.unscheduled={...clone(group),id:'unscheduled',name:'NOTSCHEDULED',courseName:'ADS',className:'2A'};
  Object.assign(h.data,{groups,boards,groupBoards,grades:allGrades,deliveries:allDeliveries,seals});
  Object.assign(app.state,clone({groups,boards,groupBoards,grades:allGrades,deliveries:allDeliveries,seals}));
}

test('date filters combine course/class/day and keep teacher assignment boundaries',()=>{
  const h=harness('coord');installDateCatalog(h);const{app}=h;
  Object.assign(app.state,{courseFilter:'ADS',filter:'2A',boardDateFilter:'2026-10-18',reportCourseFilter:'ADS',reportFilter:'2A',reportDateFilter:'2026-10-18'});
  assert.deepEqual(clone(app.filteredBoards().map(([id])=>id)),['b1','b5']);
  assert.deepEqual(clone(app.filteredReportBoards().map(([id])=>id)),['b1','b5']);
  app.state.user={uid:'t1'};app.state.profile=clone(h.data.users.t1);
  assert.deepEqual(clone(app.filteredBoards().map(([id])=>id)),['b1']);
  assert.deepEqual(clone(app.filteredReportBoards()),[]);
  app.setBancaDateFilter('2026-10-19');assert.deepEqual(clone(app.filteredBoards().map(([id])=>id)),['b2']);
});

test('date selection validates calendar dates, clears predictably and resets all account filters',()=>{
  const{app}=harness('coord');
  app.setBancaDateFilter('2026-10-18');app.setBancaDateFilter('2028-02-29',true);
  for(const invalid of ['2026-02-29','2026-04-31','2026-13-01','18/10/2026'])assert.throws(()=>app.setBancaDateFilter(invalid),/data válida/);
  assert.equal(app.state.boardDateFilter,'2026-10-18');assert.equal(app.state.reportDateFilter,'2028-02-29');
  app.setBancaDateFilter('');assert.equal(app.state.boardDateFilter,'');assert.equal(app.state.reportDateFilter,'2028-02-29');
  app.state.courseFilter='ADS';app.state.reportCourseFilter='Engenharia';app.state.filter='2A';app.state.reportFilter='3A';app.resetAppData();
  for(const key of ['boardDateFilter','reportDateFilter'])assert.equal(app.state[key],'');
  for(const key of ['courseFilter','reportCourseFilter','filter','reportFilter'])assert.equal(app.state[key],'todas');
});

test('date-filtered consolidated readiness ignores unscheduled groups only for a selected day',()=>{
  const h=harness('coord');installDateCatalog(h);const{app}=h;
  Object.assign(app.state,{reportCourseFilter:'ADS',reportFilter:'2A',reportDateFilter:'2026-10-18'});
  assert.deepEqual(clone(app.reportGroups().map(group=>group.id)),['g1','g5']);
  assert.ok(!app.reportsView().match(/<button[^>]*data-print-all[^>]*>/)[0].includes('disabled'));
  app.setBancaDateFilter('',true);
  assert.ok(app.reportGroups().some(group=>group.id==='unscheduled'));
  assert.ok(app.reportsView().match(/<button[^>]*data-print-all[^>]*>/)[0].includes('disabled'));
  app.setBancaDateFilter('2026-10-18',true);app.state.seals.b5=null;
  assert.ok(app.reportsView().match(/<button[^>]*data-print-all[^>]*>/)[0].includes('disabled'));
});

test('date-filtered agenda export includes exactly the visible boards and changes no saved data',async()=>{
  const h=harness('coord');installDateCatalog(h);const{app}=h,before=clone(h.data);
  Object.assign(app.state,{courseFilter:'ADS',filter:'2A',boardDateFilter:'2026-10-18'});
  app.exportSchedulePdf(false);const pdf=await h.downloads[0].blob.text();
  for(const included of ['DAY18','OTHERTEACHER18'])assert.ok(pdf.includes(included),included);
  for(const excluded of ['DAY19','ENGINEERING18','CLASS3A18','NOTSCHEDULED'])assert.ok(!pdf.includes(excluded),excluded);
  assert.deepEqual(h.data,before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('official analytics require coordinator access even with complete data loaded',async()=>{
  const h=harness('t1'),{app}=h;
  app.state.seals.b1={by:'t1',at:h.now()};
  assert.equal(app.analyticsView(),'');
  assert.throws(()=>app.analyticsBoards(['b1']),/exclusivos da coordenação/);
  assert.throws(()=>app.buildAnalyticsPdf(['b1']),/exclusivos da coordenação/);
  await assert.rejects(app.printAnalytics(),/exclusivos da coordenação/);
  assert.equal(h.downloads.length,0);assert.equal(h.calls.reads.length,0);
});

test('analytics include only sealed complete boards, retain individual zeroes, and distinguish missing from zero time',()=>{
  const h=harness('coord');installDateCatalog(h);const{app}=h,before=clone(h.data);
  app.state.seals.b2=null;delete app.state.grades.b3.t2.s1.code;
  app.state.timers.b1={elapsedMs:0,startedAt:0};
  app.state.timers.b5={elapsedMs:123456,startedAt:0};
  const boards=app.analyticsBoards(['b1','b1','b2','b3','b4','b5','missing']);
  assert.deepEqual(clone(boards.map(board=>board.id)),['b1','b4','b5']);
  assert.equal(boards[0].elapsedMs,0);assert.equal(boards[1].elapsedMs,null);assert.equal(boards[2].elapsedMs,123456);
  assert.equal(boards[0].students.find(student=>student.id==='s2').evaluators[0].presentation,0);
  assert.ok(Math.abs(boards[0].students[0].result.final-7.8)<1e-12);
  const summary=h.context.BancaAnalytics.summary(boards);
  assert.equal(summary.timedCount,2);assert.equal(summary.meanElapsedMs,61728);
  assert.throws(()=>app.analyticsBoards(['b1','b2'],{strict:true}),/bancas encerradas/);
  assert.deepEqual(h.data,before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('analytics-only PDF refreshes selected date/course/class results and refuses stale reopened banks',async()=>{
  const h=harness('coord');installDateCatalog(h);const{app}=h;
  Object.assign(app.state,{reportCourseFilter:'ADS',reportFilter:'2A',reportDateFilter:'2026-10-18',analyticsBoard:'b1'});
  h.data.deliveries.b1.s1=10;
  await app.printAnalytics();
  assert.equal(h.downloads.length,1);assert.match(h.downloads[0].filename,/^graficos_bancas_/);
  const pdf=await h.downloads[0].blob.text();
  for(const text of ['%PDF-1.4','DAY18','Notas por banca','Tempo de apresenta','8,20','Professor Um'])assert.ok(pdf.includes(text),text);
  for(const excluded of ['DAY19','ENGINEERING18','CLASS3A18','OTHERTEACHER18','NOTSCHEDULED'])assert.ok(!pdf.includes(excluded),excluded);
  for(const path of ['seals/b1','grades/b1','deliveries/b1','timers/b1'])assert.ok(h.calls.reads.includes(path),path);
  assert.equal(h.calls.reads.some(path=>path.includes('/b5')),false,'one selected board stays private to its export');
  h.write('seals/b1',null);
  await assert.rejects(app.printAnalytics(),/banca está aberta/);assert.equal(h.downloads.length,1);
  assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('official reports optionally embed vector graphs and official individual shares contain only selected students',async()=>{
  const h=harness('coord'),{app}=h;
  h.write('seals/b1',{by:'coord',at:h.now()});app.state.seals.b1=clone(h.data.seals.b1);
  app.state.timers.b1={elapsedMs:123456,startedAt:0};h.write('timers/b1',app.state.timers.b1);
  const withCharts=await app.buildEvaluationPdf(['b1']).text(),withoutCharts=await app.buildEvaluationPdf(['b1'],{charts:false}).text();
  assert.ok(withCharts.includes('Notas por banca'));assert.ok(!withoutCharts.includes('Notas por banca'));
  for(const text of ['Ana','Bruno','Professor Um','Professora Dois','7,80'])assert.ok(withCharts.includes(text)&&withoutCharts.includes(text),text);
  const selected=await app.createBoardShareSnapshot('b1',{studentId:'s1'}),shared=await app.buildSharePdf(selected).text();
  assert.ok(shared.includes('Notas por banca'));assert.ok(shared.includes('Ana'));assert.ok(!shared.includes('Bruno'));
  assert.ok(!shared.includes('/Subtype /Image'),'chart output retains vector data and searchable text');
  app.state.reportCharts=false;await app.printReports(['b1']);
  assert.ok(!(await h.downloads.at(-1).blob.text()).includes('Notas por banca'));
});

test('teacher partial PDF never contains official chart sections and analytics preferences reset on account change',async()=>{
  const h=harness('t1'),{app}=h;
  const snapshot=await app.createBoardShareSnapshot('b1',{studentId:'s1'});
  snapshot.includeCharts=true;
  const pdf=await app.buildSharePdf(snapshot).text();
  for(const leaked of ['Notas por banca','Intervalo reservado','Professora Dois','Bruno'])assert.ok(!pdf.includes(leaked),leaked);
  app.state.analyticsBoard='b1';app.state.reportCharts=false;app.resetAppData();
  assert.equal(app.state.analyticsBoard,'');assert.equal(app.state.reportCharts,true);
});

test('analytics export aborts without a download when its date, course, class or board selection changes during refresh',async()=>{
  for(const [field,value] of [['reportDateFilter','2026-10-19'],['reportCourseFilter','Engenharia'],['reportFilter','3A'],['analyticsBoard','b5']]){
    const h=harness('coord');installDateCatalog(h);const{app}=h,before=clone(h.data);
    Object.assign(app.state,{reportCourseFilter:'ADS',reportFilter:'2A',reportDateFilter:'2026-10-18',analyticsBoard:'b1'});
    h.options.onRead=path=>{if(path==='grades/b1')app.state[field]=value;};
    await assert.rejects(app.printAnalytics(),/A seleção dos gráficos mudou durante a emissão/,field);
    assert.equal(h.downloads.length,0,field);assert.ok(h.calls.reads.includes('grades/b1'),field);
    assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0,field);
    assert.deepEqual(h.data,before,field);
  }
});


function installNotesCatalog(h){
  const {app}=h,baseBoard=clone(h.data.boards.b1),baseGroup=clone(h.data.groups.g1),baseGrades=clone(h.data.grades.b1),baseDelivery=clone(h.data.deliveries.b1);
  const catalog=[
    ['b1','g1','ABERTA_COMPLETA','ADS','2A','2026-10-18',false,false],
    ['b2','g2','ENCERRADA_HISTORICA','Engenharia','3A','2026-10-19',true,true],
    ['b3','g3','ABERTA_PENDENTE','ADS','2A','2026-10-18',false,false],
    ['b4','g4','ENCERRADA_PENDENTE','Redes','4A','2026-10-20',true,false]
  ];
  const data={groups:{},boards:{},groupBoards:{},grades:{},deliveries:{},seals:{}};
  for(const [id,gid,name,courseName,className,day,sealed,archived]of catalog){
    data.groups[gid]={...clone(baseGroup),id:gid,name,courseName,className,active:!archived};
    data.boards[id]={...clone(baseBoard),groupId:gid,startAt:Date.parse(day+'T15:00:00Z')};
    data.groupBoards[gid]=id;data.grades[id]=clone(baseGrades);data.deliveries[id]=clone(baseDelivery);
    if(sealed)data.seals[id]={by:'coord',at:h.now()};
  }
  data.boards.b2.members={t1:true,disabled:true};data.boards.b2.memberNames={t1:'Professor Um',disabled:'Professor Histórico'};
  data.grades.b2.disabled=data.grades.b2.t2;delete data.grades.b2.t2;
  delete data.grades.b3.t2.s1.code;delete data.deliveries.b3.s2;
  data.grades.b4={};data.deliveries.b4={};
  Object.assign(h.data,clone(data));Object.assign(app.state,clone(data));
}

test('coordinator sees every evaluator grade, zeroes and 60/40 results without being a board member',()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),record=app.coordinatorBoardRecord('b1');
  assert.equal(record.id,'b1');assert.equal(record.expectedGrades,4);assert.equal(record.completedGrades,4);assert.equal(record.missingDeliveries,0);
  assert.equal(record.ready,true);assert.equal(record.sealed,false);
  const ana=record.students.find(student=>student.id==='s1'),bruno=record.students.find(student=>student.id==='s2');
  assert.deepEqual(clone(ana.evaluators.map(item=>[item.uid,item.name,item.mean,item.completedCriteria])),[['t1','Professor Um',8,4],['t2','Professora Dois',6,4]]);
  assert.deepEqual(clone(ana.evaluators[0].scores),grade(10,8,6,8));
  assert.equal(ana.banca,7);assert.equal(ana.entrega,9);assert.ok(Math.abs(ana.result.final-7.8)<1e-12);assert.equal(ana.provisional,true);
  assert.equal(bruno.evaluators[0].mean,0);assert.equal(bruno.entrega,0);assert.equal(bruno.banca,5);assert.equal(bruno.result.final,3);
  app.state.selectedBoard='b1';const detail=app.gradeView();
  for(const visible of ['Ana','Bruno','Professor Um','Professora Dois','7,80','0,00'])assert.ok(detail.includes(visible),visible);
  assert.ok(detail.includes('notes-table'));assert.ok(!detail.includes('data-grade-form='),'consultation must not edit another evaluator’s scores');
  assert.deepEqual(h.data,before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('coordinator consultation exposes partial criteria and delivery gaps without inventing averages or final results',()=>{
  const h=harness('coord'),{app}=h;
  delete app.state.grades.b1.t2.s1.code;delete app.state.deliveries.b1.s2;
  let record=app.coordinatorBoardRecord('b1');
  assert.equal(record.expectedGrades,4);assert.equal(record.completedGrades,3);assert.equal(record.missingDeliveries,1);assert.equal(record.ready,false);
  const ana=record.students.find(student=>student.id==='s1'),bruno=record.students.find(student=>student.id==='s2');
  assert.equal(ana.evaluators[1].completedCriteria,3);assert.equal(ana.evaluators[1].mean,null);
  assert.equal(ana.evaluators[1].scores.presentation,6);assert.equal(ana.banca,null);assert.equal(ana.result,null);
  assert.equal(bruno.banca,5);assert.equal(bruno.entrega,null);assert.equal(bruno.result,null);
  delete app.state.grades.b1.t1.s1;record=app.coordinatorBoardRecord('b1');
  assert.equal(record.completedGrades,2);assert.equal(record.students[0].evaluators[0].completedCriteria,0);
  assert.ok(/pendente/i.test(app.boardNotesHtml('b1')));
  app.state.seals.b1={by:'coord',at:h.now()};
  assert.equal(app.coordinatorBoardRecord('b1').sealed,true);assert.equal(app.coordinatorBoardRecord('b1').ready,false);
});

test('complete evaluator mean remains visible while a delivery is pending and final complete closed results are official',()=>{
  const{app,now}=harness('coord');delete app.state.deliveries.b1.s1;
  let student=app.coordinatorBoardRecord('b1').students.find(item=>item.id==='s1');
  assert.equal(student.banca,7);assert.equal(student.entrega,null);assert.equal(student.result,null);
  app.state.deliveries.b1.s1=9;app.state.seals.b1={by:'coord',at:now()};
  const record=app.coordinatorBoardRecord('b1');student=record.students.find(item=>item.id==='s1');
  assert.equal(record.ready,true);assert.equal(student.provisional,false);assert.ok(Math.abs(student.result.final-7.8)<1e-12);
  assert.equal(app.coordinatorBoardRecord('absent'),null);
});

test('all-notes filters include archived groups and historical disabled professors and stay independent of report filters',()=>{
  const h=harness('coord');installNotesCatalog(h);const{app}=h;
  Object.assign(app.state,{courseFilter:'NO_MATCH',reportCourseFilter:'NO_MATCH',filter:'NO_MATCH',reportFilter:'NO_MATCH',boardDateFilter:'2099-01-01',reportDateFilter:'2099-01-01'});
  assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b1','b3','b2','b4']);
  const historic=app.coordinatorBoardRecord('b2');assert.equal(historic.ready,true);
  assert.ok(historic.students[0].evaluators.some(item=>item.uid==='disabled'&&item.name==='Professor Histórico'));
  app.setNotesFilter('course','ADS');app.setNotesFilter('className','2A');app.setNotesFilter('date','2026-10-18');
  assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b1','b3']);
  app.setNotesFilter('status','pendentes');assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b3']);
  app.resetNotesFilters();app.setNotesFilter('status','encerradas');assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b2','b4']);
  app.setNotesFilter('status','abertas');assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b1','b3']);
  app.resetNotesFilters();app.setNotesFilter('status','pendentes');assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b3','b4']);
  app.resetNotesFilters();app.state.notesFilters.search='histórica';assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b2']);
  app.state.notesFilters.search='Professor Histórico';assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b2']);
  assert.equal(app.state.reportCourseFilter,'NO_MATCH');assert.equal(app.state.reportDateFilter,'2099-01-01');
});

test('all-notes filter reset and session reset remove prior coordinator selection and expanded content',()=>{
  const h=harness('coord'),{app}=h;installNotesCatalog(h);
  Object.assign(app.state.notesFilters,{course:'ADS',className:'2A',date:'2026-10-18',status:'pendentes',search:'Ana'});app.state.notesSearchDraft='Unsubmitted query';app.state.notesExpanded.add('b1');
  app.resetNotesFilters();
  assert.deepEqual(clone(app.state.notesFilters),{course:'todas',className:'todas',date:'',status:'todas',search:''});assert.equal(app.state.notesSearchDraft,'');
  assert.equal(app.state.notesExpanded.has('b1'),true,'resetting filters preserves intentional expansions');
  app.state.notesExpanded.add('b2');app.resetAppData();assert.equal(app.state.notesExpanded.size,0);
  assert.deepEqual(clone(app.state.notesFilters),{course:'todas',className:'todas',date:'',status:'todas',search:''});
});

test('coordinator all-notes HTML escapes stored text and only monograph controls are editable',()=>{
  const h=harness('coord'),{app}=h;
  app.state.groups.g1.name='<script>groupAttack()</script>';app.state.groups.g1.title='<img src=x onerror=titleAttack()>';
  app.state.groups.g1.students.s1='<svg onload=studentAttack()>';app.state.boards.b1.memberNames.t2='<img src=x onerror=teacherAttack()>';
  app.state.notesExpanded.add('b1');
  const rendered=app.allNotesView()+app.boardNotesHtml('b1');
  for(const literal of ['<script>groupAttack()','<img src=x onerror=titleAttack()','<svg onload=studentAttack()','<img src=x onerror=teacherAttack()'])assert.ok(!rendered.includes(literal),literal);
  for(const escaped of ['&lt;script&gt;groupAttack()','&lt;img src=x onerror=titleAttack()','&lt;svg onload=studentAttack()','&lt;img src=x onerror=teacherAttack()'])assert.ok(rendered.includes(escaped),escaped);
  assert.ok(!rendered.includes('data-grade-form='));assert.ok(rendered.includes('data-delivery-form='));
  assert.ok(app.navItems().some(([route,,title])=>route==='notas'&&title==='Todas as notas'));
});

test('teacher and unauthenticated direct calls cannot expose coordinator note records or all-notes navigation',()=>{
  for(const uid of ['t1','outsider']){
    const h=harness(uid),{app}=h;
    for(const unauthenticated of [false,true]){
      if(unauthenticated)app.state.user=null;
      assert.throws(()=>app.coordinatorBoardRecord('b1'),/coordenação/i);
      assert.equal(app.boardNotesHtml('b1'),'');
      assert.deepEqual(clone(app.filteredNotesBoards()),[]);
      const rendered=app.allNotesView();for(const privateText of ['Professora Dois','Ana','Bruno','7,80','notes-table'])assert.ok(!rendered.includes(privateText),privateText);
      assert.equal(app.navItems().some(([route])=>route==='notas'),false);
    }
  }
});


test('coordinator assigned to a board consults all notes while retaining forms only for their own evaluator scores',()=>{
  const h=harness('coord'),{app}=h;
  app.state.boards.b1.members.coord=true;app.state.boards.b1.memberNames.coord='Alberson';
  app.state.grades.b1.coord={s1:grade(10,10,10,10),s2:grade(0,0,0,0)};app.state.selectedBoard='b1';
  const rendered=app.gradeView();
  assert.equal((rendered.match(/data-grade-form="b1"/g)||[]).length,2,'one editable form per student, not per professor');
  for(const name of ['Alberson','Professor Um','Professora Dois'])assert.ok(app.boardNotesHtml('b1').includes(name),name);
  assert.ok(Math.abs(app.coordinatorBoardRecord('b1').students[0].banca-8)<1e-12);
  assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('all-notes filter validation rejects invalid calendar dates, unknown statuses and unauthorized mutation',()=>{
  const h=harness('coord'),{app}=h;
  app.setNotesFilter('date','2028-02-29');
  for(const invalid of ['2026-02-29','2026-04-31','2026-13-01','18/10/2026'])assert.throws(()=>app.setNotesFilter('date',invalid),/data válida/);
  assert.equal(app.state.notesFilters.date,'2028-02-29');
  assert.throws(()=>app.setNotesFilter('status','ALL'),/Situação/);assert.throws(()=>app.setNotesFilter('grades','ALL'),/Filtro/);
  assert.equal(app.state.notesFilters.status,'todas');
  app.state.profile=clone(h.data.users.t1);app.state.user={uid:'t1'};
  assert.throws(()=>app.setNotesFilter('date','2026-10-18'),/coordenação/);assert.equal(app.state.notesFilters.date,'2028-02-29');
});

test('coordinator consultation retains saved student and evaluator records when group metadata is unavailable',()=>{
  const h=harness('coord'),{app}=h;delete app.state.groups.g1;
  const record=app.coordinatorBoardRecord('b1');assert.equal(record.ready,false);
  assert.deepEqual(clone(record.students.map(student=>student.id)),['s1','s2']);assert.equal(record.completedGrades,4);
  assert.ok(app.boardNotesHtml('b1').includes('Cadastro do grupo indisponível'));
  assert.ok(app.boardNotesHtml('b1').includes('Professor Um'));assert.ok(app.boardNotesHtml('b1').includes('7,80'));
  assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b1']);
});


function installCoordinatorEvaluator(h){
  const {app}=h;
  h.data.boards.b1.members.coord=true;h.data.boards.b1.memberNames.coord='Alberson';
  h.data.grades.b1.coord={s1:grade(8,8,8,8),s2:grade(5,5,5,5)};
  h.data.groups.g2={...clone(h.data.groups.g1),id:'g2',name:'Banca sem Alberson'};
  h.data.boards.b2={...clone(h.data.boards.b1),groupId:'g2',startAt:100000};
  h.data.boards.b2.members={t1:true,t2:true};h.data.boards.b2.memberNames={t1:'Professor Um',t2:'Professora Dois'};
  h.data.grades.b2={t1:clone(h.data.grades.b1.t1),t2:clone(h.data.grades.b1.t2)};
  h.data.deliveries.b2=clone(h.data.deliveries.b1);
  Object.assign(app.state,clone(h.data));
}

test('own evaluation navigation includes only active signed-in board members in chronological order',()=>{
  const h=harness('coord'),{app}=h;installCoordinatorEvaluator(h);
  app.state.boards.b3={...clone(app.state.boards.b1),startAt:300000};
  app.state.boards.truthy={...clone(app.state.boards.b1),members:{coord:'true'}};
  app.state.boards.falseMember={...clone(app.state.boards.b1),members:{coord:false}};
  assert.deepEqual(clone(app.evaluatorBoards().map(([id])=>id)),['b3','b1']);
  assert.ok(app.navItems().some(([route,,title])=>route==='minhasavaliacoes'&&title==='Minhas avaliações'));
  const before=clone(h.data);
  app.state.selectedBoard='b2';const rendered=app.myEvaluationsView();
  assert.equal(app.state.selectedBoard,'b3','direct grading selects an assigned board when previous detail was unassigned');
  assert.ok(rendered.includes('data-grade-form="b3"'));
  assert.ok(!rendered.includes('value="b2"'),'own selector excludes consulted nonmember boards');
  assert.ok(!rendered.includes('value="truthy"'));
  app.state.profile.active=false;assert.deepEqual(clone(app.evaluatorBoards()),[]);
  app.state.profile.active=true;app.state.user=null;assert.deepEqual(clone(app.evaluatorBoards()),[]);
  assert.deepEqual(h.data,before,'opening own evaluations never changes board membership');
  assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('coordinator grading has own forms first and direct links preserve readonly all-board consultation',()=>{
  const h=harness('coord'),{app}=h;installCoordinatorEvaluator(h);
  app.state.selectedBoard='b1';const own=app.myEvaluationsView();
  assert.equal((own.match(/data-grade-form="b1"/g)||[]).length,2);
  assert.ok(own.includes('id="my-grade-heading"'));
  assert.ok(own.indexOf('data-grade-form="b1"')<own.indexOf('notes-table'),'editable own scores precede the readonly comparison');
  app.state.notesExpanded.add('b1');app.state.notesExpanded.add('b2');
  const screens=app.boardsView()+app.allNotesView()+app.reportsView();
  assert.ok(screens.includes('data-my-grades="b1"'));
  assert.ok(!screens.includes('data-my-grades="b2"'),'no grading shortcut for boards without coordinator membership');
  app.state.selectedBoard='b2';const detail=app.gradeView();
  assert.ok(detail.includes('notes-table'));
  assert.ok(!detail.includes('data-grade-form='));
  assert.equal(app.state.selectedBoard,'b2','coordinator can still consult unassigned boards');
  delete app.state.boards.b1.members.coord;
  const emptyOwn=app.myEvaluationsView();
  assert.ok(!emptyOwn.includes('data-grade-form='));assert.ok(!emptyOwn.includes('notes-table'),'no assignment does not fall back to all-board consultation');
});

test('Alberson saves his own criteria including zero and decimals without changing colleagues or deliveries',async()=>{
  const h=harness('coord'),{app}=h;installCoordinatorEvaluator(h);
  const otherGrades=clone(h.data.grades.b1),deliveries=clone(h.data.deliveries),boards=clone(h.data.boards);
  const form={dataset:{gradeForm:'b1',student:'s1'},values:{presentation:'0',practice:'9.5',code:'7,5',time:'8'}};
  await app.saveGrade(form);
  assert.equal(h.calls.sets[0][0],'grades/b1/coord/s1');
  assert.deepEqual(h.data.grades.b1.coord.s1,grade(0,9.5,7.5,8));
  assert.deepEqual(h.data.grades.b1.t1,otherGrades.t1);assert.deepEqual(h.data.grades.b1.t2,otherGrades.t2);
  assert.deepEqual(h.data.grades.b1.coord.s2,otherGrades.coord.s2);
  assert.deepEqual(h.data.deliveries,deliveries);assert.deepEqual(h.data.boards,boards);
  app.state.grades.b1.coord.s1=clone(h.data.grades.b1.coord.s1);
  const ownRecord=app.coordinatorBoardRecord('b1').students[0].evaluators.find(item=>item.uid==='coord');
  assert.deepEqual(clone(ownRecord.scores),grade(0,9.5,7.5,8));assert.equal(ownRecord.mean,6.25);
  const count=h.calls.sets.length;form.dataset.gradeForm='b2';
  await assert.rejects(app.saveGrade(form),/Banca não disponível/);assert.equal(h.calls.sets.length,count);
});

test('closed coordinator evaluations are locked until reopening then accept only their own saved notes',async()=>{
  const h=harness('coord'),{app}=h;installCoordinatorEvaluator(h);
  const sealed={by:'t1',at:h.now()};h.write('seals/b1',sealed);app.state.seals.b1=clone(sealed);
  app.state.selectedBoard='b1';const locked=app.myEvaluationsView();
  assert.ok(/disabled[^>]*value="8"/.test(locked),'own inputs show saved notes but remain locked');
  const form={dataset:{gradeForm:'b1',student:'s1'},values:{presentation:'9',practice:'9',code:'9',time:'9'}};
  await assert.rejects(app.saveGrade(form),/Banca não disponível/);assert.equal(h.calls.sets.length,0);
  const unchanged=clone(h.data.grades.b1.t1);await app.reopenBoard('b1');
  assert.equal(h.calls.confirmations.length,1);assert.equal(h.data.seals.b1,undefined);
  delete app.state.seals.b1;await app.saveGrade(form);
  assert.deepEqual(h.data.grades.b1.coord.s1,grade(9,9,9,9));assert.deepEqual(h.data.grades.b1.t1,unchanged);
});

function installCompleteCoordinatorCatalog(h){
  installNotesCatalog(h);
  h.data.groups.unassigned={id:'unassigned',name:'SEM_BANCA_GERAL',title:'Monografia sem agendamento',courseName:'Direito',className:'5A',students:{eva:'EVA_SEM_BANCA'},active:true};
  Object.assign(h.app.state,clone(h.data));
}

test('complete coordinator export includes every saved bank and unassigned student regardless of report or consultation filters',()=>{
  const h=harness('coord'),{app}=h;installCompleteCoordinatorCatalog(h);
  Object.assign(app.state,{courseFilter:'NO_MATCH',filter:'NO_MATCH',boardDateFilter:'2099-01-01',reportCourseFilter:'NO_MATCH',reportFilter:'NO_MATCH',reportDateFilter:'2099-01-01'});
  Object.assign(app.state.notesFilters,{course:'NO_MATCH',className:'NO_MATCH',date:'2099-01-01',status:'encerradas',search:'NO_MATCH'});
  const boards=app.coordinatorReportBoards();
  assert.equal(boards.filter(board=>!board.unassigned).length,4);
  assert.equal(boards.flatMap(board=>board.students).length,9);
  assert.ok(boards.some(board=>board.archived&&board.sealed));
  assert.ok(boards.some(board=>!board.sealed&&!board.unassigned));
  const unassigned=boards.find(board=>board.unassigned);assert.equal(unassigned.students[0].name,'EVA_SEM_BANCA');
  const partial=boards.find(board=>board.id==='b3');assert.ok(partial);
  assert.equal(partial.students.find(student=>student.id==='s1').evaluators.find(evaluator=>evaluator.uid==='t2').code,null);
  const zero=boards.find(board=>board.id==='b1').students.find(student=>student.id==='s2');
  assert.equal(zero.evaluators.find(evaluator=>evaluator.uid==='t1').presentation,0);assert.equal(zero.result.entrega,0);assert.equal(zero.result.final,3);
  assert.equal(app.state.notesFilters.course,'NO_MATCH');assert.equal(app.state.reportCourseFilter,'NO_MATCH');
  app.state.user={uid:'t1'};app.state.profile=clone(h.data.users.t1);assert.throws(()=>app.coordinatorReportBoards(),/coordena|restrito/i);
});

test('complete coordinator PDF keeps incomplete notes and monograph zero while official reports still require completion',async()=>{
  const h=harness('coord'),{app}=h;installCompleteCoordinatorCatalog(h);
  const before=clone(h.data);
  const blob=app.buildCoordinatorReportPdf(),pdf=await blob.text();
  assert.equal(blob.type,'application/pdf');assert.ok(pdf.startsWith('%PDF-1.4'));assert.match(pdf,/%%EOF\s*$/);
  for(const text of ['ABERTA_COMPLETA','ABERTA_PENDENTE','ENCERRADA_HISTORICA','ENCERRADA_PENDENTE','EVA_SEM_BANCA','Professor Um','Professor Hist','Pendente','0,00','Monografia','Todos os alunos'])assert.ok(pdf.includes(text),text);
  assert.ok(pdf.includes('7,80'),'provisional complete score remains distinguishable from pending values');
  assert.throws(()=>app.buildEvaluationPdf(['b1']),/bancas concluídas/);
  assert.throws(()=>app.buildEvaluationPdf(['b4']),/notas pendentes/);
  const charts=await app.buildCoordinatorReportPdf({chartsOnly:true}).text();assert.ok(charts.startsWith('%PDF-1.4'));
  const chartText=charts.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8))).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR');
  for(const marker of ['EVA_SEM_BANCA','Professor Um','Professora Dois','Apresentacao','pratica','codigo','tempo'])assert.ok(chartText.includes(marker.toLocaleLowerCase('pt-BR')),`chart PDF includes ${marker}`);
  assert.deepEqual(h.data,before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('coordinator global export refreshes the entire saved catalog and downloads PDF, CSV and chart files',async()=>{
  const h=harness('coord'),{app}=h;installCompleteCoordinatorCatalog(h);
  h.data.grades.b1.t1.s1.presentation=0;app.state.grades.b1.t1.s1.presentation=10;
  for(const kind of ['pdf','csv','charts'])await app.exportCoordinatorReport(kind);
  assert.equal(h.downloads.length,3);
  const roots=new Set(h.calls.reads);for(const root of ['users','groups','boards','grades','deliveries','seals','timers'])assert.ok(roots.has(root),root);
  assert.equal(app.state.grades.b1.t1.s1.presentation,0,'export uses fresh saved notes');
  for(const entry of h.downloads){const body=await entry.blob.text();assert.ok(body.includes('EVA_SEM_BANCA'));assert.ok(body.includes('ENCERRADA_HISTORICA'));}
  assert.equal(h.downloads.filter(entry=>entry.filename.endsWith('.pdf')).length,2);assert.equal(h.downloads.filter(entry=>entry.filename.endsWith('.csv')).length,1);
  assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('coordinator exports reject offline, pending drafts, unauthorized access and a changed session before download',async()=>{
  const offline=harness('coord');offline.app.state.connected=false;await assert.rejects(offline.app.exportCoordinatorReport('pdf'),/internet|conect/i);assert.equal(offline.downloads.length,0);
  const unsaved=harness('coord');unsaved.app.state.drafts.set('delivery/b1/s1',{delivery:'4'});await assert.rejects(unsaved.app.exportCoordinatorReport('csv'),/salv|rascunh/i);assert.equal(unsaved.downloads.length,0);
  const teacher=harness();await assert.rejects(teacher.app.exportCoordinatorReport('pdf'),/coordena|restrito/i);assert.equal(teacher.downloads.length,0);
  const changed=harness('coord');changed.options.onRead=()=>{changed.app.state.user={uid:'t1'};changed.app.state.profile=clone(changed.data.users.t1);};
  await assert.rejects(changed.app.exportCoordinatorReport('charts'),/sessão|acesso|coordena/i);assert.equal(changed.downloads.length,0);
});

test('coordinator monograph saving accepts zero only for an existing editable student and preserves evaluator notes',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data.grades),form={dataset:{deliveryForm:'b1',student:'s1'},values:{delivery:'0'}};
  await app.saveDelivery(form);assert.equal(h.data.deliveries.b1.s1,0);assert.deepEqual(h.data.grades,before);assert.equal(h.calls.sets[0][0],'deliveries/b1/s1');
  for(const change of [
    current=>{current.app.state.user=null;},
    current=>{current.app.state.connected=false;},
    current=>{current.app.state.groups.g1.active=false;},
    current=>{current.app.state.seals.b1={by:'coord',at:current.now()};},
    current=>{delete current.app.state.groups.g1.students.s1;},
    current=>{delete current.app.state.boards.b1;}
  ]){
    const current=harness('coord');change(current);await assert.rejects(current.app.saveDelivery(form));assert.equal(current.calls.sets.length,0);
  }
  const teacher=harness();await assert.rejects(teacher.app.saveDelivery(form),/restrito|coordena/i);assert.equal(teacher.calls.sets.length,0);
});

test('coordinator custom model weights criteria, evaluators and stages without changing official results or saved notes',()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),workbench=app.weightedWorkbench;
  workbench.setDraft(customWeightedModel());workbench.apply();
  const preview=workbench.viewData(),students=preview.previewBoards[0].students,ana=students.find(student=>student.id==='s1'),bruno=students.find(student=>student.id==='s2');
  assert.equal(ana.result.banca,7.875);assert.equal(ana.result.final,8.15625);assert.equal(bruno.result.final,1.875);
  assert.match(app.weightedReportsView(),/8,156/);assert.match(app.weightedReportsView(),/1,875/);
  const original=app.coordinatorReportBoards()[0].students.find(student=>student.id==='s1');assert.ok(Math.abs(original.result.final-7.8)<1e-12);
  workbench.setDraft({...customWeightedModel(),decimals:0});workbench.apply();assert.equal(workbench.viewData().previewBoards[0].students.find(student=>student.id==='s1').result.final,8.15625,'display precision never rounds the calculation');
  assert.deepEqual(h.data,before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
});

test('custom report models validate totals, save per coordinator and round-trip portable JSON',async()=>{
  const h=harness('coord'),workbench=h.app.weightedWorkbench;
  workbench.setDraft({...customWeightedModel(),boardWeight:70});assert.throws(()=>workbench.apply(),/100%/);
  await assert.rejects(workbench.exportReport('csv'),/prévia|alteraç|modelo/i);assert.equal(h.downloads.length,0);
  workbench.setDraft(customWeightedModel());workbench.apply();const saved=workbench.save();assert.equal(workbench.viewData().models.length,1);
  workbench.exportModel();const portable=JSON.parse(await h.downloads[0].blob.text());assert.equal(portable.format,'bancaflow-weighted-model');assert.equal(portable.model.boardWeight,75);
  workbench.resetModel();assert.equal(workbench.viewData().model.boardWeight,60);
  await workbench.importModel({size:JSON.stringify(portable).length,text:async()=>JSON.stringify(portable)});assert.equal(workbench.viewData().model.name,'MODELO_INTEGRACAO');
  await assert.rejects(workbench.importModel({size:4,text:async()=>'{bad'}),/JSON/i);assert.equal(workbench.viewData().model.boardWeight,75);
  workbench.reset();h.app.state.user={uid:'coord2'};h.app.state.profile={name:'Outra coordenação',role:'coordinator',active:true};assert.equal(workbench.viewData().models.length,0);
  workbench.reset();h.app.state.user={uid:'coord'};h.app.state.profile=clone(h.data.users.coord);assert.equal(workbench.viewData().models.length,1);workbench.selectModel(saved.id);assert.equal(workbench.viewData().model.criteriaWeights.presentation,50);
  workbench.reset();h.app.state.user={uid:'t1'};h.app.state.profile=clone(h.data.users.t1);assert.throws(()=>workbench.viewData(),/coordena/i);await assert.rejects(workbench.exportReport('csv'),/coordena/i);assert.doesNotMatch(h.app.weightedReportsView(),/weighted-model-form/);
});

test('custom report exports refresh saved data and apply the selected model and student filter to PDF, CSV and charts',async()=>{
  const h=harness('coord'),workbench=h.app.weightedWorkbench,before=clone(h.data);
  workbench.setDraft(customWeightedModel());workbench.apply();workbench.setFilter('search','Ana');workbench.setReport({includeSummary:true,includeDetails:true,includeCharts:true,notes:'OBSERVACAO_INTEGRACAO'});
  for(const kind of ['pdf','csv','charts']){
    await workbench.exportReport(kind);const file=h.downloads.at(-1),content=await file.blob.text();
    assert.match(file.filename,kind==='csv'?/personalizado_.*\.csv$/:/personalizado_.*\.pdf$/);
    assert.match(content,/MODELO_INTEGRACAO/);assert.match(content,/Ana/);assert.doesNotMatch(content,/Bruno/);
    if(kind==='csv'){assert.match(content,/8,15625/);assert.match(content,/8,156/);}
    else{assert.match(content,/^%PDF-1\.4/);assert.match(content,/%%EOF\s*$/);assert.match(content,/75%/);}
  }
  for(const path of ['users','groups','boards','grades','deliveries','seals','timers'])assert.ok(h.calls.reads.includes(path),path);
  assert.equal(h.downloads.length,3);assert.deepEqual(h.data,before);
});

test('custom exports reject offline, unsaved grades and a changed session before producing any file',async()=>{
  const offline=harness('coord');offline.app.state.connected=false;await assert.rejects(offline.app.weightedWorkbench.exportReport('csv'),/conex|internet/i);assert.equal(offline.downloads.length,0);
  const unsaved=harness('coord');unsaved.app.state.drafts.set('delivery/b1/s1',{delivery:'4'});await assert.rejects(unsaved.app.weightedWorkbench.exportReport('pdf'),/salv|rascunh/i);assert.equal(unsaved.downloads.length,0);
  const stale=harness('coord');let release;stale.options.beforeRead=async path=>{if(path==='users')await new Promise(resolve=>release=resolve);};
  const exporting=stale.app.weightedWorkbench.exportReport('csv');await new Promise(setImmediate);stale.app.state.user={uid:'t1'};stale.app.state.profile=clone(stale.data.users.t1);release();await assert.rejects(exporting,/sessão|coordena|acesso/i);assert.equal(stale.downloads.length,0);
});

test('chat rooms include the common room and only assigned banks, with coordinator access and inactive/session guards',()=>{
  const teacher=harness(),{app}=teacher;
  app.state.boards.b2={...clone(app.state.boards.b1),members:{t2:true},groupId:'g2'};
  assert.deepEqual(Array.from(app.chatRooms(),room=>room.id),['geral','b1']);
  assert.match(app.chatView(),/Sala dos professores/);
  assert.throws(()=>app.openChatRoom('b2'),/acesso|sala/i);
  assert.throws(()=>app.openChatRoom('missing'),/acesso|sala/i);
  const coord=harness('coord');coord.app.state.boards=clone(app.state.boards);
  assert.deepEqual(Array.from(coord.app.chatRooms(),room=>room.id),['geral','b1','b2']);
  const disabled=harness('disabled');assert.equal(disabled.app.chatRooms().length,0);
  app.state.user=null;assert.equal(app.chatRooms().length,0);assert.match(app.chatView(),/restrito/i);
});

test('chat alert helpers observe only authorized rooms outside chat and retain separate mute preferences per account',async()=>{
  const h=harness(),{app}=h;app.state.route='inicio';app.state.boards.b2={...clone(app.state.boards.b1),members:{t2:true}};
  app.syncChatAlerts();
  assert.ok(h.calls.listens.includes('chatMessages/geral'));assert.ok(h.calls.listens.includes('chatMessages/b1'));assert.equal(h.calls.listens.includes('chatMessages/b2'),false);
  assert.equal(h.calls.notificationRequests,0,'starting alert observers never prompts for permission');
  await app.requestChatNotifications();assert.equal(h.calls.notificationRequests,1);assert.equal(app.getChatAlertsState().enabled,true);
  app.toggleChatMuted();assert.equal(app.getChatAlertsState().muted,true);
  app.stopChatAlerts();app.state.user={uid:'t2'};app.state.profile=clone(h.data.users.t2);app.syncChatAlerts();assert.equal(app.getChatAlertsState().muted,false);
  app.stopChatAlerts();app.state.user={uid:'t1'};app.state.profile=clone(h.data.users.t1);app.syncChatAlerts();assert.equal(app.getChatAlertsState().muted,true,'the original account keeps its saved preference');
  app.toggleChatMuted();assert.equal(app.getChatAlertsState().muted,false);
  app.stopChatAlerts();app.state.profile.active=false;const before=h.calls.listens.length;app.syncChatAlerts();assert.equal(h.calls.listens.length,before,'inactive accounts cannot restart message alerts');
});

test('floating chat survives navigation and minimizing preserves its room, draft and new-message badge',async()=>{
  const h=harness(),{app}=h;app.state.route='avaliar';app.state.selectedBoard='b1';app.state.drafts.set('grade/b1/s1',{presentation:'9,5'});
  h.data.chatMessages={b1:{saved:{uid:'t2',name:'Professora Dois',text:'Mensagem já recebida',at:h.now()-5000}}};
  app.syncChatAlerts();app.openChatRoom('b1');app.syncChat();await new Promise(setImmediate);
  assert.equal(app.state.route,'avaliar');assert.equal(app.state.selectedBoard,'b1');assert.equal(app.state.chatOpen,true);assert.equal(app.isChatVisible(),true);
  app.state.chatDrafts.set('b1','Pergunta ainda em edição');const reads=h.calls.listens.filter(path=>path==='chatMessages/b1').length;
  app.state.route='bancas';app.syncChat();assert.equal(app.state.chatOpen,true);assert.equal(app.state.chatRoom,'b1');assert.equal(h.calls.listens.filter(path=>path==='chatMessages/b1').length,reads);
  app.closeChatWidget();app.syncChat();assert.equal(app.state.chatOpen,false);assert.equal(app.isChatVisible(),false);assert.equal(app.state.chatRoom,'b1');assert.equal(app.state.chatDrafts.get('b1'),'Pergunta ainda em edição');
  h.write('chatMessages/b1/new',{uid:'t2',name:'Professora Dois',text:'Chegou enquanto minimizado',at:h.now()});h.emit('chatMessages/b1');
  assert.equal(app.getChatAlertsState().countByRoom.b1,1);
  app.toggleChatWidget();app.syncChat();assert.equal(app.state.route,'bancas');assert.equal(app.isChatVisible(),true);assert.equal(app.state.chatDrafts.get('b1'),'Pergunta ainda em edição');assert.equal(Object.keys(app.state.chatMessages).length,2);assert.equal(app.getChatAlertsState().countByRoom.b1??0,0);
  assert.equal(app.state.drafts.get('grade/b1/s1').presentation,'9,5');
  app.resetAppData();assert.equal(app.state.chatOpen,false);assert.equal(app.state.chatDrafts.size,0);
});

test('legacy registered teacher without active flag, login key or bank membership immediately uses general chat and presence',async()=>{
  const h=harness('legacy'),{app}=h,profile={name:'Docente já cadastrado',role:'teacher'};
  h.data.users.legacy=clone(profile);app.state.users.legacy=clone(profile);app.state.profile=clone(profile);
  const before=clone({users:h.data.users,boards:h.data.boards,grades:h.data.grades,deliveries:h.data.deliveries});
  assert.deepEqual(Array.from(app.chatRooms(),room=>room.id),['geral']);
  app.state.chatRoom='b1';app.openGeneralChat();app.syncChat();
  assert.equal(app.state.route,'inicio');assert.equal(app.state.chatOpen,true);assert.equal(app.isChatVisible(),true);assert.equal(app.state.chatRoom,'geral');assert.equal(app.state.chatError,'');
  await app.startChatPresence();await new Promise(setImmediate);
  await app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Já consigo participar.'}});
  const message=h.calls.sets.find(([path])=>path.startsWith('chatMessages/geral/'));
  assert.deepEqual(message[1],{uid:'legacy',name:profile.name,text:'Já consigo participar.',at:{'.sv':'timestamp'}});
  assert.ok(h.calls.sets.some(([path,value])=>path.startsWith('chatPresence/legacy/')&&value.name===profile.name&&value.role==='teacher'));
  assert.throws(()=>app.openChatRoom('b1'),/acesso|sala/i);
  assert.deepEqual({users:h.data.users,boards:h.data.boards,grades:h.data.grades,deliveries:h.data.deliveries},before,'chat access requires no migration, bank assignment or per-user authorization write');
});

test('Alberson creates a teacher whose first session has general chat without any bank or chat allowlist',async()=>{
  const h=harness('coord'),{app}=h;
  await app.addTeacher(adminForm({name:'Nova Professora',email:'nova-chat@example.test',key:'nova-chat',method:'new',password:'strongpass'}));
  const profile=clone(h.data.users['new-teacher']),before=clone({users:h.data.users,boards:h.data.boards,grades:h.data.grades,deliveries:h.data.deliveries});
  app.resetAppData();Object.assign(app.state,clone(h.data),{user:{uid:'new-teacher'},profile,connected:true});
  assert.deepEqual(Array.from(app.chatRooms(),room=>room.id),['geral']);
  app.openGeneralChat();app.syncChat();await new Promise(setImmediate);
  await app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Primeiro acesso ao chat.'}});
  assert.ok(h.calls.sets.some(([path,value])=>path.startsWith('chatMessages/geral/')&&value.uid==='new-teacher'&&value.name===profile.name));
  assert.ok(h.calls.sets.some(([path])=>path.startsWith('chatPresence/new-teacher/')));
  assert.deepEqual({users:h.data.users,boards:h.data.boards,grades:h.data.grades,deliveries:h.data.deliveries},before);
  for(const change of [()=>app.state.profile.active=false,()=>{app.state.profile=profile;app.state.user=null;}]){
    change();assert.equal(app.chatRooms().length,0);assert.throws(()=>app.openGeneralChat(),/acesso|restrito|sala|sessão/i);
  }
});

test('chat automatically reopens cancelled permission reads when authorization becomes available and cancels retries on logout',async()=>{
  const h=harness('outsider'),{app}=h;h.options.chatReadError=true;
  app.state.chatDrafts.set('geral','Rascunho preservado');app.openGeneralChat();app.syncChat();await new Promise(setImmediate);
  assert.ok(app.state.chatError);assert.equal(app.state.chatLoading,false);
  const initialReads=h.calls.listens.filter(path=>path==='chatMessages/geral').length;
  h.options.chatReadError=false;h.advance(30000);h.runTimeouts();await new Promise(setImmediate);
  assert.ok(h.calls.listens.filter(path=>path==='chatMessages/geral').length>initialReads,'permission cancellation must create a new subscription without reloading the page');
  assert.equal(app.state.chatError,'');assert.equal(app.state.chatLoading,false);assert.equal(app.state.chatDrafts.get('geral'),'Rascunho preservado');
  assert.equal(h.calls.sets.some(([path])=>path.startsWith('chatMessages/')),false,'reconnection never submits a draft');
  await app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Permissões disponíveis.'}});
  h.emitError('chatMessages/geral');app.resetAppData();const count=h.calls.listens.length;
  app.state.user=null;app.state.profile=null;h.advance(30000);h.runTimeouts();await new Promise(setImmediate);
  assert.equal(h.calls.listens.length,count,'an old retry cannot reopen chat after session cleanup');
});

test('chat retries a message subscription that never delivers its first snapshot while keeping online presence connected',async()=>{
  const h=harness(),{app}=h;h.options.deferChatMessages=true;app.openGeneralChat();app.syncChat();await new Promise(setImmediate);
  assert.equal(app.state.chatLoading,true);const presenceReads=h.calls.listens.filter(path=>path==='chatPresence').length,initialReads=h.calls.listens.filter(path=>path==='chatMessages/geral').length;
  h.advance(10000);h.runTimeouts(10000);
  assert.equal(app.state.chatLoading,false);assert.match(app.state.chatError,/mensagens|conversa/i);
  h.options.deferChatMessages=false;h.advance(2000);h.runTimeouts(2000);await new Promise(setImmediate);
  assert.ok(h.calls.listens.filter(path=>path==='chatMessages/geral').length>initialReads);assert.equal(app.state.chatLoading,false);assert.equal(app.state.chatError,'');
  assert.equal(h.calls.listens.filter(path=>path==='chatPresence').length,presenceReads,'a stalled message query does not discard healthy online presence');
});

test('chat sends plain text with canonical author/server time only to the selected authorized room and never changes grades',async()=>{
  const h=harness(),{app}=h,before=clone({grades:h.data.grades,deliveries:h.data.deliveries,boards:h.data.boards});
  app.state.chatRoom='b1';const form={dataset:{chatRoom:'b1'},values:{message:'  Boa apresentação!\r\nPodemos começar.  '}};
  await app.sendChatMessage(form);
  const writes=h.calls.sets.filter(([path])=>path.startsWith('chatMessages/'));
  assert.equal(writes.length,1);assert.match(writes[0][0],/^chatMessages\/b1\/chat-/);
  assert.deepEqual(writes[0][1],{uid:'t1',name:'Professor Um',text:'Boa apresentação!\nPodemos começar.',at:{'.sv':'timestamp'}});
  assert.equal(app.state.chatSending,false);assert.equal(app.state.chatDrafts.has('b1'),false);
  assert.deepEqual({grades:h.data.grades,deliveries:h.data.deliveries,boards:h.data.boards},before);
  await assert.rejects(app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'wrong room'}}),/sala mudou/i);
});

test('chat rejects blank, oversized, offline, loading, unauthorized and stale-room sends without queuing messages',async()=>{
  for(const message of ['', ' \n\t ', 'x'.repeat(2001)]){
    const h=harness();await assert.rejects(h.app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message}}));assert.equal(h.calls.sets.length,0);
  }
  for(const change of [h=>{h.app.state.connected=false;},h=>{h.app.state.chatLoading=true;},h=>{h.app.state.chatError='Acesso negado';},h=>{h.app.state.profile.active=false;},h=>{h.app.state.user=null;}]){
    const h=harness();change(h);await assert.rejects(h.app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Não deve enviar'}}));assert.equal(h.calls.sets.length,0);
  }
  const outsider=harness('outsider');outsider.app.state.chatRoom='b1';await assert.rejects(outsider.app.sendChatMessage({dataset:{chatRoom:'b1'},values:{message:'Sem acesso'}}),/acesso|sala/i);assert.equal(outsider.calls.sets.length,0);
});

test('a pending chat send prevents double submission, retains newly typed drafts and preserves failed messages for retry',async()=>{
  const h=harness(),{app}=h;let release;
  h.options.beforeSet=async path=>{if(path.startsWith('chatMessages/'))await new Promise(resolve=>release=resolve);};
  const form={dataset:{chatRoom:'geral'},values:{message:'Mensagem original'}};
  const sending=app.sendChatMessage(form);assert.equal(app.state.chatSending,true);
  await app.sendChatMessage(form);await new Promise(setImmediate);assert.equal(h.calls.sets.length,1);
  app.state.chatDrafts.set('geral','Próxima mensagem ainda em edição');release();await sending;
  assert.equal(app.state.chatDrafts.get('geral'),'Próxima mensagem ainda em edição');assert.equal(app.state.chatSending,false);
  const failed=harness();failed.options.setError=Error('Falha de conexão');
  await assert.rejects(failed.app.sendChatMessage(form),/conexão/);
  assert.equal(failed.app.state.chatDrafts.get('geral'),'Mensagem original');assert.equal(failed.app.state.chatSending,false);assert.equal(failed.data.chatMessages,undefined);
});

test('optimistic chat delivery stays pending until acknowledgement and rollback removes a rejected message while keeping its draft and error',async()=>{
  const h=harness(),{app}=h;app.openGeneralChat();app.syncChat();await new Promise(setImmediate);
  h.options.optimisticChatWrites=true;let release;
  h.options.beforeSet=async path=>{if(path.startsWith('chatMessages/'))await new Promise(resolve=>release=resolve);};
  const form={dataset:{chatRoom:'geral'},values:{message:'Esta mensagem precisa chegar ao colega.'}},sending=app.sendChatMessage(form);
  await new Promise(setImmediate);
  assert.equal(Object.keys(app.state.chatMessages).length,1);assert.equal(app.state.chatPendingIds.size,1);
  assert.match(app.chatView(),/data-chat-delivery="pending"/);assert.doesNotMatch(app.chatView(),/data-chat-delivery="sent"/);
  await app.sendChatMessage(form);assert.equal(h.calls.sets.filter(([path])=>path.startsWith('chatMessages/')).length,1,'a delayed acknowledgement cannot produce a duplicate submission');
  h.options.setError=Object.assign(Error('Permission denied'),{code:'PERMISSION_DENIED'});release();await assert.rejects(sending,/Permission denied/);
  assert.equal(Object.keys(h.data.chatMessages.geral).length,0);assert.equal(Object.keys(app.state.chatMessages).length,0);assert.equal(app.state.chatPendingIds.size,0);
  assert.equal(app.state.chatDrafts.get('geral'),form.values.message);assert.ok(app.state.chatSendError);assert.match(app.chatView(),/data-chat-send-error/);
  h.write('chatPresence/t2/tab',{name:'Professora Dois',role:'teacher',at:h.now()});h.emit('chatPresence');
  assert.ok(app.state.chatSendError,'an unrelated presence update cannot hide a failed send');
  h.options.setError=null;h.options.beforeSet=null;await app.sendChatMessage(form);
  assert.equal(Object.keys(h.data.chatMessages.geral).length,1);assert.equal(Object.keys(app.state.chatMessages).length,1);assert.equal(app.state.chatPendingIds.size,0);assert.equal(app.state.chatSendError,'');
  assert.match(app.chatView(),/data-chat-delivery="sent"/);assert.doesNotMatch(app.chatView(),/data-chat-delivery="pending"/);
});

test('acknowledged chat send remains visible when its live snapshot is delayed and uses a freshly read canonical profile',async()=>{
  const h=harness(),{app}=h;app.openGeneralChat();app.syncChat();await new Promise(setImmediate);
  h.data.users.t1.name='Nome canônico atualizado';h.options.suppressChatMessageEmits=true;
  await app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Gravada e confirmada.'}});
  const sent=h.calls.sets.find(([path])=>path.startsWith('chatMessages/geral/'));
  assert.equal(sent[1].name,'Nome canônico atualizado');assert.ok(h.calls.reads.includes('users/t1'));
  assert.equal(Object.keys(app.state.chatMessages).length,1);assert.equal(app.state.chatPendingIds.size,0);assert.match(app.chatView(),/Gravada e confirmada\./);
  h.emit('chatMessages/geral');assert.equal(Object.keys(app.state.chatMessages).length,1,'the later server snapshot never duplicates an acknowledged ID');
  const disabled=harness();disabled.data.users.t1.active=false;
  await assert.rejects(disabled.app.sendChatMessage({dataset:{chatRoom:'geral'},values:{message:'Não gravar.'}}),/acesso|ativo|sessão|removido/i);
  assert.equal(disabled.calls.sets.filter(([path])=>path.startsWith('chatMessages/')).length,0);
});

function chatMutationFixture(uid='t1',message={}){
  const h=harness(uid),saved={uid:'t1',name:'Professor Um',text:'Texto original da conversa',at:h.now()-100000,...message};
  for(const api of ['beginChatEdit','beginChatDelete','cancelChatMutation','submitChatEdit','confirmChatDelete'])assert.equal(typeof h.app[api],'function',api+' must be implemented');
  h.data.chatMessages={geral:{saved:clone(saved),other:{uid:'t2',name:'Professora Dois',text:'Mensagem do colega',at:h.now()-90000}}};
  h.app.openGeneralChat();h.app.syncChat();return {...h,saved};
}
const chatEditForm=(text,id='saved',room='geral')=>({dataset:{chatRoom:room,chatId:id},values:{message:text}});

test('a professor edits a confirmed legacy message atomically while preserving author, original time and every assessment',async()=>{
  const h=chatMutationFixture(),{app}=h,before=clone({grades:h.data.grades,deliveries:h.data.deliveries,boards:h.data.boards});
  app.beginChatEdit('saved');assert.equal(app.state.chatMutation.kind,'edit');assert.equal(app.state.chatMutation.text,h.saved.text);
  h.data.users.t1.name='Professor renomeado';
  await app.submitChatEdit(chatEditForm('  Texto corrigido\r\nCom informação adicional.  '));
  const saved=h.read('chatMessages/geral/saved');
  assert.deepEqual(saved,{...h.saved,text:'Texto corrigido\nCom informação adicional.',editedAt:h.now(),revision:1});
  assert.equal(app.state.chatMutation,null);assert.equal(app.state.chatMessages.saved.text,saved.text);
  assert.equal(h.calls.transactions.length,1);assert.equal(h.calls.transactions[0].path,'chatMessages/geral/saved');assert.equal(h.calls.transactions[0].config.applyLocally,false);
  assert.equal(h.calls.sets.filter(([path])=>path.startsWith('chatMessages/')).length,0,'editing never creates or resends a message');
  assert.deepEqual({grades:h.data.grades,deliveries:h.data.deliveries,boards:h.data.boards},before);
});

test('confirmed deletion leaves an ordered tombstone, keeps edit metadata and prevents resurrection',async()=>{
  const h=chatMutationFixture('t1',{text:'Texto já corrigido',editedAt:1_799_999_999_000,revision:3}),{app}=h;
  app.beginChatDelete('saved');assert.equal(app.state.chatMutation.kind,'delete');assert.equal(h.read('chatMessages/geral/saved').text,h.saved.text,'opening the confirmation does not delete');
  await app.confirmChatDelete('saved');
  assert.deepEqual(h.read('chatMessages/geral/saved'),{...h.saved,text:'',deletedAt:h.now(),revision:4});
  assert.equal(app.state.chatMutation,null);assert.match(app.chatView(),/Mensagem apagada/);assert.doesNotMatch(app.chatView(),/Texto já corrigido/);
  assert.throws(()=>app.beginChatEdit('saved'));assert.throws(()=>app.beginChatDelete('saved'));
  assert.equal(h.calls.transactions.length,1);assert.equal(h.calls.transactions[0].config.applyLocally,false);
});

test('chat editing and deletion are limited to the author and exclude missing, pending or already deleted messages',()=>{
  for(const uid of ['t1','coord']){
    const h=chatMutationFixture(uid),{app}=h;
    for(const action of [app.beginChatEdit,app.beginChatDelete]){
      assert.throws(()=>action('other'));assert.throws(()=>action('missing'));
      if(uid==='coord')assert.throws(()=>action('saved'),'coordinator privileges never edit another author');
      else {app.state.chatPendingIds.add('saved');assert.throws(()=>action('saved'));app.state.chatPendingIds.delete('saved');}
    }
    assert.equal(h.calls.transactions.length,0);
  }
  const deleted=chatMutationFixture('t1',{text:'',deletedAt:1_799_999_999_000,revision:1});
  assert.throws(()=>deleted.app.beginChatEdit('saved'));assert.throws(()=>deleted.app.beginChatDelete('saved'));
});

test('cancelling either chat action leaves the original message and independent composer draft intact',()=>{
  const h=chatMutationFixture(),{app}=h;
  for(const begin of [app.beginChatEdit,app.beginChatDelete]){
    begin('saved');app.state.chatDrafts.set('geral','Próxima mensagem em composição');app.cancelChatMutation();
    assert.equal(app.state.chatMutation,null);assert.deepEqual(h.read('chatMessages/geral/saved'),h.saved);
    assert.equal(app.state.chatDrafts.get('geral'),'Próxima mensagem em composição');
  }
  assert.equal(h.calls.transactions.length,0);
});

test('blank, oversized, offline, loading and stale-room edits never reach a chat transaction',async()=>{
  for(const text of ['', ' \n\t ', 'x'.repeat(2001)]){
    const h=chatMutationFixture();h.app.beginChatEdit('saved');await assert.rejects(h.app.submitChatEdit(chatEditForm(text)));assert.equal(h.calls.transactions.length,0);assert.deepEqual(h.read('chatMessages/geral/saved'),h.saved);
  }
  for(const change of [h=>h.app.state.connected=false,h=>h.app.state.chatLoading=true,h=>h.app.state.chatError='Sem acesso',h=>h.app.state.profile.active=false]){
    const h=chatMutationFixture();h.app.beginChatEdit('saved');change(h);await assert.rejects(h.app.submitChatEdit(chatEditForm('Correção')));assert.equal(h.calls.transactions.length,0);
  }
  const h=chatMutationFixture();h.app.beginChatEdit('saved');await assert.rejects(h.app.submitChatEdit(chatEditForm('Correção','saved','b1')));assert.equal(h.calls.transactions.length,0);
});

test('a denied chat update retains the editor text and reports failure without replacing the confirmed message',async()=>{
  const h=chatMutationFixture(),{app}=h;app.beginChatEdit('saved');h.options.transactionError=Object.assign(Error('Permission denied'),{code:'PERMISSION_DENIED'});
  await assert.rejects(app.submitChatEdit(chatEditForm('Correção ainda não salva')),/Permission denied/);
  assert.deepEqual(h.read('chatMessages/geral/saved'),h.saved);assert.equal(app.state.chatMessages.saved.text,h.saved.text);
  assert.equal(app.state.chatMutation.text,'Correção ainda não salva');assert.equal(app.state.chatMutation.busy,false);assert.ok(app.state.chatMutation.error);assert.match(app.chatView(),/Correção ainda não salva/);
  h.options.transactionError=null;await app.submitChatEdit(chatEditForm(app.state.chatMutation.text));assert.equal(h.read('chatMessages/geral/saved').text,'Correção ainda não salva');assert.equal(app.state.chatMutation,null);
});

test('a denied chat deletion keeps the confirmation and original message available for retry',async()=>{
  const h=chatMutationFixture(),{app}=h;app.beginChatDelete('saved');h.options.transactionError=Object.assign(Error('Permission denied'),{code:'PERMISSION_DENIED'});
  await assert.rejects(app.confirmChatDelete('saved'),/Permission denied/);
  assert.deepEqual(h.read('chatMessages/geral/saved'),h.saved);assert.equal(app.state.chatMutation.kind,'delete');assert.equal(app.state.chatMutation.busy,false);assert.ok(app.state.chatMutation.error);
  h.options.transactionError=null;await app.confirmChatDelete('saved');assert.equal(h.read('chatMessages/geral/saved').text,'');assert.equal(app.state.chatMutation,null);
});

test('concurrent chat edits and deletions never overwrite a message changed since the action opened',async()=>{
  for(const kind of ['edit','delete']){
    const h=chatMutationFixture(),{app}=h;(kind==='edit'?app.beginChatEdit:app.beginChatDelete)('saved');
    const newer={...h.saved,text:'Atualizada em outro navegador',editedAt:h.now(),revision:1};h.write('chatMessages/geral/saved',newer);h.emit('chatMessages/geral');
    await assert.rejects(kind==='edit'?app.submitChatEdit(chatEditForm('Edição desatualizada')):app.confirmChatDelete('saved'));
    assert.deepEqual(h.read('chatMessages/geral/saved'),newer);assert.equal(app.state.chatMutation.busy,false);assert.ok(app.state.chatMutation.error);
  }
});

test('a Firebase transaction retry detects a newer revision even when the replacement text is identical',async()=>{
  const h=chatMutationFixture(),{app}=h;app.beginChatEdit('saved');
  const newer={...h.saved,editedAt:h.now(),revision:1};
  h.options.beforeTransaction=async path=>{if(path==='chatMessages/geral/saved'){h.write(path,newer);h.options.transactionRetries=[clone(h.saved),clone(newer)];}};
  await assert.rejects(app.submitChatEdit(chatEditForm('Não substituir outra revisão')));
  assert.deepEqual(h.read('chatMessages/geral/saved'),newer);assert.equal(h.calls.transactions.length,1);assert.ok(app.state.chatMutation.error);
});

test('a fresh disabled profile stops a previously opened chat edit before any transaction',async()=>{
  const h=chatMutationFixture(),{app}=h;app.beginChatEdit('saved');h.data.users.t1.active=false;
  await assert.rejects(app.submitChatEdit(chatEditForm('Cadastro desabilitado')));assert.deepEqual(h.read('chatMessages/geral/saved'),h.saved);assert.equal(h.calls.transactions.length,0);
});

test('a pending chat mutation blocks duplicate submits and stale session completion cannot restore its editor',async()=>{
  const h=chatMutationFixture(),{app}=h;app.beginChatEdit('saved');let release;
  h.options.beforeTransaction=async path=>{if(path.startsWith('chatMessages/'))await new Promise(resolve=>release=resolve);};
  const editing=app.submitChatEdit(chatEditForm('Correção pendente'));await new Promise(setImmediate);assert.equal(app.state.chatMutation.busy,true);
  await app.submitChatEdit(chatEditForm('Correção duplicada'));assert.equal(h.calls.transactions.length,1);
  app.resetAppData();app.state.user=null;app.state.profile=null;release();await assert.rejects(editing);
  assert.equal(app.state.chatMutation,null);assert.equal(Object.keys(app.state.chatMessages).length,0);assert.equal(app.state.chatOpen,false);
});

test('loaded older chat messages receive edits and deletion tombstones without losing the current page',async()=>{
  const h=harness(),{app}=h;
  h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Histórico '+i,at:h.now()-200000+i}]))};
  app.openGeneralChat();app.syncChat();await app.loadOlderChat();assert.equal(Object.keys(app.state.chatMessages).length,130);
  const original=clone(h.read('chatMessages/geral/m000'));h.write('chatMessages/geral/m000',{...original,text:'Histórico corrigido',editedAt:h.now(),revision:1});h.emit('chatMessages/geral/m000');
  assert.equal(app.state.chatMessages.m000.text,'Histórico corrigido');assert.equal(Object.keys(app.state.chatMessages).length,130);
  h.write('chatMessages/geral/m000',{...original,text:'',editedAt:h.now(),deletedAt:h.now(),revision:2});h.emit('chatMessages/geral/m000');
  assert.equal(app.state.chatMessages.m000.text,'');assert.equal(app.state.chatMessages.m000.deletedAt,h.now());assert.equal(Object.keys(app.state.chatMessages).length,130);
});

test('authoritative live chat snapshots remove rolled-back records while retaining older history pages',async()=>{
  const h=harness(),{app}=h;
  h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Mensagem '+i,at:h.now()-200000+i}]))};
  app.openGeneralChat();app.syncChat();await app.loadOlderChat();assert.equal(Object.keys(app.state.chatMessages).length,130);
  h.write('chatMessages/geral/local-unconfirmed',{uid:'t1',name:'Professor Um',text:'Evento local ainda não confirmado',at:h.now()});h.emit('chatMessages/geral');assert.ok(app.state.chatMessages['local-unconfirmed']);
  h.write('chatMessages/geral/local-unconfirmed',null);h.emit('chatMessages/geral');
  assert.equal(app.state.chatMessages['local-unconfirmed'],undefined);assert.ok(app.state.chatMessages.m000,'rolling back a live-window record does not discard the older history');
  assert.equal(Object.keys(app.state.chatMessages).length,130);
});

test('chat history pages by timestamp and id without losing older messages or changing rooms',async()=>{
  const h=harness(),{app}=h;
  h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Mensagem '+i,at:h.now()-200000+i}]))};
  app.state.route='chat';app.syncChat();
  assert.equal(Object.keys(app.state.chatMessages).length,100);assert.equal(app.state.chatHasMore,true);
  assert.equal(h.context.BancaChat.sortedMessages(app.state.chatMessages)[0].id,'m030');
  await app.loadOlderChat();
  assert.equal(Object.keys(app.state.chatMessages).length,130);assert.equal(app.state.chatHasMore,false);assert.equal(h.context.BancaChat.sortedMessages(app.state.chatMessages)[0].id,'m000');
  app.state.chatDrafts.set('geral','Rascunho geral');app.openChatRoom('b1');app.syncChat();
  assert.equal(app.state.chatRoom,'b1');assert.equal(Object.keys(app.state.chatMessages).length,0);assert.equal(app.state.chatDrafts.get('geral'),'Rascunho geral');
  app.stopChat();assert.equal(app.state.chatRoom,'geral');assert.equal(app.state.chatDrafts.size,0);assert.equal(Object.keys(app.state.chatMessages).length,0);assert.equal(Object.keys(app.state.chatPresence).length,0);
});

test('chat presence registers disconnect cleanup, counts current people once across tabs, and clears the old session',async()=>{
  const h=harness(),{app}=h;await app.startChatPresence();
  const presence=h.calls.sets.filter(([path])=>path.startsWith('chatPresence/'));assert.equal(presence.length,1);assert.match(presence[0][0],/^chatPresence\/t1\/chat-/);
  assert.deepEqual(presence[0][1],{name:'Professor Um',role:'teacher',at:{'.sv':'timestamp'}});assert.deepEqual(h.calls.disconnects,[{kind:'remove',path:presence[0][0]}]);
  app.state.chatPresence={t1:{tab1:{name:'Professor Um',role:'teacher',at:h.now()},tab2:{name:'Professor Um',role:'teacher',at:h.now()}},t2:{tab:{name:'Professora Dois',role:'teacher',at:h.now()}},outsider:{tab:{name:'Outro Professor',role:'teacher',at:h.now()}},disabled:{tab:{name:'Desativado',role:'teacher',at:h.now()}},stale:{tab:{name:'Conexão antiga',role:'teacher',at:h.now()-130000}}};
  assert.match(app.chatView(),/Professora Dois/);assert.doesNotMatch(app.chatView(),/Conexão antiga|Desativado/);
  app.state.chatRoom='b1';const boardHtml=app.chatView();assert.doesNotMatch(boardHtml,/Outro Professor/);assert.match(boardHtml,/Professor Um/);
  app.state.chatDrafts.set('b1','Privado');app.resetAppData();await new Promise(setImmediate);
  assert.equal(app.state.chatDrafts.size,0);assert.equal(Object.keys(app.state.chatPresence).length,0);assert.ok(h.calls.removals.includes(presence[0][0]));
  assert.ok(h.calls.disconnects.some(item=>item.kind==='cancel'&&item.path===presence[0][0]));
});

test('a delayed old presence acknowledgement cannot restore a disconnected tab or remove a new connection',async()=>{
  const h=harness(),{app}=h;let oldPath,release;
  h.options.beforeSet=async path=>{if(path.startsWith('chatPresence/')&&!oldPath){oldPath=path;await new Promise(resolve=>release=resolve);}};
  const old=app.startChatPresence();await new Promise(setImmediate);assert.ok(oldPath);assert.equal(typeof release,'function');
  await app.stopChatPresence();await app.startChatPresence();
  const paths=h.calls.sets.filter(([path])=>path.startsWith('chatPresence/')).map(([path])=>path);assert.equal(paths.length,2);assert.notEqual(paths[0],paths[1]);
  release();await old;await new Promise(setImmediate);
  assert.equal(h.read(oldPath),undefined,'a late acknowledgement is removed instead of leaving a ghost online connection');
  assert.equal(h.read(paths[1]).name,'Professor Um','the replacement connection remains online');
});

test('chat history uses Firebase key ordering for messages sharing the same timestamp',async()=>{
  const h=harness(),{app}=h,at=h.now()-3000;
  h.data.chatMessages={geral:Object.fromEntries([...Array.from({length:180},(_,i)=>'A'+String(i).padStart(3,'0')),...Array.from({length:20},(_,i)=>'a'+String(i).padStart(3,'0'))].map(id=>[id,{uid:'t2',name:'Professora Dois',text:id,at}]))};
  app.state.route='chat';app.syncChat();assert.equal(Object.keys(app.state.chatMessages).length,100);
  await app.loadOlderChat();assert.equal(Object.keys(app.state.chatMessages).length,200,'the previous page must include every ordinal key, including upper/lowercase ties');
  assert.equal(h.context.BancaChat.sortedMessages(app.state.chatMessages)[0].id,'A000');
});

test('cancelled chat access prevents a pending older-history read from restoring private messages',async()=>{
  const h=harness(),{app}=h;h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Privado '+i,at:h.now()-200000+i}]))};
  app.state.route='chat';app.syncChat();let release;
  h.options.beforeRead=async path=>{if(path==='chatMessages/geral')await new Promise(resolve=>release=resolve);};
  const older=app.loadOlderChat();assert.equal(app.state.chatLoadingOlder,true);h.emitError('chatMessages/geral');
  assert.equal(Object.keys(app.state.chatMessages).length,0);assert.ok(app.state.chatError);release();await older;
  assert.equal(Object.keys(app.state.chatMessages).length,0,'late history must stay cleared after access cancellation');assert.equal(app.state.chatLoadingOlder,false);
});

test('retrying only a presence failure preserves a pending history request and the message subscription',async()=>{
  const h=harness(),{app}=h;
  h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Histórico '+i,at:h.now()-200000+i}]))};
  app.state.route='chat';app.syncChat();let release;
  h.options.beforeRead=async path=>{if(path==='chatMessages/geral')await new Promise(resolve=>release=resolve);};
  const older=app.loadOlderChat();assert.equal(app.state.chatLoadingOlder,true);
  h.emitError('chatPresence');assert.ok(app.state.chatPresenceError);assert.equal(app.state.chatError,'','the message subscription remains valid until retry');
  const reads=h.calls.listens.filter(path=>path==='chatMessages/geral').length;
  app.retryChat();assert.equal(app.state.chatLoadingOlder,true,'presence reconnection does not replace the healthy message subscription');
  assert.equal(h.calls.listens.filter(path=>path==='chatMessages/geral').length,reads);
  assert.equal(Object.keys(app.state.chatMessages).length,100);
  release();await older;
  assert.equal(Object.keys(app.state.chatMessages).length,130);assert.equal(app.state.chatLoadingOlder,false);
});

test('refreshing only chat messages replaces a pending history epoch without reconnecting online presence',async()=>{
  const h=harness(),{app}=h;
  h.data.chatMessages={geral:Object.fromEntries(Array.from({length:130},(_,i)=>['m'+String(i).padStart(3,'0'),{uid:'t2',name:'Professora Dois',text:'Histórico '+i,at:h.now()-200000+i}]))};
  app.openGeneralChat();app.syncChat();let release;
  h.options.beforeRead=async path=>{if(path==='chatMessages/geral')await new Promise(resolve=>release=resolve);};
  const older=app.loadOlderChat(),presenceReads=h.calls.listens.filter(path=>path==='chatPresence').length;
  app.retryChat({messages:true,presence:false});assert.equal(app.state.chatLoadingOlder,false);
  assert.equal(h.calls.listens.filter(path=>path==='chatPresence').length,presenceReads);
  release();await older;assert.equal(Object.keys(app.state.chatMessages).length,100,'an old page cannot append after a manual message refresh');
  h.options.beforeRead=null;await app.loadOlderChat();assert.equal(Object.keys(app.state.chatMessages).length,130);
});

function installAdditionalCoordinator(h,uid='coord2'){
  const profile={name:'Coordenação Nova',email:'coord2@example.test',key:'coord-nova',role:'coordinator',active:true};
  h.data.users[uid]=clone(profile);h.app.state.users[uid]=clone(profile);h.app.state.user={uid};h.app.state.profile=clone(profile);return uid;
}

test('Alberson creates a coordinator with isolated Auth, canonical role and preserved existing assessments',async()=>{
  const h=harness('coord'),before=clone(h.data),form=adminForm({name:' Nova Coordenação ',email:'COORD2@EXAMPLE.TEST',key:'coord-nova',role:'coordinator',method:'new',password:'strongpass'});
  await h.app.addTeacher(form);
  assert.equal(h.data.users['new-teacher'].role,'coordinator');assert.equal(h.data.users['new-teacher'].active,true);
  assert.equal(h.data.users['new-teacher'].name,'Nova Coordenação');assert.equal(h.data.users['new-teacher'].email,'coord2@example.test');
  assert.equal(h.app.state.user.uid,'coord');assert.equal(h.app.state.profile.key,'alberson');assert.equal(form.wasReset,true);
  assert.equal(h.calls.authCreates.length,1);assert.equal(h.calls.authDeletes.length,0);assert.equal(h.calls.appDeletes.length,1);
  assert.equal('password' in h.data.users['new-teacher'],false);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.deliveries,before.deliveries);assert.deepEqual(h.data.boards,before.boards);
  assert.match(h.app.teachersView(),/Coordenador e avaliador/);
});

test('coordinator registration validates role, supports existing Auth and rolls back only a failed new account',async()=>{
  const values={name:'Nova Coordenação',email:'coord2@example.test',key:'coord-nova',role:'coordinator',method:'new',password:'strongpass'};
  for(const role of ['admin','owner','COORDINATOR']){
    const h=harness('coord');await assert.rejects(h.app.addTeacher(adminForm({...values,role})),/função|perfil|acesso|inválid|Escolha/i);assert.equal(h.calls.authCreates.length,0);assert.equal(h.calls.transactions.length,0);
  }
  const existing=harness('coord');await existing.app.addTeacher(adminForm({...values,method:'existing',uid:'linked-coordinator'}));assert.equal(existing.data.users['linked-coordinator'].role,'coordinator');assert.equal(existing.calls.authCreates.length,0);
  const failed=harness('coord');failed.options.transactionError=Error('permission-denied');await assert.rejects(failed.app.addTeacher(adminForm(values)),/permission-denied/);
  assert.deepEqual(failed.calls.authDeletes,['new-teacher']);assert.equal(failed.data.users['new-teacher'],undefined);assert.equal(failed.app.state.user.uid,'coord');
});

test('Alberson can edit and reactivate another coordinator while his own protected profile cannot be changed',async()=>{
  const h=harness('coord'),profile={name:'Coordenação Nova',email:'coord2@example.test',key:'coord-nova',role:'coordinator',active:true};
  h.data.users.coord2=clone(profile);h.app.state.users.coord2=clone(profile);h.app.startTeacherEdit('coord2');
  await h.app.saveTeacherEdit(adminForm({name:'Coordenação Atualizada',contactEmail:'contato@example.test'},{teacherUid:'coord2'}));
  assert.equal(h.data.users.coord2.name,'Coordenação Atualizada');assert.equal(h.data.users.coord2.role,'coordinator');assert.equal(h.data.users.coord2.key,'coord-nova');assert.equal(h.data.users.coord2.email,'coord2@example.test');
  await h.app.changeTeacherAccess('coord2',false);assert.equal(h.data.users.coord2.active,false);
  await h.app.changeTeacherAccess('coord2',true);assert.equal(h.data.users.coord2.active,true);assert.equal(h.data.users.coord2.disabledAt,undefined);
  await assert.rejects(h.app.changeTeacherAccess('coord',false),/Alberson|protegido|própri|coordenação/i);
  h.data.users.protected={...clone(profile),key:'alberson'};h.app.state.users.protected=clone(h.data.users.protected);
  await assert.rejects(h.app.changeTeacherAccess('protected',false),/Alberson|protegido|própri|coordenação/i);
  assert.equal(h.data.users.coord.active,true);assert.equal(h.data.users.protected.active,true);
  const saved=clone(h.data.grades);h.write('boards/b2',{groupId:'g1',members:{coord2:true,t1:true}});
  const bank=clone(h.data.boards.b2);await h.app.changeTeacherAccess('coord2',false);assert.equal(h.data.users.coord2.active,false);assert.deepEqual(h.data.grades,saved);assert.deepEqual(h.data.boards.b2,bank);
});

test('additional active coordinators manage groups, access profiles and group imports',async()=>{
  const h=harness('coord');installAdditionalCoordinator(h);const before=clone(h.data);h.app.resetGroupAdmin();
  assert.equal(h.app.canManageGroups(),true);await h.app.saveGroup(groupForm(newGroupDraft()));
  assert.equal(h.data.groups['new-group'].createdBy,'coord2');assert.equal(h.data.groups['new-group'].courseName,'Redes de Computadores');assert.deepEqual(h.data.grades,before.grades);
  await h.app.addTeacher(adminForm({name:'Outra Coordenação',email:'extra@example.test',key:'extra-coord',role:'coordinator',method:'new',password:'strongpass'}));assert.equal(h.data.users['new-teacher'].role,'coordinator');assert.equal(h.data.users['new-teacher'].createdBy,'coord2');
  const importing=harness('coord');installAdditionalCoordinator(importing);const session=importing.app.prepareImport(importRows());await importing.app.confirmExcelImport(session);
  assert.equal(importing.data.groups['new-group'].createdBy,'coord2');assert.equal(importing.data.groups['new-group'].courseName,'Engenharia');assert.deepEqual(importing.data.grades,fixture().grades);
});

test('an additional coordinator creates a manual bank with atomic teacher and room reservations',async()=>{
  const h=harness('coord');installAdditionalCoordinator(h);const before=clone(h.data.grades);
  const group={id:'g2',name:'Nova banca manual',courseName:'ADS',className:'3A',title:'Projeto novo',advisorUid:'t1',students:{s3:'Carla'},active:true};
  h.data.groups.g2=clone(group);h.app.state.groups.g2=clone(group);
  const start=Math.ceil((h.now()+3600000)/900000)*900000,board=h.app.makeBoard(group,start,30,'Sala 2',['t1','coord2']);
  await h.app.createBoards([board]);
  assert.equal(h.data.boards['new-group'].createdBy,'coord2');assert.equal(h.data.boards['new-group'].members.coord2,true);assert.equal(h.data.groupBoards.g2,'new-group');
  const paths=Object.keys(h.calls.updates[0]);assert.ok(paths.includes('boards/new-group'));assert.ok(paths.includes('groupBoards/g2'));assert.ok(paths.some(path=>path.startsWith('locks/')));assert.ok(paths.some(path=>path.startsWith('roomLocks/')));
  assert.deepEqual(h.data.grades,before);assert.equal(h.data.boards.b1.memberNames.t1,'Professor Um');
});

test('timer turns red strictly above fifteen minutes and keeps overrun state paused or sealed',()=>{
  const h=harness(),{app}=h;
  for(const ms of [0,899999,900000])assert.equal(app.timerIsOverrun(ms),false);
  for(const ms of [900001,900010,1200000])assert.equal(app.timerIsOverrun(ms),true);
  for(const invalid of [null,undefined,'900001',NaN,Infinity])assert.equal(app.timerIsOverrun(invalid),false);
  for(const ms of [900000,900010]){
    app.state.timers.b1={elapsedMs:ms,startedAt:0};const markup=app.timerHtml('b1'),display=markup.match(/<div class="timer-display[^"]*"/)[0];
    assert.equal(display.includes('timer-overrun'),ms>900000);assert.equal(markup.match(/<p class="timer-overrun-warning"[^>]*>/)[0].includes(' hidden'),ms<=900000);
  }
  app.state.seals.b1={at:h.now(),by:'t1'};assert.ok(app.timerHtml('b1').match(/<div class="timer-display timer-overrun"/));
  app.state.timers.b1={elapsedMs:0,startedAt:0};assert.ok(!app.timerHtml('b1').match(/<div class="timer-display timer-overrun"/));
});

test('timer tick updates red display, panel and warning without replacing the grading DOM',()=>{
  const h=harness(),{app}=h,classes=new Set(),panelClasses=new Set(),warning={hidden:true},panel={classList:{toggle:(name,on)=>on?panelClasses.add(name):panelClasses.delete(name)},querySelector:()=>warning};
  const display={dataset:{timerDisplay:'b1'},textContent:'',classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},closest:()=>panel};
  h.context.document.querySelectorAll=selector=>selector==='[data-timer-display]'?[display]:[];
  app.state.timers.b1={elapsedMs:899990,startedAt:h.now()};app.updateTimerDisplays();assert.equal(display.textContent,'14:59,99');assert.equal(classes.has('timer-overrun'),false);
  h.advance(20);app.updateTimerDisplays();assert.equal(display.textContent,'15:00,01');assert.equal(classes.has('timer-overrun'),true);assert.equal(panelClasses.has('timer-overrun'),true);assert.equal(warning.hidden,false);
  app.state.timers.b1={elapsedMs:0,startedAt:0};app.updateTimerDisplays();assert.equal(display.textContent,'00:00,00');assert.equal(classes.has('timer-overrun'),false);assert.equal(panelClasses.has('timer-overrun'),false);assert.equal(warning.hidden,true);
});

function installBankImportGroup(h){
  const uid=installAdditionalCoordinator(h),group={id:'g2',name:'Banca da planilha',courseName:'ADS',className:'3A',title:'Agenda segura',advisorUid:'t1',students:{s3:'Carla',s4:'Daniel'},active:true};
  h.data.groups.g2=clone(group);h.app.state.groups.g2=clone(group);return uid;
}
const bankImportRows=()=>[['ID do grupo','Data','Hora','Duração','Sala','Avaliador 1','Avaliador 2'],['g2','2027-01-17','10:00',30,'Sala Excel','one@example.test','coord2@example.test']];

test('coordinator scheduled-bank Excel commit is explicit and reserves rooms and teachers atomically',async()=>{
  const h=harness('coord');installBankImportGroup(h);const before=clone(h.data),session=h.app.prepareBankImport(bankImportRows());
  assert.equal(session.preview.errors.length,0);assert.equal(session.preview.boards.length,1);
  h.options.confirm=false;await h.app.confirmBoardImport(session);assert.equal(h.calls.updates.length,0);
  h.options.confirm=true;await h.app.confirmBoardImport(session);
  assert.equal(h.data.groupBoards.g2,'new-group');assert.equal(h.data.boards['new-group'].createdBy,'coord2');assert.equal(h.data.boards['new-group'].members.coord2,true);assert.equal(h.data.boards['new-group'].advisorName,'Professor Um');
  assert.equal(h.calls.updates.length,1);assert.ok(Object.keys(h.calls.updates[0]).some(path=>path.startsWith('roomLocks/')));assert.ok(Object.keys(h.calls.updates[0]).some(path=>path.startsWith('locks/')));
  assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.deliveries,before.deliveries);assert.deepEqual(h.data.groups,before.groups);assert.deepEqual(h.data.boards.b1,before.boards.b1);
});

test('scheduled-bank import rejects fresh conflicts, invalid sheets, offline state and stale actors before writing',async()=>{
  const changed=harness('coord');installBankImportGroup(changed);const session=changed.app.prepareBankImport(bankImportRows());changed.data.users.t1.active=false;
  await assert.rejects(changed.app.confirmBoardImport(session),/agenda|cadastros|mudaram/i);assert.equal(changed.calls.updates.length,0);
  const invalid=harness('coord');installBankImportGroup(invalid);const rows=bankImportRows();rows[1][2]='10:07';const bad=invalid.app.prepareBankImport(rows);assert.ok(bad.preview.errors.length);await assert.rejects(invalid.app.confirmBoardImport(bad),/planilha válida|prévia/);assert.equal(invalid.calls.updates.length,0);
  const offline=harness('coord');installBankImportGroup(offline);const off=offline.app.prepareBankImport(bankImportRows());offline.app.state.connected=false;await assert.rejects(offline.app.confirmBoardImport(off),/internet|conect/);assert.equal(offline.calls.updates.length,0);
  const revoked=harness('coord');installBankImportGroup(revoked);const stale=revoked.app.prepareBankImport(bankImportRows());revoked.data.users.coord2.role='teacher';await assert.rejects(revoked.app.confirmBoardImport(stale),/coordena|permissão/);assert.equal(revoked.calls.updates.length,0);
  const teacher=harness('t1');assert.throws(()=>teacher.app.openBoardImport(),/coordena/);assert.equal(teacher.calls.updates.length,0);
});

test('scheduled-bank import retries never overwrite an existing bank or save after a session change',async()=>{
  const h=harness('coord');installBankImportGroup(h);const session=h.app.prepareBankImport(bankImportRows());
  h.options.onRead=()=>{h.app.state.user={uid:'t1'};h.app.state.profile=clone(h.data.users.t1);};
  await assert.rejects(h.app.confirmBoardImport(session),/sessão|coordena/);assert.equal(h.calls.updates.length,0);
  const once=harness('coord');installBankImportGroup(once);const original=clone(once.data.grades),first=once.app.prepareBankImport(bankImportRows());await once.app.confirmBoardImport(first);
  const again=once.app.prepareBankImport(bankImportRows());await assert.rejects(once.app.confirmBoardImport(again),/agenda|cadastros|planilha válida|prévia/i);assert.equal(once.calls.updates.length,1);assert.deepEqual(once.data.grades,original);
});

test('manual bank creation rereads conflicts and coordinator access before any reservation is written',async()=>{
  for(const scenario of ['conflict','revoked','offline']){
    const h=harness('coord');installBankImportGroup(h);const group=h.data.groups.g2,start=Math.ceil((h.now()+3600000)/900000)*900000,plan=[h.app.makeBoard(group,start,30,'Sala Manual',['t1','coord2'])];
    if(scenario==='conflict')h.data.boards.hidden={groupId:'g-hidden',advisorUid:'t1',members:{t1:true,t2:true},startAt:start,durationMin:30,room:'Outra sala'};
    if(scenario==='revoked')h.data.users.coord2.role='teacher';
    if(scenario==='offline')h.app.state.connected=false;
    await assert.rejects(h.app.createBoards(plan),/sobreposta|coordena|internet|conect/);assert.equal(h.calls.updates.length,0);assert.equal(h.data.groupBoards?.g2,undefined);assert.equal(!!h.app.state.boardSaving,false);
  }
});

test('double submission cannot create two banks while the first fresh catalog read is pending',async()=>{
  const h=harness('coord');installBankImportGroup(h);const start=Math.ceil((h.now()+3600000)/900000)*900000,board=h.app.makeBoard(h.data.groups.g2,start,30,'Sala Manual',['t1','coord2']);
  let release;h.options.beforeRead=path=>path==='users'?new Promise(resolve=>release=resolve):undefined;
  const first=h.app.createBoards([board]);assert.equal(h.app.state.boardSaving,true);assert.equal(typeof release,'function');
  await assert.rejects(h.app.createBoards([board]),/Aguarde|andamento/);assert.equal(h.calls.updates.length,0);
  release();await first;assert.equal(h.calls.updates.length,1);assert.equal(h.data.groupBoards.g2,'new-group');assert.equal(h.app.state.boardSaving,false);
});

test('ID-only bank sheet renews its preview when the referenced group display or roster changes',async()=>{
  for(const changedField of ['name','students']){
    const h=harness('coord');installBankImportGroup(h);const session=h.app.prepareBankImport(bankImportRows());assert.equal(session.preview.errors.length,0);
    if(changedField==='name')h.data.groups.g2.name='Nome atualizado fora desta janela';else h.data.groups.g2.students={s3:'Carla Atualizada',s4:'Daniel'};
    await assert.rejects(h.app.confirmBoardImport(session),/agenda|cadastros|mudaram|prévia/i);assert.equal(h.calls.updates.length,0);assert.equal(session.preview.errors.length,0);assert.equal(session.preview.boards.length,1);
    assert.deepEqual(session.catalog.groups.g2,h.data.groups.g2,'renewed preview contains the current group that will receive the bank');
    await h.app.confirmBoardImport(session);assert.equal(h.calls.updates.length,1);assert.equal(h.data.groupBoards.g2,'new-group');
  }
});

const academicSnapshot = h => clone(Object.fromEntries(['groups','boards','grades','deliveries','seals','timers'].map(key=>[key,h.data[key]])));
function installAdministrator(h){
  installAdditionalCoordinator(h,'admin');
  Object.assign(h.data.users.admin,{name:'Administração Univap',email:'admin@univap.br',key:'admin'});
  h.app.state.users.admin=clone(h.data.users.admin);h.app.state.profile=clone(h.data.users.admin);
}

test('every active coordinator including the administrator creates and manages evaluator access without changing academic history',async()=>{
  for(const actor of ['coord2','admin']){
    const h=harness('coord');if(actor==='admin')installAdministrator(h);else installAdditionalCoordinator(h);
    const before=academicSnapshot(h);assert.equal(h.app.canManageTeachers(),true);assert.match(h.app.teachersView(),/id="teacher-form"/);
    await h.app.addTeacher(adminForm({name:'Docente da equipe',email:'team@example.test',key:'docente-equipe',role:'teacher',method:'new',password:'initial-test-pass'}));
    assert.equal(h.data.users['new-teacher'].createdBy,actor);assert.equal(h.app.state.user.uid,actor);assert.equal(h.data.users['new-teacher'].role,'teacher');
    h.app.startTeacherEdit('new-teacher');await h.app.saveTeacherEdit(adminForm({name:'Docente Atualizado',contactEmail:'contact@example.test'},{teacherUid:'new-teacher'}));
    assert.equal(h.data.users['new-teacher'].name,'Docente Atualizado');assert.equal(h.data.users['new-teacher'].email,'team@example.test');
    await h.app.changeTeacherAccess('new-teacher',false);assert.equal(h.data.users['new-teacher'].active,false);
    await h.app.changeTeacherAccess('new-teacher',true);assert.equal(h.data.users['new-teacher'].active,true);
    await assert.rejects(h.app.changeTeacherAccess(actor,false),/própri|proteg|conta|Alberson/i);
    await assert.rejects(h.app.changeTeacherAccess('coord',false),/própri|proteg|conta|Alberson/i);
    assert.deepEqual(academicSnapshot(h),before);assert.equal('password' in h.data.users['new-teacher'],false);
  }
});

test('Wagner is promoted on his existing UID and retains every board, saved criterion and delivery',async()=>{
  const h=harness('coord');h.data.users.t1={...h.data.users.t1,name:'Wagner',key:'wagner'};h.app.state.users.t1=clone(h.data.users.t1);
  const original=clone(h.data.users.t1),before=academicSnapshot(h);
  assert.match(h.app.teachersView(),/data-promote-teacher="t1"/);
  await h.app.promoteTeacher('t1');
  assert.deepEqual(h.data.users.t1,{...original,role:'coordinator'});assert.equal(h.data.users.t1.email,original.email);
  assert.equal(h.calls.authCreates.length,0);assert.equal(h.calls.authDeletes.length,0);assert.ok(h.calls.confirmations.some(message=>/Wagner/.test(message)&&message.includes(original.email)));
  assert.deepEqual(academicSnapshot(h),before);assert.equal(h.data.boards.b1.members.t1,true);assert.equal(h.data.grades.b1.t1.s1.presentation,10);
  h.app.state.user={uid:'t1'};h.app.state.profile=clone(h.data.users.t1);assert.equal(h.app.canManageTeachers(),true);assert.match(h.app.teachersView(),/id="teacher-form"/);
  assert.equal(h.app.coordinatorReportBoards()[0].students.length,2);assert.equal(h.app.weightedWorkbench.viewData().summary.studentCount,2);
});

test('promotion requires an active target, confirmation, a fresh coordinator actor and an unchanged profile',async()=>{
  for(const scenario of ['teacher','inactive-actor','revoked','inactive-target','cancel','concurrent','session']){
    const h=harness(scenario==='teacher'?'t2':'coord'),before=academicSnapshot(h);
    if(scenario==='inactive-actor')h.app.state.profile.active=false;
    if(scenario==='revoked')h.data.users.coord.role='teacher';
    if(scenario==='inactive-target'){h.data.users.t1.active=false;h.app.state.users.t1.active=false;}
    if(scenario==='cancel')h.options.confirm=false;
    if(scenario==='concurrent')h.options.transactionRetries=[clone(h.data.users.t1),{...clone(h.data.users.t1),name:'Mudou em outra janela'}];
    if(scenario==='session')h.options.onRead=()=>{h.app.state.user={uid:'t2'};h.app.state.profile=clone(h.data.users.t2);};
    if(scenario==='cancel')await h.app.promoteTeacher('t1');
    else await assert.rejects(h.app.promoteTeacher('t1'),/coordena|permissão|acesso|ativo|desabilit|outra janela|sessão|alterad/i,scenario);
    assert.equal(h.data.users.t1.role,'teacher',scenario);assert.equal(h.calls.authCreates.length,0);assert.equal(h.calls.authDeletes.length,0);assert.deepEqual(academicSnapshot(h),before);
  }
});

test('fresh revocation blocks professor creation, editing and disabling even when the local coordinator profile is stale',async()=>{
  for(const action of ['create','edit','disable']){
    const h=harness('coord');installAdditionalCoordinator(h);h.data.users.coord2.active=false;
    if(action==='edit')h.app.startTeacherEdit('t2');
    const before=clone(h.data),operation=action==='create'?()=>h.app.addTeacher(adminForm({name:'Novo',email:'new@example.test',key:'new',role:'teacher',method:'new',password:'initial-test-pass'}))
      :action==='edit'?()=>h.app.saveTeacherEdit(adminForm({name:'Alterado',contactEmail:''},{teacherUid:'t2'})):()=>h.app.changeTeacherAccess('t2',true);
    await assert.rejects(operation(),/coordena|permissão|acesso|mudou|sessão/i,action);
    assert.deepEqual(h.data,before);assert.equal(h.calls.authCreates.length,0);assert.equal(h.calls.transactions.length,0);
  }
});

test('administrator registration uses the existing safe coordinator role and never exposes a fixed login password in the public HTML',async()=>{
  const h=harness('coord'),before=academicSnapshot(h);
  await h.app.addTeacher(adminForm({name:'Administração Univap',email:'admin@univap.br',key:'admin',role:'coordinator',method:'new',password:'initial-test-pass'}));
  const saved=h.data.users['new-teacher'];assert.equal(saved.email,'admin@univap.br');assert.equal(saved.key,'admin');assert.equal(saved.role,'coordinator');
  assert.equal('password' in saved,false);assert.doesNotMatch(html,/id="teacher-password"[^>]*\bvalue=/i);
  assert.deepEqual(academicSnapshot(h),before);assert.equal(h.app.state.user.uid,'coord');
});

test('additional coordinators and the administrator can issue agenda, official, analytic, global and custom PDFs with the same grades',async()=>{
  for(const actor of ['coord2','admin']){
    const h=harness('coord');if(actor==='admin')installAdministrator(h);else installAdditionalCoordinator(h);
    h.write('seals/b1',{by:actor,at:h.now()});h.app.state.seals.b1=clone(h.data.seals.b1);const before=academicSnapshot(h);
    h.app.exportSchedulePdf(false);await h.app.printReports(['b1']);await h.app.printAnalytics();
    for(const kind of ['pdf','charts','csv'])await h.app.exportCoordinatorReport(kind);
    for(const kind of ['pdf','charts','csv'])await h.app.weightedWorkbench.exportReport(kind);
    assert.equal(h.downloads.length,9);for(const file of h.downloads.filter(file=>file.filename.endsWith('.pdf'))){const contents=await file.blob.text();assert.match(contents,/^%PDF-1\.4/);assert.match(contents,/%%EOF\s*$/);}
    assert.deepEqual(academicSnapshot(h),before);assert.equal(h.calls.sets.length+h.calls.updates.length+h.calls.transactions.length,0);
  }
});

function assignmentForm(memberUids){return{dataset:{board:'b1'},querySelectorAll:()=>memberUids.map(value=>({value}))};}

test('coordinator assignment updates only members and reservations and releases an ungraded evaluator without stale local locks',async()=>{
  const h=harness('coord');installAdditionalCoordinator(h);const before=academicSnapshot(h),initial=clone(h.data.boards.b1);
  h.app.startBoardAssignment('b1');await h.app.saveBoardAssignment(assignmentForm(['t1','t2','coord2']));
  assert.equal(h.data.boards.b1.members.coord2,true);assert.equal(h.data.boards.b1.assignmentRevision,1);assert.equal(h.data.boards.b1.memberNames.coord2,'Coordenação Nova');
  for(const slot of ['900000','1800000']){assert.equal(h.data.locks[slot].coord2,'b1');assert.equal(h.app.state.locks[slot].coord2,'b1');}
  assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.deliveries,before.deliveries);assert.deepEqual(h.data.groups,before.groups);
  h.app.startBoardAssignment('b1');await h.app.saveBoardAssignment(assignmentForm(['t1','t2']));
  assert.equal(h.data.boards.b1.assignmentRevision,2);for(const slot of ['900000','1800000']){assert.equal(h.data.locks[slot]?.coord2,undefined);assert.equal(h.app.state.locks[slot]?.coord2,undefined);}
  const final=clone(h.data.boards.b1);delete final.assignmentRevision;assert.deepEqual(final,initial);assert.deepEqual(h.data.grades,before.grades);
  assert.equal(h.calls.updates.length,2);for(const changes of h.calls.updates)for(const path of Object.keys(changes))assert.match(path,/^(boards\/b1\/(members|memberNames|assignmentRevision)|locks\/)/);
});

test('assignment rejects a freshly sealed, archived, changed or unauthorized bank and pending edits before writing',async()=>{
  for(const scenario of ['sealed','archived','changed','revoked','unsaved','session']){
    const h=harness('coord');installAdditionalCoordinator(h);h.app.startBoardAssignment('b1');
    if(scenario==='sealed')h.data.seals.b1={by:'coord',at:h.now()};
    if(scenario==='archived')h.data.groups.g1.active=false;
    if(scenario==='changed')h.data.boards.b1.room='Alterada';
    if(scenario==='revoked')h.data.users.coord2.role='teacher';
    if(scenario==='unsaved')h.app.state.drafts.set('delivery/b1/s1',{delivery:'7'});
    if(scenario==='session')h.options.onRead=()=>{h.app.state.user={uid:'t2'};h.app.state.profile=clone(h.data.users.t2);};
    const before=academicSnapshot(h);
    await assert.rejects(h.app.saveBoardAssignment(assignmentForm(['t1','t2','coord2'])),/Reabra|encerrad|ativo|alterad|outra janela|permissão|coordena|Salve|sessão/i,scenario);
    assert.deepEqual(academicSnapshot(h),before);assert.equal(h.calls.updates.length,0);
  }
});

test('assignment rereads grades and blocks removal of a professor who has saved a new criterion since the dialog opened',async()=>{
  const h=harness('coord');installAdditionalCoordinator(h);delete h.data.grades.b1.t2;delete h.app.state.grades.b1.t2;
  h.app.startBoardAssignment('b1');h.data.grades.b1.t2={s1:{presentation:0}};const before=academicSnapshot(h);
  await assert.rejects(h.app.saveBoardAssignment(assignmentForm(['t1','coord2'])),/notas|avaliações.*preserv/i);
  assert.deepEqual(academicSnapshot(h),before);assert.equal(h.calls.updates.length,0);assert.equal(h.data.boards.b1.members.t2,true);
});

test('academic year filters preserve all saved years, notes and chat access while narrowing evaluation reports',()=>{
  const h=harness('coord'),{app}=h;
  const futureGroup={...clone(h.data.groups.g1),id:'g2027',name:'Grupo do próximo ano',academicYear:2027};
  const futureBoard={...clone(h.data.boards.b1),groupId:'g2027',startAt:Date.UTC(2027,9,20,14)};
  app.state.groups.g1.academicYear=2026;app.state.groups.g2027=futureGroup;app.state.boards.b2027=futureBoard;app.state.groupBoards.g2027='b2027';
  app.state.grades.b2027=clone(app.state.grades.b1);app.state.deliveries.b2027=clone(app.state.deliveries.b1);
  const academic=clone({groups:app.state.groups,boards:app.state.boards,grades:app.state.grades,deliveries:app.state.deliveries});
  app.state.academicYear='2026';assert.deepEqual(clone(app.filteredBoards().map(([id])=>id)),['b1']);assert.deepEqual(clone(app.filteredReportBoards().map(([id])=>id)),['b1']);
  assert.deepEqual(clone(app.filteredNotesBoards().map(([id])=>id)),['b1']);assert.deepEqual(clone(app.coordinatorReportBoards().map(board=>board.id)),['b1']);
  assert.ok(app.chatRooms().some(room=>room.id==='b2027'),'year scope never revokes access to historical chat');
  app.state.academicYear='2027';assert.deepEqual(clone(app.filteredBoards().map(([id])=>id)),['b2027']);assert.deepEqual(clone(app.coordinatorReportBoards().map(board=>board.id)),['b2027']);
  app.state.academicYear='todos';assert.equal(app.filteredBoards().length,2);assert.equal(app.coordinatorReportBoards().length,2);
  assert.deepEqual(clone({groups:app.state.groups,boards:app.state.boards,grades:app.state.grades,deliveries:app.state.deliveries}),academic);
});

test('manual group identities may repeat in another academic year but same-year duplicates remain protected',async()=>{
  const h=harness('coord'),draft={...newGroupDraft(),academicYear:2026};
  h.data.groups.old={id:'old',...draft,students:{s1:'Outra pessoa'},active:false};h.app.state.groups.old=clone(h.data.groups.old);h.app.resetGroupAdmin();
  await assert.rejects(h.app.saveGroup(groupForm(draft)),/já existe|já cadastrado|cadastrado|duplicado/i);
  assert.equal(h.calls.sets.length,0);
  const next={...draft,academicYear:2027};await h.app.saveGroup(groupForm(next));
  assert.equal(h.data.groups['new-group'].academicYear,2027);assert.equal(h.data.groups.old.academicYear,2026);assert.deepEqual(h.data.grades,fixture().grades);
});

test('annual Excel import skips only existing groups in the chosen year and persists the new year without changing past notes',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data.grades);
  h.data.groups.old={id:'old',name:'Grupo novo',academicYear:2026,className:'1E',courseName:'Engenharia',title:'Sensores',advisorUid:'t1',students:{s1:'Carla',s2:'Daniel'}};
  app.state.groups.old=clone(h.data.groups.old);app.state.academicYear='2027';
  const next=app.prepareImport(importRows());assert.equal(next.preview.groups.length,1);assert.equal(next.preview.groups[0].academicYear,2027);
  await app.confirmExcelImport(next);assert.equal(h.data.groups['new-group'].academicYear,2027);assert.equal(h.data.groups.old.academicYear,2026);assert.deepEqual(h.data.grades,before);
  app.state.academicYear='2026';const original=app.prepareImport(importRows());assert.equal(original.preview.groups.length,0);assert.equal(original.preview.skipped.length,1);
});

test('password recovery keeps a generic personalized interface for missing and existing accounts without modifying any academics',async()=>{
  const h=harness(),{app}=h,before=academicSnapshot(h);app.state.user=null;app.state.profile=null;
  assert.ok(app.accountSecurity,'security controller is integrated');app.accountSecurity.openRecovery('unknown@example.test');
  h.options.resetEmailError=Object.assign(Error('not found'),{code:'auth/user-not-found'});
  await app.accountSecurity.submit('account-recovery-form',{email:'unknown@example.test',channel:'email'});
  const generic=app.accountSecurity.getState().success;assert.match(generic,/Se os dados corresponderem/);assert.equal(app.accountSecurity.getState().error,'');
  h.options.resetEmailError=null;app.accountSecurity.openRecovery('one@example.test');await app.accountSecurity.submit('account-recovery-form',{email:'one@example.test',channel:'email'});
  assert.equal(app.accountSecurity.getState().success,generic);assert.equal(h.calls.passwordResets.length,2);assert.deepEqual(academicSnapshot(h),before);
  assert.equal(h.calls.sets.length,0);assert.equal(h.calls.updates.length,0);assert.match(app.accountSecurity.view(),/SMS ainda não está disponível/);
});

test('changing the login email reauthenticates and sends verification while retaining UID, profile email and every saved note',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data);app.accountSecurity.openAccount();
  await app.accountSecurity.submit('account-email-form',{newEmail:'novo.alberson@example.test',password:'CurrentPassword!12'});
  assert.equal(h.calls.reauthentications.length,1);assert.equal(h.calls.reauthentications[0].uid,'coord');assert.equal(h.calls.reauthentications[0].email,'coord@example.test');
  assert.equal(h.calls.emailChanges.length,1);assert.equal(h.calls.emailChanges[0].email,'novo.alberson@example.test');
  assert.equal(app.state.user.uid,'coord');assert.equal(app.state.user.email,'coord@example.test');assert.equal(h.data.users.coord.email,'coord@example.test');
  assert.match(app.accountSecurity.getState().success,/Alberson.*novo\.alberson@example\.test/);assert.equal(app.accountSecurity.getState().error,'');
  assert.deepEqual(h.data,before);assert.ok(!JSON.stringify(app.accountSecurity.getState()).includes('CurrentPassword'));
});

test('an account switch during reauthentication cannot send another user email-change request or retain credential feedback',async()=>{
  const h=harness('t1'),{app}=h;let release;
  h.options.beforeReauthenticate=()=>new Promise(resolve=>release=resolve);app.accountSecurity.openAccount();
  const task=app.accountSecurity.submit('account-email-form',{newEmail:'future@example.test',password:'CurrentPassword!12'});
  await Promise.resolve();assert.equal(h.calls.reauthentications.length,1);
  app.state.user={uid:'t2',email:'two@example.test'};app.state.profile=clone(h.data.users.t2);app.setAccessRevision(app.getAccessRevision()+1);release();await task;
  assert.equal(h.calls.emailChanges.length,0);assert.equal(app.accountSecurity.getState().open,false);assert.equal(app.accountSecurity.getState().success,'');assert.equal(h.calls.updates.length,0);
});

test('only a verified canonical Auth email can synchronize its own profile without touching role, key, name or academic identities',async()=>{
  const h=harness('coord'),{app}=h,academic=academicSnapshot(h),original=clone(h.data.users.coord);
  assert.ok(app.syncVerifiedAccountEmail,'verified e-mail synchronizer is integrated');
  app.auth.currentUser.email='confirmed@example.test';app.auth.currentUser.emailVerified=true;
  const result=await app.syncVerifiedAccountEmail(app.auth.currentUser,clone(original),app.getAccessRevision());
  assert.equal(h.data.users.coord.email,'confirmed@example.test');
  const expected={...original,email:'confirmed@example.test'};assert.deepEqual(h.data.users.coord,expected);assert.equal(app.auth.currentUser.uid,'coord');assert.deepEqual(academicSnapshot(h),academic);
  assert.ok(result===undefined||result.email==='confirmed@example.test');
});

test('unverified email claims and changed Auth identity never synchronize a profile login email',async()=>{
  const h=harness('t1'),{app}=h,original=clone(h.data.users.t1);
  app.auth.currentUser.email='unverified@example.test';app.auth.currentUser.emailVerified=false;
  await app.syncVerifiedAccountEmail(app.auth.currentUser,clone(original),app.getAccessRevision());assert.deepEqual(h.data.users.t1,original);
  const previous=app.auth.currentUser;app.auth.currentUser={uid:'t2',email:'two@example.test',emailVerified:true};
  try{await app.syncVerifiedAccountEmail(previous,clone(original),app.getAccessRevision());}catch(error){assert.match(error.message,/sessão|conta|acesso/i);}
  assert.deepEqual(h.data.users.t1,original);assert.equal(h.calls.updates.length,0);assert.equal(h.calls.sets.length,0);
});

test('coordinator backup captures every academic year with versioned metadata and excludes authentication and SMS recovery secrets',async()=>{
  const h=harness('coord'),{app}=h;h.write('groups/future',{id:'future',name:'Grupo futuro',academicYear:2030,students:{s1:'Aluno futuro'}});
  h.write('accountContacts/coord',{phone:'+5512999999999',verified:true});h.write('accountSecurity',{privateOtp:'NEVER_INCLUDE'});app.state.academicYear='2026';
  const before=clone(h.data);await app.exportAcademicBackup();assert.equal(h.downloads.length,1);const result=JSON.parse(await h.downloads[0].blob.text());
  assert.equal(result.format,'BancaFlowAcademicBackup');assert.equal(result.schemaVersion,1);assert.equal(result.scope,'all-academic-years');assert.equal(result.projectId,'avaliadortcc');assert.equal(result.data.groups.future.academicYear,2030);
  assert.deepEqual(result.data.grades,before.grades);assert.deepEqual(result.data.boards,before.boards);assert.equal(result.data.accountContacts,undefined);assert.equal(result.data.accountSecurity,undefined);assert.ok(!JSON.stringify(result).includes('NEVER_INCLUDE'));assert.match(h.downloads[0].filename,/bancaflow_backup_.*\.json/);assert.equal(app.state.backupBusy,false);assert.deepEqual(h.data,before);
  const teacher=harness('t1');await assert.rejects(teacher.app.exportAcademicBackup(),/coordenação/);assert.equal(teacher.downloads.length,0);
});

test('changing year initializes an empty new-group form for that year while preserving an unfinished historical draft',()=>{
  const h=harness('coord'),{app}=h;app.resetGroupAdmin();app.setAcademicYear('2027');assert.equal(app.state.groupFormDraft.academicYear,2027);
  app.state.groupFormDraft.name='Projeto em digitação';app.setAcademicYear('2028');assert.equal(app.state.groupFormDraft.academicYear,2027);assert.equal(app.state.groupFormDraft.name,'Projeto em digitação');
  app.state.groupEditId='g1';app.state.groupFormDraft.name='';app.setAcademicYear('2029');assert.equal(app.state.groupFormDraft.academicYear,2027);assert.equal(app.state.groupEditId,'g1');
});

test('native recovery and email-change retry without a continue URL only when Firebase rejects that URL',async()=>{
  const recovery=harness('t1');recovery.options.beforeResetEmail=(_email,settings)=>{if(settings)throw Object.assign(Error('continue URL rejected'),{code:'auth/unauthorized-continue-uri'});};
  recovery.app.accountSecurity.openRecovery('one@example.test');await recovery.app.accountSecurity.submit('account-recovery-form',{email:'one@example.test',channel:'email'});
  assert.equal(recovery.calls.passwordResets.length,2);assert.ok(recovery.calls.passwordResets[0].settings.url);assert.equal(recovery.calls.passwordResets[1].settings,undefined);assert.ok(recovery.app.accountSecurity.getState().success);assert.equal(recovery.app.accountSecurity.getState().error,'');
  const change=harness('t1');change.options.beforeEmailChange=(_user,_email,settings)=>{if(settings)throw Object.assign(Error('continue URL invalid'),{code:'auth/invalid-continue-uri'});};
  change.app.accountSecurity.openAccount();await change.app.accountSecurity.submit('account-email-form',{newEmail:'next@example.test',password:'CurrentPassword!12'});
  assert.equal(change.calls.emailChanges.length,2);assert.ok(change.calls.emailChanges[0].settings.url);assert.equal(change.calls.emailChanges[1].settings,undefined);assert.equal(change.calls.reauthentications.length,1);assert.ok(change.app.accountSecurity.getState().success);assert.equal(change.data.users.t1.email,'one@example.test');
  const denied=harness('t1');denied.options.resetEmailError=Object.assign(Error('network failed'),{code:'auth/network-request-failed'});denied.app.accountSecurity.openRecovery('one@example.test');await denied.app.accountSecurity.submit('account-recovery-form',{email:'one@example.test',channel:'email'});
  assert.equal(denied.calls.passwordResets.length,1);assert.ok(denied.app.accountSecurity.getState().error);assert.equal(denied.app.accountSecurity.getState().success,'');
});

test('native email-change continue-URL fallback rechecks the actor before attempting a second verification message',async()=>{
  const h=harness('t1'),{app}=h;h.options.beforeEmailChange=()=>{app.state.user={uid:'t2',email:'two@example.test'};app.state.profile=clone(h.data.users.t2);app.setAccessRevision(app.getAccessRevision()+1);throw Object.assign(Error('continue URL rejected'),{code:'auth/unauthorized-continue-uri'});};
  app.accountSecurity.openAccount();await app.accountSecurity.submit('account-email-form',{newEmail:'next@example.test',password:'CurrentPassword!12'});
  assert.equal(h.calls.emailChanges.length,1);assert.equal(h.data.users.t1.email,'one@example.test');assert.equal(app.accountSecurity.getState().open,false);
});

test('legacy database rules can accept a current-year manual group after a single metadata-only retry without changing saved academics',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),year=require('../assets/academic-years.js').calendarYear(h.now());
  app.state.academicYear=String(year);app.resetGroupAdmin();h.options.beforeSet=(path,value)=>{if(path.startsWith('groups/')&&Object.hasOwn(value,'academicYear'))throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});};
  await app.saveGroup(groupForm({...newGroupDraft(),academicYear:year}));
  assert.equal(h.calls.sets.length,2);assert.equal(h.calls.sets[0][1].academicYear,year);assert.equal(Object.hasOwn(h.calls.sets[1][1],'academicYear'),false);
  const saved=h.data.groups['new-group'];assert.ok(saved);assert.equal(require('../assets/academic-years.js').yearOfGroup(saved,h.data.boards),year);assert.equal(saved.createdAt,h.now());
  assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);assert.deepEqual(h.data.deliveries,before.deliveries);
});

test('legacy database rules can accept a current-year Excel batch atomically after removing only inferable new year metadata',async()=>{
  const h=harness('coord'),{app}=h,before=clone(h.data),year=require('../assets/academic-years.js').calendarYear(h.now());
  app.state.academicYear=String(year);const session=app.prepareImport(importRows());
  h.options.beforeUpdate=(_base,changes)=>{if(Object.values(changes).some(value=>value&&typeof value==='object'&&Object.hasOwn(value,'academicYear')))throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});};
  await app.confirmExcelImport(session);assert.equal(h.calls.updates.length,2);assert.equal(h.calls.updates[0]['groups/new-group'].academicYear,year);assert.equal(Object.hasOwn(h.calls.updates[1]['groups/new-group'],'academicYear'),false);
  assert.equal(require('../assets/academic-years.js').yearOfGroup(h.data.groups['new-group'],h.data.boards),year);assert.deepEqual(h.data.groups.g1,before.groups.g1);assert.deepEqual(h.data.grades,before.grades);assert.deepEqual(h.data.boards,before.boards);
});

test('legacy compatibility never strips a future or already explicit year and never retries after fresh coordinator revocation',async()=>{
  const future=harness('coord');future.app.state.academicYear='2030';future.app.resetGroupAdmin();future.options.beforeSet=()=>{throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});};
  await assert.rejects(future.app.saveGroup(groupForm({...newGroupDraft(),academicYear:2030})),/regras|Firebase|PERMISSION_DENIED/i);assert.equal(future.calls.sets.length,1);assert.equal(future.data.groups['new-group'],undefined);
  const existing=harness('coord'),year=require('../assets/academic-years.js').calendarYear(existing.now()),group={id:'historical',...existing.app.validatedGroupDraft({...newGroupDraft(),academicYear:year}),active:true};existing.write('groups/historical',group);existing.app.state.groups.historical=clone(group);existing.app.resetGroupAdmin();existing.app.editGroup('historical');
  existing.options.beforeTransaction=()=>{throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});};
  await assert.rejects(existing.app.saveGroup(groupForm({...newGroupDraft(),academicYear:year,title:'Alteração'})),/regras|Firebase|PERMISSION_DENIED/i);assert.equal(existing.calls.transactions.length,1);assert.deepEqual(existing.data.groups.historical,clone(group));
  const revoked=harness('coord');revoked.app.resetGroupAdmin();revoked.options.beforeSet=()=>{revoked.data.users.coord.active=false;throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});};
  await assert.rejects(revoked.app.saveGroup(groupForm(newGroupDraft())),/permissão|acesso|coordenação|PERMISSION_DENIED/i);assert.equal(revoked.calls.sets.length,1);assert.equal(revoked.data.groups['new-group'],undefined);
});

function replicationForm(values,sid='s1',defaults=values){
  const data=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,String(value)]));
  const inputs=Object.keys(data).map(name=>{const input={name,defaultValue:String(defaults[name]??''),disabled:false};Object.defineProperty(input,'value',{get:()=>data[name],set:value=>data[name]=String(value)});return input;});
  const buttons=[{type:'submit',disabled:false},{type:'button',disabled:false,dataset:{replicateGrade:'b1',sourceStudent:sid}}];
  return {dataset:{gradeForm:'b1',student:sid},values:data,isConnected:true,elements:{namedItem:name=>inputs.find(input=>input.name===name)},querySelector:selector=>inputs.find(input=>selector.includes(input.name))||buttons[0],querySelectorAll:selector=>selector.includes('button')?[...inputs,...buttons]:selector.includes(':not(:disabled)')?inputs.filter(input=>!input.disabled):inputs};
}

test('Replicar Nota copies the current unsaved four criteria including zero with one atomic update limited to this author and board',async()=>{
  const h=harness('t1'),{app}=h;h.write('groups/g2',{...clone(h.data.groups.g1),id:'g2'});h.write('boards/b2',{...clone(h.data.boards.b1),groupId:'g2'});h.write('grades/b2',{t1:{s1:grade(4),s2:grade(3)}});
  const before=clone(h.data),scores={presentation:'0',practice:'9,5',code:'8',time:'10'},form=replicationForm(scores,'s1',grade(10,8,6,8));
  app.state.drafts.set('grade/b1/s1',clone(scores));app.state.drafts.set('grade/b1/s2',{presentation:'1',practice:'2',code:'3',time:'4'});app.state.drafts.set('delivery/b1/s1',{delivery:'7'});app.state.drafts.set('grade/b2/s1',{presentation:'5'});
  await app.replicateGrade(form);assert.equal(h.calls.confirmations.length,1);assert.match(h.calls.confirmations[0],/Ana|alunos|grupo|banca/i);
  assert.equal(h.calls.updates.length,1);assert.equal(h.calls.updateBases[0],'grades/b1/t1');assert.deepEqual(h.calls.updates[0],{s1:grade(0,9.5,8,10),s2:grade(0,9.5,8,10)});assert.equal(h.calls.sets.length,0);
  assert.deepEqual(h.data.grades.b1.t1,{s1:grade(0,9.5,8,10),s2:grade(0,9.5,8,10)});assert.deepEqual(h.data.grades.b1.t2,before.grades.b1.t2);assert.deepEqual(h.data.grades.b2,before.grades.b2);assert.deepEqual(h.data.deliveries,before.deliveries);assert.deepEqual(h.data.groups,before.groups);assert.deepEqual(h.data.boards,before.boards);
  assert.deepEqual(clone(app.state.drafts.get('delivery/b1/s1')),{delivery:'7'});assert.deepEqual(clone(app.state.drafts.get('grade/b2/s1')),{presentation:'5'});assert.equal(app.state.busyBoards.has('b1'),false);
});

test('Replicar Nota rejects invalid values and preserves pending notes when confirmation is cancelled or the server refuses the batch',async()=>{
  const cancelled=harness('t1'),form=replicationForm(grade(8));cancelled.options.confirm=false;const before=clone(cancelled.data);await cancelled.app.replicateGrade(form);assert.equal(cancelled.calls.updates.length,0);assert.deepEqual(cancelled.data,before);
  for(const values of [{presentation:'',practice:'8',code:'8',time:'8'},{presentation:'0',practice:'8',code:'11',time:'8'},{presentation:'NaN',practice:'8',code:'8',time:'8'}]){
    const invalid=harness('t1');await assert.rejects(invalid.app.replicateGrade(replicationForm(values)),/Preencha|notas|critérios|0 e 10/i);assert.equal(invalid.calls.updates.length,0);assert.equal(invalid.calls.confirmations.length,0);
  }
  const denied=harness('t1'),draft={presentation:'9',practice:'0',code:'7',time:'6'};denied.app.state.drafts.set('grade/b1/s1',clone(draft));denied.app.state.drafts.set('grade/b1/s2',{presentation:'4'});const existing=clone(denied.data),drafts=clone([...denied.app.state.drafts]);denied.options.updateError=Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});
  await assert.rejects(denied.app.replicateGrade(replicationForm(draft)),/PERMISSION_DENIED|permiss|replicar/i);assert.deepEqual(denied.data,existing);assert.deepEqual(clone([...denied.app.state.drafts]),drafts);assert.equal(denied.app.state.busyBoards.has('b1'),false);
});

test('Replicar Nota is available to an assigned coordinator but never permits nonmembers, disabled users or unavailable banks',async()=>{
  const coordinator=harness('coord');coordinator.data.boards.b1.members.coord=true;coordinator.app.state.boards.b1.members.coord=true;const old=clone(coordinator.data.grades.b1);await coordinator.app.replicateGrade(replicationForm(grade(7)));
  assert.equal(coordinator.calls.updateBases[0],'grades/b1/coord');assert.deepEqual(coordinator.data.grades.b1.coord,{s1:grade(7),s2:grade(7)});assert.deepEqual(coordinator.data.grades.b1.t1,old.t1);assert.deepEqual(coordinator.data.grades.b1.t2,old.t2);
  for(const [uid,setup] of [['coord',h=>{}],['t1',h=>{h.app.state.profile.active=false;}],['t1',h=>{h.app.state.connected=false;}],['t1',h=>{h.app.state.seals.b1={by:'t2',at:h.now()};}],['t1',h=>{h.app.state.groups.g1.active=false;}],['t1',h=>{delete h.app.state.boards.b1.members.t1;}],['t1',h=>{h.app.state.user=null;}]]){
    const h=harness(uid);setup(h);await assert.rejects(h.app.replicateGrade(replicationForm(grade(8))),/banca|avalia|acesso|internet|conta|sessão|disponível/i);assert.equal(h.calls.updates.length,0);
  }
});

test('Replicar Nota rechecks fresh seals, membership, roster and actor before writing and cannot overwrite another session after a read',async()=>{
  for(const change of [h=>h.write('seals/b1',{by:'t2',at:h.now()}),h=>{delete h.data.boards.b1.members.t1;},h=>{h.data.users.t1.active=false;},h=>{delete h.data.groups.g1.students.s2;},h=>{h.app.state.user={uid:'t2'};h.app.state.profile=clone(h.data.users.t2);}]){
    const h=harness('t1');let changed=false;h.options.beforeRead=()=>{if(!changed){changed=true;change(h);}};
    await assert.rejects(h.app.replicateGrade(replicationForm(grade(8))),/banca|avalia|acesso|sessão|mud|grupo|aluno|disponível/i);assert.equal(h.calls.updates.length,0);assert.deepEqual(h.data.grades,fixture().grades);
  }
});

test('Replicar Nota prevents duplicate batch and regular saves while pending and keeps newly edited drafts made after confirmation',async()=>{
  const h=harness('t1'),{app}=h,form=replicationForm(grade(6));let release,started;
  const pending=new Promise(resolve=>started=resolve);h.options.beforeUpdate=()=>{started();return new Promise(resolve=>release=resolve);};
  const task=app.replicateGrade(form);await pending;assert.equal(app.state.busyBoards.has('b1'),true);
  await app.replicateGrade(form);assert.equal(h.calls.updates.length,1);await assert.rejects(app.saveGrade(replicationForm(grade(9))),/aguarde|andamento|salv|ocupad/i);assert.equal(h.calls.sets.length,0);
  const late={presentation:'2',practice:'3',code:'4',time:'5'};app.state.drafts.set('grade/b1/s2',clone(late));release();await task;
  assert.deepEqual(clone(app.state.drafts.get('grade/b1/s2')),late);assert.equal(app.state.busyBoards.has('b1'),false);
});

test('Replicar Nota waits for a pending regular save and never races or duplicates an individual grade write',async()=>{
  const h=harness('t1'),{app}=h,form=replicationForm(grade(5));let release,started;
  const pending=new Promise(resolve=>started=resolve);h.options.beforeSet=path=>{if(path.startsWith('grades/')){started();return new Promise(resolve=>release=resolve);}};
  const saving=app.saveGrade(form);await pending;assert.equal(app.state.gradeSaves.has('b1/t1/s1'),true);
  await app.saveGrade(form);assert.equal(h.calls.sets.length,1);await assert.rejects(app.replicateGrade(form),/Aguarde.*salvamento|salvando|notas.*andamento/i);assert.equal(h.calls.updates.length,0);assert.equal(h.calls.confirmations.length,0);
  release();await saving;assert.equal(app.state.gradeSaves.size,0);h.options.beforeSet=null;
  await app.replicateGrade(form);assert.equal(h.calls.updates.length,1);assert.deepEqual(h.data.grades.b1.t1.s2,grade(5));
});

test('Replicar Nota does not replace a newer same-author score delivered from another session before its acknowledgement finishes',async()=>{
  const h=harness('t1'),{app}=h;
  h.options.afterUpdate=(base)=>{if(base==='grades/b1/t1'){h.write('grades/b1/t1/s2',grade(2));app.state.grades.b1.t1=clone(h.data.grades.b1.t1);}};
  await app.replicateGrade(replicationForm(grade(6)));
  assert.deepEqual(h.data.grades.b1.t1.s2,grade(2));assert.deepEqual(clone(app.state.grades.b1.t1.s2),grade(2));assert.deepEqual(clone(app.state.grades.b1.t1.s1),grade(6));assert.equal(app.state.busyBoards.has('b1'),false);
});
