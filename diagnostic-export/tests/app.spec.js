import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const seeded='SEED-NO-PERSIST-KEY-7d9b4676';

test('secure key setup, native controls, queue, mocked transcript and downloads',async({page,context})=>{
  await page.goto('/');
  await expect(page).toHaveTitle('Cosmic Transcriber Web');
  await expect(page.getByRole('heading',{level:1,name:'Your API key, your usage'})).toBeVisible();
  await expect(page.locator('.brand')).toContainText('COSMIC TRANSCRIBER');
  const model=page.locator('#modelSelect');
  await expect(model.locator('option')).toHaveCount(4);
  await expect(model.locator('option',{hasText:/realtime|live/i})).toHaveCount(0);
  for(const id of ['gpt-transcribe','gpt-4o-transcribe-diarize','gpt-4o-transcribe','gpt-4o-mini-transcribe']){await model.selectOption(id);await expect(model).toHaveValue(id)}
  await model.selectOption('gpt-4o-transcribe-diarize');
  await expect(page.locator('#languageInput')).toBeEnabled();
  await expect(page.locator('#promptInput')).toBeDisabled();
  await expect(page.locator('#keywordsInput')).toBeDisabled();
  await model.selectOption('gpt-transcribe');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill(seeded);
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await expect(page.locator('#apiKeyInput')).toHaveValue('');
  await expect(page.locator('#keyStatus')).toContainText(/configured/i);

  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList')).toContainText('ID3 Unicode 東京.mp3',{timeout:30000});
  const dropped=await readFile('tests/fixtures/vbr-190s.mp3');
  const b64=dropped.toString('base64');
  await page.evaluate(({b64})=>{const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const dt=new DataTransfer();dt.items.add(new File([bytes],'01 dropped-vbr.mp3',{type:'audio/mpeg'}));document.getElementById('dropZone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))},{b64});
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});
  const names=await page.locator('#queueList li strong').allTextContents();
  expect(names[0]).toBe('01 dropped-vbr.mp3');
  await page.getByRole('button',{name:'Remove 01 dropped-vbr.mp3'}).click();
  await expect(page.locator('#queueList li')).toHaveCount(1);

  await page.getByRole('button',{name:/Start transcription/i}).click();
  await expect(page.locator('#progressTitle')).toContainText(/Complete|Finished/,{timeout:60000});
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  await expect(page.locator('#startBtn')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.outerHTML.includes('<script>window.__xss=1</script>'))).toBe(false);
  expect(await page.evaluate(()=>window.__xss)).toBeUndefined();

  const stores=await page.evaluate(async(seed)=>{const ls=Object.values(localStorage).join('|'),ss=Object.values(sessionStorage).join('|');let idb='';for(const db of await indexedDB.databases()){const r=indexedDB.open(db.name);const opened=await new Promise((ok,bad)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});for(const n of opened.objectStoreNames){const tx=opened.transaction(n,'readonly');const vals=await new Promise((ok,bad)=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>bad(q.error)});idb+=JSON.stringify(vals)}opened.close()}let cache='';for(const k of await caches.keys())for(const r of await (await caches.open(k)).keys())cache+=r.url;return {ls,ss,idb,cache,docCookie:document.cookie,found:[ls,ss,idb,cache,document.cookie].some(x=>x.includes(seed))}},seeded);
  expect(stores.found).toBe(false);
  expect(stores.docCookie).not.toContain('__Host-cosmic_byok');
  const sessionStatusRequestPromise=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/session/status');
  await page.reload();
  const sessionStatusRequest=await sessionStatusRequestPromise;
  const sessionStatusHeaders=await sessionStatusRequest.allHeaders();
  expect(sessionStatusHeaders.cookie??'').toContain('__Host-cosmic_byok=');
});

test('responsive theme, keyboard focus and 200% zoom remain usable',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#modelSelect')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.body.style.zoom='2');
  await page.locator('#modelSelect').focus();
  await expect(page.locator('#modelSelect')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.body.style.zoom='1');
  await page.getByRole('button',{name:'Switch theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','paper');
  await expect(page.locator('#startBtn')).toBeVisible();
});


test('malformed saved preferences recover safely and diagnostics do not expose filenames',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('cosmic-transcriber-web-preferences-v1',JSON.stringify({theme:'evil',model:'gpt-realtime',languages:{bad:true},chunkMb:'not-a-number',maxMinutes:999,retryCount:-9,keywords:'x'.repeat(9000),prompt:'x'.repeat(13000),previousContext:'yes',exportTxt:'no'}))});
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1,name:'Your API key, your usage'})).toBeVisible();
  await expect(page.locator('#modelSelect')).toHaveValue('gpt-transcribe');
  const restoredPrompt=await page.locator('#promptInput').inputValue();
  const restoredKeywords=await page.locator('#keywordsInput').inputValue();
  expect(restoredPrompt.length).toBe(12000);
  expect(restoredKeywords).toBe('');
  expect(/[\uD800-\uDBFF]$/.test(restoredPrompt)).toBe(false);
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-only-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  const corrupt=await readFile('tests/fixtures/corrupt.mp3');
  await page.locator('#fileInput').setInputFiles({name:'private-person-name.mp3',mimeType:'audio/mpeg',buffer:corrupt});
  await expect(page.locator('#queueList')).toContainText(/error/i,{timeout:30000});
  await expect(page.locator('#startBtn')).toBeDisabled();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#diagnosticsBtn').click();
  const download=await downloadPromise;
  const path=await download.path();
  const diagnostic=await readFile(path,'utf8');
  expect(diagnostic).not.toContain('private-person-name.mp3');
});

