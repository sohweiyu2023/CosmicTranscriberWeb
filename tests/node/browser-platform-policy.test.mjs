import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {browserGates, BROWSER_POLICY_REVISION} from '../../scripts/browser-platform-policy.mjs';

test('release platform coverage retains every supported engine and actual target browser', async () => {
  assert.equal(BROWSER_POLICY_REVISION, '2026-10-11-target-platforms-v1');
  assert.deepEqual(browserGates('win32'), ['test:e2e:windows', 'test:e2e:firefox-key-stress', 'test:e2e:branded']);
  assert.deepEqual(browserGates('linux'), ['test:e2e:core']);
  assert.deepEqual(browserGates('darwin'), ['test:e2e:macos', 'test:safari:real']);
  const {scripts} = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const projects = command => [...command.matchAll(/--project=([\w-]+)/g)].map(match => match[1]);
  assert.deepEqual(projects(scripts['test:e2e:windows']), ['chromium', 'firefox']);
  assert.deepEqual(projects(scripts['test:e2e:branded']), ['chrome', 'edge']);
  assert.deepEqual(projects(scripts['test:e2e:core']), ['chromium', 'firefox', 'webkit', 'mobile-safari']);
  assert.deepEqual(projects(scripts['test:e2e:macos']), ['webkit', 'mobile-safari', 'chrome']);
  for (const name of browserGates('win32').concat(browserGates('linux'), browserGates('darwin'))) {
    assert.ok(scripts[name]?.startsWith('npm run build && '), `${name} must build the current source`);
  }
});

test('unknown platforms fail closed and callers cannot mutate required gates', () => {
  assert.throws(() => browserGates('freebsd'), /No reviewed release browser policy/);
  const copy = browserGates('win32');
  copy.length = 0;
  assert.equal(browserGates('win32').length, 3);
});
