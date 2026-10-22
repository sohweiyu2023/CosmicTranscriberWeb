import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('invalid hint edits do not poison valid imports or existing exports and still block paid dispatch',async({page})=>{
  let requests=0;
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/transcribe',async route=>{
    requests++;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,result:{text:'Synthetic settings-recovery transcript'},
      diagnostics:{appRequestId:'settings-recovery',openaiRequestId:'mock-only-settings-recovery'}
    })});
  });
  await page.goto('/');
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill('test-settings-recovery-key');
  await page.getByRole('button',{name:/Create secure session/i}).click();
  // The session request closes a modal asynchronously. Wait before filling
  // controls behind it, since branded browsers cannot focus them while inert.
  await expect(page.locator('#keyDialog')).not.toBeVisible();
  await expect(page.locator('#keyStatus')).toContainText(/configured/i);
  await page.locator('#languageInput').fill('English');
  await page.locator('#keywordsInput').fill('<unfinished keyword>');
  await expect(page.locator('#languageInput')).toHaveValue('English');
  await expect(page.locator('#keywordsInput')).toHaveValue('<unfinished keyword>');
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.mp3');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:30000});

  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Check settings');
  await expect(page.locator('#progressDetail')).toContainText('ISO');
  expect(requests).toBe(0);
  await page.locator('#languageInput').fill('en');
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressDetail')).toContainText('keyword');
  expect(requests).toBe(0);
  await page.locator('#keywordsInput').fill('Cosmic');
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete',{timeout:60000});
  expect(requests).toBe(1);

  await page.locator('#languageInput').fill('English');
  await page.locator('#keywordsInput').fill('<unfinished keyword>');
  await page.locator('#exportMd').uncheck();
  await expect(page.locator('#downloadButtons button')).toHaveCount(1);
  const diagnosticDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download detailed diagnostics',exact:true}).click();
  const diagnostics=JSON.parse(await readFile(await (await diagnosticDownload).path(),'utf8'));
  expect(diagnostics.queue).toHaveLength(1);
  expect(requests).toBe(1);
  await page.getByRole('button',{name:'Remove format.mp3',exact:true}).click();
  await expect(page.locator('#queueList li')).toHaveCount(0);
  await expect(page.locator('#downloadButtons button')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
