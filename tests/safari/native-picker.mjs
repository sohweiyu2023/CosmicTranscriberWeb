import {spawnSync} from 'node:child_process';

// Invokes the real macOS file-open panel after a genuine WebDriver click.
// Unlike WebDriver sendKeys this follows the user picker path that WebKit
// normally uses to grant the selected disk file a sandbox extension.
// No bytes are synthesized, no File objects are constructed, and subsequent
// native full/sliced SHA, timestamps, duration and app workflow remain strict.
export function nativePickerAppleScript(absolutePath){
  if(typeof absolutePath!=='string'||!absolutePath.startsWith('/')||absolutePath.includes('\0')||absolutePath.length>4096)
    throw new TypeError('A bounded absolute native fixture path is required');
  const quoted=JSON.stringify(absolutePath);
  return `tell application "System Events"
  keystroke "g" using {command down, shift down}
  delay 0.35
  keystroke ${quoted}
  delay 0.35
  key code 36
  delay 0.35
  key code 36
end tell`;
}

export function submitRealMacOSFilePanel(absolutePath){
  if(process.platform!=='darwin')throw new Error('The native file picker requires a genuine macOS host');
  const outcome=spawnSync('/usr/bin/osascript',['-e',nativePickerAppleScript(absolutePath)],{encoding:'utf8',timeout:12000,windowsHide:true});
  if(outcome.status!==0){
    const explanation=(outcome.error?.message||outcome.stderr||'native picker unavailable').trim().slice(0,250);
    throw new Error(`Native macOS file picker failed: ${explanation}`);
  }
}
