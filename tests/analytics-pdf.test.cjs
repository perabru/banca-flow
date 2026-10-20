const assert = require('node:assert/strict');
const { test } = require('node:test');
const { draw, formatDuration } = require('../assets/analytics-pdf.js');
class Pdf {
  constructor() { this.width=595.28;this.height=841.89;this.margin=40;this.bottom=795;this.pages=[];this.newPage(); }
  newPage(){this.pages.push([]);this.y=149;this.contentTop=149;}
  ensure(h){if(this.y+h>this.bottom)this.newPage();}
  rect(x,top,width,height,fill){
    assert.ok([x,top,width,height].every(Number.isFinite),'finite rectangles');
    assert.ok(x>=this.margin-.01 && x+width<=this.width-this.margin+.01,`rectangle width: ${x}+${width}`);
    assert.ok(top>=149 && top+height<=this.bottom+.01,`rectangle height: ${top}+${height}`);
    assert.ok(width>=0 && height>=0,'positive rectangles');
    this.pages.at(-1).push({type:'rect',x,top,width,height,fill});
  }
  text(value,x,top,size=10,bold=false,color){
    assert.ok([x,top,size].every(Number.isFinite),'finite text positions');
    assert.ok(top>=149 && top+size<=this.bottom+.01,`text height: ${top}+${size}`);
    assert.ok(x>=this.margin && x+String(value).length*size*.55<=this.width-this.margin+1,`text width: ${value}`);
    this.pages.at(-1).push({type:'text',value:String(value),x,top,size,bold,color});
  }
  wrap(value,width,size=10){
    const output=[];
    for(const paragraph of String(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if((line?line.length+1:0)+word.length<=Math.floor(width/(size*.55))){line+=(line?' ':'')+word;continue;}
        if(line){output.push(line);line='';}
        for(const ch of word){if((line.length+1)*size*.55>width){output.push(line);line='';}line+=ch;}
      }
      output.push(line||' ');
    }
    return output;
  }
}
const textOf=pdf=>pdf.pages.flat().filter(item=>item.type==='text').map(item=>item.value).join('\n');
const spec=(options={})=>({title:'Notas individuais dos alunos',subtitle:'Banca × 60% + entregas × 40%.',unit:'grade',max:10,series:[{label:'Média da banca',color:'#174B8E'},{label:'Entregas',color:'#087F8C'},{label:'Nota final',color:'#B4223B'}],rows:[{label:'Ana Maria',values:[0,null,7.8]},{label:'Bruno',values:[10,9,9.6]}],...options});
test('vector chart keeps zero, missing values, exact grades, labels and grade scale',()=>{
 const pdf=new Pdf();assert.equal(draw(pdf,[spec()]),pdf);const text=textOf(pdf);
 for(const value of ['Notas individuais dos alunos','Média da banca','Ana Maria','0,00','Não registrado','7,80','10,00','9,60','nota / 10'])assert.ok(text.includes(value),value);
 assert.ok(pdf.pages.flat().some(item=>item.type==='rect'&&item.fill==='#B4223B'));
 assert.ok(!pdf.pages.flat().some(item=>item.type==='image'));
});
test('100+ rows paginate with repeated chart title, legend, scale and every exact value',()=>{
 const rows=Array.from({length:125},(_,i)=>({label:`Aluno ${i+1} · Engenharia de Computação · Turma 2A`,values:[(i%100)/10,8,9]}));
 const pdf=new Pdf();draw(pdf,[spec({rows})]);assert.ok(pdf.pages.length>10);
 for(const row of rows)assert.ok(textOf(pdf).includes(row.label),row.label);
 for(const page of pdf.pages.slice(1)){
  const text=page.filter(item=>item.type==='text').map(item=>item.value).join(' ');
  assert.ok(text.includes('CONTINUAÇÃO'));assert.ok(text.includes('Média da banca'));assert.ok(text.includes('nota / 10'));
 }
});
test('long names, unbroken labels and huge legends flow without clipping or hanging',()=>{
 const label='Q'.repeat(4000),series=Array.from({length:30},(_,i)=>({label:`Professor ${i} ${'Departamento de Engenharia '.repeat(25)}`}));
 const pdf=new Pdf();draw(pdf,[spec({title:'Título '.repeat(200),subtitle:'Descrição '.repeat(200),series,rows:[{label,values:Array(30).fill(8)},{label:'Último aluno',values:Array(30).fill(0)}]})]);
 assert.ok(pdf.pages.length>5);const text=textOf(pdf).replace(/\n/g,'');assert.equal((text.match(/Q/g)||[]).length,label.length);assert.ok(text.includes('Último aluno'));
 for(let i=0;i<30;i++)assert.ok(text.includes(`Professor ${i}`));
 assert.ok(pdf.y<=pdf.bottom);
});
test('stacked weights keep both exact components and their final sum selectable',()=>{
 const pdf=new Pdf();draw(pdf,[spec({mode:'stacked',series:[{label:'Banca × 60%'},{label:'Entregas × 40%'}],rows:[{label:'Ana',values:[4.2,3.6]},{label:'Bruno',values:[0,0]},{label:'Carla',values:[null,2]}]})]);
 for(const value of ['4,20','3,60','7,80','0,00','Não registrado','Parcial'])assert.ok(textOf(pdf).includes(value),value);
});
test('duration charts use milliseconds, preserve centiseconds and allow missing and zero',()=>{
 const pdf=new Pdf();draw(pdf,[spec({unit:'duration',max:1800000,rows:[{label:'Banca 01',values:[0,123456,null]},{label:'Banca 02',values:[1800000,59999,60000]}]})]);
 const text=textOf(pdf);for(const value of ['00:00,00','02:03,45','30:00,00','00:59,99','01:00,00','min:seg,cc','Não registrado'])assert.ok(text.includes(value),value);
 assert.equal(formatDuration(9),'00:00,00');assert.equal(formatDuration(3723456),'62:03,45');
});
test('empty series and empty rows produce a useful bounded message',()=>{
 const pdf=new Pdf();draw(pdf,[spec({rows:[]}),spec({series:[]})]);assert.equal((textOf(pdf).match(/Não há dados/g)||[]).length,2);
});
test('ordinary four-criterion charts stay intact with two or three evaluators',()=>{
 for(const count of [2,3]){
  const pdf=new Pdf();pdf.y=610;
  const series=Array.from({length:count},(_,i)=>({label:`Professor avaliador ${i+1}`}));
  const rows=['Apresentação','Parte prática','Domínio do código','Domínio do tempo'].map(label=>({label,values:Array(count).fill(8)}));
  draw(pdf,[spec({title:'Notas dos avaliadores · Ana',subtitle:'Notas individuais salvas em cada critério, sem ponderação. Escala fixa de 0 a 10 para facilitar a comparação.',series,rows})]);
  assert.equal(pdf.pages.length,2,`${count} avaliadores: um gráfico completo na página seguinte`);
  assert.equal(pdf.pages[0].length,0,'o gráfico não começa no restante da página anterior');
  const text=pdf.pages[1].filter(item=>item.type==='text').map(item=>item.value).join(' ');
  for(const row of rows)assert.ok(text.includes(row.label));
  assert.ok(!text.includes('CONTINUAÇÃO'));
 }
});

