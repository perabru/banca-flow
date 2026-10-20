const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const modelApi = require('../assets/weighted-model.js');
const { append } = require('../assets/weighted-report-pdf.js');

class Recorder {
  constructor(){this.width=595.28;this.margin=40;this.pages=[[]];this.tables=[];this.paragraphs=[];this.issued='20/10/2026';this.responsible='Alberson';}
  paragraph(value){this.paragraphs.push(String(value));this.pages.at(-1).push(String(value));}
  table(headers,rows,widths,options){
    assert.equal(headers.length,widths.length);
    assert.ok(Math.abs(widths.reduce((sum,value)=>sum+value,0)-(this.width-2*this.margin))<.01);
    for(const row of rows)assert.equal(row.length,headers.length);
    this.tables.push({headers,rows,widths,options});
  }
  newPage(){this.pages.push([]);}
}
const evaluator=(extra={})=>({uid:'alberson',name:'Alberson',presentation:0,practice:8,code:9,time:7,mean:9.99,...extra});
const board=(extra={})=>({id:'b1',label:'Grupo A',project:'Sistema (TCC) & pesquisa',courseName:'Computação',className:'2A',startLabel:'20/10/2026 às 15:00',room:'Sala 1',advisorName:'Orientador',sealed:false,archived:false,elapsedMs:912345,plannedMs:1200000,students:[{id:'s1',name:'Ana Maria',evaluators:[evaluator()],result:{banca:9.99,entrega:8,final:9.99}}],...extra});
const custom=(extra={})=>({...modelApi.defaults(),name:'Modelo da coordenação',title:'Resultados de TCC',boardWeight:70,monographWeight:30,criteriaWeights:{presentation:40,practice:30,code:20,time:10},evaluatorWeights:{alberson:3},decimals:4,...extra});
const textOf=pdf=>[...pdf.paragraphs,...pdf.tables.flatMap(table=>[...table.headers,...table.rows.flat()])].join('\n');
const noCharts={includeCharts:false};
const resultTable=pdf=>pdf.tables.find(table=>table.headers[0]==='Média da banca');

test('custom report exposes every model weight, raw criterion, precise contribution and prepared metadata',()=>{
  const data=board({students:[{id:'s1',name:'Ana Maria',evaluators:[evaluator(),evaluator({uid:'bruno',name:'Bruno',presentation:10,practice:10,code:10,time:10})],result:{banca:9.99,entrega:8,final:9.99}}]});
  const snapshot=structuredClone(data),pdf=new Recorder();
  assert.equal(append(pdf,[data],{model:custom(),...noCharts,preparedBy:'Coordenação 2',issuedAt:'20/10/2026 16:07',scopeLabel:'Curso Computação · turma 2A · inclui arquivadas',notes:'Parecer da coordenação'}),pdf);
  assert.deepEqual(data,snapshot,'report must never overwrite saved grades');
  const text=textOf(pdf);
  for(const value of ['Relatório personalizado · Modelo: Modelo da coordenação','Coordenação 2','20/10/2026 16:07','Curso Computação · turma 2A · inclui arquivadas','Parecer da coordenação','70%','30%','40%','20%','10%','Peso relativo','alberson','bruno','15:12,34','20:00,00','Provisório','0,0000','4,9000','6,1750','4,3225','2,4000','6,7225'])assert.ok(text.includes(value),value);
  assert.deepEqual(resultTable(pdf).rows[0],['6,1750','8,0000','4,3225','2,4000','6,7225']);
  assert.ok(!text.includes('9,9900'),'saved means are not reused');
  assert.ok(pdf.footerLabel.startsWith('Relatório personalizado'));
  assert.ok(pdf.documentTitle.includes('Modelo da coordenação'));
  assert.ok(text.includes('sem arredondamento intermediário'));
});

test('missing positive criteria and monograph stay pending while valid zero scores remain zero',()=>{
  const data=board({sealed:true,students:[{id:'a',name:'Nota incompleta',evaluators:[evaluator({practice:null})],result:{entrega:0}},{id:'b',name:'Monografia pendente',evaluators:[evaluator({presentation:0,practice:0,code:0,time:0})],result:{entrega:null}}]});
  const pdf=new Recorder();append(pdf,[data],{...noCharts,model:custom({decimals:2})});
  const raw=pdf.tables.filter(table=>table.headers[0]==='Avaliador'&&table.headers.length===7);
  assert.deepEqual(raw[0].rows[0],['Alberson','3','0,00','Pendente','9,00','7,00','Pendente']);
  const results=pdf.tables.filter(table=>table.headers[0]==='Média da banca');
  assert.deepEqual(results[0].rows[0],['Pendente','0,00','Pendente','0,00','Pendente']);
  assert.deepEqual(results[1].rows[0],['0,00','Pendente','0,00','Pendente','Pendente']);
  const text=textOf(pdf);assert.ok(text.includes('Parte prática pendente'));assert.ok(text.includes('Monografia e entregas pendentes'));assert.ok(!text.includes('9,99'));
});

