import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {normalizeOpenAiResult} from '../../public/js/transcript-result.js';
import {buildFileOutput} from '../../public/js/output.js';

const app = readFileSync(new URL('../../public/js/app.js', import.meta.url), 'utf8');

function section(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf('\n' + end, a);
  assert.ok(a >= 0 && b > a, `Missing section ${start} .. ${end}`);
  return app.slice(a, b);
}

const controllerSource = [
  section('function updateSettingsAvailability()', 'function renderStats('),
  section('function askConfirmation(', 'function checkpointPersistenceFailure('),
  section('function prepareDownloads(s)', 'function renderDownloads()'),
  section('async function run({', 'function beforeUnload('),
  section('async function rerunCompletedWithCurrentSettings()', 'function resetKeyVisibility(')
].join('\n');

function setupController(result, {includeTimestamps = true, exportTxt = true, exportMd = true} = {}) {
  const oldText = 'Trustworthy prior speaker-labelled result';
  const ct = {index: 1, logicalStart: 0, duration: 2, logicalEnd: 2, start: 0, end: 2};
  const prior = {...ct, text: oldText, segments: [{speaker: 'A', start: 0, end: 2, text: oldText}]};
  const item = {
    id: 'synthetic-item',
    file: {name: 'synthetic.wav'},
    diagRef: 'fake',
    status: 'done',
    parts: [prior],
    completedSettingsIdentity: 'original',
    completedExportSettingsIdentity: 'a'.repeat(64),
    completedModel: 'gpt-4o-transcribe-diarize'
  };
  const s = {
    model: 'gpt-4o-transcribe-diarize',
    includeTimestamps,
    exportTxt,
    exportMd,
    mergeFiles: false,
    continueOnError: true
  };
  const state = {
    accountStatus: 'active',
    keyConfigured: true,
    principalScope: 'synthetic',
    queue: [item],
    downloads: [],
    completedFiles: 1,
    running: false,
    confirmResolver: null
  };
  const evidence = {calls: 0, prompts: [], dialogs: [], progress: [], downloads: []};
  const UI = {
    completedStat: {},
    modelSelect: {value: s.model, disabled: false},
    modelHelp: {textContent: ''},
    chunkRange: {value: '20', disabled: false},
    chunkLabel: {textContent: ''},
    durationRange: {value: '5', disabled: false},
    durationLabel: {textContent: ''},
    languageInput: {disabled: false},
    keywordsInput: {disabled: false},
    promptInput: {disabled: false},
    previousContext: {disabled: false},
    retrySelect: {disabled: false},
    includeTimestamps: {disabled: false},
    exportTxt: {disabled: false},
    exportMd: {disabled: false},
    mergeFiles: {disabled: false},
    continueOnError: {disabled: false},
    confirmTitle: {textContent: ''},
    confirmText: {textContent: ''},
    confirmNo: {textContent: '', focus() {}},
    confirmYes: {textContent: ''},
    confirmDialog: {
      showModal() {
        evidence.dialogs.push({
          title: UI.confirmTitle.textContent,
          cancelLabel: UI.confirmNo.textContent,
          confirmLabel: UI.confirmYes.textContent,
          text: UI.confirmText.textContent
        });
        evidence.prompts.push(UI.confirmText.textContent);
        queueMicrotask(() => {
          const resolver = state.confirmResolver;
          state.confirmResolver = null;
          resolver(evidence.approve !== false);
        });
      }
    }
  };
  const context = {
    state,
    UI,
    MODELS: {[s.model]: {label: 'GPT-4o Transcribe Diarize', help: '', languages: 'single', keywords: false, prompt: false, previous: false, diarize: true}},
    readSettings: () => ({...s}),
    savePrefs() {},
    preparedQueueItem: () => true,
    combinedExportHasMixedSettings: () => false,
    combinedExportComplete: q => q.length > 0 && q.every(x => x.status === 'done'),
    combinedTranscriptWithinLimit: () => true,
    eligibleQueueItem: x => x.status === 'ready',
    settingsIdentity: async () => evidence.identity ?? 'changed-settings',
    settingsForIdentity: x => x,
    processingRevision: () => 'synthetic',
    safeBaseName: () => 'synthetic',
    safeError: e => e.message,
    errorCode: e => e.code,
    buildFileOutput,
    renderDownloads: () => evidence.downloads.push(state.downloads.map(x => ({name: x.name, isPrevious: !!x.isPrevious}))),
    renderQueue() {},
    renderStats() {},
    addDiag() {},
    refreshSession() {},
    endTimedOperation() {},
    window: {addEventListener() {}, removeEventListener() {}},
    beforeUnload() {},
    rid: p => `${p}-synthetic`,
    setProgress: (...a) => evidence.progress.push(a),
    isExplicitUserCancellation: () => false,
    systemicJobFailure: () => false,
    processFile: async row => {
      assert.equal(row, item);
      evidence.calls++;
      const part = normalizeOpenAiResult(result, ct, {requireDiarization: true});
      row.parts = [{...ct, ...part}];
      row.status = 'done';
      state.completedFiles++;
      row.completedSettingsIdentity = 'changed-settings';
    }
  };
  vm.createContext(context);
  vm.runInContext(
    controllerSource + '\nglobalThis.inspect={prepareDownloads,rerunCompletedWithCurrentSettings,syncSettingsUi,askAmbiguousRetry};',
    context
  );
  return {state, item, evidence, prior, oldText, s, ...context.inspect};
}

