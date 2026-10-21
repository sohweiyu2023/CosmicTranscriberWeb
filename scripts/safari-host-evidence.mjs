import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Diagnostic collection only. Never export raw messages, filenames, URLs,
// command output or session identifiers. Never change macOS privacy settings.
const processes=['Safari','safaridriver','webdriverd','sandboxd','tccd','com.apple.WebKit.WebContent','com.apple.WebKit.Networking'];
const operations=['file-read-data','file-read-metadata','file-read-xattr','file-issue-extension','mach-lookup'];
const services=['kTCCServiceSystemPolicyAllFiles','kTCCServiceSystemPolicyDownloadsFolder','kTCCServiceSystemPolicyDocumentsFolder','kTCCServiceSystemPolicyDesktopFolder','kTCCServiceAppleEvents','kTCCServiceAccessibility','kTCCServiceScreenCapture','kTCCServiceListenEvent','kTCCServiceDeveloperTool'];
function processClass(value){
  const name=String(value||'').split('/').at(-1);
  return processes.includes(name)?name:/WebContent/.test(name)?'com.apple.WebKit.WebContent':/Networking/.test(name)?'com.apple.WebKit.Networking':'other';
}
export function redactEvidence(message,process=''){
  message=String(message||'');
  if(!/NotReadableError|\bdeny(?:\(|\b)|\bdenied\b|file-issue-extension/i.test(message))return null;
  const category=/NotReadableError/.test(message)?'not-readable':/\bdeny(?:\(|\b)|\bdenied\b/i.test(message)?'denial':'extension-event';
  return {category,process:processClass(process),operation:operations.find(op=>message.includes(op))||'other',
    service:services.find(service=>message.includes(service))||'other',
    mentionsTestFixture:message.includes('ctw-safari-real-disk-')||message.includes('format.mp3'),
    mentionsReadExtension:message.includes('com.apple.app-sandbox.read')};
}
export function summarizeUnifiedText(text,{since=0,until=Infinity}={}){
  const summary={parsedEvents:0,unparsedLines:0,outsideProbeWindow:0,unknownTimeEvents:0,matchingEvents:0,processCounts:{},operationCounts:{},serviceCounts:{},events:[]};
  for(const line of String(text).split(/\r?\n/)){
    if(!line.trim())continue;
    let item;try{item=JSON.parse(line)}catch{summary.unparsedLines++;continue}
    if(!item||typeof item.eventMessage!=='string')continue;
    summary.parsedEvents++;
    const process=processClass(item.processImagePath||item.process);
    if(process==='other')continue;
    const event=redactEvidence(item.eventMessage,process);if(!event)continue;
    const time=Date.parse(String(item.timestamp||''));
    if(!Number.isFinite(time)){summary.unknownTimeEvents++;continue}
    if(time<since-1000||time>until+1000){summary.outsideProbeWindow++;continue}
    event.time=new Date(time).toISOString();event.withinProbeWindow=true;
    summary.matchingEvents++;
    summary.processCounts[event.process]=(summary.processCounts[event.process]||0)+1;
    summary.operationCounts[event.operation]=(summary.operationCounts[event.operation]||0)+1;
    summary.serviceCounts[event.service]=(summary.serviceCounts[event.service]||0)+1;
    summary.events.push(event);
  }
  summary.events.sort((a,b)=>Number(b.mentionsTestFixture)-Number(a.mentionsTestFixture)||Number(b.operation!=='other')-Number(a.operation!=='other'));
  summary.events=summary.events.slice(0,32);
  return summary;
}
export async function inspectDriverLogs({directory,since=0,maxDepth=4,maxFiles=48,maxBytes=4*1024*1024}={}){
  const result={available:false,entries:0,directoriesByDepth:{},directoryKinds:{},filesByDepth:{},extensions:{},skippedSymlinks:0,
    filesInspected:0,bytesInspected:0,truncated:false,matchingEvents:0,events:[]};
  const allowedExtensions=new Set(['.log','.txt','.json','.plist','.trace']);
  async function walk(folder,depth){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(++result.entries>256){result.truncated=true;return}
      const file=path.join(folder,entry.name),info=await lstat(file);
      if(info.isSymbolicLink()){result.skippedSymlinks++;continue}
      if(info.isDirectory()){
        result.directoriesByDepth[depth]=(result.directoriesByDepth[depth]||0)+1;
        const kind=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(entry.name)?'uuid':/session/i.test(entry.name)?'session':'other';
        result.directoryKinds[kind]=(result.directoryKinds[kind]||0)+1;
        if(depth<maxDepth)await walk(file,depth+1);else result.truncated=true;
        continue;
      }
      if(!info.isFile())continue;
      result.filesByDepth[depth]=(result.filesByDepth[depth]||0)+1;
      const ext=path.extname(entry.name).toLowerCase(),kind=allowedExtensions.has(ext)?ext:'other';
      result.extensions[kind]=(result.extensions[kind]||0)+1;
      if(info.mtimeMs<since-30000)continue;
      if(result.filesInspected>=maxFiles||result.bytesInspected>=maxBytes){result.truncated=true;continue}
      const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      try{
        const buffer=Buffer.alloc(Math.min(256*1024,maxBytes-result.bytesInspected));
        const {bytesRead}=await fd.read(buffer,0,buffer.length,0);
        result.filesInspected++;result.bytesInspected+=bytesRead;
        for(const line of buffer.toString('utf8',0,bytesRead).split(/\r?\n/)){
          const event=redactEvidence(line);if(!event)continue;
          result.matchingEvents++;if(result.events.length<32)result.events.push(event);
        }
      }finally{await fd.close()}
    }
  }
  try{const root=await lstat(directory);if(root.isSymbolicLink()){result.skippedSymlinks++;return result}await walk(directory,0);result.available=true}
  catch(error){result.errorCode=/^[A-Z0-9_]+$/.test(String(error.code))?error.code:'UNAVAILABLE'}
  return result;
}
function safeProcessCount(){const r=spawnSync('/usr/bin/pgrep',['-x','safaridriver'],{encoding:'utf8',timeout:2000});return r.status===0?r.stdout.trim().split(/\s+/).filter(x=>/^\d+$/.test(x)).length:0}
async function main(){
  if(process.platform!=='darwin')throw new Error('Native Safari host diagnostics require macOS');
  const root=path.resolve(import.meta.dirname,'..'),startedAt=new Date().toISOString(),since=Date.now();
  const fixture=path.join(root,'tests/fixtures/format.mp3');
  const fixtureIdentity=async()=>({sha256:createHash('sha256').update(await readFile(fixture)).digest('hex'),mtimeNs:String((await stat(fixture,{bigint:true})).mtimeNs)});
  const originalBefore=await fixtureIdentity();
  const scopes=[['user-WebDriver',path.join(homedir(),'Library','Logs','com.apple.WebDriver')],['system-WebDriver','/Library/Logs/com.apple.WebDriver']];
  const before={};for(const [name,directory] of scopes)before[name]=await inspectDriverLogs({directory,since});
  const probe=spawnSync(process.execPath,['tests/safari/disk-access-probe.mjs'],{cwd:root,encoding:'utf8',timeout:150000,maxBuffer:2*1024*1024});
  // Child completion precedes collection; give the terminated driver at most
  // five seconds to exit/flush. No kill-all or additional OS permissions.
  let driverCount=safeProcessCount();for(let i=0;i<20&&driverCount;i++){await delay(250);driverCount=safeProcessCount()}
  const after={};for(const [name,directory] of scopes)after[name]=await inspectDriverLogs({directory,since});
  const predicate='(process == "sandboxd" OR process == "tccd" OR process CONTAINS[c] "Safari" OR process CONTAINS[c] "WebKit" OR process CONTAINS[c] "webdriver") AND (eventMessage CONTAINS[c] "deny" OR eventMessage CONTAINS[c] "denied" OR eventMessage CONTAINS[c] "sandbox" OR eventMessage CONTAINS[c] "permission" OR eventMessage CONTAINS[c] "file")';
  const probeWindowEnd=Date.now();
  const osLog=spawnSync('/usr/bin/log',['show','--last','5m','--style','ndjson','--info','--debug','--predicate',predicate],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
  let native;try{native=JSON.parse(await readFile(path.join(root,'test-results/safari-disk-access-probe.json'),'utf8'))}catch{}
  const originalAfter=await fixtureIdentity();
  const fixturePreserved=JSON.stringify(originalBefore)===JSON.stringify(originalAfter);
  const report={schema:'cosmic-safari-host-evidence-1',role:'diagnostic-only-not-acceptance',startedAt,finishedAt:new Date().toISOString(),
    privacyPermissionsChanged:false,applicationSourceChanged:false,rawLogsExported:false,
    nativeProbe:{exitCode:probe.status,errorCode:probe.error?.code||null,status:native?.status||'NO REPORT',browser:native?.browser||null,
      candidates:(native?.candidates||[]).map(c=>({label:c.label,status:c.status,nativeError:c.native?.error?.startsWith('NotReadableError')?'NotReadableError':c.errorCode||null})),
      originalFixturePreserved:fixturePreserved},
    driverProcessesRemaining:driverCount,logLayoutBefore:before,logLayoutAfter:after,
    unifiedLog:{exitCode:osLog.status,errorCode:osLog.error?.code||null,
      permissionUnavailable:/not permitted|permission denied|requires root/i.test(String(osLog.stderr)),
      ...summarizeUnifiedText(osLog.stdout||'',{since,until:probeWindowEnd})}};
  await mkdir(path.join(root,'test-results'),{recursive:true});
  await writeFile(path.join(root,'test-results/safari-host-evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  console.log('Diagnostic collection finished. Native probe status is '+report.nativeProbe.status+'; this is not Safari acceptance.');
  if(!fixturePreserved)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