test('zero criterion, evaluator and stage weights are explicit and never create false requirements',()=>{
  const data=board({students:[{id:'s',name:'Zero válido',evaluators:[evaluator({presentation:0,practice:null,code:null,time:null}),evaluator({uid:'excluded',name:'Professor excluído',presentation:null,practice:null,code:null,time:null})],result:{entrega:null}}]});
  const model=custom({boardWeight:100,monographWeight:0,criteriaWeights:{presentation:100,practice:0,code:0,time:0},evaluatorWeights:{alberson:2,excluded:0},decimals:0});
  const pdf=new Recorder();append(pdf,[data],{...noCharts,model});
  assert.deepEqual(resultTable(pdf).rows[0],['0','Pendente','0','0','0']);
  const raw=pdf.tables.find(table=>table.headers.length===7);
  assert.deepEqual(raw.rows[0],['Alberson','2','0','Pendente','Pendente','Pendente','0']);
  assert.deepEqual(raw.rows[1],['Professor excluído','0','Pendente','Pendente','Pendente','Pendente','Pendente']);
  assert.ok(textOf(pdf).includes('1 de 1 avaliador(es) com peso positivo'));
  assert.ok(!textOf(pdf).includes('Pendência:'));
  const monographPdf=new Recorder();append(monographPdf,[board({students:[{id:'m',name:'Só monografia',evaluators:[],result:{entrega:0}}]})],{...noCharts,model:custom({boardWeight:0,monographWeight:100,decimals:2})});
  assert.deepEqual(resultTable(monographPdf).rows[0],['Pendente','0,00','0,00','0,00','0,00']);
});

test('summary includes archived boards, unassigned students, pending and provisional results using the selected model',()=>{
  const complete=board({sealed:true,archived:true});
  const provisional=board({id:'open',label:'Banca aberta'});
  const unassigned=board({id:'sem-banca:g',label:'Grupo sem banca',unassigned:true,archived:true,students:[{id:'new',name:'Novo aluno',evaluators:[],result:{entrega:null}}]});
  const pdf=new Recorder();append(pdf,[complete,provisional,unassigned],noCharts);
  const summary=pdf.tables.find(table=>table.headers[0]==='Indicador').rows;
  const count=label=>summary.find(row=>row[0]===label)[1];
  assert.equal(count('Bancas na seleção'),'2');assert.equal(count('Alunos no relatório'),'3');assert.equal(count('Bancas arquivadas'),'1');assert.equal(count('Alunos sem banca'),'1');assert.equal(count('Resultados completos'),'2');assert.equal(count('Resultados completos em bancas encerradas'),'1');assert.equal(count('Resultados completos provisórios'),'1');assert.equal(count('Resultados com pendências'),'1');
  const overview=pdf.tables.find(table=>table.headers[0]==='Aluno / curso / turma');assert.equal(overview.rows.length,3);assert.equal(overview.rows[2].at(-1),'Sem banca');
  for(const value of ['Novo aluno','Arquivada','Grupo sem banca','Sem banca designada','Concluído','Provisório','Aluno sem banca agendada.'])assert.ok(textOf(pdf).includes(value),value);
});

test('configured evaluators outside selection and new default evaluators are documented without changing their weights',()=>{
  const pdf=new Recorder();append(pdf,[board({students:[{id:'s',name:'Aluno',evaluators:[evaluator({uid:'new',name:'Professor novo',presentation:10,practice:10,code:10,time:10})],result:{entrega:10}}]})],{...noCharts,model:custom({evaluatorWeights:{outside:0,outsideWeighted:2,outsideDefault:1}})});
  const weights=pdf.tables.find(table=>table.headers[1]==='Identificador');
  assert.deepEqual(weights.rows,[['Professor novo','new','1'],['Avaliador fora da seleção','outside','0'],['Avaliador fora da seleção','outsideWeighted','2']]);
  assert.ok(!textOf(pdf).includes('outsideDefault'));
  assert.ok(textOf(pdf).includes('atuais e novos: 1'));
  assert.equal(resultTable(pdf).rows[0].at(-1),'10,0000');
});

test('summary continues after model and notes without an unconditional page break and reserves heading space',()=>{
  const pdf=new Recorder(),reservations=[];pdf.ensure=height=>reservations.push(height);
  append(pdf,[board()],{...noCharts,includeDetails:false,notes:'Observação antes do resumo'});
  assert.equal(pdf.pages.length,1);
  assert.deepEqual(reservations,[140]);
  const page=pdf.pages[0];assert.ok(page.indexOf('Observação antes do resumo')<page.indexOf('Resumo dos resultados'));
  assert.ok(pdf.tables.some(table=>table.headers[0]==='Indicador'));
});

