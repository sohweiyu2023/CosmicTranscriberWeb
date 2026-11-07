// Privacy boundary for the separate ordinary (non-WebDriver) Safari GUI probe.
// The native File oracle runs on the original result BEFORE this report-only
// sanitization. CI artifacts and console output must never include AppleScript
// stderr, local paths, browser-supplied arbitrary text or exception stacks.
import {safariProbeErrorCategory} from './disk-access-probe-contract.mjs';

const stages=new Set(['native-mouse-click','go-to-folder-sheet','native-parent-directory','native-parent-confirm','native-filename','native-open']);
const statuses=new Set(['RUNNING','PASS','FAIL']);
const safeNum=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const safeExit=x=>Number.isInteger(x)&&x>=0&&x<=255?x:null;
const safeHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x)?x.toLowerCase():null;
const safeTimestamp=x=>typeof x==='string'&&/^\d{1,24}$/.test(x)?x:null;
const safeDate=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x)?x:null;
const safeError=x=>x?safariProbeErrorCategory(x):null;
const safeIdentity=x=>x&&typeof x==='object'?{
 size:safeNum(x.size),sha256:safeHash(x.sha256),sliceSha256:safeHash(x.sliceSha256),mtimeNs:safeTimestamp(x.mtimeNs)
}:null;

const read=(value,key)=>{try{return value?.[key]}catch{return undefined}};
const failureKinds=new Set(['none','timeout','interrupted','command-missing','execution-denied','output-limit','output-read-failed','output-write-failed','apple-events-denied','assistive-access-denied','process-failed','foreground-unverified','native-window-unverified','native-panel-unverified','cleanup-unverified','cleanup-blocked','outcome-uncertain','unknown']);
const signals=new Set(['SIGTERM','SIGKILL','SIGABRT','SIGSEGV','SIGINT']);
const detailsStates=new Set(['none','recognized-template','status-only','unrecognized-output-omitted']);
export const ordinaryErrorCategory=value=>{try{return safeError(value)}catch{return 'UnclassifiedError'}};
export function safeMacProcessFacts(value){
 if(!value||typeof value!=='object')return null;
 const duration=read(value,'durationMs');
 const status=read(value,'exitStatus'),signal=read(value,'signal'),kind=read(value,'failureKind'),state=read(value,'detailsState'),inspected=read(value,'stderrCharsInspected');
 return {durationMs:Number.isSafeInteger(duration)&&duration>=0?duration:null,outcomeUncertain:read(value,'outcomeUncertain')===true,outputTruncated:read(value,'outputTruncated')===true,exitStatus:safeExit(status),signal:signals.has(signal)?signal:null,failureKind:failureKinds.has(kind)?kind:'unknown',detailsState:detailsStates.has(state)?state:'unrecognized-output-omitted',stderrPresent:read(value,'stderrPresent')===true,stderrCharsInspected:Number.isSafeInteger(inspected)&&inspected>=0&&inspected<=8192?inspected:null,stderrTruncated:read(value,'stderrTruncated')===true,rawOutput:'omitted'};
}
export function macProcessFacts(result){
 const status=read(result,'status'),signal=read(result,'signal'),error=read(result,'error'),code=read(error,'code'),raw=read(result,'stderr');
 const text=typeof raw==='string'?raw.slice(0,8192):'';
 let kind='unknown',detailsState=text?'unrecognized-output-omitted':'status-only';
 if(code==='EUNCERTAIN')kind='outcome-uncertain';else if(code==='ABORT_ERR')kind='interrupted';else if(code==='ETIMEDOUT')kind='timeout';else if(code==='ENOENT')kind='command-missing';else if(code==='EACCES'||code==='EPERM')kind='execution-denied';else if(code==='ENOBUFS')kind='output-limit';else if(code==='EIO')kind='output-read-failed';
 else if(/could not write.*(?:image|file)|could not save.*(?:image|file)/i.test(text)){kind='output-write-failed';detailsState='recognized-template'}
 else if(/CTW_SAFARI_CLEANUP_BLOCKED/.test(text)){kind='cleanup-blocked';detailsState='recognized-template'}
 else if(/CTW_SAFARI_CLEANUP_UNVERIFIED/.test(text)){kind='cleanup-unverified';detailsState='recognized-template'}
 else if(/CTW_SAFARI_NOT_FOREGROUND/.test(text)){kind='foreground-unverified';detailsState='recognized-template'}
 else if(/CTW_SAFARI_NATIVE_WINDOW_UNVERIFIED/.test(text)){kind='native-window-unverified';detailsState='recognized-template'}
 else if(/CTW_SAFARI_NATIVE_PANEL_UNVERIFIED/.test(text)){kind='native-panel-unverified';detailsState='recognized-template'}
 else if(/not authorized to send Apple events/i.test(text)){kind='apple-events-denied';detailsState='recognized-template'}
 else if(/not allowed assistive access|not trusted for accessibility/i.test(text)){kind='assistive-access-denied';detailsState='recognized-template'}
 else if(signals.has(signal))kind='interrupted';else if(status===0&&!error){kind='none';detailsState='none'}else if(Number.isInteger(status)&&status!==0)kind='process-failed';
 return safeMacProcessFacts({durationMs:read(result,'elapsedMs'),outcomeUncertain:read(result,'outcomeUncertain'),outputTruncated:read(result,'outputTruncated'),exitStatus:status,signal,failureKind:kind,detailsState,stderrPresent:typeof raw==='string'&&raw.length>0,stderrCharsInspected:text.length,stderrTruncated:typeof raw==='string'&&raw.length>8192});
}

