import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const scenario of ['unavailable','malformed','quota'])test('diagnostics classify '+scenario+' preference storage without its contents',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(scenario=>{
    const key='cosmic-transcriber-web-preferences-v1';
    if(scenario==='malformed')localStorage.setItem(key,'{private-stored-prompt@example.test');
    if(scenario==='unavailable'){
      const get=Storage.prototype.getItem;
      Storage.prototype.getItem=function(name){if(name===key)throw new DOMException('private-stored-prompt@example.test','SecurityError');return get.call(this,name)};
    }
    if(scenario==='quota'){
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('private-stored-prompt@example.test','QuotaExceededError');return set.call(this,name,value)};
    }
  },scenario);
  await page.goto('/');await expect(page.locator('#diagnosticsBtn')).toBeVisible();
  if(scenario==='quota')await page.locator('#themeBtn').click();
  const downloading=page.waitForEvent('download');await page.locator('#diagnosticsBtn').click();
  const text=await readFile(await (await downloading).path(),'utf8');const data=JSON.parse(text);
  expect(data.events.some(row=>row.category==='preference_failure'&&row.storageCategory===scenario)).toBe(true);
  expect(text).not.toContain('private-stored-prompt@example.test');
  expect(data.eventCompleteness.scope).toBe('current_page_memory_only');expect(data.eventCompleteness.fullApplicationCoverage).toBe(false);
  expect(errors).toEqual([]);
});

for(const scenario of ['setup','forget','admin'])test('diagnostics correlate '+scenario+' failures without private messages',async({page})=>{
  const requestId='req-'+ 'a'.repeat(24),privateMessage='TEST_ONLY_PRIVATE_UI_MESSAGE@example.invalid';
  await page.route('**/api/session/status',route=>route.fulfill({json:{ok:true,configured:true,expiresAt:Math.floor(Date.now()/1000)+3600,principalScope:'c'.repeat(32),account:{status:'active',email:'synthetic-admin@example.invalid',isAdmin:scenario==='admin',registrationMode:'open'}}}));
  const fail=route=>route.fulfill({status:503,json:{ok:false,requestId,error:{code:'internal_error',message:privateMessage}}});
  if(scenario==='setup')await page.route('**/api/key/session',fail);
  if(scenario==='forget')await page.route('**/api/key/forget',fail);
  if(scenario==='admin')await page.route('**/api/admin/**',fail);
  await page.goto('/');
  if(scenario==='setup'){
    await page.locator('#configureKeyBtn').click();await page.locator('#apiKeyInput').fill('offline-fake-only');await page.locator('#createKeyBtn').click();
    await expect(page.locator('#keyDialogError')).toContainText(privateMessage);await page.locator('#closeKeyBtn').click();
  }
  if(scenario==='forget'){await expect(page.locator('#forgetKeyBtn')).toBeEnabled();await page.locator('#forgetKeyBtn').click();await expect(page.locator('#progressTitle')).toHaveText('Could not clear session')}
  if(scenario==='admin')await expect(page.locator('#adminError')).toContainText(privateMessage);
  const downloading=page.waitForEvent('download');await page.locator('#diagnosticsBtn').click();
  const text=await readFile(await (await downloading).path(),'utf8'),data=JSON.parse(text);
  const category={setup:'session_configure_failure',forget:'session_forget_failure',admin:'admin_failure'}[scenario];
  expect(data.events.some(row=>row.category===category&&row.appRequestId===requestId)).toBe(true);
  expect(text).not.toContain(privateMessage);expect(text).not.toContain('synthetic-admin@example.invalid');expect(text).not.toContain('offline-fake-only');
});

test('diagnostics record a failed export without its exception contents',async({page})=>{
  await page.addInitScript(()=>{const original=URL.createObjectURL;window.__restoreDiagnosticURL=()=>{URL.createObjectURL=original};URL.createObjectURL=()=>{throw Error('TEST_ONLY_PRIVATE_DOWNLOAD_CONTENT')}});
  await page.goto('/');await page.locator('#diagnosticsBtn').click();await expect(page.locator('#progressTitle')).toHaveText('Could not prepare diagnostics');
  await page.evaluate(()=>window.__restoreDiagnosticURL());const downloading=page.waitForEvent('download');await page.locator('#diagnosticsBtn').click();
  const text=await readFile(await (await downloading).path(),'utf8');expect(JSON.parse(text).events.some(row=>row.category==='diagnostic_export_failure')).toBe(true);expect(text).not.toContain('TEST_ONLY_PRIVATE_DOWNLOAD_CONTENT');
});