test('section flags and charts-only mode preserve model context and pass exact selected chart data',()=>{
  const previous=global.BancaAnalyticsPdf,chart={title:'Escolhido',series:[{label:'Final'}],rows:[{label:'Ana',values:[null]}]},calls=[];
  global.BancaAnalyticsPdf={draw:(...args)=>calls.push(args)};
  try {
    const only=new Recorder();append(only,[board()],{model:custom(),chartsOnly:true,charts:[chart]});
    assert.ok(!only.tables.some(table=>table.headers[0]==='Indicador'||table.headers[0]==='Média da banca'));
    assert.ok(textOf(only).includes('Composição do modelo'));
    assert.ok(textOf(only).includes('Gráficos do modelo personalizado'));
    assert.equal(calls[0][0],only);assert.equal(calls[0][1][0],chart);assert.equal(calls[0][1][0].rows[0].values[0],null);
    const hidden=new Recorder();append(hidden,[board()],{includeSummary:false,includeDetails:false,includeCharts:false,charts:[chart]});
    assert.equal(hidden.tables.length,3);assert.equal(calls.length,1);assert.ok(!textOf(hidden).includes('Gráficos do modelo personalizado'));
    const noDetail=new Recorder();append(noDetail,[board()],{includeDetails:false,includeCharts:false});assert.ok(noDetail.tables.some(table=>table.headers[0]==='Indicador'));assert.ok(!noDetail.tables.some(table=>table.headers[0]==='Média da banca'));
    const noSummary=new Recorder();append(noSummary,[board()],{includeSummary:false,includeCharts:false});assert.ok(!noSummary.tables.some(table=>table.headers[0]==='Indicador'));assert.ok(noSummary.tables.some(table=>table.headers[0]==='Média da banca'));
    const empty=new Recorder();append(empty,[],{charts:[]});assert.ok(textOf(empty).includes('Nenhum gráfico selecionado'));
  } finally {global.BancaAnalyticsPdf=previous;}
});

test('default charts are generated from the same model, and empty data and invalid adapters fail usefully',()=>{
  const previous=global.BancaAnalyticsPdf;let received;
  global.BancaAnalyticsPdf={draw:(pdf,charts)=>{received=charts;}};
  try {
    append(new Recorder(),[board()],{model:custom()});
    assert.equal(received[0].rows[0].values[0],4.9);assert.equal(received[0].decimals,4);
    const empty=new Recorder();append(empty,[],{includeCharts:false});assert.ok(textOf(empty).includes('Nenhum aluno cadastrado'));
    assert.throws(()=>append({},[]),TypeError);
    assert.throws(()=>append(new Recorder(),[],{model:custom({boardWeight:80})}),/somar 100/);
    delete global.BancaAnalyticsPdf;assert.throws(()=>append(new Recorder(),[],{charts:[{}]}),/gráficos ainda não carregaram/);
  } finally {global.BancaAnalyticsPdf=previous;}
  const source=fs.readFileSync(path.join(__dirname,'../assets/weighted-report-pdf.js'),'utf8'),context={};vm.runInNewContext(source,context);
  assert.throws(()=>context.BancaWeightedReportPdf.append(new Recorder(),[],{}),/cálculo dos modelos ainda não carregou/);
});

test('free text is safely bounded, control characters removed and literal text retained',()=>{
  const pdf=new Recorder(),notes='Observação (A) \\ Pesquisa & TCC\u0000'+'N'.repeat(13000);
  append(pdf,[],{...noCharts,title:'Título\u0000 (customizado) & coordenação',notes,issuedAt:new Date('2026-10-20T16:30:00Z')});
  const text=textOf(pdf);assert.ok(text.includes('Título (customizado) & coordenação'));assert.ok(text.includes('Observação (A) \\ Pesquisa & TCC'));assert.ok(!text.includes('\u0000'));
  const note=pdf.paragraphs.find(value=>value.startsWith('Observação (A)'));assert.equal(note.length,12000);assert.ok(text.includes('20/10/2026'));
});