const oldNames = ['synthetic (previous successful result).txt', 'synthetic (previous successful result).md'];

test('malformed changed rerun retains prior TXT/MD separately, uses rerun dialog labels, and updates on export pref toggles', async () => {
  const x = setupController({text: 'invalid unlabelled substitute'});
  x.s.mergeFiles = true;
  x.prepareDownloads(x.s);
  const original = Array.from(x.state.downloads.slice(0, 2), e => e.makeText());
  await x.rerunCompletedWithCurrentSettings();

  assert.equal(x.evidence.calls, 1);
  assert.equal(x.item.status, 'error');
  assert.equal(x.state.completedFiles, 0);
  assert.equal(x.evidence.dialogs[0].title, 'Confirm rerun');
  assert.equal(x.evidence.dialogs[0].cancelLabel, 'Cancel');
  assert.equal(x.evidence.dialogs[0].confirmLabel, 'Run again');
  assert.deepEqual(Array.from(x.state.downloads, d => d.name), oldNames);
  assert.ok(x.state.downloads.every(d => d.isPrevious === true));
  assert.deepEqual(Array.from(x.state.downloads, d => d.makeText()), original);
  assert.equal(x.evidence.progress.at(-1)[1], 'Finished with errors');

  // Toggle exportMd off and includeTimestamps off after failed rerun:
  // syncSettingsUi() must refresh retained downloads even though status !== 'done'.
  x.s.exportMd = false;
  x.s.includeTimestamps = false;
  x.syncSettingsUi();
  assert.deepEqual(Array.from(x.state.downloads, d => d.name), [oldNames[0]]);
  assert.doesNotMatch(x.state.downloads[0].makeText(), /00:00:00/);
  assert.match(x.state.downloads[0].makeText(), /Trustworthy prior speaker-labelled result/);
});

test('ambiguous retry confirmation preserves conservative retry labels', async () => {
  const x = setupController({text: '', segments: []});
  await x.askAmbiguousRetry({chunk: 1});
  assert.equal(x.evidence.dialogs[0].title, 'Confirm retry');
  assert.equal(x.evidence.dialogs[0].cancelLabel, 'Do not retry');
  assert.equal(x.evidence.dialogs[0].confirmLabel, 'Retry and accept possible charge');
});

test('explicit new silence completes; current and combined exclude prior words', async () => {
  const x = setupController({text: '', segments: []});
  x.s.mergeFiles = true;
  await x.rerunCompletedWithCurrentSettings();
  assert.equal(x.evidence.calls, 1);
  assert.equal(x.state.completedFiles, 1);
  assert.equal(x.item.status, 'done');
  assert.equal(x.item.parts[0].text, '');
  assert.deepEqual(x.item.parts[0].segments, []);
  const prior = x.state.downloads.filter(d => oldNames.includes(d.name));
  const fresh = x.state.downloads.filter(d => !oldNames.includes(d.name));
  assert.equal(prior.length, 2);
  assert.equal(fresh.length, 4);
  for (const d of prior) assert.match(d.makeText(), /Trustworthy prior/);
  for (const d of fresh) assert.doesNotMatch(d.makeText(), /Trustworthy prior/);
});

