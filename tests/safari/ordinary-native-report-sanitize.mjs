// Privacy boundary for the separate ordinary (non-WebDriver) Safari GUI probe.
// The native File oracle runs on the original result BEFORE this report-only
// sanitization. CI artifacts and console output must never include AppleScript
// stderr, local paths, browser-supplied arbitrary text or exception stacks.
import {safariProbeErrorCategory} from './disk-access-probe-contract.mjs';

const stages=new Set(['native-mouse-click','go-to-folder-sheet','native-parent-directory','native-filename','native-open']);
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
const safeStage=x=>({
 stage:stages.has(x?.stage)?x.stage:'OTHER',
 osascriptStatus:safeExit(x?.osascriptStatus),
 osascriptErrorCode:safeError(x?.osascriptError||x?.osascriptErrorCode),
 screenshotStatus:safeExit(x?.screenshotStatus),screenshotBytes:safeNum(x?.screenshotBytes)
});
const safeNative=x=>x&&typeof x==='object'?{
 isTrusted:x.isTrusted===true,name:x.name==='format.mp3'?'format.mp3':'OTHER',
 type:x.type==='audio/mpeg'?'audio/mpeg':'OTHER',
 size:safeNum(x.size),lastModified:safeNum(x.lastModified),bytesRead:safeNum(x.bytesRead),
 sha256:safeHash(x.sha256),sliceSha256:safeHash(x.sliceSha256),duration:safeNum(x.duration),
 errorCode:safeError(x.error)
}:null;
export function sanitizeOrdinarySafariReport(raw){
 const r=raw&&typeof raw==='object'?raw:{};
 return {
  schema:'cosmic-ordinary-safari-file-probe-1',
  role:'diagnostic-only-not-release-or-SafariDriver-certification',
  platform:r.platform==='darwin'?'darwin':'OTHER',
  startedAt:safeDate(r.startedAt),finishedAt:safeDate(r.finishedAt),
  status:statuses.has(r.status)?r.status:'FAIL',
  source:safeIdentity(r.source),
  origin:r.origin==='loopback-http-test-only'?'loopback-http-test-only':null,
  guiPicker:r.guiPicker?{
   method:r.guiPicker.method==='genuine-System-Events-mouse-click-and-open-panel'?'genuine-System-Events-mouse-click-and-open-panel':'OTHER',
   stages:Array.isArray(r.guiPicker.stages)?r.guiPicker.stages.slice(0,5).map(safeStage):[]
  }:null,
  native:safeNative(r.native),
  failureScreenshot:r.failureScreenshot==='ordinary-safari-native-picker.png'?'ordinary-safari-native-picker.png':null,
  errorCode:safeError(r.error||r.errorCode),
  cleanupErrorCode:safeError(r.cleanupError||r.cleanupErrorCode),
  screenshotErrorCode:safeError(r.screenshotError||r.screenshotErrorCode)
 };
}
