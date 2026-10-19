const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { append } = require('../assets/coordinator-report-pdf.js');
class Recorder {
 constructor(){this.width=595.28;this.margin=40;this.pages=[[]];this.tables=[];this.paragraphs=[];}
 paragraph(value,...options){this.paragraphs.push(String(value));this.pages.at(-1).push(String(value));}
 table(headers,rows,widths,options){assert.equal(headers.length,widths.length);assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-(this.width-2*this.margin))<.01);for(const row of rows)assert.equal(row.length,headers.length);this.tables.push({headers,rows,widths,options});}
 newPage(){this.pages.push([]);}
}
const evaluator=(extra={})=>({uid:'alberson',name:'Alberson',presentation:0,practice:8,code:9,time:7,mean:6,...extra});
const board=(extra={})=>({id:'b1',label:'Grupo A',project:'Projeto & (ensaio)',courseName:'Computação',className:'2A',startLabel:'19/10/2026 às 15:00',room:'Sala 1',advisorName:'Orientador',sealed:false,archived:false,elapsedMs:null,plannedMs:1200000,students:[{id:'s1',name:'Ana Maria',evaluators:[evaluator()],result:{banca:6,entrega:9,parcelaBanca:3.6,parcelaEntrega:3.6,final:7.2},status:'Provisório'}],...extra});
const textOf=pdf=>[...pdf.paragraphs,...pdf.tables.flatMap(table=>[...table.headers,...table.rows.flat()])].join('\n');
test('complete, open and zero grades retain every individual score and weighted result',()=>{
 const pdf=new Recorder();assert.equal(append(pdf,[board()],{scopeLabel:'Todos os alunos cadastrados'}),pdf);const text=textOf(pdf);
 for(const value of ['Alberson','Ana Maria','0,00','8,00','9,00','7,00','6,00','3,60','7,20','Provisório','Todos os alunos cadastrados','Monografia / entregas','Média parcial da banca: 6,00'])assert.ok(text.includes(value),value);
 assert.equal(pdf.tables.find(table=>table.headers[0]==='Avaliador').rows[0].at(-1),'6,00');
});
test('incomplete criteria never use stale means and pending final is explicit without replacing missing scores with zero',()=>{
 const data=board({students:[{id:'s1',name:'Ana',evaluators:[evaluator({practice:null,mean:9.99}),evaluator({uid:'other',name:'Bruno',presentation:10,practice:10,code:10,time:10,mean:10})],result:{banca:null,entrega:0,parcelaBanca:null,parcelaEntrega:0,final:null}}]});
 const pdf=new Recorder();append(pdf,[data]);const text=textOf(pdf);const individuals=pdf.tables.find(table=>table.headers[0]==='Avaliador');
 assert.deepEqual(individuals.rows[0],['Alberson','0,00','Pendente','9,00','7,00','Pendente']);
 assert.ok(text.includes('Média parcial da banca: 10,00'));assert.ok(text.includes('1 de 2 avaliador(es)'));assert.ok(text.includes('Pendente · Provisório'));assert.ok(!text.includes('9,99'));
 const result=pdf.tables.find(table=>table.headers[0]==='Média da banca');assert.deepEqual(result.rows[0],['Pendente','0,00','Pendente','0,00','Pendente']);
});
test('archived boards, missing group fallback and registered students without boards remain in overview and details',()=>{
 const archived=board({label:'Banca com grupo indisponível',archived:true,sealed:true,students:[{id:'old',name:'Aluno histórico',evaluators:[evaluator()],result:{banca:6,entrega:null,final:null}}]});
 const unassigned=board({id:'unassigned',label:'Sem banca',unassigned:true,students:[{id:'new',name:'Aluno recém-cadastrado',evaluators:[],result:{}}]});
 const pdf=new Recorder();append(pdf,[archived,unassigned]);const text=textOf(pdf);
 for(const value of ['Aluno histórico','Aluno recém-cadastrado','Banca com grupo indisponível','Arquivada','Sem banca designada','Pendente'])assert.ok(text.includes(value),value);
 assert.equal(pdf.tables.find(table=>table.headers[0]==='Aluno / curso / turma').rows.length,2);
 const summary=pdf.tables[0].rows;assert.equal(summary.find(row=>row[0]==='Bancas')[1],'1');assert.equal(summary.find(row=>row[0]==='Alunos sem banca')[1],'1');
});
test('provided summary statistics and chart scope are used while exact chart nulls pass through',()=>{
 const pdf=new Recorder(),charts=[{title:'Todos os alunos',series:[{label:'Nota final'}],rows:[{label:'Ana',values:[null]}]}];let call;
 const previous=global.BancaAnalyticsPdf;global.BancaAnalyticsPdf={draw:(...args)=>{call=args;},formatDuration:()=> '02:03,45'};
 try {append(pdf,[board({elapsedMs:123456})],{scopeLabel:'Todos os 150 alunos',summary:{studentCount:150,boardCount:25,officialCount:100,provisionalCount:3,pendingCount:47,unassignedCount:10},charts});}
 finally {global.BancaAnalyticsPdf=previous;}
 assert.equal(call[0],pdf);assert.equal(call[1],charts);assert.equal(call[1][0].rows[0].values[0],null);
 const text=textOf(pdf);for(const value of ['150','25','100','47','10','Todos os 150 alunos','resultados parciais','02:03,45'])assert.ok(text.includes(value),value);
});
test('empty datasets produce a useful report and invalid PDF adapters fail clearly',()=>{
 const pdf=new Recorder();append(pdf,[]);assert.ok(textOf(pdf).includes('Nenhum aluno cadastrado'));assert.throws(()=>append({},[]),TypeError);
 const previous=global.BancaAnalyticsPdf;delete global.BancaAnalyticsPdf;try{assert.throws(()=>append(new Recorder(),[],{charts:[{}]}),/gráficos ainda não carregaram/);}finally{global.BancaAnalyticsPdf=previous;}
});
// Exercise the repository's real table pagination rather than a second implementation.
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const nativeClass=html.slice(html.indexOf('class EvaluationPdf extends SchedulePdf'),html.indexOf('\n}\n',html.indexOf('class EvaluationPdf extends SchedulePdf'))+2);
class NativeParent {
 constructor(){this.width=595.28;this.height=841.89;this.margin=40;this.bottom=795;this.pages=[];this.issued='19/10/2026';this.responsible='Alberson';this.measure={font:'',measureText:value=>({width:String(value).length*4.6})};this.newPage();}
 rect(x,top,width,height,fill){assert.ok([x,top,width,height].every(Number.isFinite));assert.ok(top+height<=this.bottom+.01);this.pages.at(-1).push({type:'rect',x,top,width,height,fill});}
 text(value,x,top,size=10){assert.ok(top+size<=this.bottom+.01);assert.ok(x+String(value).length*size*.55<=this.width-this.margin+3,`text beyond margin: ${String(value).slice(0,45)}`);this.pages.at(-1).push({type:'text',value:String(value),x,top,size});}
 wrap(value,width,size=10){const max=Math.max(1,Math.floor(width/(size*.55))),out=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/\s+/).filter(Boolean)){if((line?line.length+1:0)+word.length<=max){line+=(line?' ':'')+word;continue;}if(line){out.push(line);line='';}for(const ch of word){if(line.length>=max){out.push(line);line='';}line+=ch;}}out.push(line||' ');}return out;}
 ensure(height){if(this.y+height>this.bottom)this.newPage();}
 paragraph(value,size=10,bold=false,color,gap=6){for(const line of this.wrap(value,this.width-2*this.margin-20,size,bold)){this.ensure(size+5);this.text(line,this.margin+10,this.y,size,bold,color);this.y+=size+5;}this.y+=gap;}
}
const NativePdf=vm.runInNewContext(`(${nativeClass})`,{SchedulePdf:NativeParent});
const nativeText=pdf=>pdf.pages.flat().filter(item=>item.type==='text').map(item=>item.value).join('\n');
test('real table pagination repeats headings and preserves every student and evaluator on many pages',()=>{
 const students=Array.from({length:120},(_,i)=>({id:`s${i}`,name:`Aluno ${String(i).padStart(3,'0')}`,evaluators:[evaluator({name:`Alberson ${i}`}),evaluator({name:`Avaliador ${i}`,practice:null})],result:{banca:null,entrega:i%11,parcelaBanca:null,parcelaEntrega:(i%11)*.4,final:null}}));
 const pdf=new NativePdf();append(pdf,[board({students})]);assert.ok(pdf.pages.length>20);const text=nativeText(pdf);
 for(const student of students){assert.ok(text.includes(student.name),student.name);for(const item of student.evaluators)assert.ok(text.includes(item.name),item.name);}
 assert.ok(pdf.pages.slice(1).some(page=>page.filter(item=>item.type==='text').map(item=>item.value).join(' ').includes('continuação')));
 assert.ok((text.match(/Situação/g)||[]).length>2,'overview headings repeat');assert.ok(pdf.y<=pdf.bottom);
});
test('native tables flow exceptionally long names and literal punctuation without clipping or losing values',()=>{
 const name='Aluno (A) \\ História & Pesquisa '+ 'Q'.repeat(1700),teacher='Professor '+ 'Z'.repeat(1800),pdf=new NativePdf();
 append(pdf,[board({label:'Projeto '+ 'G'.repeat(1000),students:[{id:'s',name,evaluators:[evaluator({name:teacher})],result:{banca:6,entrega:0,parcelaBanca:3.6,parcelaEntrega:0,final:3.6}}]})]);
 const text=nativeText(pdf).replace(/\n/g,'');assert.ok(text.includes('Aluno (A) \\ História & Pesquisa'));assert.ok((text.match(/Q/g)||[]).length>=3400);assert.equal((text.match(/Z/g)||[]).length,1800);assert.ok(text.includes('3,60'));assert.ok(pdf.pages.length>5);
});

test('complete report and vector charts paginate together with missing and zero notes retained',()=>{
 const chartsModule=require('../assets/analytics-pdf.js'),previous=global.BancaAnalyticsPdf;global.BancaAnalyticsPdf=chartsModule;
 const pdf=new NativePdf(),rows=Array.from({length:75},(_,i)=>({label:`Aluno ${i}`,values:[i%2?0:null,(i%11)]}));
 try {append(pdf,[board()],{charts:[{title:'Notas de todos os alunos',subtitle:'Inclui pendências',unit:'grade',series:[{label:'Média da banca'},{label:'Monografia'}],rows}]});}
 finally {global.BancaAnalyticsPdf=previous;}
 const text=nativeText(pdf);for(const value of ['Gráficos de todos os alunos','Notas de todos os alunos','Aluno 74','CONTINUAÇÃO','0,00','Não registrado'])assert.ok(text.includes(value),value);
 assert.ok(pdf.pages.length>5);assert.ok(pdf.pages.flat().every(item=>item.type==='rect'||item.type==='text'));assert.ok(pdf.y<=pdf.bottom);
});
