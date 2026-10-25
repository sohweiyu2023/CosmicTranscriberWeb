// Test-only failure evidence. Never logs control values, text, errors or credentials.
const numericKeys=['left','top','width','height','viewportWidth','viewportHeight','optionCount','selectedIndex','openDialogs'];
const booleanKeys=['connected','disabled','hidden','displayed','visible','pointerEventsEnabled','focused','documentFocused','documentComplete','fontsLoaded','cancelDisabled'];
export function safeNativeSelectObservation(observation){
 const safe={};
 for(const key of numericKeys){const n=observation?.[key];safe[key]=typeof n==='number'&&Number.isFinite(n)?Math.max(-1000000,Math.min(1000000,Math.round(n*1000)/1000)):null;}
 for(const key of booleanKeys)safe[key]=typeof observation?.[key]==='boolean'?observation[key]:null;
 return safe;
}
export async function selectNativeModelWithDiagnostics(model,expected,{ordinal=0,emit=message=>console.error(message)}={}){
 const started=Date.now();let phase='snapshot',snapshotInFlight=true,selectionInFlight=false,lastSample=null;
 try{
  const sample=await model.evaluate(element=>{
   const box=element.getBoundingClientRect(),css=getComputedStyle(element);
   return {left:box.left,top:box.top,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
    optionCount:element.options.length,selectedIndex:element.selectedIndex,openDialogs:document.querySelectorAll('dialog[open]').length,
    connected:element.isConnected,disabled:element.disabled,hidden:element.hidden,displayed:css.display!=='none',visible:css.visibility==='visible',pointerEventsEnabled:css.pointerEvents!=='none',
    focused:document.activeElement===element,documentFocused:document.hasFocus(),documentComplete:document.readyState==='complete',fontsLoaded:document.fonts?.status==='loaded',cancelDisabled:document.getElementById('cancelBtn')?.disabled};
  },undefined,{timeout:15000});
  snapshotInFlight=false;lastSample=safeNativeSelectObservation(sample);phase='select';selectionInFlight=true;
  // Preserve the original native action and default timeout. No force or retry.
  await model.selectOption(expected);
  selectionInFlight=false;
 }catch(error){
  const diagnostic={schema:'cosmic-native-select-diagnostic-1',ordinal:Number.isSafeInteger(ordinal)&&ordinal>=0&&ordinal<=100?ordinal:null,elapsedMs:Date.now()-started,phase,snapshotInFlight,selectionInFlight,lastSample};
  // Do not issue another browser call after a protocol/action timeout.
  try{emit('NATIVE_SELECT_DIAGNOSTIC '+JSON.stringify(diagnostic));}catch{/* retain original failure */}
  throw error;
 }
}
