import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

function decodeMeta(request) {
  const encoded = request.headers()['x-cosmic-metadata'] || '';
  const raw = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function configureKey(page, key = 'test-retained-download-key') {
  await page.getByRole('button', {name: /Configure API key/i}).click();
  await page.locator('#apiKeyInput').fill(key);
  await page.getByRole('button', {name: /Create secure session/i}).click();
  await expect(page.locator('#keyDialog')).not.toBeVisible();
  await expect(page.locator('#keyStatus')).toContainText(/configured/i);
}

test('saved diarization selection survives reload and malformed plaintext envelope fails closed without silent retry', async ({page}) => {
  let requests = 0;
  const requestedModels = [];
  await page.addInitScript(() => {
    if (!localStorage.getItem('cosmic-transcriber-web-preferences-v1')) {
      localStorage.setItem('cosmic-transcriber-web-preferences-v1', JSON.stringify({model: 'gpt-4o-transcribe-diarize'}));
    }
  });
  await page.route('**/api/transcribe', async route => {
    requests++;
    requestedModels.push(decodeMeta(route.request()).model);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {text: 'plaintext only without speaker segments'},
        diagnostics: {appRequestId: 'app-diarize-bad', openaiRequestId: 'req-diarize-bad', elapsedMs: 5}
      })
    });
  });

  await page.goto('/');
  await page.reload();
  await expect(page.locator('#modelSelect')).toHaveValue('gpt-4o-transcribe-diarize');
  await configureKey(page);
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.wav');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready', {timeout: 30000});

  await page.locator('#startBtn').click();
  await expect(page.locator('#confirmDialog')).toBeVisible({timeout: 30000});
  await expect(page.locator('#confirmTitle')).toHaveText('Confirm retry');
  await page.locator('#confirmNo').click();

  await expect(page.locator('#progressTitle')).toHaveText('Finished with errors', {timeout: 30000});
  await expect(page.locator('#queueList .mini-state')).toHaveText('Needs attention');
  await expect(page.locator('#downloadButtons button')).toHaveCount(0);
  expect(requests).toBe(1);
  expect(requestedModels).toEqual(['gpt-4o-transcribe-diarize']);
});

test('changed-settings rerun retains prior TXT/MD downloads on failure, refreshes on export prefs, and excludes prior words on valid new silence', async ({page}) => {
  let requests = 0;
  let mode = 'positive';
  await page.route('**/api/transcribe', async route => {
    requests++;
    if (mode === 'positive') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            text: 'Speaker A original transcript.',
            segments: [{speaker: 'A', start: 1, end: 2, text: 'Speaker A original transcript.'}]
          },
          diagnostics: {appRequestId: 'app-pos', openaiRequestId: 'req-pos', elapsedMs: 5}
        })
      });
      return;
    }
    if (mode === 'malformed') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {text: 'malformed unlabelled substitute'},
          diagnostics: {appRequestId: 'app-bad', openaiRequestId: 'req-bad', elapsedMs: 5}
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {text: '', segments: []},
        diagnostics: {appRequestId: 'app-silence', openaiRequestId: 'req-silence', elapsedMs: 5}
      })
    });
  });

  await page.goto('/');
  await configureKey(page);
  await page.locator('#modelSelect').selectOption('gpt-4o-transcribe-diarize');
  await page.locator('#mergeFiles').check();
  await page.locator('#fileInput').setInputFiles('tests/fixtures/format.wav');
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready', {timeout: 30000});

  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete', {timeout: 60000});
  expect(requests).toBe(1);

  const origTxtPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download format.wav.txt', exact: true}).click();
  const origTxt = await readFile(await (await origTxtPromise).path(), 'utf8');
  expect(origTxt).toContain('Part 1 · Speaker A');
  expect(origTxt).toContain('[00:00:01–00:00:02] Speaker A original transcript.');

  const origMdPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download format.wav.md', exact: true}).click();
  const origMd = await readFile(await (await origMdPromise).path(), 'utf8');
  expect(origMd).toContain('### Part 1 · Speaker A');

  // Change language hint and trigger malformed rerun
  mode = 'malformed';
  await page.locator('#languageInput').fill('en');
  await page.locator('#rerunCompletedBtn').click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await expect(page.locator('#confirmTitle')).toHaveText('Confirm rerun');
  await page.locator('#confirmYes').click();

  // Decline ambiguous retry
  await expect(page.locator('#confirmDialog')).toBeVisible({timeout: 30000});
  await page.locator('#confirmNo').click();
  await expect(page.locator('#progressTitle')).toHaveText('Finished with errors', {timeout: 30000});
  await expect(page.locator('#completedStat')).toHaveText('0');
  expect(requests).toBe(2);

  // Only prior TXT and MD should be offered (never current or Combined Transcript)
  await expect(page.locator('#downloadButtons button')).toHaveCount(2);
  await expect(page.locator('#downloadButtons')).not.toContainText('Combined Transcript');

  const priorTxtPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download format.wav (previous successful result).txt', exact: true}).click();
  const priorTxt = await readFile(await (await priorTxtPromise).path(), 'utf8');
  expect(priorTxt).toBe(origTxt);

  const priorMdPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download format.wav (previous successful result).md', exact: true}).click();
  const priorMd = await readFile(await (await priorMdPromise).path(), 'utf8');
  expect(priorMd).toBe(origMd);

  // Altered export preferences must refresh retained download buttons even when status === 'error'
  await page.locator('#exportMd').uncheck();
  await page.locator('#includeTimestamps').uncheck();
  await expect(page.locator('#downloadButtons button')).toHaveCount(1);
  const noTsTxtPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download format.wav (previous successful result).txt', exact: true}).click();
  const noTsTxt = await readFile(await (await noTsTxtPromise).path(), 'utf8');
  expect(noTsTxt).not.toContain('00:00:01');
  expect(noTsTxt).toContain('Speaker A original transcript.');

  // Restore exportMd & run explicit valid new silence on a fresh language hint
  await page.locator('#exportMd').check();
  await page.locator('#includeTimestamps').check();
  mode = 'silence';
  await page.locator('#languageInput').fill('zh');
  await page.locator('#startBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Complete', {timeout: 60000});
  expect(requests).toBe(3);

  const silenceCombinedPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download Combined Transcript.txt', exact: true}).click();
  const silenceCombined = await readFile(await (await silenceCombinedPromise).path(), 'utf8');
  expect(silenceCombined).not.toContain('Speaker A original transcript.');

  // Reload discards transient in-memory previous download while preserving IndexedDB checkpoints
  await page.reload();
  await expect(page.locator('#downloadButtons button')).toHaveCount(0);
  const cpCount = await page.evaluate(async () => {
    const r = indexedDB.open('cosmic-transcriber-web');
    const db = await new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
    const tx = db.transaction('checkpoints', 'readonly');
    const n = await new Promise((ok, bad) => { const q = tx.objectStore('checkpoints').count(); q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error); });
    db.close();
    return n;
  });
  expect(cpCount).toBeGreaterThanOrEqual(2);
});
