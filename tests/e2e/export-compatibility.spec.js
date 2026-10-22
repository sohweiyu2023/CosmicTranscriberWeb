import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('mixed MP3 and WAV files combine with matching settings and retain format-specific checkpoints',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{
    requests++;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,result:{text:`Synthetic mixed-format transcript ${requests}`},
      diagnostics:{appRequestId:`mixed-format-${requests}`,openaiRequestId:`mock-only-${requests}`}
    })});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-mixed-format-export-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#mergeFiles').check();
  await page.locator('#fileInput').setInputFiles(['tests/fixtures/format.mp3','tests/fixtures/format.wav']);
  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  expect(requests).toBe(2);
  await expect(page.locator('#downloadButtons button')).toHaveCount(6);
  await expect(page.locator('#progressDetail')).not.toContainText('different transcription settings');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download Combined Transcript.txt',exact:true}).click();
  const download=await downloaded;
  const text=await readFile(await download.path(),'utf8');
  expect(text).toContain('Synthetic mixed-format transcript 1');
  expect(text).toContain('Synthetic mixed-format transcript 2');

  const checkpoints=await page.evaluate(async()=>{
    const open=indexedDB.open('cosmic-transcriber-web');
    const db=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
    try{
      const get=db.transaction('checkpoints','readonly').objectStore('checkpoints').getAll();
      return await new Promise((resolve,reject)=>{get.onsuccess=()=>resolve(get.result.map(cp=>({format:cp.audioFormat,settings:cp.settingsIdentity})));get.onerror=()=>reject(get.error)});
    }finally{db.close()}
  });
  expect(checkpoints.map(cp=>cp.format).sort()).toEqual(['mp3','wav']);
  expect(new Set(checkpoints.map(cp=>cp.settings)).size).toBe(2);

  // Re-exporting with different presentation settings must not resend audio.
  await page.locator('#includeTimestamps').uncheck();
  await expect(page.getByRole('button',{name:'Download Combined Transcript.txt',exact:true})).toBeVisible();
  expect(requests).toBe(2);
});
