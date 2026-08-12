from __future__ import annotations
import hashlib,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]; P=ROOT/'work'/'public/js/app.js'
def sha(t):return hashlib.sha256(t.encode('utf-8')).hexdigest()
def apply(expected,ops):
 t=P.read_text(encoding='utf-8')
 if sha(t)!=expected:raise SystemExit(f'unexpected app.js base: {sha(t)}')
 lines=t.splitlines(keepends=True)
 for start,end,repl in sorted(ops,key=lambda x:x[0],reverse=True):lines[start:end]=repl.splitlines(keepends=True)
 P.write_text(''.join(lines),encoding='utf-8',newline='')

apply('20ab265578a14b2cb650ebda5d04fb466eaefc31ec3f58d5adb7cd55722daac2',[
 (76,76,"function mp3RecoverySummary(inspection){const r=inspection?.recoveries||{};return {leadingBytes:Number(r.leadingBytes)||0,trailingBytes:Number(r.trailingBytes)||0,gapCount:Array.isArray(r.gaps)?r.gaps.length:0,gapBytes:Array.isArray(r.gaps)?r.gaps.reduce((n,g)=>n+(Number(g?.bytes)||0),0):0,terminalPartialBytes:Number(r.terminalPartialBytes)||0}}\nfunction hasMp3Recovery(inspection){const r=mp3RecoverySummary(inspection);return r.leadingBytes>0||r.trailingBytes>0||r.gapCount>0||r.terminalPartialBytes>0}\nfunction operationElapsedText(ms){return secondsText(Math.max(0,Number(ms)||0)/1000)}\nfunction beginTimedOperation({phase,title,detail,fileRef=null,chunk=null,chunkCount=null,attempt=null}){endTimedOperation();const startedPerf=performance.now();const operation={phase,startedAt:nowIso(),startedPerf,fileRef,chunk,chunkCount,attempt,timer:null};const tick=()=>{if(state.activeOperation!==operation)return;UI.progressDetail.textContent=`${detail} · elapsed ${operationElapsedText(performance.now()-startedPerf)}`};operation.timer=setInterval(tick,1000);state.activeOperation=operation;tick();addDiag('operation_started',{phase,fileRef,chunk,chunkCount,attempt});return operation}\nfunction endTimedOperation(result='finished'){const op=state.activeOperation;if(!op)return;clearInterval(op.timer);addDiag('operation_finished',{phase:op.phase,fileRef:op.fileRef,chunk:op.chunk,chunkCount:op.chunkCount,attempt:op.attempt,result,elapsedMs:Math.round(performance.now()-op.startedPerf)});state.activeOperation=null}\n"),
 (73,74,'function addDiag(category,data={}){return pushDiagnostic(state.diagnostics,makeDiagnosticEvent(category,data,{now:nowIso,elapsedMs:performance.now()-state.pageStartedPerf}))}\n'),
 (65,66,"const state={queue:[],keyConfigured:false,keyExpiresAt:null,principalScope:null,serverVersion:null,modelAllowlistRevision:null,pricingLastVerified:null,running:false,cancelRequested:false,abort:null,completedFiles:0,downloads:[],diagnostics:[],online:navigator.onLine,confirmResolver:null,pageSessionId:rid('page'),pageStartedPerf:performance.now(),pageStartedAt:new Date().toISOString(),runId:null,activeOperation:null};\n"),
 (60,61," startBtn:$('startBtn'),rerunCompletedBtn:$('rerunCompletedBtn'),cancelBtn:$('cancelBtn'),progressTitle:$('progressTitle'),progressPercent:$('progressPercent'),progressBar:$('progressBar'),progressDetail:$('progressDetail'),fileCountStat:$('fileCountStat'),durationStat:$('durationStat'),completedStat:$('completedStat'),downloads:$('downloads'),downloadButtons:$('downloadButtons'),diagnosticsBtn:$('diagnosticsBtn'),versionText:$('versionText'),\n"),
 (11,11,"import {applyTransportClassification,isExplicitUserCancellation} from './transport-policy.js';\nimport {DIAGNOSTICS_REVISION,DIAGNOSTICS_SCHEMA,diagnosticErrorFields,makeDiagnosticEvent,pushDiagnostic} from './diagnostics.js';\n"),
] )
print('repair_115_app_3 PASS.')
