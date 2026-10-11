# OpenAI API-Key Setup Guide

Cosmic Transcriber Web uses **your own OpenAI API key** and your own API billing. A ChatGPT Plus/Pro/other ChatGPT subscription is separate from API billing.

Recommended setup:
1. Create a dedicated OpenAI Project for Cosmic Transcriber where practical.
2. Create a distinct API key for this use.
3. Prefer **Restricted** API-key permissions and grant only the permissions needed for audio transcription if your account UI offers the relevant endpoint scope.
4. Configure project/model/spend/rate controls appropriate to your use.
5. Monitor API usage and billing.
6. Revoke/rotate immediately if exposure is suspected.

Do not share a personal API key among users. Each Cosmic user configures their own credential session.

References retrieved 2026-08-09:
- https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
- https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform
- https://help.openai.com/en/articles/8867743-assign-api-key-permissions
- https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform
