import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MODELS,DEFAULT_PROMPT} from '../../public/js/models.js';
import {effectivePaidSettings} from '../../public/js/checkpoint-effective-settings.js';
const app=readFileSync(new URL('../../public/js/app.js',import.meta.url),'utf8');
function between(a,b){const start=app.indexOf(a),end=app.indexOf(b,start);assert.ok(start>=0&&end>start,a);return app.slice(start,end);}
const functions=[
 between('function prefString(','function loadPrefs('),
 between('function loadPrefs(','const GPT_TRANSCRIBE_REGIONAL_LANGUAGE_CODES='),
 between('const GPT_TRANSCRIBE_REGIONAL_LANGUAGE_CODES=','function renderStats(')
].join('\n');
function harness(raw,{getThrows=false,setThrows=false,withoutObjectHasOwn=false}={}){
 let stored=raw,writes=0;const failures=[],options=[];
 const modelSelect={append(o){options.push(o)},get value(){return this.selected||''},set value(v){this.selected=options.some(o=>o.value===String(v))?String(v):''}};
 const UI={modelSelect,themeBtn:{},modelHelp:{},chunkLabel:{},durationLabel:{}};
 for(const key of ['languageInput','chunkRange','durationRange','retrySelect','keywordsInput','promptInput','previousContext','includeTimestamps','exportTxt','exportMd','mergeFiles','continueOnError'])UI[key]={value:'',checked:false};
 const context=vm.createContext({MODELS,DEFAULT_PROMPT,UI,
  document:{documentElement:{dataset:{}},createElement(){return {value:'',textContent:''}}},
  localStorage:{getItem(){if(getThrows)throw Error('synthetic storage denied');return stored},setItem(k,v){if(setThrows)throw Error('synthetic storage write denied');stored=v;writes++}},
  truncateUtf16Safe:(s,n)=>s.slice(0,n),preferenceFailure:(stage)=>failures.push(stage),addDiag(){},
  state:{running:false,queue:[]},preparedQueueItem:()=>true,MAX_COMBINED_FILES:10,prepareDownloads(){},renderStats(){}});
 if(withoutObjectHasOwn)vm.runInContext('Object.hasOwn=undefined',context);
 const defaults=app.match(/^const DEFAULTS=.*;$/m)?.[0];assert.ok(defaults);
 vm.runInContext(defaults+'\nconst PREF_KEY="synthetic-preferences";\n'+functions,context,{timeout:1000});
 return {context,UI,options,failures,read:()=>vm.runInContext('readSettings()',context),
  init:()=>vm.runInContext('initSettings()',context),load:()=>vm.runInContext('loadPrefs()',context),
  stored:()=>stored,writes:()=>writes};
}
for(const id of Object.keys(MODELS))test('saved '+id+' survives load, picker, help and persisted settings without substitution',()=>{
 const h=harness(JSON.stringify({model:id,languages:'zh',prompt:'synthetic context',keywords:'synthetic term'}));h.init();
 assert.equal(h.UI.modelSelect.value,id);assert.equal(h.UI.modelHelp.textContent,MODELS[id].help);
 assert.deepEqual(h.options.map(o=>o.value),Object.keys(MODELS));
 const s=h.read();assert.equal(s.model,id);assert.equal(s.diarize,MODELS[id].diarize);
 assert.equal(s.prompt,MODELS[id].prompt?'synthetic context':'');
 assert.equal(s.keywords.length,MODELS[id].keywords?1:0);
 assert.equal(s.previousContext,MODELS[id].previous);
 assert.equal(JSON.parse(h.stored()).model,id);
 assert.equal(effectivePaidSettings(s,'mp3').model,id);assert.deepEqual(h.failures,[]);
});
for(const id of ['whisper-1','gpt-live-transcribe','removed-model','',null,42,['gpt-4o-transcribe-diarize'],{},'toString','constructor','__proto__','hasOwnProperty'])
 test('invalid saved selection '+JSON.stringify(id)+' restores a valid explicit default',()=>{
  const h=harness(JSON.stringify({model:id}));assert.equal(h.load().model,'gpt-transcribe');h.init();
  assert.equal(h.UI.modelSelect.value,'gpt-transcribe');assert.equal(h.read().model,'gpt-transcribe');
  assert.equal(JSON.parse(h.stored()).model,'gpt-transcribe');
 });
for(const raw of ['not-json','null','[]','42'])test('malformed preference object '+raw+' recovers without losing valid picker',()=>{
 const h=harness(raw);h.init();assert.equal(h.read().model,'gpt-transcribe');assert.ok(h.failures.length>0);
});
test('missing preferences use existing default',()=>{const h=harness(null);h.init();assert.equal(h.read().model,'gpt-transcribe')});
test('read failure uses default and records safe load category',()=>{const h=harness(null,{getThrows:true});h.init();assert.equal(h.read().model,'gpt-transcribe');assert.ok(h.failures.includes('load'))});
test('save failure preserves selected retiring model and reports save category',()=>{
 const h=harness(JSON.stringify({model:'gpt-4o-transcribe-diarize'}),{setThrows:true});h.init();
 assert.equal(h.read().model,'gpt-4o-transcribe-diarize');assert.ok(h.failures.includes('save'));
});
for(const model of ['toString','constructor','removed-model'])test('settings boundary rejects forged invalid model '+model,()=>{
 const h=harness(null);h.init();Object.defineProperty(h.UI.modelSelect,'value',{value:model});
 assert.throws(()=>h.read(),/supported completed-file/);
});
test('changing model alters effective checkpoint settings instead of reusing old identity',()=>{
 const a=harness(JSON.stringify({model:'gpt-4o-transcribe-diarize'}));a.init();
 const b=harness(JSON.stringify({model:'gpt-transcribe'}));b.init();
 assert.notEqual(JSON.stringify(effectivePaidSettings(a.read(),'mp3')),JSON.stringify(effectivePaidSettings(b.read(),'mp3')));
});
test('load/init/save never dispatches a provider request',()=>{
 const h=harness(JSON.stringify({model:'gpt-4o-transcribe-diarize'}));
 h.context.fetch=()=>{throw Error('unexpected network')};h.context.api=()=>{throw Error('unexpected API')};
 h.init();h.read();assert.equal(h.writes(),1);
});
test('restoration and strict validation do not require Object.hasOwn',()=>{
 for(const id of [...Object.keys(MODELS),'toString','constructor','__proto__']){
  const h=harness(JSON.stringify({model:id}),{withoutObjectHasOwn:true});h.init();
  assert.equal(h.read().model,Object.prototype.hasOwnProperty.call(MODELS,id)?id:'gpt-transcribe');
  assert.deepEqual(h.failures,[]);
 }
 const h=harness(null,{withoutObjectHasOwn:true});h.init();
 Object.defineProperty(h.UI.modelSelect,'value',{value:'toString'});
 assert.throws(()=>h.read(),/supported completed-file/);
});