// Read-only ownership checks precede every native action. Never send keys to
// an unverified foreground app, ordinary page, or security/consent prompt.
export function ordinarySafariGuardScript(mode){
 if(!['page','chooser','go-to-folder'].includes(mode))throw new TypeError('Native guard mode must be explicit');
 return `tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  if frontApp is not "Safari" then error "CTW_SAFARI_NOT_FOREGROUND"
  tell process "Safari"
    if (count of windows) is 0 then error "CTW_SAFARI_NATIVE_WINDOW_UNVERIFIED"
    if name of window 1 does not contain "Genuine ordinary Safari file picker" then error "CTW_SAFARI_NATIVE_WINDOW_UNVERIFIED"
    ${mode==='page'?'if (count of sheets of window 1) is not 0 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"':`if (count of sheets of window 1) is not 1 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"
    set filePanel to sheet 1 of window 1
    set controls to entire contents of filePanel
    if (count of controls) > 2000 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"
    set hasOpen to false
    set hasCancel to false
    set hasFiles to false
    repeat with control in controls
      try
        if role of control is "AXButton" and name of control is "Open" then set hasOpen to true
        if role of control is "AXButton" and name of control is "Cancel" then set hasCancel to true
        if role of control is in {"AXBrowser", "AXOutline", "AXTable"} then set hasFiles to true
      end try
    end repeat
    if not (hasOpen and hasCancel and hasFiles) then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"
    ${mode==='chooser'?'if (count of sheets of filePanel) is not 0 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"':`if (count of sheets of filePanel) is not 1 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"
    set folderPanel to sheet 1 of filePanel
    set controls to entire contents of folderPanel
    if (count of controls) > 500 then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"
    set hasGo to false
    set hasFolderField to false
    repeat with control in controls
      try
        if role of control is "AXButton" and name of control is "Go" then set hasGo to true
        if role of control is in {"AXTextField", "AXComboBox"} then set hasFolderField to true
      end try
    end repeat
    if not (hasGo and hasFolderField) then error "CTW_SAFARI_NATIVE_PANEL_UNVERIFIED"`}`}
  end tell
end tell`;
}
export function ordinarySafariCleanupScript(expectedUrl){
 const u=new URL(expectedUrl);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||!u.port||u.search||u.hash||u.username||u.password)throw new TypeError('Cleanup requires the exact owned loopback page');
 return `tell application "System Events"
  if not (exists process "Safari") then return "already closed"
  tell process "Safari"
    set ownedWindows to (windows whose name contains "Genuine ordinary Safari file picker")
    if (count of ownedWindows) is not 1 then error "CTW_SAFARI_CLEANUP_UNVERIFIED"
    if (count of sheets of item 1 of ownedWindows) is not 0 then error "CTW_SAFARI_CLEANUP_BLOCKED"
  end tell
end tell
tell application "Safari"
  set ownedWindows to (windows whose name contains "Genuine ordinary Safari file picker")
  if (count of ownedWindows) is not 1 then error "CTW_SAFARI_CLEANUP_UNVERIFIED"
  set ownedWindow to item 1 of ownedWindows
  if URL of current tab of ownedWindow is not ${JSON.stringify(expectedUrl)} then error "CTW_SAFARI_CLEANUP_UNVERIFIED"
  close ownedWindow
end tell`;
}
export async function runOrdinaryCleanup(operation,report){
 try{await operation()}catch(error){report.status='FAIL';report.failurePhase??='cleanup';report.cleanupErrorCode=ordinaryErrorCategory(error)}
}

