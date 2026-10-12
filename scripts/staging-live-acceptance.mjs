import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
const ORIGIN='https://transcriber-staging.awakeningtoreality.com';
const FORMATS=[['mp3','audio/mpeg','gpt-transcribe'],['flac','audio/flac','gpt-transcribe'],['mp4','audio/mp4','gpt-transcribe'],['mpeg','audio/mpeg','gpt-transcribe'],['mpga','audio/mpeg','gpt-transcribe'],['m4a','audio/mp4','gpt-transcribe'],['ogg','audio/ogg','gpt-transcribe'],['wav','audio/wav','gpt-4o-transcribe-diarize'],['webm','audio/webm','gpt-transcribe']];
const report={schema:'cosmic-paid-staging-nine-1',commit:process.env.GITHUB_SHA||null,status:'RUNNING',phase:'environment',attempted:0,formats:[],startedAt:new Date().toISOString()};
let accessCookie='',authHeader='',byokCookie='';
const safeError=e=>String(e?.code||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
function configureAccess(s){
 s=String(s||'').trim();assert.ok(s.length>0&&s.length<=16384,'Missing secure staging identity');
 if(/^Authorization:\s*Bearer\s+\S+$/i.test(s))authHeader=s.replace(/^Authorization:\s*Bearer\s+/i,'');
 else if(/^Bearer\s+\S+$/i.test(s))authHeader=s.replace(/^Bearer\s+/i,'');
 else if(/^Cookie:\s*CF_Authorization=[A-Za-z0-9._-]+$/i.test(s))accessCookie=s.replace(/^Cookie:\s*/i,'');
 else if(/^CF_Authorization=[A-Za-z0-9._-]+$/.test(s))accessCookie=s;
 else if(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s))accessCookie='CF_Authorization='+s;
 else throw Error('Staging Access credential format not supported');
 if(authHeader&&!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authHeader)){const e=Error('Access bearer credential must be a JWT');e.code='access_token_not_jwt';throw e}
}
async function api(route,method='GET',body=null,headers={}){
 assert.ok(route.startsWith('/api/'),'Only staging API permitted');
 const h={...headers};const cookie=[accessCookie,byokCookie].filter(Boolean).join('; ');
 if(cookie)h.Cookie=cookie;if(authHeader)h['Cf-Access-Token']=authHeader;
 if(method!=='GET')h.Origin=ORIGIN;
 const response=await fetch(ORIGIN+route,{method,body,headers:h,redirect:'manual',signal:AbortSignal.timeout(90000)});
 if(response.status>=300&&response.status<400){const e=Error('Cloudflare Access returned a redirect');e.code='access_redirect';e.httpStatus=response.status;throw e}
 assert.ok(response.headers.get('content-type')?.includes('application/json'),'Staging Worker JSON required');
 const t=await response.text();assert.ok(t.length<=131072,'Staging response size invalid');
 let j;try{j=JSON.parse(t)}catch{throw Error('Invalid Worker JSON')}
 if(!response.ok||j?.ok!==true){const e=Error('Staging API response rejected');e.code=safeError({code:j?.error?.code||'http_'+response.status});e.httpStatus=response.status;throw e}
 return {j,response};
}
async function run(){
 assert.equal(process.env.COSMIC_PAID_STAGING_MODE,'exact-nine-real-requests');
 assert.equal(process.env.GITHUB_REF,'refs/heads/ci/v1.2.0-production-readiness');
 assert.match(process.env.GITHUB_SHA||'',/^[0-9a-f]{40}$/);
 report.phase='access-credential';
 configureAccess(process.env.STAGING_CF_AUTHORIZATION);
 report.phase='openai-key';
 const apiKey=String(process.env.STAGING_OPENAI_API_KEY||'').trim();
 assert.ok(apiKey&&apiKey.length<=512&&!/\s/.test(apiKey),'Staging OpenAI key invalid or missing');
 report.phase='fixture-manifest';
 const sums=(await readFile('SHA256SUMS.txt','utf8')).split('\n');
 const fixtures=[];
 for(const [format,mime,model] of FORMATS){
  report.phase='fixture-'+format;
  const name='tests/fixtures/format.'+format;
  const sum=sums.find(line=>line.endsWith('  '+name));assert.ok(sum,'No reviewed source fixture');
  const bytes=await readFile(name);assert.ok(bytes.length>=1024&&bytes.length<=24_000_000,'Invalid audio fixture size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sum.split(' ',1)[0],'Reviewed disk fixture SHA-256 differs');
  fixtures.push({format,mime,model,bytes});
 }
 report.phase='access-status';
 const status=(await api('/api/session/status')).j;
 report.phase='access-version';
 assert.equal(status.version,'1.2.0','Wrong staging Worker version');
 report.phase='access-account';
 assert.ok(status.account?.isAdmin===true||status.account?.status==='active','Cloudflare Access account not active');
 report.phase='access-principal';
 assert.ok(typeof status.principalScope==='string'&&status.principalScope.length>5,'Verified identity missing');
 report.access='PASS';
 if(status.account?.isAdmin){report.phase='admin-overview';assert.equal((await api('/api/admin/overview')).j.ok,true);report.adminReadOnly='PASS'}
 report.phase='byok-create';
 const session=await api('/api/key/session','POST',JSON.stringify({apiKey}),{'content-type':'application/json'});
 assert.equal(session.j.configured,true);
 report.phase='byok-cookie';
 const cookie=session.response.headers.getSetCookie?.().find(x=>x.startsWith('__Host-cosmic_byok='));
 assert.ok(cookie&&/;\s*HttpOnly\b/i.test(cookie)&&/;\s*Secure\b/i.test(cookie)&&/;\s*SameSite=Strict\b/i.test(cookie),'Secure HttpOnly BYOK cookie required');
 byokCookie=cookie.split(';',1)[0];assert.ok(byokCookie.length>60&&byokCookie.length<3900);
 report.phase='byok-status';
 assert.equal((await api('/api/session/status')).j.configured,true);report.secureByok='PASS';
 console.log('STAGING PREPAID PASS: verified identity, fixtures and encrypted BYOK cookie');
 for(const {format,mime,model,bytes} of fixtures){
  report.phase='paid-'+format;
  assert.ok(report.attempted<9,'Hard cap nine paid requests');
  const id=randomUUID().replaceAll('-','');
  const metadata={v:2,audioFormat:format,jobId:'live-'+id,fileId:'f-'+id,attemptId:'a-'+id,chunkIndex:1,chunkCount:1,declaredBytes:bytes.length,durationSeconds:1,model,languages:[],keywords:[],prompt:'',requestKind:'transcription'};
  const headers={'content-type':mime,'x-cosmic-metadata':Buffer.from(JSON.stringify(metadata)).toString('base64url')};
  report.attempted++;
  try{
   const {j}=await api('/api/transcribe','POST',bytes,headers);
   assert.ok(j.result&&typeof j.result==='object','Missing OpenAI result');
   assert.ok(typeof j.result.text==='string'||Array.isArray(j.result.segments),'Invalid OpenAI transcript structure');
   assert.ok(j.diagnostics&&typeof j.diagnostics==='object','Missing upstream diagnostics');
   report.formats.push({format,model,status:'PASS',requestIdPresent:!!j.diagnostics.openaiRequestId});
   console.log('STAGING PAID PASS '+format+' model='+model);
  }catch(e){report.formats.push({format,model,status:'FAIL',code:safeError(e),httpStatus:e?.httpStatus||null});throw e}
 }
 report.phase='byok-forget';
 assert.equal((await api('/api/key/forget','DELETE')).j.configured,false);
 report.phase='byok-forget-status';
 byokCookie='';assert.equal((await api('/api/session/status')).j.configured,false);
 report.byokForget='PASS';report.phase='complete';report.status='PASS';
}
try{await run()}catch(e){
 report.status='FAIL';report.failure={phase:report.phase,code:safeError(e),httpStatus:e?.httpStatus||null};
 console.error('STAGING REAL PAID FAIL: phase='+report.failure.phase+' code='+report.failure.code+'; attempted='+report.attempted);
 process.exitCode=1; // No retry: the previous paid request could already be billable.
}finally{
 report.finishedAt=new Date().toISOString();
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/staging-live-acceptance.json',JSON.stringify(report,null,2)+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'\nV1.2 staging real paid acceptance: '+report.status+'; attempts '+report.attempted+'/9; passes '+report.formats.filter(x=>x.status==='PASS').length+'/9. Secrets and transcripts omitted.\n');
}