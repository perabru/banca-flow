const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const importer = require('../assets/board-import.js');
const roster = require('../assets/roster-import.js');
const XLSX = require('../assets/vendor/xlsx-0.20.3.full.min.js');
const users = {
 t1: { name: 'Professora Ána', email: 'ana@univap.br', key: 'ana', role: 'teacher', active: true },
 t2: { name: 'Professor Bruno', email: 'bruno@univap.br', key: 'bruno', role: 'teacher', active: true },
 c1: { name: 'Nova Coordenação', email: 'coord@univap.br', key: 'coord', role: 'coordinator', active: true },
 off: { name: 'Professor Desativado', email: 'off@univap.br', key: 'off', role: 'teacher', active: false }
};
const groups = Object.fromEntries(['g1','g2','g3'].map((id,index)=>[id,{id,name:`Grupo ${index+1}`,courseName:'ADS',className:'3A',title:'Projeto',advisorUid:'t1',students:{s1:'Ana'}}]));
const now = new Date(2026,9,20,8).getTime();
const headers = ['Curso','Turma','Grupo','Data','Hora','Duração','Sala','Avaliador 1','Avaliador 2','Avaliador 3'];
const row = (values={}) => ['ADS','3A',values.group||'Grupo 1',values.date??'21/10/2026',values.time??'19:00',values.duration??30,values.room??'Sala 1',values.first??'ana@univap.br',values.second??'bruno@univap.br',values.third??''];
const parse = (rows, options={}) => importer.parseRows(rows,{users,groups,now,...options});
const book = rows => {const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Bancas');return workbook;};
const serial = (year,month,day) => (Date.UTC(year,month-1,day)-Date.UTC(1899,11,30))/86400000;

test('resolves saved group and active coordinator or teacher, preserving canonical membership and local schedule',()=>{
 const result=parse([headers,row({third:'coord'})]);
 assert.deepEqual(result.errors,[]);assert.equal(result.rowCount,1);assert.equal(result.headerRow,1);
 const b=result.boards[0];assert.equal(b.groupId,'g1');assert.equal(b.startAt,new Date(2026,9,21,19).getTime());assert.equal(b.advisorUid,'t1');assert.equal(b.advisorName,'Professora Ána');assert.deepEqual(b.members,{t1:true,t2:true,c1:true});assert.deepEqual(b.memberNames,{t1:'Professora Ána',t2:'Professor Bruno',c1:'Nova Coordenação'});assert.deepEqual(b.lines,[2]);
 assert.equal(result.warnings.length,0);
});

test('group ID works without optional course/class while ambiguous names require precise metadata',()=>{
 const others={...groups,other:{...groups.g1,id:'other',courseName:'Engenharia',className:'4A'}};
 assert.match(parse([headers,row()],{groups:others}).errors.join(),/^$/);
 const short=['Grupo','Data','Hora','Duração','Sala','Avaliador 1','Avaliador 2'];
 const bad=parse([short,['Grupo 1','2026-10-21','19:00',30,'Sala 1','ana','bruno']],{groups:others});
 assert.match(bad.errors.join(),/ambíguo/);assert.deepEqual(bad.boards,[]);
 const good=parse([['ID do grupo',...short.slice(1)],['g1','2026-10-21','19:00',30,'Sala 1','ana','bruno']],{groups:others});
 assert.deepEqual(good.errors,[]);assert.equal(good.boards[0].groupId,'g1');
 assert.deepEqual(parse([short,['g2','2026-10-21','19:00',30,'Sala 1','ana','bruno']]).errors,[]);
 const mismatch=parse([['ID do grupo',...headers],['g1','Engenharia','3A',...row().slice(2)]],{groups:others});
 assert.match(mismatch.errors.join(),/não encontrado/);
});

test('dates from Excel serials and zero-midnight time use calendar values rather than UTC shifts',()=>{
 for(const [date,time,hour,minute]of [[serial(2026,10,21),0,0,0],[serial(2026,10,21)+.75,.5,12,0],['2026-10-21','19:15:00',19,15],[new Date(2026,9,21,23),.8125,19,30]]){
  const result=parse([headers,row({date,time})]);assert.deepEqual(result.errors,[],String(date));assert.equal(result.boards[0].startAt,new Date(2026,9,21,hour,minute).getTime());
 }
 assert.equal(importer.parseDate(60),null);assert.deepEqual(importer.parseDate(61),{year:1900,month:3,day:1});
 assert.deepEqual(importer.parseDate(1),{year:1900,month:1,day:1});
});

test('invalid calendar dates, past starts, minute/second offsets, duration and blank rooms prevent every write candidate',()=>{
 const cases=[{date:'31/02/2026'},{date:'21/13/2026'},{date:'10/21/26'},{date:'2026-02-29'},{date:Infinity},{date:'19/10/2026'},{time:'19:01'},{time:'19:00:01'},{time:1},{time:.50001},{time:''},{duration:20},{duration:30.5},{duration:''},{room:''},{room:'x'.repeat(81)},{room:'Sala\n1'}];
 for(const values of cases){const result=parse([headers,row({group:'Grupo 2',time:'20:00'}),row(values)]);assert.ok(result.errors.length,JSON.stringify(values));assert.deepEqual(result.boards,[]);}
 assert.throws(()=>parse([headers,row()],{now:NaN}),/horário/);
});

test('unknown, inactive, duplicate and ambiguous evaluators are rejected without silent replacement',()=>{
 for(const values of [{first:''},{second:'off'},{first:'desconhecido'},{second:'t1'},{third:'ana'}])assert.ok(parse([headers,row(values)]).errors.length,JSON.stringify(values));
 const ambiguous={...users,another:{...users.t1,name:'Professora Ana',email:'ana2@univap.br',key:'ana2'}};
 assert.match(parse([headers,row({first:'Professora Ana'})],{users:ambiguous}).errors.join(),/ambíguo/);
 assert.deepEqual(parse([headers,row()],{users:ambiguous}).errors,[]);
 const result=parse([headers,row({first:'bruno',second:'coord'})]);assert.deepEqual(result.errors,[]);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/orientador/);
 const inactiveAdvisor={...users,t1:{...users.t1,active:false}};
 assert.deepEqual(parse([headers,row({first:'bruno',second:'coord'})],{users:inactiveAdvisor}).errors,[],'inactive advisor can remain in historical group when not an evaluator');
});

