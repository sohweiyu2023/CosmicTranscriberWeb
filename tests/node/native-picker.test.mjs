import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativePickerAppleScript,submitRealMacOSFilePanel,clearRejectedNativeSelection} from '../safari/native-picker.mjs';

test('native macOS picker strictly requires a genuine absolute disk fixture',()=>{
  for(const path of ['',null,'C:\\Users\\fake.mp3','relative/file.mp3','/unsafe\0path']){
    assert.throws(()=>nativePickerAppleScript(path),TypeError);
  }
});

test('native macOS picker preserves Unicode filename and escapes quotes in AppleScript',()=>{
  const source=nativePickerAppleScript('/Users/Shared/ctw-safari-native-xyz/ID3 Unicode 東京 "sample".mp3');
  assert.match(source,/tell application "Safari" to activate/);
  assert.match(source,/command down, shift down/);
  assert.match(source,/key code 49/,'The genuine OS Space keypress must open the picker');
  assert.ok(source.indexOf('key code 49')<source.indexOf('command down, shift down'),'OS Space must precede Go to Folder');
  assert.match(source,/if frontApp is not "Safari" then error/,'Never type a disk pathname into an unrelated foreground app');
  assert.ok(source.indexOf('if frontApp is not "Safari"')<source.indexOf('key code 49'),'Check foreground Safari before OS keyboard input');
  assert.match(source,/keystroke "\/Users\/Shared\/ctw-safari-native-xyz"/,
    'Navigate to the parent directory rather than repeating the observed stalled whole-file-path attempt');
  assert.ok(source.includes('keystroke '+JSON.stringify('ID3 Unicode 東京 "sample".mp3')),
    'The real filename must be selected separately in the native Open panel');
  assert.doesNotMatch(source,/keystroke "\/Users\/Shared\/ctw-safari-native-xyz\/ID3/,
    'Avoid the previously stalled full-path navigation in this genuine Safari fallback');
  assert.ok(source.indexOf('keystroke "/Users/Shared/ctw-safari-native-xyz"')<source.indexOf('keystroke "ID3 Unicode'),
    'Navigate to the actual directory before choosing the genuine file');
  assert.match(source,/delay 1\.2\n  keystroke/,'Wait for directory navigation before selecting the file');
  assert.equal((source.match(/key code 36/g)||[]).length,2,
    'One Return opens the directory and one opens the selected file');
});

test('native picker cannot run on an unrelated non-macOS platform',()=>{
  if(process.platform==='darwin')return;
  assert.throws(()=>submitRealMacOSFilePanel('/Users/Shared/test.mp3'),/genuine macOS/);
});

test('strict SafariDriver native-file gate does not attempt unsupported external picker fallback',()=>{
  const source=readFileSync(new URL('../safari/safari-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/\/value`,\{text:fixture\.file\}/,'Only genuine disk-backed WebDriver file selection is allowed');
  assert.match(source,/assertNativeObservation\(observed\.result,fixture\)/,'Native read failure must fail the strict gate');
  assert.match(source,/report\.fixtures\.push\(evidence\)/,'Preserve native read failure evidence before asserting');
  assert.match(source,/mode:'not-attempted'/,'Record why unsupported picker fallback was not attempted');
  assert.doesNotMatch(source,/submitRealMacOSFilePanel\(fixture\.file\)/,'Do not use AppleScript during SafariDriver');
  assert.doesNotMatch(source,/clearRejectedNativeSelection\(/,'Do not mutate app queue to conceal failed native selection');
  assert.doesNotMatch(source,/input\.files\s*=/,'Never inject a synthetic FileList');
  const app=readFileSync(new URL('../../public/js/app.js',import.meta.url),'utf8');
  assert.match(app,/item\.status='error';item\.error=safeError\(e\)/,'The app must visibly report native-file errors');
});

// Exercise actual fail-closed queue invariants, not merely source-string markers.
// The genuine macOS picker remains an external mandatory acceptance gate.
function rejectedHarness({rows=[{name:'format.mp3',status:'Needs attention'}],paid=0,afterClearPaid=paid}={}){
  const actions=[];let queue=rows;
  return {actions,options:{expectedName:'format.mp3',beforePaidCount:0,
    waitForRejectedQueue:async()=>queue,
    readQueue:async()=>queue,
    clickClear:async()=>{actions.push('clear');queue=[];paid=afterClearPaid},
    countPaid:async()=>paid}};
}
test('native fallback clears exactly one genuinely rejected file without paid work',async()=>{
  const {actions,options}=rejectedHarness();
  await clearRejectedNativeSelection(options);
  assert.deepEqual(actions,['clear']);
});
test('native fallback rejects an unexpectedly ready original file without clearing it',async()=>{
  const {actions,options}=rejectedHarness({rows:[{name:'format.mp3',status:'Ready'}]});
  await assert.rejects(clearRejectedNativeSelection(options),/fail closed/);
  assert.deepEqual(actions,[]);
});
test('native fallback rejects multiple stale queue entries without clearing them',async()=>{
  const {actions,options}=rejectedHarness({rows:[{name:'format.mp3',status:'Needs attention'},{name:'other.mp3',status:'Needs attention'}]});
  await assert.rejects(clearRejectedNativeSelection(options),/fail closed/);
  assert.deepEqual(actions,[]);
});
test('native fallback rejects an unexpected original file name without clearing it',async()=>{
  const {actions,options}=rejectedHarness({rows:[{name:'wrong.mp3',status:'Needs attention'}]});
  await assert.rejects(clearRejectedNativeSelection(options),/fail closed/);
  assert.deepEqual(actions,[]);
});
test('native fallback refuses to clear when original unreadable selection dispatched paid work',async()=>{
  const {actions,options}=rejectedHarness({paid:1});
  await assert.rejects(clearRejectedNativeSelection(options),/must never dispatch paid work/);
  assert.deepEqual(actions,[]);
});
test('native fallback rejects any paid dispatch occurring during queue cleanup',async()=>{
  const {actions,options}=rejectedHarness({afterClearPaid:1});
  await assert.rejects(clearRejectedNativeSelection(options),/Clearing a failed selection must never dispatch paid work/);
  assert.deepEqual(actions,['clear']);
});
test('native fallback rejects a Clear Queue control that leaves the failed item',async()=>{
  const {options}=rejectedHarness();
  options.clickClear=async()=>{};
  await assert.rejects(clearRejectedNativeSelection(options),/must be removed/);
});
