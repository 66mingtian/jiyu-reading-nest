# Security Policy

## Supported scope

This repository is a personal, single-user reference deployment. Its private MCP path is a practical gate for a personal Worker, not a complete multi-user authentication system.

Before operating a shared or public service, add real authentication, authorization, per-user data isolation, rate limits, abuse controls, retention rules, and account-level deletion.

## Data boundaries

- D1 stores reading metadata, progress, preferences, annotations, bookmarks, and records.
- A private R2 bucket stores imported source text.
- IndexedDB is a device cache and is not the only recovery source.
- Outbound bookshelf payloads remove internal R2 object keys.
- Full imported books must never be committed as fixtures or demos.

## Secret handling

Never commit:

- `MCP_PATH_TOKEN`
- Cloudflare API tokens or account credentials
- real `wrangler.jsonc` database identifiers if they identify a private deployment
- `.dev.vars`, `.env`, Wrangler state, database dumps, R2 exports, screenshots, or logs
- user book text, annotations, chats, or reading history

Set the MCP token with Wrangler:

```bash
openssl rand -hex 32
pnpm --filter @ss/server exec wrangler secret put MCP_PATH_TOKEN
```

Keep the R2 bucket private. This project does not require or generate a public R2 URL.

Because the personal access token is part of the request path, production Workers Logs must not
store invocation URLs and automatic traces must remain disabled. The checked-in Wrangler config
sets `observability.logs.invocation_logs` to `false` and `observability.traces.enabled` to `false`.
Application error logs record only a route category and never `request.url` or `url.pathname`.

## Reporting a vulnerability

Please open a GitHub security advisory instead of a public issue when the report contains an exploitable security weakness. Do not include real tokens, private source text, or production data in the report.