test('archived or missing groups and duplicate/existing schedules are never replaced',()=>{
 assert.match(parse([headers,row()],{groups:{...groups,g1:{...groups.g1,active:false}}}).errors.join(),/removido/);
 assert.match(parse([headers,row({group:'Nunca cadastrado'})]).errors.join(),/Cadastre/);
 for(const options of [{groupBoards:{g1:'old'}},{boards:{old:{groupId:'g1'}}}])assert.match(parse([headers,row()],options).errors.join(),/já possui/);
 assert.match(parse([headers,row(),row({time:'20:00'})]).errors.join(),/mais de uma linha/);
 assert.match(parse([headers,row()],{users:{...users,t1:undefined}}).errors.join(),/não encontrado/);
});

test('teacher and room overlaps include existing boards, within-file plans and quarter-hour locks',()=>{
 const first=parse([headers,row()]).boards[0];
 assert.match(parse([headers,row({group:'Grupo 2',room:'Sala 2',time:'19:15'})],{boards:{b1:first}}).errors.join(),/outra banca/);
 assert.match(parse([headers,row({group:'Grupo 2',first:'bruno',second:'coord',room:'sALA 1',time:'19:15'})],{boards:{b1:{...first,members:{off:true}}}}).errors.join(),/sala.*ocupada/i);
 assert.match(parse([headers,row(),row({group:'Grupo 2',room:'Sala 2',time:'19:15'})]).errors.join(),/outra banca/);
 const locks={[first.startAt]:{t1:'reserved'}};
 assert.match(parse([headers,row()],{locks}).errors.join(),/reserva/);
 const hex=Buffer.from('sala á').toString('hex'),roomLocks={[first.startAt]:{[hex]:'reserved'}};
 assert.match(parse([headers,row({room:'SALA Á'})],{roomLocks}).errors.join(),/sala.*reservada/i);
 assert.deepEqual(parse([headers,row({group:'Grupo 2',time:'19:30'})],{boards:{b1:first}}).errors,[],'touching intervals do not overlap');
});

test('missing or repeated headers, invalid tables and excessive cohorts fail without partial plans',()=>{
 assert.match(parse([['Grupo'],['Grupo 1']]).errors.join(),/obrigatório/);
 assert.match(parse([headers.concat('Hora'),row().concat('20:00')]).errors.join(),/mais de uma coluna/);
 assert.match(parse([headers]).errors.join(),/Não há bancas/);
 assert.match(parse([]).errors.join(),/vazia/);
 assert.throws(()=>parse([null]),/tabela/);assert.throws(()=>parse(Array.from({length:10021},()=>[])),/limite/);
 const many=Array.from({length:501},(_,i)=>row({group:`Novo${i}`}));assert.match(parse([headers,...many]).errors.join(),/500 bancas/);
 assert.equal(parse([['Bancas agendadas'],[],headers,row()]).headerRow,3);
});

