import {test,expect} from '@playwright/test';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {expectedNativeLastModified} from '../safari/native-file-contract.mjs';

const fixtures=[...['mp3','flac','mp4','mpeg','mpga','m4a','ogg','wav','webm'].map(ext=>({name:`format.${ext}`,duration:'0:01'})),{name:'ID3 Unicode 東京.mp3',duration:'0:04'}];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

for(const fixture of fixtures)test(`native file bytes and preparation: ${fixture.name}`,async({page,browserName},testInfo)=>{
  const source=path.resolve('tests/fixtures',fixture.name);
  const bytes=await readFile(source),before=await stat(source);
  const ranges=[[0,Math.min(512,bytes.length)],[Math.floor(bytes.length/2),Math.min(bytes.length,Math.floor(bytes.length/2)+512)],[Math.max(0,bytes.length-512),bytes.length]];
  let dispatches=0;
  await page.route('**/api/transcribe',async route=>{dispatches++;await route.abort();});
  // Diagnose an intermittent branded-browser module bootstrap failure
  // without retrying the test, altering authentication, or relaxing assertions.
  const bootstrap={pageErrors:[],consoleErrors:[],requestFailures:[],httpErrors:[]};
  const capture=(field,value)=>{if(bootstrap[field].length<24)bootstrap[field].push(String(value).slice(0,400));};
  page.on('pageerror',error=>capture('pageErrors',error.message));
  page.on('console',message=>{if(message.type()==='error')capture('consoleErrors',message.text());});
  page.on('requestfailed',request=>capture('requestFailures',`${new URL(request.url()).pathname}: ${request.failure()?.errorText||'unknown'}`));
  page.on('response',response=>{if(response.status()>=400)capture('httpErrors',`${response.status()} ${new URL(response.url()).pathname}`);});
  await page.goto('/');
  try{
    await expect(page.locator('#accountState')).toHaveText('active');
  }catch(error){
    const documentState=await page.evaluate(()=>({
      readyState:document.readyState,
      accountState:document.querySelector('#accountState')?.textContent,
      moduleScripts:Array.from(document.querySelectorAll('script[type="module"]'),script=>new URL(script.src).pathname),
      loadedModules:performance.getEntriesByType('resource').filter(item=>item.name.includes('/js/')).map(item=>({path:new URL(item.name).pathname,durationMs:Math.round(item.duration),transferSize:item.transferSize})).slice(0,60)
    })).catch(e=>({inspectionError:String(e)}));
    const evidence={fixture:fixture.name,browserName,bootstrap,documentState};
    console.error('Native-file bootstrap failure evidence:',JSON.stringify(evidence));
    await testInfo.attach('bootstrap-failure-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
    throw error;
  }
  // Observe the native File selected by the browser before the app clears the input.
  // This preserves disk backing, the browser's MIME hint and its lastModified value.
  await page.evaluate(()=>document.querySelector('#fileInput').addEventListener('change',event=>{
    window.__cosmicNativeFile=event.target.files[0];
  },{capture:true,once:true}));
  await page.locator('#fileInput').setInputFiles(source);
  const native=await page.evaluate(async ranges=>{
    const file=window.__cosmicNativeFile;
    if(!(file instanceof File))throw new Error('Native file selection was not observed.');
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
    return {name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,sha256:await digest(file),slices:await Promise.all(ranges.map(([start,end])=>digest(file.slice(start,end))))};
  },ranges);
  expect(native.name).toBe(fixture.name);
  expect(native.size).toBe(bytes.length);
  const expectedLastModified=expectedNativeLastModified(before.mtimeMs,{browserName,platform:process.platform});
  expect(native.lastModified).toBe(expectedLastModified);
  expect(native.sha256).toBe(sha256(bytes));
  expect(native.slices).toEqual(ranges.map(([start,end])=>sha256(bytes.subarray(start,end))));
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready');
  // These generated fixtures contain one or four seconds of audio. A failed
  // media probe's 0.001-second fallback must not satisfy native preparation.
  await expect(page.locator('#durationStat')).toHaveText(fixture.duration);
  expect(dispatches).toBe(0);
  const after=await stat(source);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(sha256(await readFile(source))).toBe(sha256(bytes));
  await testInfo.attach('native-file-evidence',{body:JSON.stringify({project:testInfo.project.name,browserName,platform:process.platform,sourceName:fixture.name,sourceMtimeMs:before.mtimeMs,expectedLastModified,...native,ranges,preparedDuration:fixture.duration},null,2),contentType:'application/json'});
});
