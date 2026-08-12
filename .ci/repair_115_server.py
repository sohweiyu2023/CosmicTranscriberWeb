from __future__ import annotations
import hashlib, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'

def fail(msg:str)->None: raise SystemExit(msg)
def sha(text:str)->str: return hashlib.sha256(text.encode('utf-8')).hexdigest()
def write(rel:str,text:str)->None:
    p=WORK/rel; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(text,encoding='utf-8',newline='')
def patch_lines(rel:str, expected_sha:str, ops:list[tuple[int,int,str]])->None:
    p=WORK/rel
    if not p.is_file(): fail(f'missing base file {rel}')
    text=p.read_text(encoding='utf-8')
    if sha(text)!=expected_sha: fail(f'unexpected 1.0.14 base for {rel}: {sha(text)}')
    lines=text.splitlines(keepends=True)
    for start,end,replacement in sorted(ops,key=lambda x:x[0],reverse=True):
        lines[start:end]=replacement.splitlines(keepends=True)
    write(rel,''.join(lines))

patch_lines('src/index.js', '38a2055ee06570751511ba65b3a2f91aceefa1d981eb7a00d5cafcdcaac61e70', [
    (103,103,'  safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, category: "dispatch_start", elapsedMs: 0 });\n'),
    (105,106,'    safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, status: 200, category: "success", openaiRequestId: result.diagnostics.openaiRequestId, elapsedMs: Date.now() - started });\n'),
    (109,110,'    safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, status: error?.status || 502, category: error?.code || "unknown", openaiRequestId: details?.openaiRequestId, elapsedMs: Date.now() - started });\n'),
])
patch_lines('src/openai.js', 'e9d52c180859e6e9e3d71bd5973f5da02ecf2d08ea3e25cc1da5e95a2d87e808', [
    (175,175,'    attemptId: safeLogValue(event.attemptId, 100),\n    requestKind: safeLogValue(event.requestKind, 40),\n    model: safeLogValue(event.model, 80),\n'),
    (176,176,'    chunkCount: Number.isInteger(event.chunkCount) ? event.chunkCount : undefined,\n    declaredBytes: Number.isInteger(event.declaredBytes) ? event.declaredBytes : undefined,\n'),
])
patch_lines('wrangler.jsonc', '7f3f63b271d4530c79737af210c6b707ab413e99e44c932688d8980d441aaea3', [
    (66,66,'      "observability": {\n        "enabled": true,\n        "logs": {\n          "enabled": true,\n          "invocation_logs": false,\n          "head_sampling_rate": 1\n        },\n        "traces": {\n          "enabled": true,\n          "head_sampling_rate": 1\n        }\n      },\n'),
    (118,118,'      "observability": {\n        "enabled": true,\n        "logs": {\n          "enabled": true,\n          "invocation_logs": false,\n          "head_sampling_rate": 0.1\n        },\n        "traces": {\n          "enabled": true,\n          "head_sampling_rate": 0.05\n        }\n      },\n'),
])
patch_lines('scripts/deploy-verify.mjs', '1edcb9f5b8494a01e0a2b3f5cbeeade423b4546fce9adcb95e4cc5361cfd5893', [
    (28,29,"  const logSample=config?.observability?.logs?.head_sampling_rate;if(typeof logSample!=='number'||logSample<=0||logSample>0.1)errs.push('top-level custom log sampling must be greater than 0 and no more than 0.1');\n  const envObs=e?.observability;\n  if(envObs?.enabled!==true)errs.push(`${envName} observability must remain enabled`);\n  if(envObs?.logs?.enabled!==true)errs.push(`${envName} custom Workers Logs must remain enabled`);\n  if(envObs?.logs?.invocation_logs!==false)errs.push(`${envName} automatic invocation logs must remain disabled to minimize request metadata retention`);\n  const envLogSample=envObs?.logs?.head_sampling_rate;\n  const expectedLogSample=envName==='staging'?1:0.1;\n  if(envLogSample!==expectedLogSample)errs.push(`${envName} custom log sampling must be ${expectedLogSample}`);\n  if(envObs?.traces?.enabled!==true)errs.push(`${envName} automatic tracing must remain enabled`);\n  const traceSample=envObs?.traces?.head_sampling_rate;\n  const expectedTraceSample=envName==='staging'?1:0.05;\n  if(traceSample!==expectedTraceSample)errs.push(`${envName} trace sampling must be ${expectedTraceSample}`);\n"),
])
print('repair_115_server PASS.')
