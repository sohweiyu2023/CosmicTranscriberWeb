from __future__ import annotations
import json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
VERSION='1.0.15'
OLD='1.0.14'

def fail(msg): raise SystemExit(msg)
def replace_version(path:pathlib.Path):
    if not path.is_file(): fail(f'missing version surface {path.relative_to(WORK)}')
    text=path.read_text(encoding='utf-8')
    path.write_text(text.replace(OLD,VERSION),encoding='utf-8',newline='')

for name in ['repair_115_app_1.py','repair_115_app_2.py','repair_115_app_3.py','repair_115_app_modules.py','repair_115_server.py','repair_115_tests.py','repair_115_gates.py']:
    path=ROOT/'.ci'/name
    if not path.is_file(): fail(f'missing 1.0.15 repair script {name}')
    subprocess.run([sys.executable,str(path)],cwd=ROOT,check=True)

version_targets=[
    'package.json','RELEASE_MANIFEST.json','README.md','PASTE-ONCE-WINDOWS.ps1','wrangler.jsonc',
    'public/index.html','public/js/models.js','scripts/audit-lib.mjs','scripts/mutation-suite.mjs',
    'tests/e2e/mock-server.mjs','tests/integration/wrangler.test.jsonc','tests/node/version-consistency.test.mjs',
    'tests/worker/runtime.test.js','tests/worker/wrangler.test.jsonc','.github/workflows/ci.yml',
    'docs/ADR-001-V1_ARCHITECTURE.md','docs/ARCHITECTURE.md','docs/AUDIT_REPORT.md','docs/AUTOMATED_TEST_RESULTS.md',
    'docs/CLOUDFLARE_ACCESS_SETUP.md','docs/CLOUDFLARE_DEPLOYMENT.md','docs/DEPENDENCIES_LICENSES.md','docs/DEVELOPER_GUIDE.md',
    'docs/MUTATION_TEST_REPORT.md','docs/PACKAGE_HYGIENE.md','docs/RELEASE_CHECKLIST.md','docs/RESEARCH_NOTES.md',
    'docs/TESTING_GUIDE.md','docs/TROUBLESHOOTING.md','docs/USER_MANUAL.md'
]
for rel in version_targets: replace_version(WORK/rel)

manifest_path=WORK/'RELEASE_MANIFEST.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['version']=VERSION
manifest['generatedAt']=None
manifest['releaseReady']=False
manifest['dependencyLock']={'status':'candidate-unverified','sha256':None,'registry':'https://registry.npmjs.org'}
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='')

lock=WORK/'package-lock.json'
if lock.exists(): lock.unlink()

changelog=WORK/'docs/CHANGELOG.md'
text=changelog.read_text(encoding='utf-8')
entry="""## 1.0.15 — candidate

- Distinguishes explicit user cancellation from browser/network transport interruption so transport failures no longer falsely appear as user cancellation, while preserving conservative ambiguous-billing protection after dispatch.
- Adds explicit, confirmation-gated reruns for completed files under the current model/settings. Exact completed checkpoints can be reused safely; changed model/settings create a distinct paid-work identity.
- Adds live elapsed `Uploading / waiting for OpenAI` status for long transcription/diarization operations and explicit retry status after an ambiguous request is accepted.
- Upgrades downloaded diagnostics to privacy-safe schema v2 with bounded event history, page/run/file references, phase timing, checkpoint/retry state, transport classifications, MP3 recovery counters, user confirmation decisions, Worker/OpenAI request IDs, browser connectivity/visibility state, and server-version metadata while excluding filenames, credentials, prompts, transcripts, audio contents, source fingerprints and principal identifiers.
- Adds pre-dispatch structured Worker correlation logs with app request ID, pseudonymous user, job/attempt/chunk identifiers, model, declared bytes and elapsed time; staging uses full custom-log and trace sampling for debugging while automatic invocation logs remain disabled, and production remains sampled.
- Adds regression tests and mutation guards for transport-vs-cancel classification, ambiguous retry, slow-request progress, safe completed-file reruns, diagnostics privacy/bounds, structured correlation logs, and environment-bounded observability.

"""
if not text.startswith('## 1.0.15 — candidate'):
    changelog.write_text(entry+text,encoding='utf-8',newline='')

