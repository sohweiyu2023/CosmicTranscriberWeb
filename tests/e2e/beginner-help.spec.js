import {test,expect} from '@playwright/test';

test('beginner help is keyboard accessible and fits a narrow screen',async({page})=>{
  await page.goto('/');
  await page.setViewportSize({width:320,height:740});
  const help=page.locator('#quickStart');
  const summary=help.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(help).toHaveAttribute('open','');
  await expect(help).toContainText('24 MB or smaller');
  await expect(help).toContainText('does not record from a microphone');
  await expect(help).toContainText('not a spending cap');
  await expect(help).toContainText('download folder');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(help).not.toHaveAttribute('open','');
  await page.getByRole('button',{name:'About',exact:true}).click();
  await expect(page.getByRole('link',{name:'MIT licence'})).toHaveAttribute('href','/LICENSE');
  await expect(page.getByRole('link',{name:'Third-party notices'})).toHaveAttribute('href','/THIRD-PARTY-NOTICES.md');
  await expect(page.locator('#aboutDialog')).toContainText('does not establish Mac Safari validation');
  for(const path of ['/LICENSE','/THIRD-PARTY-NOTICES.md']){
    const response=await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect((await response.text()).length).toBeGreaterThan(100);
  }
});
