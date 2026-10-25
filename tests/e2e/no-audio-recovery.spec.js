import {test,expect} from '@playwright/test';

test('provider no-audio rejection is visible without automatic resubmission or a false download',async({page})=>{
  let requests=0,fulfilled=0,responseObserved=false,started=0,requestEnteredMs=null,phase='setup';
  await page.route('**/api/transcribe',async route=>{
    requests++;
    requestEnteredMs=Date.now()-started;
    await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({
      ok:false,error:{code:'openai_request_rejected',message:'No usable audio was found. Choose a file with an audio track.',details:{billingState:'explicit_rejection'}}
    })});
    fulfilled++;
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-no-audio-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#retrySelect').selectOption('3');
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.mp4');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready');
  started=Date.now();phase='provider-response';
  try{
    // The UI rejection deadline begins when the provider rejection arrives,
    // rather than while hashing/checkpointing/upload are still in progress.
    // Register before Start; retain the original native click and UI deadlines.
    await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/api/transcribe'&&response.request().method()==='POST'&&response.status()===400,{timeout:15000}).then(()=>{responseObserved=true}),
      page.locator('#startBtn').click()
    ]);
    phase='rejection-ui';
    await expect(page.locator('#progressTitle')).toHaveText('Finished with errors');
    await expect(page.locator('#queueList .mini-state')).toHaveText('Needs attention');
    await expect(page.locator('#queueList')).toContainText('Choose a file with an audio track');
    await expect(page.locator('#downloads')).toBeHidden();
    await expect(page.locator('#startBtn')).toBeEnabled();
    expect(requests).toBe(1);
    phase='remove';
    await page.getByRole('button',{name:'Remove format.mp4',exact:true}).click();
    await expect(page.locator('#queueEmpty')).toBeVisible();
  }catch(error){
    // Passive test counters only; no extra browser request or private content.
    console.error('NO_AUDIO_REJECTION_DIAGNOSTIC '+JSON.stringify({phase,requests,fulfilled,responseObserved,requestEnteredMs,elapsedMs:Date.now()-started}));
    throw error;
  }
});
