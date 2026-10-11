import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('capture deterministic key screens with semantic assertions',async({page},testInfo)=>{
  await page.goto('/');
  await mkdir('test-results/visual',{recursive:true});
  await expect(page.locator('#modelSelect')).toBeVisible();
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