test('actual XLSX, XLS and CSV files preserve native date/time values and import all valid fields',()=>{
 const rows=[headers,row({date:serial(2026,10,21),time:19/24})],workbook=book(rows);
 workbook.Sheets.Bancas.D2.z='dd/mm/yyyy';workbook.Sheets.Bancas.E2.z='hh:mm';
 for(const bookType of ['xlsx','xls']){
  const bytes=XLSX.write(workbook,{type:'array',bookType}),loaded=roster.readWorkbook(bytes,XLSX,'bancas.'+bookType);
  const raw=importer.readSheet(loaded,'Bancas',XLSX),preview=parse(raw);
  assert.equal(typeof raw[1][3],'number');assert.equal(typeof raw[1][4],'number');assert.deepEqual(preview.errors,[]);assert.equal(preview.boards[0].startAt,new Date(2026,9,21,19).getTime());
 }
 const csv='\uFEFF'+[headers,row()].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
 const loaded=roster.readWorkbook(new TextEncoder().encode(csv),XLSX,'bancas.csv');
 assert.deepEqual(parse(importer.readSheet(loaded,loaded.SheetNames[0],XLSX)).errors,[]);
});

test('1904 date system is converted before parsing and workbook inputs stay unchanged',()=>{
 const workbook=book([headers,row({date:serial(2026,10,21)-1462,time:.5})]);workbook.Workbook={WBProps:{date1904:true}};
 const before=JSON.stringify(workbook),raw=importer.readSheet(workbook,'Bancas',XLSX);
 assert.equal(raw[1][3],serial(2026,10,21));assert.equal(parse(raw).boards[0].startAt,new Date(2026,9,21,12).getTime());assert.equal(JSON.stringify(workbook),before);
});

test('formulas and oversized worksheets are rejected before preview; no untrusted cells execute',()=>{
 const workbook=book([headers,row()]);workbook.Sheets.Bancas.G2.f='HYPERLINK("https://example.test","Sala")';
 assert.throws(()=>importer.readSheet(workbook,'Bancas',XLSX),/fórmula/);delete workbook.Sheets.Bancas.G2.f;
 workbook.Sheets.Bancas['!fullref']='A1:A10050';assert.throws(()=>importer.readSheet(workbook,'Bancas',XLSX),/limite/);
 assert.throws(()=>importer.readSheet(workbook,'Inexistente',XLSX),/aba válida/);
});

test('template is future dated, UTF-8 safe and browser UMD exposes same immutable API',()=>{
 const rows=importer.templateRows({now});assert.deepEqual(rows[0],headers);assert.equal(rows[1][3],'21/10/2026');assert.ok(importer.templateCsv({now}).startsWith('\uFEFF'));assert.match(importer.templateCsv({now}),/Duração/);
 const input=[headers,row()],snapshot=JSON.stringify({input,users,groups});parse(input);assert.equal(JSON.stringify({input,users,groups}),snapshot);
 const context=vm.createContext({TextEncoder,Date});vm.runInContext(readFileSync(path.join(__dirname,'..','assets','board-import.js'),'utf8'),context);
 assert.equal(context.BancaBoardImport.LIMITS.boards,500);assert.equal(Object.isFrozen(context.BancaBoardImport),true);
});


test('explicit UID and e-mail take precedence over names and inactive UIDs are not silently replaced',()=>{
 const collisions={...users,alias:{name:'t1',email:'another@univap.br',key:'alias',role:'teacher',active:true},fake:{name:'off',email:'fake@univap.br',key:'fake',role:'teacher',active:true}};
 assert.equal(importer.resolveEvaluator('t1',collisions).uid,'t1');
 assert.match(importer.resolveEvaluator('off',collisions).error,/ativos/);
 assert.equal(importer.resolveEvaluator('ANA@UNIVAP.BR',collisions).uid,'t1');
 const result=parse([['ID do grupo',...headers],['g1',...row({group:'g1'})]]);assert.deepEqual(result.errors,[]);assert.equal(result.boards[0].groupId,'g1');
});
