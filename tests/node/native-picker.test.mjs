import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePickerAppleScript,submitRealMacOSFilePanel} from '../safari/native-picker.mjs';

test('native macOS picker strictly requires a genuine absolute disk fixture',()=>{
  for(const path of ['',null,'C:\\Users\\fake.mp3','relative/file.mp3','/unsafe\0path']){
    assert.throws(()=>nativePickerAppleScript(path),TypeError);
  }
});

test('native macOS picker preserves Unicode filename and escapes quotes in AppleScript',()=>{
  const source=nativePickerAppleScript('/Users/Shared/ctw-safari-native-xyz/ID3 Unicode 東京 "sample".mp3');
  assert.match(source,/tell application "Safari" to activate/);
  assert.match(source,/command down, shift down/);
  assert.match(source,/ID3 Unicode 東京 \\"sample\\".mp3/);
  assert.match(source,/key code 36/);
  assert.equal((source.match(/key code 36/g)||[]).length,2);
});

test('native picker cannot run on an unrelated non-macOS platform',()=>{
  if(process.platform==='darwin')return;
  assert.throws(()=>submitRealMacOSFilePanel('/Users/Shared/test.mp3'),/genuine macOS/);
});
