// Integration check with a local Vite server; no live database writes.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],{stdio:'ignore'});
let browser;
try {
  for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:5174')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser = await chromium.launch({headless:true, ...(process.env.CLOCK_TEST_BROWSER ? {executablePath:process.env.CLOCK_TEST_BROWSER,args:['--no-sandbox']} : {})});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174');
  const results = await page.evaluate(async () => {
    const {buildTimesheet} = await import('/src/lib/timesheetTemplate.ts');
    const source = await (await fetch('/src/assets/folha-ponto-modelo.xlsx')).arrayBuffer();
    const p = {id:'p1',name:'Moisés de Couto Almeida',job_title:'Analista de redes'};
    const entries = ['11:00','15:00','16:00','21:00'].map((t,i)=>({user_id:'p1',timestamp:`2026-09-01T${t}:00Z`,type:['entry_1','exit_1','entry_2','exit_2'][i]}));
    entries.push({user_id:'p2',timestamp:'2026-09-02T11:00:00Z',type:'entry_1'});
    entries.push({user_id:'p1',timestamp:'2026-09-02T11:00:00Z',type:'entry_1',voided_at:'2026-09-02T12:00:00Z'});
    entries.push({user_id:'p1',timestamp:'2026-10-01T01:00:00Z',type:'exit_2'});
    const occurrences = [{user_id:'p1',date:'2026-09-01',type:'other',description:'=HYPERLINK("x") <teste> & texto',status:'pending'}, {user_id:'p2',date:'2026-09-01',type:'other',description:'OUTRO FUNCIONARIO',status:'approved'}];
    async function encode(blob) { return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);}); }
    const outputs = {};
    for (const m of ['2026-09','2026-10','2026-02','2028-02']) outputs[m] = await encode(await buildTimesheet(source,p,entries,m,occurrences,'2026-09-25'));
    let duplicate = false;
    try {await buildTimesheet(source,p,[entries[0],entries[0]],'2026-09',[]);} catch(e) {duplicate = /duplicadas/.test(e.message);}
    let invalid = false;
    try {await buildTimesheet(source,p,[],'2026-13',[]);} catch(e) {invalid = /válido/.test(e.message);}
    return {outputs,duplicate,invalid};
  });
  assert.ok(results.duplicate); assert.ok(results.invalid);
  const original = await JSZip.loadAsync(await fs.readFile('src/assets/folha-ponto-modelo.xlsx'));
  const xmlOriginal = await original.file('xl/worksheets/sheet2.xml').async('string');
  const cell = (xml,ref) => xml.match(new RegExp(`<c\\b[^>]*r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`))?.[0] ?? '';
  for (const [month,data] of Object.entries(results.outputs)) {
    const bytes = Buffer.from(data,'base64'), zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet2.xml').async('string');
    assert.match(cell(xml,'C7'),/Moisés de Couto Almeida/);
    assert.match(cell(xml,'C6'),/Analista de redes/);
    for(const tag of ['cols','mergeCells','pageMargins','pageSetup']) assert.equal(xml.match(new RegExp(`<${tag}\\b[\\s\\S]*?(?:</${tag}>|/>)`))?.[0],xmlOriginal.match(new RegExp(`<${tag}\\b[\\s\\S]*?(?:</${tag}>|/>)`))?.[0]);
    for(const path of Object.keys(original.files).filter(p=>/xl\/(drawings|media|embeddings|printerSettings)\//.test(p)&&!original.files[p].dir)) assert.deepEqual(await zip.file(path).async('uint8array'),await original.file(path).async('uint8array'));
    assert.equal(zip.file('xl/calcChain.xml'),null);
    const helper=await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.doesNotMatch(helper,/Mateus|Liriel|Robson|Leonardo/);
    if(month==='2026-09') {
      const numeric = ref => Number(cell(xml,ref).match(/<v>(.*?)<\/v>/)?.[1]);
      assert.ok(Math.abs(numeric('C13')-8/24)<1e-10);
      assert.ok(Math.abs(numeric('D13')-12/24)<1e-10);
      assert.ok(Math.abs(numeric('E13')-13/24)<1e-10);
      assert.ok(Math.abs(numeric('F13')-18/24)<1e-10);
      assert.ok(Math.abs(numeric('F42')-22/24)<1e-10);
      assert.doesNotMatch(cell(xml,'C14'),/<v>/);
      assert.doesNotMatch(cell(xml,'A43'),/<v>/);
      const occ=await zip.file('xl/worksheets/ocorrencias.xml').async('string');
      assert.match(occ,/HYPERLINK/);assert.doesNotMatch(occ,/<f[ >]|OUTRO FUNCIONARIO/);
      await fs.mkdir('/tmp/ponto-excel-qa',{recursive:true});
      await fs.writeFile('/tmp/ponto-excel-qa/sample.xlsx',bytes);
    }
    if(month==='2026-10') assert.match(cell(xml,'A43'),/<v>/);
    if(month==='2026-02') {assert.match(cell(xml,'A40'),/<v>/);assert.doesNotMatch(cell(xml,'A41'),/<v>/);}
    if(month==='2028-02') {assert.match(cell(xml,'A41'),/<v>/);assert.doesNotMatch(cell(xml,'A42'),/<v>/);}
  }
  // Exercise the actual download button handler, including multi-employee ZIP.
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async()=>{const {exportReport}=await import('/src/lib/excelExport.ts');await exportReport([{id:'1',name:'Mesmo Nome',job_title:'Redes'},{id:'2',name:'Mesmo Nome',job_title:'Motorista'}],[],'2026-09',[]);});
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'folhas-de-ponto-2026-09.zip');
  const archive=await JSZip.loadAsync(await fs.readFile(await download.path()));
  assert.equal(Object.keys(archive.files).length,2);
  console.log('PASS: model preservation, identity, punches, time zone, cancelled records, month boundaries, occurrence isolation, formula safety, duplicates, multiple download.');
} finally {await browser?.close();server.kill();}