test('Escape from API-key dialog clears plaintext input',async({page})=>{await page.goto('/');await page.getByRole('button',{name:/Configure API key/i}).click();await page.locator('#apiKeyInput').fill('TEMP-PLAINTEXT-KEY');await page.keyboard.press('Escape');await expect(page.locator('#keyDialog')).not.toBeVisible();await expect(page.locator('#apiKeyInput')).toHaveValue('');});


test('API-key dialog header Close clears plaintext and malformed principal scope blocks Start',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('TEMP-CLOSE-PLAINTEXT-KEY');
  await page.getByRole('button',{name:'Close'}).click();
  await expect(page.locator('#keyDialog')).not.toBeVisible();
  await expect(page.locator('#apiKeyInput')).toHaveValue('');

  await page.route('**/api/session/status',async route=>{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,configured:true,expiresAt:Math.floor(Date.now()/1000)+3600,principalScope:'bad'})})});
  await page.reload();
  await expect(page.locator('#keyStatus')).toContainText(/unavailable/i);
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  await expect(page.locator('#startBtn')).toBeDisabled();
});


test('duplicate content is visible and removable, and Clear queue resets the queue',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-duplicate-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  const buf=await readFile('tests/fixtures/ID3 Unicode 東京.mp3');
  await page.locator('#fileInput').setInputFiles([
    {name:'01-original.mp3',mimeType:'audio/mpeg',buffer:buf},
    {name:'02-same-content.mp3',mimeType:'audio/mpeg',buffer:buf}
  ]);
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await expect(page.locator('#queueList')).toContainText('Duplicate content skipped');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.getByRole('button',{name:'Remove 02-same-content.mp3'}).click();
  await expect(page.locator('#queueList li')).toHaveCount(1);
  await page.locator('#clearQueueBtn').click();
  await expect(page.locator('#queueList li')).toHaveCount(0);
  await expect(page.locator('#clearQueueBtn')).toBeDisabled();
});

test('Cancel returns an in-flight queue row to resumable Ready state',async({page})=>{
  await page.route('**/api/transcribe',async route=>{await new Promise(r=>setTimeout(r,2000));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'late result'},diagnostics:{appRequestId:'late-app',openaiRequestId:'late-openai'}})})}catch{}});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-cancel-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  const dispatched=page.waitForRequest(req=>req.url().includes('/api/transcribe'));
  await page.locator('#startBtn').click();
  await dispatched;
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await expect(page.locator('#configureKeyBtn')).toBeDisabled();
  await expect(page.locator('#modelSelect')).toBeDisabled();
  await expect(page.locator('#includeTimestamps')).toBeDisabled();
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Cancelled',{timeout:10000});
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#configureKeyBtn')).toBeEnabled();
  await expect(page.locator('#modelSelect')).toBeEnabled();
  await expect(page.locator('#includeTimestamps')).toBeEnabled();
});


test('Cancel interrupts explicit 429 Retry-After backoff before another paid attempt',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{requests++;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'openai_rate_limited',message:'Rate limited.',details:{billingState:'explicit_rejection',retryAfter:'30'}},requestId:'retry-app'})})});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-retry-cancel-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#retrySelect').selectOption('1');
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  const first=page.waitForRequest(req=>req.url().includes('/api/transcribe'));
  await page.locator('#startBtn').click();
  await first;
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Cancelled',{timeout:5000});
  expect(requests).toBe(1);
});

test('Clear queue removes in-memory transcript downloads while preserving resumable checkpoints',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-clear-downloads-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  await page.locator('#exportMd').uncheck();
  await expect(page.locator('#downloadButtons button')).toHaveCount(1);
  await expect(page.locator('#downloadButtons')).toContainText('.txt');
  await page.locator('#exportMd').check();
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  const checkpointCount=await page.evaluate(async()=>{let count=0;for(const dbInfo of await indexedDB.databases()){if(dbInfo.name!=='cosmic-transcriber-web')continue;const r=indexedDB.open(dbInfo.name);const db=await new Promise((ok,bad)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const tx=db.transaction('checkpoints','readonly');count=await new Promise((ok,bad)=>{const q=tx.objectStore('checkpoints').count();q.onsuccess=()=>ok(q.result);q.onerror=()=>bad(q.error)});db.close()}return count});
  expect(checkpointCount).toBeGreaterThan(0);
  await page.locator('#clearQueueBtn').click();
  await expect(page.locator('#downloadButtons button')).toHaveCount(0);
  await expect(page.locator('#downloads')).toBeHidden();
  const after=await page.evaluate(async()=>{const r=indexedDB.open('cosmic-transcriber-web');const db=await new Promise((ok,bad)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const tx=db.transaction('checkpoints','readonly');const n=await new Promise((ok,bad)=>{const q=tx.objectStore('checkpoints').count();q.onsuccess=()=>ok(q.result);q.onerror=()=>bad(q.error)});db.close();return n});
  expect(after).toBe(checkpointCount);
});

test('cancelling a later file keeps already completed file downloads available',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{requests++;if(requests===1){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'completed first file'},diagnostics:{appRequestId:'first-app',openaiRequestId:'first-openai'}})});return}await new Promise(r=>setTimeout(r,3000));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'late second file'},diagnostics:{appRequestId:'second-app',openaiRequestId:'second-openai'}})})}catch{}});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-cancel-preserve-download-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#fileInput').setInputFiles(['tests/fixtures/ID3 Unicode 東京.mp3','tests/fixtures/vbr-190s.mp3']);
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#completedStat')).toHaveText('1',{timeout:60000});
  await expect.poll(()=>requests,{timeout:60000}).toBeGreaterThanOrEqual(2);
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Cancelled',{timeout:10000});
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  await expect(page.locator('#downloadButtons')).toContainText('ID3 Unicode 東京');
});