test('declining rerun creates no retained artifact or attempt; same settings creates no redundant prior result', async () => {
  const declined = setupController({text: '', segments: []});
  declined.evidence.approve = false;
  await declined.rerunCompletedWithCurrentSettings();
  assert.equal(declined.evidence.calls, 0);
  assert.equal(declined.item.previousRerunResult, undefined);
  assert.equal(declined.item.status, 'done');

  const same = setupController({text: '', segments: []});
  same.evidence.identity = 'original';
  await same.rerunCompletedWithCurrentSettings();
  assert.equal(same.evidence.calls, 1);
  assert.equal(same.item.previousRerunResult, undefined);
});

test('multi-file run assigns a distinct jobId to each file so D1 chunk_count identities never collide', async () => {
  const processStart = app.indexOf('async function processFile(');
  const processEnd = app.indexOf('\nfunction prepareDownloads', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  let ridCounter = 0;
  const seenJobIds = [];
  const context = {
    MODELS: {'gpt-transcribe': {diarize: false}},
    performance,
    DOMException,
    state: {runId: 'run-shared-batch', principalScope: 'A'.repeat(32), completedFiles: 0, cancelRequested: false},
    UI: {completedStat: {}},
    addDiag() {},
    setProgress() {},
    renderQueue() {},
    hashBlobStreaming: async file => file.fp,
    ensureInspectionForSettings: async () => {},
    settingsIdentity: async () => 'a'.repeat(64),
    settingsForIdentity: s => s,
    processingRevision: () => 'rev-1',
    checkpointId: async () => 'cp:' + 'b'.repeat(64),
    loadCheckpoint: async () => null,
    newCheckpoint: (item, cpid, sid) => ({
      id: cpid,
      chunks: item.inspection.chunks.map(c => ({...c, status: 'pending', attempts: []})),
      results: {}
    }),
    compatibleCheckpoint: () => true,
    checkpointResultReusable: () => false,
    checkpointAttemptNeedsConfirmation: () => false,
    rid: prefix => `${prefix}-${++ridCounter}`,
    safeDisplayName: s => s,
    addTranscriptCharacters: (n, t) => n + t.length,
    hashText: s => s,
    effectivePaidSettings: s => s,
    sendChunk: async (_item, chunk, _s, jobId) => {
      seenJobIds.push({jobId, chunkIndex: chunk.index});
      return {...chunk, text: 'ok', segments: null};
    }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(processStart, processEnd) + '\nglobalThis.processFile=processFile;', context);

  const fileA = {
    file: {name: 'long.mp3', size: 100, fp: '1'.repeat(64)},
    fingerprint: '1'.repeat(64),
    audioFormat: 'mp3',
    diagRef: 'f-1',
    inspection: {chunks: [{index: 1, logicalStart: 0, duration: 10}, {index: 2, logicalStart: 10, duration: 10}]}
  };
  const fileB = {
    file: {name: 'short.wav', size: 50, fp: '2'.repeat(64)},
    fingerprint: '2'.repeat(64),
    audioFormat: 'wav',
    diagRef: 'f-2',
    inspection: {chunks: [{index: 1, logicalStart: 0, duration: 5}]}
  };
  await context.processFile(fileA, {model: 'gpt-transcribe', previousContext: false}, 1, 2);
  await context.processFile(fileB, {model: 'gpt-transcribe', previousContext: false}, 2, 2);

  assert.equal(seenJobIds.length, 3);
  assert.equal(seenJobIds[0].jobId, seenJobIds[1].jobId, 'chunks of same file share one jobId');
  assert.notEqual(seenJobIds[0].jobId, seenJobIds[2].jobId, 'different files in same run must not collide on jobId');
  assert.notEqual(seenJobIds[0].jobId, 'run-shared-batch');
});
