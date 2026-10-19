import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

// Invokes the real macOS file-open panel via a genuine OS keyboard event.
// Unlike WebDriver sendKeys this follows the user picker path that WebKit
// normally uses to grant the selected disk file a sandbox extension.
// No bytes are synthesized, no File objects are constructed, and subsequent
// native full/sliced SHA, timestamps, duration and app workflow remain strict.
export function nativePickerAppleScript(absolutePath){
  if(typeof absolutePath!=='string'||!absolutePath.startsWith('/')||absolutePath.includes('\0')||absolutePath.length>4096)
    throw new TypeError('A bounded absolute native fixture path is required');
  const parentDirectory=path.posix.dirname(absolutePath);
  const fileName=path.posix.basename(absolutePath);
  if(parentDirectory==='/'||!fileName||fileName==='.'||fileName==='..')
    throw new TypeError('Native fixture must be a file in an explicit absolute directory');
  const quotedDirectory=JSON.stringify(parentDirectory),quotedName=JSON.stringify(fileName);
  return `tell application "Safari" to activate
  delay 0.5
  tell application "System Events"
  -- Fail closed if an unrelated app owns the keyboard. The focused DOM
  -- button was checked through SafariDriver before entering OS automation.
  set frontApp to name of first application process whose frontmost is true
  if frontApp is not "Safari" then error "Safari did not become the foreground application"
  -- The genuine app + Files button has DOM focus. An OS Space keypress
  -- triggers the native picker without a WebDriver click that can hang
  -- until the modal closes, starving subsequent WebDriver commands.
  key code 49
  delay 1.0
  -- The previous whole-path Go to Folder attempt left the Safari 26.6
  -- native panel unresolved, blocking the subsequent WebDriver command.
  -- Instead navigate to the genuine disk parent directory, then use the
  -- native Open dialog's ordinary filename selection and Open action.
  keystroke "g" using {command down, shift down}
  delay 0.75
  keystroke ${quotedDirectory}
  delay 0.75
  key code 36
  delay 1.2
  keystroke ${quotedName}
  delay 0.75
  key code 36
end tell
return frontApp`;
}

export function submitRealMacOSFilePanel(absolutePath){
  if(process.platform!=='darwin')throw new Error('The native file picker requires a genuine macOS host');
  const outcome=spawnSync('/usr/bin/osascript',['-e',nativePickerAppleScript(absolutePath)],{encoding:'utf8',timeout:12000,windowsHide:true});
  if(outcome.status!==0){
    const explanation=(outcome.error?.message||outcome.stderr||'native picker unavailable').trim().slice(0,250);
    throw new Error(`Native macOS file picker failed: ${explanation}`);
  }
  return String(outcome.stdout||'').trim().slice(0,100);
}


// Keep the native Safari fallback fail-closed. The first genuine SafariDriver
// selection can fail in the browser while still reaching the app's real queue.
// Never conceal that error, dispatch paid work, or let its stale queue entry
// contaminate a second genuine OS-picker selection. Dependencies are injected
// solely to unit-test the exact invariant without a macOS host.
export async function clearRejectedNativeSelection({
  expectedName,beforePaidCount,waitForRejectedQueue,readQueue,clickClear,countPaid
}){
  const failedQueue=await waitForRejectedQueue();
  assert.deepEqual(failedQueue,[{name:expectedName,status:'Needs attention'}],
    'An unreadable native selection must fail closed before a genuine picker retry');
  assert.equal(await countPaid(),beforePaidCount,
    'Unreadable native selection must never dispatch paid work');
  await clickClear();
  assert.deepEqual(await readQueue(),[],
    'The original failed file must be removed before native picker retry');
  assert.equal(await countPaid(),beforePaidCount,
    'Clearing a failed selection must never dispatch paid work');
}
