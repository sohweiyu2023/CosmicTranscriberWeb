import {diagnosticErrorFields} from './diagnostics.js';
let reportDiagnostic=()=>{};
export function configureAdminDiagnostics(report){reportDiagnostic=typeof report==='function'?report:()=>{}}
function reportAdminFailure(operation,error){try{reportDiagnostic('admin_failure',{operation,...diagnosticErrorFields(error),appRequestId:error?.requestId})}catch{}}
const $ = id => document.getElementById(id);
const UI = {
  card: $('adminCard'),
  refresh: $('adminRefreshBtn'),
  registrationMode: $('registrationModeSelect'),
  stats: $('adminStats'),
  models: $('adminModels'),
  usersBody: $('adminUsersBody'),
  usersNote: $('adminUsersNote'),
  error: $('adminError')
};
let currentAccount = null;
let busy = false;
const protectedControls = new WeakSet();

function setBusy(value) {
  busy=value;
  UI.refresh.disabled=value;
  UI.registrationMode.disabled=value;
  // Every operation can replace the user rows. Prevent edits until its refresh
  // finishes, including controls created by that refresh, and keep admins locked.
  for(const control of UI.usersBody.querySelectorAll('select,button')){
    control.disabled=value||protectedControls.has(control);
  }
}

function safeText(value, max = 160) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max); }
function duration(seconds) { const n=Math.max(0,Number(seconds)||0); if(n<60)return `${Math.round(n)} sec`; if(n<3600)return `${(n/60).toFixed(1)} min`; return `${(n/3600).toFixed(1)} hr`; }
function bytes(value) { const n=Math.max(0,Number(value)||0); if(n<1e6)return `${Math.round(n/1000)} KB`; if(n<1e9)return `${(n/1e6).toFixed(1)} MB`; return `${(n/1e9).toFixed(2)} GB`; }
function when(ts) { if(!Number.isFinite(Number(ts))||Number(ts)<=0)return '—'; const d=new Date(Number(ts)*1000); return Number.isNaN(d.getTime())?'—':d.toLocaleString(); }

async function api(path, options={}) {
  const response = await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  let body=null; try{body=await response.json()}catch{body={ok:false,error:{code:'malformed_response',message:'The server returned a malformed response.'}}}
  if(!response.ok||body?.ok===false){const e=new Error(body?.error?.message||`Request failed (${response.status}).`);e.code=body?.error?.code||`http_${response.status}`;e.status=response.status;e.requestId=body?.requestId||null;throw e}
  return body;
}

function stat(label, value, title='') {
  const div=document.createElement('div');
  const l=document.createElement('span');l.className='stat-label';l.textContent=label;
  const strong=document.createElement('strong');strong.textContent=value;if(title)strong.title=title;
  div.append(l,strong);return div;
}

function renderOverview(data) {
  UI.registrationMode.value = data.registrationMode || 'open';
  UI.stats.replaceChildren(
    stat('Users', String(data.users?.total||0)),
    stat('Active', String(data.users?.active||0)),
    stat('Pending', String(data.users?.pending||0)),
    stat('Blocked', String(data.users?.blocked||0)),
    stat('New 7d', String(data.users?.new7d||0)),
    stat('Seen 24h', String(data.users?.seen24h||0)),
    stat('Jobs', `${data.jobs?.completed||0}/${data.jobs?.total||0}`, 'completed / started'),
    stat('Chunks', `${data.usage?.chunksSucceeded||0}/${data.usage?.chunksStarted||0}`, `${data.usage?.chunksFailed||0} failed attempts`),
    stat('Audio', duration(data.usage?.audioSecondsRequested||0), `${bytes(data.usage?.bytesRequested||0)} requested`)
  );
  const models=Array.isArray(data.models)?data.models:[];
  UI.models.replaceChildren();
  if(!models.length){UI.models.textContent='No transcription usage yet.';return}
  for(const model of models){
    const row=document.createElement('div');row.className='admin-model-row';
    const name=document.createElement('strong');name.textContent=safeText(model.model,80);
    const detail=document.createElement('span');detail.textContent=`${model.successes||0}/${model.requests||0} successful · ${model.failures||0} failed · ${duration(model.audioSecondsRequested||0)} · ${bytes(model.bytesRequested||0)}`;
    row.append(name,detail);UI.models.append(row);
  }
}

