# Future V2 Durable Background Jobs

Only if V1 field reliability shows the need:

```text
Browser → authenticated scoped temporary R2 upload → Workflow → OpenAI → result state → browser
```

Required controls: private R2 bucket, no public object URLs, short lifecycle/cleanup, source/job ownership bound to verified Access subject, raw OpenAI key never persisted, temporary credential strategy scoped to the job, durable retry logic that respects ambiguous billing, authenticated status/download endpoints, deletion after success/failure timeout, explicit revised privacy disclosure, and migrations/rollback tests.

Do not automatically carry a stateless browser BYOK cookie into an unattended Workflow design; V2 needs a fresh credential-lifecycle ADR.