test('a failed prepared file remains retryable and re-enters the checkpoint-aware path',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{requests++;if(requests===1){await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'openai_authentication_failed',message:'OpenAI rejected the API key.',details:{billingState:'explicit_rejection'}},requestId:'auth-reject'})});return}await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'retry succeeded'},diagnostics:{appRequestId:'retry-app',openaiRequestId:'retry-openai'}})})});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-retry-prepared-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#queueList .mini-state')).toHaveText('Needs attention',{timeout:60000});
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  expect(requests).toBe(2);
});

test('combined export is withheld until failed prepared rows retry without resending completed files',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{requests++;if(requests===1){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'first complete'},diagnostics:{appRequestId:'first-app',openaiRequestId:'first-openai'}})});return}if(requests===2){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'openai_request_rejected',message:'Rejected test request.',details:{billingState:'explicit_rejection'}},requestId:'second-reject'})});return}await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'second retry complete'},diagnostics:{appRequestId:'second-retry-app',openaiRequestId:'second-retry-openai'}})})});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-partial-merge-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#mergeFiles').check();
  await page.locator('#fileInput').setInputFiles(['tests/fixtures/ID3 Unicode 東京.mp3','tests/fixtures/vbr-190s.mp3']);
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Finished with errors',{timeout:60000});
  await expect(page.locator('#completedStat')).toHaveText('1');
  await expect(page.locator('#downloadButtons')).not.toContainText('Combined Transcript');
  await expect(page.locator('#downloadButtons')).toContainText('ID3 Unicode 東京');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  expect(requests).toBe(3);
  await expect(page.locator('#completedStat')).toHaveText('2');
  await expect(page.locator('#downloadButtons')).toContainText('Combined Transcript');
  await expect(page.locator('#startBtn')).toBeDisabled();
});

test('combined export is withheld when completed files used different transcription settings',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{requests++;if(requests===1){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'first old settings'},diagnostics:{appRequestId:'mixed-first',openaiRequestId:'mixed-first-openai'}})});return}if(requests===2){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'openai_request_rejected',message:'Rejected test request.',details:{billingState:'explicit_rejection'}},requestId:'mixed-reject'})});return}await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{text:'second new settings'},diagnostics:{appRequestId:'mixed-second',openaiRequestId:'mixed-second-openai'}})})});
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-mixed-settings-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#mergeFiles').check();
  await page.locator('#fileInput').setInputFiles(['tests/fixtures/ID3 Unicode 東京.mp3','tests/fixtures/vbr-190s.mp3']);
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Finished with errors',{timeout:60000});
  await expect(page.locator('#completedStat')).toHaveText('1');
  await page.locator('#promptInput').fill('changed request context for retry');
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  expect(requests).toBe(3);
  await expect(page.locator('#completedStat')).toHaveText('2');
  await expect(page.locator('#downloadButtons')).not.toContainText('Combined Transcript');
  await expect(page.locator('#progressDetail')).toContainText(/different transcription settings/i);
  await expect(page.locator('#startBtn')).toBeDisabled();
});

test('removing a completed file removes its in-memory downloads without deleting its checkpoint',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-remove-completed-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  await expect(page.locator('#completedStat')).toHaveText('1');
  await page.getByRole('button',{name:'Remove ID3 Unicode 東京.mp3'}).click();
  await expect(page.locator('#queueList li')).toHaveCount(0);
  await expect(page.locator('#downloadButtons button')).toHaveCount(0);
  await expect(page.locator('#completedStat')).toHaveText('0');
  const checkpoints=await page.evaluate(async()=>{const r=indexedDB.open('cosmic-transcriber-web');const db=await new Promise((ok,bad)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});const tx=db.transaction('checkpoints','readonly');const n=await new Promise((ok,bad)=>{const q=tx.objectStore('checkpoints').count();q.onsuccess=()=>ok(q.result);q.onerror=()=>bad(q.error)});db.close();return n});
  expect(checkpoints).toBeGreaterThan(0);
});