async function loadAdmin() {
  const [overview,users]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users?limit=100&offset=0')]);
  renderOverview(overview);renderUsers(users);
}

function makeStatusControl(user) {
  const wrap=document.createElement('div');wrap.className='inline-actions';
  const select=document.createElement('select');select.setAttribute('aria-label',`Status for ${safeText(user.email)}`);
  for(const status of ['active','pending','blocked']){const o=document.createElement('option');o.value=status;o.textContent=status[0].toUpperCase()+status.slice(1);select.append(o)}
  select.value=user.status;
  const save=document.createElement('button');save.type='button';save.className='secondary';save.textContent=user.isAdmin?'Protected':'Save';
  if(user.isAdmin){protectedControls.add(select);protectedControls.add(save);save.title='Administrator status is protected by deployment configuration.'}
  select.disabled=busy||user.isAdmin;save.disabled=busy||user.isAdmin;
  save.addEventListener('click',async()=>{
    if(busy||user.isAdmin||select.value===user.status)return;
    const target=select.value;
    if(!confirm(`Change ${user.email} from ${user.status} to ${target}?`)){select.value=user.status;return}
    setBusy(true);UI.error.textContent='';
    try{
      await api(`/api/admin/users/${encodeURIComponent(String(user.id))}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:target})});
      await loadAdmin();
    }catch(e){reportAdminFailure('write',e);UI.error.textContent=safeText(e.message,500);select.value=user.status}
    finally{setBusy(false)}
  });
  wrap.append(select,save);return wrap;
}

function renderUsers(data) {
  UI.usersBody.replaceChildren();
  const users=Array.isArray(data.users)?data.users:[];
  UI.usersNote.textContent=`${users.length} shown`;
  for(const user of users){
    const tr=document.createElement('tr');
    const email=document.createElement('td');email.textContent=safeText(user.email,320);
    const status=document.createElement('td');const badge=document.createElement('span');badge.className=`mini-state ${user.status}`;badge.textContent=safeText(user.status);status.append(badge);
    const last=document.createElement('td');last.textContent=when(user.lastSeenAt);
    const jobs=document.createElement('td');jobs.textContent=String(user.jobsStarted||0);
    const chunks=document.createElement('td');chunks.textContent=`${user.chunksSucceeded||0}/${user.chunksStarted||0}`;chunks.title=`${user.chunksFailed||0} failed`;
    const audio=document.createElement('td');audio.textContent=duration(user.audioSecondsRequested||0);audio.title=bytes(user.bytesRequested||0);
    const action=document.createElement('td');action.append(makeStatusControl(user));
    tr.append(email,status,last,jobs,chunks,audio,action);UI.usersBody.append(tr);
  }
  if(!users.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=7;td.className='muted';td.textContent='No users yet.';tr.append(td);UI.usersBody.append(tr)}
}

export async function refreshAdmin() {
  if(!currentAccount?.isAdmin || busy)return;
  setBusy(true);UI.error.textContent='';
  try{await loadAdmin()}catch(e){reportAdminFailure('read',e);UI.error.textContent=safeText(e.message,500)}
  finally{setBusy(false)}
}

export function syncAdminAccount(account) {
  currentAccount=account||null;
  const show=account?.isAdmin===true;
  UI.card.hidden=!show;
  if(show)void refreshAdmin();
}

UI.refresh?.addEventListener('click',()=>{void refreshAdmin()});
UI.registrationMode?.addEventListener('change',async()=>{
  if(!currentAccount?.isAdmin||busy)return;
  const mode=UI.registrationMode.value;
  const descriptions={open:'New authenticated users become active immediately.',approval:'New authenticated users are created as pending until you approve them.',closed:'New users are refused; existing active users continue.'};
  if(!confirm(`Set Cosmic registration to ${mode.toUpperCase()}?\n\n${descriptions[mode]||''}`)){await refreshAdmin();return}
  setBusy(true);UI.error.textContent='';
  try{await api('/api/admin/settings/registration',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});await loadAdmin()}
  catch(e){reportAdminFailure('write',e);UI.error.textContent=safeText(e.message,500)}
  finally{setBusy(false)}
});
