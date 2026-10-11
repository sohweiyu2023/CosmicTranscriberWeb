import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('capture deterministic key screens with semantic assertions',async({page},testInfo)=>{
  // Capture genuine browser/bootstrap failures without retries or weaker
  // application assertions. Account activation, not mere HTML visibility,
  // proves the module loaded and its async authentication UI initialized.
  const evidence={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[]};
  const add=(key,value)=>{if(evidence[key].length<16)evidence[key].push(String(value).slice(0,320))};
  page.on('pageerror',error=>add('pageErrors',error.message));
  page.on('console',message=>{if(message.type()==='error')add('consoleErrors',message.text())});
  page.on('requestfailed',request=>add('failedRequests',`${new URL(request.url()).pathname}: ${request.failure()?.errorText||'failed'}`));
  page.on('response',response=>{if(response.status()>=400)add('httpErrors',`${response.status()} ${new URL(response.url()).pathname}`)});
  await page.goto('/');
  await mkdir('test-results/visual',{recursive:true});
  await expect(page.locator('#modelSelect')).toBeVisible();
  try{
    await expect(page.locator('#accountState')).toHaveText('active');
    await expect(page.locator('#configureKeyBtn')).toBeEnabled();
  }catch(error){
    const state=await page.evaluate(()=>({
      readyState:document.readyState,
      account:document.querySelector('#accountState')?.textContent,
      keyButtonDisabled:document.querySelector('#configureKeyBtn')?.disabled,
      modules:performance.getEntriesByType('resource').filter(x=>x.name.includes('/js/')).slice(0,48).map(x=>({path:new URL(x.name).pathname,durationMs:Math.round(x.duration),size:x.transferSize})),
      scripts:Array.from(document.querySelectorAll('script[type="module"]'),x=>new URL(x.src).pathname)
    })).catch(error=>({inspectionError:String(error)}));
    const report={project:testInfo.project.name,evidence,state};
    console.error('Visual bootstrap failure evidence:',JSON.stringify(report));
    await testInfo.attach('visual-bootstrap-failure',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    throw error;
  }
  await page.screenshot({path:`test-results/visual/initial-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:/Configure API key/i}).click();
  await expect(page.locator('#keyDialog')).toBeVisible();
  await page.screenshot({path:`test-results/visual/key-setup-${testInfo.project.name}.png`,fullPage:true});
  await page.locator('#cancelKeyBtn').click();
  await expect(page.locator('#keyDialog')).not.toBeVisible();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/ID3 Unicode 東京.mp3');
  await expect(page.locator('#queueList li')).toHaveCount(1,{timeout:30000});
  await page.screenshot({path:`test-results/visual/populated-queue-${testInfo.project.name}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`test-results/visual/mobile-${testInfo.project.name}.png`,fullPage:true});
});