test('grade precision formats grouped PDF labels consistently from zero through four decimals',()=>{
 for(const [decimals,expected,zero] of [[0,'8','0'],[1,'8,3','0,0'],[3,'8,318','0,000'],[4,'8,3175','0,0000']]){
  const source=spec({decimals,rows:[{label:'Ana',values:[0,null,8.3175]}]}),before=JSON.stringify(source),pdf=new Pdf();
  draw(pdf,[source]);
  const values=pdf.pages.flat().filter(item=>item.type==='text'&&item.size===8.5).map(item=>item.value);
  assert.deepEqual(values,[zero,'Não registrado',expected]);
  assert.equal(JSON.stringify(source),before,'source values remain unrounded');
 }
});

test('omitted or invalid precision keeps two decimals and matches SVG rounding',()=>{
 for(const decimals of [undefined,null,'3',-1,5,2.5,NaN,Infinity]){
  const pdf=new Pdf();draw(pdf,[spec({decimals,series:[{label:'Resultado'}],rows:[{label:'Ana',values:[1.005]}]})]);
  assert.ok(textOf(pdf).includes('1,01'),'same locale rounding as the table and SVG');
 }
 const pdf=new Pdf();draw(pdf,[spec({unit:'duration',decimals:0,max:1800000,rows:[{label:'Banca',values:[0,123459,null]}]})]);
 assert.ok(textOf(pdf).includes('02:03,45'),'duration keeps centiseconds');
});

test('stacked PDF charts apply display precision to components and their exact sum',()=>{
 const pdf=new Pdf();draw(pdf,[spec({mode:'stacked',decimals:3,series:[{label:'Banca'},{label:'Entrega'}],rows:[{label:'Ana',values:[5.6174,2.7002]}]})]);
 const values=pdf.pages.flat().filter(item=>item.type==='text'&&item.size===8.5).map(item=>item.value);
 assert.deepEqual(values,['8,318','5,617','2,700']);
});
