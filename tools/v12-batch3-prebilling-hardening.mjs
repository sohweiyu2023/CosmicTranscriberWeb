#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const argv=process.argv.slice(2);
function arg(name){const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;}
const root=arg('--root');
if(!root){console.error('Usage: node v12-batch3-prebilling-hardening.mjs --root <V1.2 source root>');process.exit(2);}
const resolved=path.resolve(root);
function fail(msg){console.error(`V1.2 Batch3 prebilling hardening BLOCKED: ${msg}`);process.exit(1);}
function regular(rel){const f=path.join(resolved,rel);if(!fs.existsSync(f)||!fs.statSync(f).isFile()||fs.lstatSync(f).isSymbolicLink())fail(`${rel} is not a regular file`);return f;}
function read(rel){return fs.readFileSync(regular(rel),'utf8');}
function write(rel,text){fs.writeFileSync(path.join(resolved,rel),text,'utf8');}
function occurrence(text,needle){let n=0,pos=0;while((pos=text.indexOf(needle,pos))>=0){n++;pos+=needle.length;}return n;}
function insertionPoint(text,anchor,label){const count=occurrence(text,anchor);if(count!==1)fail(`${label} anchor count ${count}, expected exactly 1`);return text.indexOf(anchor);}

const TEST_MARKERS=[
  "rejects malformed direct-format audio before paid dispatch and leaves the attempt reusable",
  "rejects direct-format MIME mismatch before paid dispatch and leaves the attempt reusable",
  "rejects oversized direct-format metadata before paid dispatch and leaves the attempt reusable"
];
const GUARD_MARKER='Worker direct-format validation precedes paid-dispatch receipt and has zero-dispatch integration proof';
const MUTATION_MARKER='bypass Worker direct-format body validation before paid dispatch';

const integrationRel='tests/integration/worker.test.js';
const auditRel='scripts/audit-lib.mjs';
const mutationRel='scripts/mutation-suite.mjs';
let integration=read(integrationRel),audit=read(auditRel),mutation=read(mutationRel);

const presentTests=TEST_MARKERS.filter(m=>integration.includes(m));
const guardPresent=audit.includes(GUARD_MARKER);
const mutationPresent=mutation.includes(MUTATION_MARKER);
const presentCount=presentTests.length+Number(guardPresent)+Number(mutationPresent);
if(presentCount!==0&&presentCount!==5){
  fail(`partial prior application detected (${presentCount}/5 markers present); refusing to guess or duplicate edits`);
}
if(presentCount===5){
  console.log('V1.2 Batch3 prebilling hardening already present: 5/5 markers; no changes needed.');
  process.exit(0);
}

