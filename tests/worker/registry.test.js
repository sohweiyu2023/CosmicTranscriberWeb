import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  adminListUsers,
  adminOverview,
  adminSetRegistrationMode,
  adminSetUserStatus,
  configuredAdminEmails,
  recordTranscriptionDispatch,
  recordTranscriptionResult,
  requireActiveAccount,
  resolveUserAccount
} from '../../src/user-registry.js';

function principal(sub,email){return {sub,email,country:'US',source:'access'}}

async function setting(mode){
  await env.USER_DB.prepare("UPDATE cosmic_settings SET value=?, updated_at=unixepoch() WHERE key='registration_mode'").bind(mode).run();
}

function metadata(overrides={}){
  return {jobId:'job-a',attemptId:'attempt-1',model:'gpt-transcribe',chunkIndex:1,chunkCount:2,declaredBytes:4096,durationSeconds:30,...overrides};
}

describe('D1 user registry and admin controls',()=>{
  it('normalizes configured admins and auto-activates an administrator',async()=>{
    expect([...configuredAdminEmails(env)]).toEqual(['admin@example.test']);
    const account=await resolveUserAccount(env,principal('admin-sub','ADMIN@example.test'));
    expect(account).toMatchObject({email:'admin@example.test',status:'active',isAdmin:true,registrationMode:'open'});
    expect(()=>requireActiveAccount(account)).not.toThrow();
  });

  it('supports open, approval and closed registration without weakening existing accounts',async()=>{
    await setting('open');
    const open=await resolveUserAccount(env,principal('open-sub','open@example.test'));
    expect(open.status).toBe('active');

    await setting('approval');
    const pending=await resolveUserAccount(env,principal('pending-sub','pending@example.test'));
    expect(pending.status).toBe('pending');
    expect(()=>requireActiveAccount(pending)).toThrow();

    await setting('closed');
    const closed=await resolveUserAccount(env,principal('closed-sub','closed@example.test'));
    expect(closed).toMatchObject({status:'registration_closed',userId:null});
    const existing=await resolveUserAccount(env,principal('open-sub','open@example.test'));
    expect(existing.status).toBe('active');
  });

  it('preserves account status when Cloudflare reissues sub for the same verified email',async()=>{
    await setting('approval');
    const first=await resolveUserAccount(env,principal('subject-old','returning@example.test'));
    expect(first.status).toBe('pending');
    const second=await resolveUserAccount(env,principal('subject-new','returning@example.test'));
    expect(second.status).toBe('pending');
    expect(second.userId).toBe(first.userId);
    const rows=await env.USER_DB.prepare('SELECT id,access_sub,email FROM cosmic_users WHERE email=?').bind('returning@example.test').all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].access_sub).toBe('subject-new');
  });

  it('fails closed if the same Access sub suddenly presents a different verified email',async()=>{
    await setting('open');
    await resolveUserAccount(env,principal('stable-sub','stable@example.test'));
    await expect(resolveUserAccount(env,principal('stable-sub','different@example.test'))).rejects.toMatchObject({code:'identity_email_mismatch'});
  });

  it('lets an admin approve/block users but protects configured administrator accounts',async()=>{
    await setting('approval');
    const admin=await resolveUserAccount(env,principal('admin-control','admin@example.test'));
    const user=await resolveUserAccount(env,principal('control-user','control@example.test'));
    await adminSetUserStatus(env,admin,user.userId,'active');
    expect((await resolveUserAccount(env,principal('control-user','control@example.test'))).status).toBe('active');
    await adminSetUserStatus(env,admin,user.userId,'blocked');
    expect((await resolveUserAccount(env,principal('control-user','control@example.test'))).status).toBe('blocked');
    await expect(adminSetUserStatus(env,admin,admin.userId,'blocked')).rejects.toMatchObject({code:'admin_status_protected'});
  });

  it('switches registration mode with an audit record',async()=>{
    const admin=await resolveUserAccount(env,principal('admin-mode','admin@example.test'));
    await adminSetRegistrationMode(env,admin,'closed');
    expect((await adminOverview(env)).registrationMode).toBe('closed');
    const audit=await env.USER_DB.prepare("SELECT action,detail FROM cosmic_admin_audit WHERE actor_user_id=? ORDER BY id DESC LIMIT 1").bind(admin.userId).first();
    expect(audit).toMatchObject({action:'registration_mode',detail:'closed'});
  });

  it('defends admin mutation helpers even if a future route forgets its admin guard',async()=>{
    await setting('open');
    const nonAdmin=await resolveUserAccount(env,principal('ordinary-actor','ordinary@example.test'));
    const target=await resolveUserAccount(env,principal('ordinary-target','target@example.test'));
    await expect(adminSetRegistrationMode(env,nonAdmin,'closed')).rejects.toMatchObject({code:'admin_required'});
    await expect(adminSetUserStatus(env,nonAdmin,target.userId,'blocked')).rejects.toMatchObject({code:'admin_required'});
  });

  it('rejects a duplicate accepted attempt before it can become a second paid dispatch',async()=>{
    await setting('open');
    const p=principal('dispatch-once','dispatch-once@example.test');
    const account=await resolveUserAccount(env,p);
    const m=metadata({jobId:'single-use-job',chunkIndex:1,chunkCount:1,attemptId:'single-use-attempt'});
    const beforeModel=await env.USER_DB.prepare('SELECT request_count FROM cosmic_model_usage WHERE model=?').bind(m.model).first();
    const beforeRequests=Number(beforeModel?.request_count || 0);
    await recordTranscriptionDispatch(env,p,m);
    await expect(recordTranscriptionDispatch(env,p,m)).rejects.toMatchObject({code:'duplicate_usage_attempt',details:{billingState:'ambiguous_after_dispatch'}});
    await expect(recordTranscriptionDispatch(env,p,{...m,chunkIndex:2})).rejects.toMatchObject({code:'usage_attempt_identity_mismatch'});
    const dispatches=await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_dispatches WHERE user_id=? AND job_id=?').bind(account.userId,'single-use-job').first();
    expect(Number(dispatches.n)).toBe(1);
    const listed=await adminListUsers(env,{limit:100,offset:0});
    const u=listed.users.find(x=>x.id===account.userId);
    expect(u).toMatchObject({jobsStarted:1,chunksStarted:1});
    const model=await env.USER_DB.prepare('SELECT request_count FROM cosmic_model_usage WHERE model=?').bind(m.model).first();
    expect(Number(model.request_count)).toBe(beforeRequests+1);
  });

  it('keeps logical job identity immutable and does not count a rejected conflicting dispatch',async()=>{
    await setting('open');
    const p=principal('job-identity','job-identity@example.test');
    const account=await resolveUserAccount(env,p);
    const first=metadata({jobId:'immutable-job',chunkIndex:1,chunkCount:2,attemptId:'immutable-attempt-1',model:'gpt-4o-mini-transcribe'});
    await recordTranscriptionDispatch(env,p,first);
    const before=await adminListUsers(env,{limit:100,offset:0});
    const beforeUser=before.users.find(x=>x.id===account.userId);
    await expect(recordTranscriptionDispatch(env,p,{...first,attemptId:'immutable-attempt-2',model:'gpt-4o-transcribe'})).rejects.toMatchObject({code:'usage_job_identity_mismatch'});
    const after=await adminListUsers(env,{limit:100,offset:0});
    const afterUser=after.users.find(x=>x.id===account.userId);
    expect(afterUser.jobsStarted).toBe(beforeUser.jobsStarted);
    expect(afterUser.chunksStarted).toBe(beforeUser.chunksStarted);
    const dispatches=await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_dispatches WHERE user_id=? AND job_id=?').bind(account.userId,'immutable-job').first();
    expect(Number(dispatches.n)).toBe(1);
  });

  it('requires a recorded matching dispatch before accepting an outcome receipt',async()=>{
    await setting('open');
    const p=principal('receipt-guard','receipt@example.test');
    await resolveUserAccount(env,p);
    await expect(recordTranscriptionResult(env,p,metadata({jobId:'missing-job',attemptId:'orphan-result'}),{success:true})).rejects.toMatchObject({code:'usage_attempt_dispatch_missing'});
    await recordTranscriptionDispatch(env,p,metadata({jobId:'identity-job',attemptId:'identity-dispatch'}));
    await expect(recordTranscriptionResult(env,p,metadata({jobId:'identity-job',attemptId:'identity-result',model:'gpt-4o-transcribe'}),{success:true})).rejects.toMatchObject({code:'usage_attempt_dispatch_missing'});
  });

  it('records aggregate job/chunk/model usage without storing file names, transcript or API-key content',async()=>{
    await setting('open');
    const p=principal('usage-sub','usage@example.test');
    const account=await resolveUserAccount(env,p);
    await recordTranscriptionDispatch(env,p,metadata({chunkIndex:1,attemptId:'attempt-fail'}));
    await recordTranscriptionResult(env,p,metadata({chunkIndex:1,attemptId:'attempt-fail'}),{success:false});
    // Replaying the same result must be idempotent rather than double-counting.
    await recordTranscriptionResult(env,p,metadata({chunkIndex:1,attemptId:'attempt-fail'}),{success:false});
    await recordTranscriptionDispatch(env,p,metadata({chunkIndex:1,attemptId:'attempt-success-1'}));
    await recordTranscriptionResult(env,p,metadata({chunkIndex:1,attemptId:'attempt-success-1'}),{success:true});
    await recordTranscriptionDispatch(env,p,metadata({chunkIndex:2,attemptId:'attempt-success-2',declaredBytes:2048,durationSeconds:15}));
    await recordTranscriptionResult(env,p,metadata({chunkIndex:2,attemptId:'attempt-success-2',declaredBytes:2048,durationSeconds:15}),{success:true});

    const job=await env.USER_DB.prepare('SELECT status FROM cosmic_jobs WHERE user_id=? AND job_id=?').bind(account.userId,'job-a').first();
    expect(job.status).toBe('completed');
    const receipts=await env.USER_DB.prepare('SELECT attempt_id,success FROM cosmic_attempt_results WHERE user_id=? AND job_id=? ORDER BY attempt_id').bind(account.userId,'job-a').all();
    expect(receipts.results).toHaveLength(3);
    const listed=await adminListUsers(env,{limit:100,offset:0});
    const u=listed.users.find(x=>x.id===account.userId);
    expect(u).toMatchObject({jobsStarted:1,chunksStarted:3,chunksSucceeded:2,chunksFailed:1});
    const schema=(await env.USER_DB.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'cosmic_%'").all()).results.map(x=>`${x.name}:${x.sql}`).join('\n').toLowerCase();
    for(const forbidden of ['api_key','transcript','filename','file_name','prompt','audio_blob']) expect(schema).not.toContain(forbidden);
  });

  it('does not downgrade a completed chunk or job when a later explicit retry fails',async()=>{
    await setting('open');
    const p=principal('retry-status','retry-status@example.test');
    const account=await resolveUserAccount(env,p);
    await recordTranscriptionDispatch(env,p,metadata({jobId:'retry-job',chunkIndex:1,chunkCount:1,attemptId:'success-first'}));
    await recordTranscriptionResult(env,p,metadata({jobId:'retry-job',chunkIndex:1,chunkCount:1,attemptId:'success-first'}),{success:true});
    await recordTranscriptionDispatch(env,p,metadata({jobId:'retry-job',chunkIndex:1,chunkCount:1,attemptId:'failed-later'}));
    await recordTranscriptionResult(env,p,metadata({jobId:'retry-job',chunkIndex:1,chunkCount:1,attemptId:'failed-later'}),{success:false});
    const chunk=await env.USER_DB.prepare('SELECT status,successes,failures FROM cosmic_job_chunks WHERE user_id=? AND job_id=? AND chunk_index=1').bind(account.userId,'retry-job').first();
    expect(chunk).toMatchObject({status:'completed',successes:1,failures:1});
    const job=await env.USER_DB.prepare('SELECT status FROM cosmic_jobs WHERE user_id=? AND job_id=?').bind(account.userId,'retry-job').first();
    expect(job.status).toBe('completed');
  });
});
