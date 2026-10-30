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