const tests=`\n\n  it('rejects malformed direct-format audio before paid dispatch and leaves the attempt reusable',async()=>{\n    let upstreamHits=0;\n    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',()=>{upstreamHits++;return HttpResponse.json({text:'ok'},{headers:{'x-request-id':'req_prebill_malformed'}})}));\n    const cookie=await createSession('prebill-malformed-key');\n    const valid=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45,1,2,3,4]);\n    const invalid=Uint8Array.from([0x4e,0x4f,0x50,0x45,0,0,0,0,0x42,0x41,0x44,0x21,1,2,3,4]);\n    const meta=metadata({v:2,audioFormat:'wav',declaredBytes:invalid.length,jobId:'job-prebill-malformed',fileId:'file-prebill-malformed',attemptId:'attempt-prebill-malformed'});\n    const bad=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/wav','X-Cosmic-Metadata':encodeMeta(meta),Cookie:cookie}),body:invalid});\n    expect(bad.status).toBe(415);\n    expect(upstreamHits).toBe(0);\n    const retry=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/wav','X-Cosmic-Metadata':encodeMeta({...meta,declaredBytes:valid.length}),Cookie:cookie}),body:valid});\n    expect(retry.status,await retry.clone().text()).toBe(200);\n    expect(upstreamHits).toBe(1);\n  });\n\n  it('rejects direct-format MIME mismatch before paid dispatch and leaves the attempt reusable',async()=>{\n    let upstreamHits=0;\n    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',()=>{upstreamHits++;return HttpResponse.json({text:'ok'},{headers:{'x-request-id':'req_prebill_mime'}})}));\n    const cookie=await createSession('prebill-mime-key');\n    const valid=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45,1,2,3,4]);\n    const meta=metadata({v:2,audioFormat:'wav',declaredBytes:valid.length,jobId:'job-prebill-mime',fileId:'file-prebill-mime',attemptId:'attempt-prebill-mime'});\n    const bad=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/ogg','X-Cosmic-Metadata':encodeMeta(meta),Cookie:cookie}),body:valid});\n    expect(bad.status).toBe(415);\n    expect(upstreamHits).toBe(0);\n    const retry=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/wav','X-Cosmic-Metadata':encodeMeta(meta),Cookie:cookie}),body:valid});\n    expect(retry.status,await retry.clone().text()).toBe(200);\n    expect(upstreamHits).toBe(1);\n  });\n\n  it('rejects oversized direct-format metadata before paid dispatch and leaves the attempt reusable',async()=>{\n    let upstreamHits=0;\n    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',()=>{upstreamHits++;return HttpResponse.json({text:'ok'},{headers:{'x-request-id':'req_prebill_oversize'}})}));\n    const cookie=await createSession('prebill-oversize-key');\n    const valid=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45,1,2,3,4]);\n    const identity={v:2,audioFormat:'wav',jobId:'job-prebill-oversize',fileId:'file-prebill-oversize',attemptId:'attempt-prebill-oversize'};\n    const badMeta=metadata({...identity,declaredBytes:24_000_001});\n    const bad=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/wav','X-Cosmic-Metadata':encodeMeta(badMeta),Cookie:cookie}),body:valid});\n    expect(bad.status).toBe(413);\n    expect(upstreamHits).toBe(0);\n    const goodMeta=metadata({...identity,declaredBytes:valid.length});\n    const retry=await worker.fetch(\`\${origin}/api/transcribe\`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/wav','X-Cosmic-Metadata':encodeMeta(goodMeta),Cookie:cookie}),body:valid});\n    expect(retry.status,await retry.clone().text()).toBe(200);\n    expect(upstreamHits).toBe(1);\n  });`;

const finalDescribe='\n});\n';
if(!integration.endsWith(finalDescribe))fail(`${integrationRel} does not end in the expected single describe terminator`);
const iPos=integration.length-finalDescribe.length;
integration=integration.slice(0,iPos)+tests+integration.slice(iPos);

const guard=`\n    ,["${GUARD_MARKER}", () => { const worker=s("src/index.js"), integ=s("tests/integration/worker.test.js"); const h=worker.indexOf("validateAudioRequestHeaders(request, metadata);"); const b=worker.indexOf("const verifiedAudio = await readAndValidateAudioBody(request, metadata);"); const r=worker.indexOf("await recordTranscriptionDispatch(env, principal, metadata);"); const d=worker.indexOf("const result = await dispatchTranscription",r); return h>=0&&b>h&&r>b&&d>r&&${TEST_MARKERS.map(m=>`integ.includes(${JSON.stringify(m)})`).join('&&')}&&(integ.match(/expect\\(upstreamHits\\)\\.toBe\\(0\\);/g)||[]).length>=3&&(integ.match(/expect\\(upstreamHits\\)\\.toBe\\(1\\);/g)||[]).length>=3; }]`;
const auditAnchor='\n  ];\n}\n';
const aPos=insertionPoint(audit,auditAnchor,`${auditRel} final safeguards`);
audit=audit.slice(0,aPos)+guard+audit.slice(aPos);

const mut=`\n  ["${MUTATION_MARKER}", "src/index.js", /const verifiedAudio = await readAndValidateAudioBody\\(request, metadata\\);/, "const verifiedAudio = new Uint8Array(await request.arrayBuffer());"],`;
const mutationAnchor='\n];\n\nconst baselineFailures = ';
const mPos=insertionPoint(mutation,mutationAnchor,`${mutationRel} mutation-array close`);
mutation=mutation.slice(0,mPos)+mut+mutation.slice(mPos);

for(const [rel,text] of [[integrationRel,integration],[auditRel,audit],[mutationRel,mutation]])write(rel,text);
console.log('V1.2 Batch3 prebilling hardening applied: 3 integration tests + 1 static safeguard + 1 mutation.');
