import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Real synthetic media through the browser picker and drop zone. Content, not the
// filename, decides acceptance; nothing here may reach a paid endpoint.
const fixture=name=>readFile(`tests/fixtures/${name}`);
const paidPaths=new Set(['/api/transcribe','/api/key/test']);
function countPaid(page){const seen={count:0};page.on('request',r=>{if(paidPaths.has(new URL(r.url()).pathname))seen.count++});return seen}
const row=(page,name)=>page.locator('#queueList li').filter({has:page.locator('strong',{hasText:name})});

test('picker discovers compatible aliases and generic MIME by content, and explains unusable media',async({page})=>{
  const paid=countPaid(page);
  await page.goto('/');
  const cases=[
    {name:'audiobook chapter.m4b',mimeType:'audio/x-m4b',bytes:await fixture('format.m4a'),ready:true},
    {name:'phone clip.mov',mimeType:'video/quicktime',bytes:await fixture('video-with-audio.mp4'),ready:true},
    {name:'voice note.opus',mimeType:'audio/ogg',bytes:await fixture('format.opus'),ready:true},
    {name:'lossless alac.m4a',mimeType:'audio/mp4',bytes:await fixture('format-alac.m4a'),ready:true},
    {name:'download without extension',mimeType:'application/octet-stream',bytes:await fixture('format.flac'),ready:true},
    {name:'screen capture.mp4',mimeType:'video/mp4',bytes:await fixture('no-audio.mp4'),ready:false,error:/No audio stream/},
    {name:'damaged.m4a',mimeType:'audio/mp4',bytes:await fixture('corrupt-format.m4a'),ready:false,error:/MP4|container|signature|corrupt/i},
    {name:'renamed notes.aac',mimeType:'audio/aac',bytes:Buffer.from('not audio, only a renamed text document\n'.repeat(40)),ready:false,error:/No supported audio container/}
  ];
  await page.locator('#fileInput').setInputFiles(cases.map(({name,mimeType,bytes})=>({name,mimeType,buffer:bytes})));
  await expect(page.locator('#queueList li')).toHaveCount(cases.length,{timeout:30000});
  for(const item of cases){
    const li=row(page,item.name);
    await expect(li.locator('.mini-state')).toHaveText(item.ready?'Ready':'Needs attention',{timeout:30000});
    if(!item.ready)await expect(li).toContainText(item.error);
  }
  expect(paid.count).toBe(0);
});

test('drop zone uses the same content discovery and rejects video-only movies before upload',async({page})=>{
  const paid=countPaid(page);
  await page.goto('/');
  const withAudio=(await fixture('video-with-audio.mp4')).toString('base64');
  const videoOnly=(await fixture('no-audio.mp4')).toString('base64');
  await page.evaluate(({withAudio,videoOnly})=>{
    const file=(b64,name,type)=>{const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new File([bytes],name,{type})};
    const dt=new DataTransfer();dt.items.add(file(withAudio,'dropped interview.m4v','video/x-m4v'));dt.items.add(file(videoOnly,'dropped silent.mp4','video/mp4'));
    document.getElementById('dropZone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  },{withAudio,videoOnly});
  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});
  await expect(row(page,'dropped interview.m4v').locator('.mini-state')).toHaveText('Ready',{timeout:30000});
  await expect(row(page,'dropped silent.mp4').locator('.mini-state')).toHaveText('Needs attention',{timeout:30000});
  await expect(row(page,'dropped silent.mp4')).toContainText('No audio stream');
  expect(paid.count).toBe(0);
});