manual=WORK/'docs/USER_MANUAL.md'
manual_text=manual.read_text(encoding='utf-8')
manual_section="""
## Re-running completed audio with another model (1.0.15)

After a file completes, change the model/settings if desired and use **Run completed again**. Cosmic Transcriber shows an explicit paid-run confirmation. If the exact same completed settings checkpoint is still valid, it can be reused without sending another paid request; changed model/settings use a distinct checkpoint identity and may create new OpenAI charges. Download any result you want to keep before rerunning because the row's download result will be replaced.

## Detailed diagnostics (1.0.15)

Use **Download detailed diagnostics** when reporting a problem. The JSON includes bounded timing/correlation information, checkpoint and retry state, transport classification, MP3 recovery counters, browser online/visibility state, and Worker/OpenAI request IDs where available. It intentionally excludes filenames, API keys, cookies, authorization headers, prompts, transcripts, audio contents, source fingerprints and authenticated principal identifiers.
"""
if '## Re-running completed audio with another model (1.0.15)' not in manual_text:
    manual.write_text(manual_text.rstrip()+manual_section+'\n',encoding='utf-8',newline='')

trouble=WORK/'docs/TROUBLESHOOTING.md'
trouble_text=trouble.read_text(encoding='utf-8')
trouble_section="""
## A transcription appears stuck for a long time (1.0.15)

The browser now shows an elapsed `Uploading / waiting for OpenAI` phase rather than a fake percentage while an in-flight request is awaiting a definitive response. Diarization can take materially longer than ordinary transcription. Avoid refreshing or cancelling merely because the request is slow. If a browser/network interruption occurs after dispatch, the app preserves the attempt as billing-ambiguous and asks for explicit confirmation before a potentially duplicate paid retry. Download the detailed diagnostics JSON before changing site data when possible.

## Browser/network interruption versus Cancel (1.0.15)

Only an explicit user cancellation is reported as **Cancelled**. A browser transport/network interruption is classified separately (for example `browser_transport_abort`, `browser_network_error`, `browser_offline` or `browser_transport_error`) and remains conservative about possible OpenAI billing after dispatch.
"""
if '## A transcription appears stuck for a long time (1.0.15)' not in trouble_text:
    trouble.write_text(trouble_text.rstrip()+trouble_section+'\n',encoding='utf-8',newline='')

testing=WORK/'docs/TESTING_GUIDE.md'
testing_text=testing.read_text(encoding='utf-8')
testing_section="""
## 1.0.15 staging acceptance additions

- Simulate a browser transport abort and verify it is not labeled user cancellation; retry requires explicit billing-risk confirmation.
- Verify slow transcription shows a live elapsed OpenAI-wait phase.
- Complete a file, rerun with identical settings and verify valid completed checkpoint reuse; then change model and verify an explicit confirmation and a distinct request.
- Export detailed diagnostics and verify sensitive fields are absent while correlation/timing fields are present.
- In staging Observability, verify custom structured Worker logs and traces can correlate a request/attempt/chunk without exposing authorization, cookies, API keys, audio or transcript content.
"""
if '## 1.0.15 staging acceptance additions' not in testing_text:
    testing.write_text(testing_text.rstrip()+testing_section+'\n',encoding='utf-8',newline='')

deploy=WORK/'docs/CLOUDFLARE_DEPLOYMENT.md'
deploy_text=deploy.read_text(encoding='utf-8')
deploy_section="""
## Observability policy (1.0.15)

Staging retains privacy-safe custom JSON operational logs and automatic tracing at full sampling to make transient browser/Worker/OpenAI failures diagnosable. Automatic invocation logs remain disabled to minimize request-metadata retention. Production uses lower custom-log/trace sampling. Never add API keys, Authorization/Cookie headers, prompts, transcripts, audio contents, source fingerprints or principal identifiers to custom logs.
"""
if '## Observability policy (1.0.15)' not in deploy_text:
    deploy.write_text(deploy_text.rstrip()+deploy_section+'\n',encoding='utf-8',newline='')

pkg=json.loads((WORK/'package.json').read_text(encoding='utf-8'))
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
checks=[
    (pkg.get('version')==VERSION,'package version'),
    (manifest.get('version')==VERSION and manifest.get('releaseReady') is False,'candidate manifest'),
    ('browser_transport_abort' in (WORK/'public/js/transport-policy.js').read_text(encoding='utf-8'),'transport classification'),
    ('cosmic-web-diagnostics-2' in (WORK/'public/js/diagnostics.js').read_text(encoding='utf-8'),'diagnostics v2'),
    ('rerunCompletedBtn' in (WORK/'public/index.html').read_text(encoding='utf-8'),'rerun UI'),
    ('dispatch_start' in (WORK/'src/index.js').read_text(encoding='utf-8'),'structured dispatch log'),
    ('expectedTraceSample' in (WORK/'scripts/deploy-verify.mjs').read_text(encoding='utf-8'),'observability verifier'),
    (not lock.exists(),'no inherited package lock')
]
for ok,label in checks:
    if not ok: fail(f'1.0.15 promotion assertion failed: {label}')
print('Cosmic Transcriber Web 1.0.15 candidate promotion PASS.')
