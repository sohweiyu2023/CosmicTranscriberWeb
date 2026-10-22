import {test,expect} from '@playwright/test';

test('unreadable media metadata shows unknown duration and unavailable cost before any paid request',async({page})=>{
  let paidRequests=0;
  page.on('request',request=>{if(['/api/transcribe','/api/key/test'].includes(new URL(request.url()).pathname))paidRequests++});
  await page.addInitScript(()=>{
    const create=document.createElement.bind(document);
    document.createElement=(name,options)=>{
      const element=create(name,options);
      if(String(name).toLowerCase()==='audio')Object.defineProperty(element,'src',{
        configurable:true,get:()=>'',set:()=>queueMicrotask(()=>element.onerror?.(new Event('error')))
      });
      return element;
    };
  });
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.wav');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:30000});
  await expect(page.locator('#queueList')).toContainText('Duration unavailable');
  await expect(page.locator('#durationStat')).toHaveText('Unknown');
  await expect(page.locator('#costEstimate')).toHaveText('Estimate unavailable');
  await expect(page.locator('#costEstimate')).toHaveAttribute('title',/OpenAI API usage may still be charged/);

  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.mp3');
  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});
  await expect(page.locator('#durationStat')).toContainText('+ unknown');
  await expect(page.locator('#costEstimate')).toHaveText('Estimate unavailable');
  expect(paidRequests).toBe(0);
});

test('file inspection reports bounded source hashing progress',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    window.__sourceHashProgress=[];
    const detail=document.getElementById('progressDetail');
    new MutationObserver(()=>window.__sourceHashProgress.push(detail.textContent)).observe(detail,{childList:true,subtree:true,characterData:true});
  });
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.mp3');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:30000});
  expect(await page.evaluate(()=>window.__sourceHashProgress)).toEqual(expect.arrayContaining([expect.stringContaining('in bounded slices')]));
});
