import {test,expect} from '@playwright/test';

test('provider no-audio rejection is visible without automatic resubmission or a false download',async({page})=>{
  let requests=0;
  await page.route('**/api/transcribe',async route=>{
    requests++;
    await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({
      ok:false,error:{code:'openai_request_rejected',message:'No usable audio was found. Choose a file with an audio track.',details:{billingState:'explicit_rejection'}}
    })});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-no-audio-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  await page.locator('#retrySelect').selectOption('3');
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.mp4');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready');
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Finished with errors');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Needs attention');
  await expect(page.locator('#queueList')).toContainText('Choose a file with an audio track');
  await expect(page.locator('#downloads')).toBeHidden();
  await expect(page.locator('#startBtn')).toBeEnabled();
  expect(requests).toBe(1);
  await page.getByRole('button',{name:'Remove format.mp4',exact:true}).click();
  await expect(page.locator('#queueEmpty')).toBeVisible();
});
