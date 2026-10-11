import {spawn} from 'node:child_process';
import {randomBytes,randomInt} from 'node:crypto';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; // CTW_REAL_SAFARI_LOCALHOST_TLS_ONLY

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=randomInt(20000,50000);
const token=randomBytes(16).toString('hex');
const origin=`https://127.0.0.1:${port}`; // CTW_REAL_SAFARI_HTTPS
const driverPort=randomInt(50001,59000);

async function waitFor(url,{method='GET',body,headers}={}){
  let last;
  for(let i=0;i<100;i++){
    try{const r=await fetch(url,{method,body,headers});if(r.ok)return r;last=new Error(`${r.status} ${await r.text()}`)}catch(e){last=e}
    await sleep(200);
  }
  throw last||new Error(`Timed out waiting for ${url}`);
}

const server=spawn(process.execPath,['tests/e2e/mock-server.mjs'],{
  env:{...process.env,COSMIC_E2E_PORT:String(port),COSMIC_E2E_TOKEN:token},stdio:['ignore','pipe','pipe']
});
server.stdout.pipe(process.stdout);server.stderr.pipe(process.stderr);
let driver;let sessionId;
try{
  await waitFor(`${origin}/__cosmic_e2e_health?token=${token}`);
  driver=spawn('/usr/bin/safaridriver',['-p',String(driverPort)],{stdio:['ignore','pipe','pipe']});
  driver.stdout.pipe(process.stdout);driver.stderr.pipe(process.stderr);
  const sessionResponse=await waitFor(`http://127.0.0.1:${driverPort}/session`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capabilities:{alwaysMatch:{acceptInsecureCerts:true,browserName:'safari'}}})
  });
  const session=await sessionResponse.json();
  sessionId=session.value?.sessionId||session.sessionId;
  if(!sessionId)throw new Error(`SafariDriver did not return a session id: ${JSON.stringify(session)}`);
  const cmd=async(path,body)=>{
    const r=await fetch(`http://127.0.0.1:${driverPort}/session/${sessionId}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const text=await r.text();if(!r.ok)throw new Error(`SafariDriver ${path} failed: ${r.status} ${text}`);return text?JSON.parse(text):{};
  };
  await cmd('/url',{url:origin});
  for(let i=0;i<50;i++){
    const state=await cmd('/execute/sync',{script:'return document.readyState',args:[]});
    if(state.value==='complete')break;
    await sleep(100);
  }
  const result=await cmd('/execute/sync',{script:`return {
    title: document.title,
    brand: document.querySelector('.brand')?.textContent || '',
    heading: document.querySelector('h1')?.textContent || '',
    models: Array.from(document.querySelectorAll('#modelSelect option')).map(x=>x.value),
    realtime: Array.from(document.querySelectorAll('#modelSelect option')).some(x=>/realtime|live/i.test(x.textContent||'')),
    startVisible: !!document.querySelector('#startBtn') && getComputedStyle(document.querySelector('#startBtn')).display !== 'none'
  }`,args:[]});
  const v=result.value||{};
  if(v.title!=='Cosmic Transcriber Web')throw new Error(`Unexpected Safari title: ${v.title}`);
  if(!/COSMIC TRANSCRIBER/i.test(v.brand))throw new Error(`Safari brand missing: ${v.brand}`);
  if(!/Your API key, your usage/i.test(v.heading))throw new Error(`Safari heading missing: ${v.heading}`);
  const expected=['gpt-transcribe','gpt-4o-transcribe-diarize','gpt-4o-transcribe','gpt-4o-mini-transcribe'];
  if(JSON.stringify(v.models)!==JSON.stringify(expected))throw new Error(`Safari model list mismatch: ${JSON.stringify(v.models)}`);
  if(v.realtime)throw new Error('Safari exposed a realtime/live transcription model.');
  if(!v.startVisible)throw new Error('Safari Start button is not visible.');
  console.log('Real Safari WebDriver smoke: PASS');
} finally {
  if(sessionId&&driver){try{await fetch(`http://127.0.0.1:${driverPort}/session/${sessionId}`,{method:'DELETE'})}catch{}}
  if(driver&&!driver.killed)driver.kill('SIGTERM');
  if(!server.killed)server.kill('SIGTERM');
}
