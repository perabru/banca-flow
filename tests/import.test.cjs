const {test}=require('node:test');
const assert=require('node:assert/strict');
const importer=require('../assets/roster-import.js');
const XLSX=require('../assets/vendor/xlsx-0.20.3.full.min.js');
const users={alb:{name:'Alberson',email:'alb@univap.br',key:'alberson',role:'coordinator',active:true},ana:{name:'Professora Ána',email:'ana@univap.br',key:'ana',role:'teacher',active:true},disabled:{name:'Inativo',email:'off@univap.br',key:'inativo',role:'teacher',active:false}};
const headers=['Curso','Turma','Grupo','Título','Orientador','Aluno'];
const row=(student='Maria',extra={})=>[extra.course||'ADS','3A','Grupo 01','Projeto Final',extra.advisor||'ana@univap.br',student];
const parse=(rows,options={})=>importer.parseRows(rows,{users,...options});
const workbook=(rows)=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Grupos');return book;};

test('single-student rows aggregate groups and create stable student IDs independent of row order',()=>{
 const first=parse([headers,row('José'),row('Ana')]),second=parse([headers,row('Ana'),row('José')]);
 assert.equal(first.errors.length,0);assert.equal(first.groups.length,1);assert.equal(first.studentCount,2);
 assert.deepEqual(first.groups[0].students,second.groups[0].students);
 assert.equal(first.groups[0].advisorUid,'ana');assert.equal(first.groups[0].active,true);
 assert.deepEqual(first.groups[0].students,{s001:'Ana',s002:'José'});
});
test('accepts wide student columns and normalized accented aliases with default course',()=>{
 const preview=parse([['Turma','Número do grupo','Título do projeto','Professor orientador','Aluno 1','Aluno 2'],['1A','Equipe Verde','Projeto','Professora Ana','Rita','João']],{defaultCourse:'Engenharia'});
 assert.deepEqual(preview.errors,[]);assert.equal(preview.studentCount,2);assert.equal(preview.groups[0].courseName,'Engenharia');
});
test('unknown, inactive and ambiguous advisors are rejected; unique email resolves duplicate names',()=>{
 const dup={...users,ana2:{...users.ana,email:'ana2@univap.br',key:'ana2'}};
 assert.match(parse([headers,row('A',{advisor:'Inativo'})]).errors.join(),/não encontrado/);
 assert.match(importer.parseRows([headers,row('A',{advisor:'Professora Ana'})],{users:dup}).errors.join(),/ambíguo/);
 assert.equal(importer.parseRows([headers,row('A')],{users:dup}).errors.length,0);
 assert.equal(parse([headers,row('A',{advisor:'ana'})]).errors.length,0);
});
test('advisor emails preserve punctuation instead of treating dots and hyphens as equivalent',()=>{
 const teachers={a:{name:'Ana A',email:'ana.silva@univap.br',role:'teacher'},b:{name:'Ana B',email:'ana-silva@univap.br',role:'teacher'}};
 assert.equal(importer.resolveAdvisor('ANA.SILVA@UNIVAP.BR',teachers).uid,'a');
 assert.equal(importer.resolveAdvisor('ana-silva@univap.br',teachers).uid,'b');
});
test('course, class and group identity prevents overwrite, including archived groups',()=>{
 const existingGroups={old:{id:'old',courseName:'ADS',className:'3A',name:'Grupo 01',active:false,students:{legacy:'Preservado'}}};
 const preview=parse([headers,row('Novo')],{existingGroups});
 assert.equal(preview.groups.length,0);assert.equal(preview.skipped.length,1);assert.match(preview.skipped[0].reason,/removidos/);
 assert.deepEqual(existingGroups.old.students,{legacy:'Preservado'});
 assert.equal(parse([headers,row('Novo',{course:'Engenharia'})],{existingGroups}).groups.length,1);
});
test('duplicate students and conflicting group metadata are explicit errors',()=>{
 assert.match(parse([headers,row('José'),row('JOSE')]).errors.join(),/repetido/);
 const conflict=row('B');conflict[3]='Outro título';
 assert.match(parse([headers,row('A'),conflict]).errors.join(),/título ou orientador diferente/);
});
test('rejects missing required headers, empty data, oversized values and excessive student groups',()=>{
 assert.match(parse([['Grupo','Aluno'],['G','A']]).errors.join(),/obrigatório/);
 assert.match(parse([headers]).errors.join(),/Não há alunos/);
 assert.match(parse([headers,row('X'.repeat(121))]).errors.join(),/120/);
 assert.match(parse([headers,...Array.from({length:21},(_,i)=>row('Aluno '+i))]).errors.join(),/20 alunos/);
 assert.throws(()=>parse(Array.from({length:10021},()=>[])),/limite/);
});
test('does not fill down ambiguous blank metadata or accept duplicate metadata headers',()=>{
 assert.match(parse([headers,row('A'),['','','','','','B']]).errors.join(),/Grupo está vazio/);
 assert.match(parse([['Curso','Turma','Grupo','Título','Orientador','Orientador','Aluno']]).errors.join(),/mais de uma coluna/);
});
test('file constraints reject unsupported, empty and oversized uploads',()=>{
 for(const file of [{name:'x.exe',size:5},{name:'x.xlsx',size:0},{name:'x.xls',size:6*1024*1024}])assert.throws(()=>importer.validateFile(file));
 assert.doesNotThrow(()=>importer.validateFile({name:'BANCA.XLSX',size:100}));
});
test('vendored parser reads real XLSX, XLS and UTF-8 CSV files',()=>{
 const book=workbook([headers,row('João'),row('Lívia')]);
 for(const bookType of ['xlsx','xls']){
  const bytes=XLSX.write(book,{type:'array',bookType});
  const parsedBook=importer.readWorkbook(bytes,XLSX,'banca.'+bookType);
  const preview=parse(importer.readSheet(parsedBook,'Grupos',XLSX));
  assert.deepEqual(preview.errors,[]);assert.equal(preview.studentCount,2);
 }
 const csv=importer.templateCsv('ana@univap.br');
 const csvbook=importer.readWorkbook(new TextEncoder().encode(csv),XLSX,'modelo.csv');
 const preview=parse(importer.readSheet(csvbook,csvbook.SheetNames[0],XLSX));
 assert.deepEqual(preview.errors,[]);assert.equal(preview.studentCount,2);assert.match(preview.groups[0].courseName,/Análise/);
});
test('formula cells and overflowing worksheet bounds are rejected before preview',()=>{
 const book=workbook([headers,row()]);book.Sheets.Grupos.A2={t:'s',v:'ADS',f:'HYPERLINK("https://example.com","ADS")'};
 assert.throws(()=>importer.readSheet(book,'Grupos',XLSX),/fórmula/);
 delete book.Sheets.Grupos.A2.f;book.Sheets.Grupos['!fullref']='A1:A10050';
 assert.throws(()=>importer.readSheet(book,'Grupos',XLSX),/limite/);
});
test('finds headers after introductory rows and rejects malformed containers',()=>{
 const preview=parse([['Bancas 2026'],[],headers,row()]);
 assert.deepEqual(preview.errors,[]);assert.equal(preview.headerRow,3);
 assert.throws(()=>parse([null]),/tabela válida/);
});