// Exercise the application's own table/header pagination instead of duplicating it.
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function classSource(name){const start=html.indexOf(`class ${name} extends `);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}\n',start)+2);}
class NativeParent {
  constructor(){this.width=595.28;this.height=841.89;this.margin=40;this.bottom=795;this.pages=[];this.issued='20/10/2026';this.responsible='Alberson';this.measure={font:'',measureText:value=>({width:String(value).length*4.6})};this.newPage();}
  rect(x,top,width,height,fill){assert.ok([x,top,width,height].every(Number.isFinite));assert.ok(top+height<=this.bottom+.01);this.pages.at(-1).push({type:'rect',x,top,width,height,fill});}
  text(value,x,top,size=10){assert.ok(top+size<=this.bottom+.01);assert.ok(x+String(value).length*size*.55<=this.width-this.margin+3,`text beyond margin: ${String(value).slice(0,45)}`);this.pages.at(-1).push({type:'text',value:String(value),x,top,size});}
  wrap(value,width,size=10){const max=Math.max(1,Math.floor(width/(size*.55))),out=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){if((line?line.length+1:0)+word.length<=max){line+=(line?' ':'')+word;continue;}if(line){out.push(line);line='';}for(const char of word){if(line.length>=max){out.push(line);line='';}line+=char;}}out.push(line||' ');}return out;}
  ensure(height){if(this.y+height>this.bottom)this.newPage();}
  paragraph(value,size=10,bold=false,color,gap=6){for(const line of this.wrap(value,this.width-2*this.margin-20,size,bold)){this.ensure(size+5);this.text(line,this.margin+10,this.y,size,bold,color);this.y+=size+5;}this.y+=gap;}
}
const NativeEvaluation=vm.runInNewContext(`(${classSource('EvaluationPdf')})`,{SchedulePdf:NativeParent});
const NativePdf=vm.runInNewContext(`(${classSource('CoordinatorReportPdf')})`,{EvaluationPdf:NativeEvaluation,SchedulePdf:NativeParent});
const nativeText=pdf=>pdf.pages.flat().filter(item=>item.type==='text').map(item=>item.value).join('\n');

test('real report tables retain 120 students, every evaluator and pending reason through page continuations',()=>{
  const students=Array.from({length:120},(_,index)=>({id:`s${index}`,name:`Aluno ${String(index).padStart(3,'0')}`,evaluators:[evaluator({name:`Alberson ${index}`}),evaluator({uid:`p${index}`,name:`Professor ${index}`,practice:index%2?null:0})],result:{entrega:index%11}}));
  const pdf=new NativePdf();append(pdf,[board({students})],{...noCharts,model:custom()});
  assert.ok(pdf.pages.length>20);const text=nativeText(pdf);
  for(const student of students){assert.ok(text.includes(student.name),student.name);for(const teacher of student.evaluators)assert.ok(text.includes(teacher.name),teacher.name);}
  assert.ok(text.includes('Aluno 119'));assert.ok(text.includes('continuação'));assert.ok((text.match(/Situação/g)||[]).length>2);assert.ok(text.includes('Pendência:'));assert.ok(pdf.y<=pdf.bottom);
});

test('real report table wraps long student, teacher, board and note text without clipping or data loss',()=>{
  const studentName='Aluno (A) \\ Pesquisa & História '+'Q'.repeat(1700),teacherName='Professor '+'Z'.repeat(1800),pdf=new NativePdf();
  append(pdf,[board({label:'Projeto '+'G'.repeat(1000),students:[{id:'s',name:studentName,evaluators:[evaluator({name:teacherName})],result:{entrega:0}}]})],{...noCharts,model:custom(),notes:'Nota '+'R'.repeat(4000)});
  const text=nativeText(pdf).replace(/\n/g,'');
  assert.ok(text.includes('Aluno (A) \\ Pesquisa & História'));assert.ok((text.match(/Q/g)||[]).length>=3400);assert.equal((text.match(/Z/g)||[]).length,3600);assert.equal((text.match(/G/g)||[]).length>=2000,true);assert.ok((text.match(/R/g)||[]).length>=4000);assert.ok(text.includes('3,4300'));assert.ok(pdf.pages.length>8);assert.ok(pdf.y<=pdf.bottom);
});

test('complete custom report and vector charts paginate together with zero and missing chart values intact',()=>{
  const chartsModule=require('../assets/analytics-pdf.js'),previous=global.BancaAnalyticsPdf;global.BancaAnalyticsPdf=chartsModule;
  const pdf=new NativePdf(),rows=Array.from({length:75},(_,index)=>({label:`Aluno gráfico ${index}`,values:[index%2?0:null,index%11]}));
  try {append(pdf,[board()],{model:custom(),charts:[{title:'Notas por aluno do modelo',subtitle:'Todos os registros, inclusive pendências',series:[{label:'Banca ponderada'},{label:'Monografia'}],rows}]});}
  finally {global.BancaAnalyticsPdf=previous;}
  const text=nativeText(pdf);for(const value of ['Gráficos do modelo personalizado','Notas por aluno do modelo','Aluno gráfico 74','CONTINUAÇÃO','Não registrado','0,00','5,8300'])assert.ok(text.includes(value),value);
  assert.ok(pdf.pages.length>5);assert.ok(pdf.pages.flat().every(item=>item.type==='rect'||item.type==='text'));assert.ok(pdf.y<=pdf.bottom);
});
