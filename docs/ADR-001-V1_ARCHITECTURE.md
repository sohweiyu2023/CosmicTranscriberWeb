# ADR-001 — V1 Browser + Cloudflare Streaming Relay

**Status:** Accepted for V1 architecture; V1.1 user-registry extension under certification, 2026-08-14.

## Context
A native macOS port would require a Mac for meaningful acceptance. The user can thoroughly test a web product from Windows and reserve a small real-Safari pass for the end. Source recordings can be multi-hour; API keys and billing-sensitive retries require a server-mediated security boundary.

## Decision
Use a static browser application plus Cloudflare Worker. Keep source audio local except while a bounded chunk is streamed through Cloudflare to the fixed OpenAI transcription endpoint. Require Cloudflare Access for initial deployment. Store each user’s OpenAI key only in an authenticated AES-GCM browser credential cookie, never in app storage/database. Use IndexedDB only for safe checkpoints/results.

Do not add R2, D1, KV, Durable Objects, Workflows or a service worker in V1 without evidence they solve a concrete reliability requirement.

## Alternatives rejected
- Native macOS/Avalonia: insufficient local hardware validation.
- Direct browser → OpenAI: would expose BYOK plaintext to frontend JavaScript and encourage client-side secret handling.
- Owner shared API key: violates Mode B and mixes billing.
- Persistent server jobs/R2/Workflow: unnecessary privacy and lifecycle complexity for V1.
- Full multipart buffering in Worker: unnecessary memory risk.
- Generic OpenAI proxy: unacceptable credential/SSRF abuse surface.

## Consequences
The tab must stay open for active work. Browser restart requires reselecting the source file. Future durable background jobs can be added as V2 without changing the source fingerprint/chunk/result identity model.

### V1.1 registry extension

Cloudflare Access remains the sole login authority. V1.1 adds a D1-backed application authorization/administration layer containing verified identity metadata and aggregate operational counters only. It does not change the V1 audio path or create a server-side audio/transcript archive. Staging and production registries are isolated.