const safeStage=x=>{const stage=read(x,'stage');return {
 stage:stages.has(stage)?stage:'OTHER',
 osascriptStatus:safeExit(x?.osascriptStatus),
 osascriptErrorCode:safeError(x?.osascriptError||x?.osascriptErrorCode),
 screenshotStatus:safeExit(x?.screenshotStatus),screenshotBytes:safeNum(x?.screenshotBytes),
 osascriptDiagnostic:safeMacProcessFacts(read(x,'osascriptDiagnostic')),screenshotDiagnostic:safeMacProcessFacts(read(x,'screenshotDiagnostic'))
}};
const safeNative=x=>x&&typeof x==='object'?{
 isTrusted:x.isTrusted===true,name:x.name==='format.mp3'?'format.mp3':'OTHER',
 type:x.type==='audio/mpeg'?'audio/mpeg':'OTHER',
 size:safeNum(x.size),lastModified:safeNum(x.lastModified),bytesRead:safeNum(x.bytesRead),
 sha256:safeHash(x.sha256),sliceSha256:safeHash(x.sliceSha256),duration:safeNum(x.duration),
 errorCode:safeError(x.error)
}:null;
export function sanitizeOrdinarySafariReport(raw){
 const r=raw&&typeof raw==='object'?raw:{};
 const status=read(r,'status'),browserVersion=read(r,'browserVersion'),architecture=read(r,'architecture'),failurePhase=read(r,'failurePhase'),readiness=read(r,'pageReadiness');
 return {
  schema:'cosmic-ordinary-safari-file-probe-1',
  role:'diagnostic-only-not-release-or-SafariDriver-certification',
  platform:r.platform==='darwin'?'darwin':'OTHER',
  startedAt:safeDate(r.startedAt),finishedAt:safeDate(r.finishedAt),
  status:statuses.has(status)?status:'FAIL',
  browserVersion:typeof browserVersion==='string'&&/^\d+(?:\.\d+){0,3}$/.test(browserVersion)?browserVersion:'UNKNOWN',
  architecture:['arm64','x64'].includes(architecture)?architecture:'UNKNOWN',
  fixturesPreserved:r.fixturesPreserved===true,sourceAfter:safeIdentity(r.sourceAfter),selectedAfter:safeIdentity(r.selectedAfter),
  processes:Object.fromEntries(['browserMetadata','fixtureCopy','browserOpen','browserClose','failureScreenshot'].map(key=>[key,safeMacProcessFacts(r.processes?.[key])])),
  source:safeIdentity(r.source),selectedExpected:safeIdentity(r.selectedExpected),
  fixtureMaterialization:r.fixtureMaterialization==='certified-mp3-1980-mtime'?'certified-mp3-1980-mtime':null,
  failurePhase:['setup','page-readiness','native-picker','cleanup'].includes(failurePhase)?failurePhase:null,
  uiOutcomeUncertain:r.uiOutcomeUncertain===true,fixtureCleanupState:r.fixtureCleanupState==='preserved-for-uncertain-ui-outcome'?'preserved-for-uncertain-ui-outcome':null,cleanupState:r.cleanupState==='skipped-uncertain-ui-outcome'?'skipped-uncertain-ui-outcome':null,
  pageReadiness:readiness?Object.fromEntries([...['homeRequests','homeResponsesFinished','readyCallbacks','invalidReadyBodies','resultCallbacks','otherRequests','elapsedMs'].map(key=>[key,safeNum(read(readiness,key))]),...['acknowledged','titleMatches','inputPresent','secureContext','cryptoSubtlePresent'].map(key=>[key,read(readiness,key)===true])]):null,
  origin:r.origin==='loopback-http-test-only'?'loopback-http-test-only':null,
  guiPicker:r.guiPicker?{
   method:r.guiPicker.method==='genuine-System-Events-mouse-click-and-open-panel'?'genuine-System-Events-mouse-click-and-open-panel':'OTHER',
   stages:Array.isArray(r.guiPicker.stages)?r.guiPicker.stages.slice(0,6).map(safeStage):[]
  }:null,
  native:safeNative(r.native),
  failureScreenshot:r.failureScreenshot==='ordinary-safari-native-picker.png'?'ordinary-safari-native-picker.png':null,
  errorCode:safeError(r.error||r.errorCode),
  cleanupErrorCode:safeError(r.cleanupError||r.cleanupErrorCode),
  integrityErrorCode:safeError(r.integrityError||r.integrityErrorCode),
  screenshotErrorCode:safeError(r.screenshotError||r.screenshotErrorCode)
 };
}
