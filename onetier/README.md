# OneTier

OneTier is a Zapier-style automation platform you can run on your own machine. You connect apps, build flows with triggers and actions, store data in Tables, publish forms and portals as Interfaces, deploy AI Chatbots, map processes on a Canvas, and let AI clients take actions through MCP. Every part of it is real and runs against its own backend.

## Quick start

Requirements: **Node.js 22.5+** (Node 26 recommended). No database server is needed, because OneTier uses the SQLite that's built into Node.

```bash
cd onetier
npm run install:all      # installs server + web dependencies
npm start                # builds the web app and serves everything on http://localhost:3000
```

For development with hot reload:

```bash
npm run dev              # API on :3000, web app on http://localhost:5173
npm test                 # boots a fresh server and runs the end-to-end suite (87 checks)
```

Open the app and sign up. OneTier is **completely free** — no plans, trials, credit cards or limits. Each new workspace comes with sample content: a Leads table, a contact-form Interface, a support Chatbot, a draft "Welcome new contacts" flow and a Canvas.

### Turning on AI (optional)

AI steps, Copilot, AI table fields and Chatbots can run on any of these. Choose in **Settings → AI**:

| Option | Needs an API key? | How |
|---|---|---|
| **Claude account** | No | Click **Sign in with Claude**. OneTier runs the official Claude Code sign-in on this computer, then sends AI requests through Claude Code (`claude -p`). Requires Claude Code (`npm i -g @anthropic-ai/claude-code`). |
| **ChatGPT account** | No | Click **Sign in with ChatGPT**. This uses OpenAI's Codex CLI (`codex login`, `codex exec`). Requires Codex CLI (`npm i -g @openai/codex`). |
| **Anthropic API key** | Yes | Paste the key; it's verified and stored encrypted. Default model: `claude-opus-5-5`. |
| **OpenAI API key** | Yes | Paste the key; OneTier lists the models it can use. |

Requests made with a Claude or ChatGPT account count toward that account's plan limits. Public chatbots answering website visitors never use a personal account; they need an API key, and otherwise answer by keyword search. With nothing connected, Copilot drafts flows with keyword matching.

**ChatGPT or Claude as your agent:** open **MCP**, create a server (the 18 "agent builder" tools are included), and add its URL as a connector:
- in Claude: Settings → Connectors, or `claude mcp add --transport http onetier <url>`
- in ChatGPT: Developer mode → Create connector

Then ask it to build flows. It calls `onetier_create_flow`, `onetier_run_flow`, `onetier_publish_flow` and the rest, on your own subscription. The ChatGPT and Claude web apps need a public URL (a tunnel plus `PUBLIC_URL`).

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:PORT` | Base URL used in webhook and MCP links. Set it when you deploy behind a domain or tunnel. |
| `ONETIER_DATA_DIR` | `server/data` | Where the SQLite database and encryption key live |
| `ONETIER_SECRET` | auto-generated | 64-hex-character key used to encrypt stored credentials |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Default API keys |
| `ONETIER_LOCAL_AI_ACCOUNTS` | `on` | Set to `off` on shared or public servers so workspaces can't use the machine's Claude or ChatGPT sign-in |
| `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH` | `claude` / `codex` | Paths to the CLIs if they aren't on `PATH` |

## What's inside

### Flows (the automation engine)
- **Triggers:**
  - instant webhooks: Catch Hook, Catch Raw Hook, and `?wait=true` for a synchronous response
  - schedules: every N minutes, hourly, daily, weekly or monthly
  - polling: RSS, any JSON API, GitHub, Stripe, Slack, Telegram, Notion, Airtable, HubSpot, Trello and custom apps; only new items fire, with no duplicates
  - internal events: new or updated table record, form submission, interface button, chatbot lead or message
  - manual runs and sub-flow starts
- **Actions:** 13 external integrations (Slack, Discord, Telegram, GitHub, Notion, Airtable, HubSpot, Trello, Stripe, Twilio, SendGrid, SMTP, Anthropic) plus a large set of built-in tools.
- **Logic:**
  - Filters, plus Paths for branching (every matching path runs, with a fallback path)
  - Looping over line items, and Delay For / Until (long delays pause the run and resume later)
  - Human-in-the-loop approvals with a timeout, Digest batching, Sub-flows with return values, and Storage that persists between runs
- **AI by OneTier:** generate text, extract structured data, classify, summarize, and an **AI Agent** step that calls the OneTier actions you allow.
- **Developer tools:** Formatter (text, numbers, dates, utilities), Code (JavaScript in a sandboxed process) and Webhooks / custom HTTP requests.
- **Editor:**
  - step testing with real sample data, and field mapping with `{{step.field}}` and a variable picker
  - checks before publishing, draft and published versions with restore, autosave and folders
  - trash and restore, duplicate, and JSON export/import
- **Reliability:**
  - Autoreplay retries, set per-step to stop or continue on error
  - error notifications, and an automatic turn-off after repeated failures
  - full run history with per-step data in and out, replay, and bulk replay

### Products
- **Tables:** a typed spreadsheet database with 14 field types, including AI fields. It supports CSV import and export, search, filter and sort, and triggers flows.
- **Interfaces:** pages built from blocks (forms, tables, buttons that run flows, embedded chatbots, text and images). They support themes, password protection, public URLs and a submissions log.
- **Chatbots:** a knowledge base and instructions, Claude models, lead capture into Tables, and automations that run flows as tools. They come with a public page, an embeddable iframe and conversation history.
- **Canvas:** process diagrams you can draw or generate with AI. Nodes link to real flows and show their live status.
- **Copilot:** describe a workflow in plain language and it drafts the flow, and it answers questions about the product. Open it with ⌘J.

### Platform
- **MCP server:** expose chosen actions and flows to Claude, ChatGPT, Cursor and other AI clients over the Model Context Protocol (streamable HTTP).
- **REST API (`/api/v1`):** API keys can run flows, read runs and work with table records.
- **Developer platform:** build private integrations for any REST API with no code. You define the authentication (API key, bearer or basic), triggers, actions and searches, then test them in the browser.
- **Workspaces and teams:**
  - multiple workspaces and invite links, with owner, admin and member roles
  - audit log on Team and Enterprise, and SSO settings
  - encrypted credentials (AES-256-GCM)
- **Free forever:** there is no billing at all. Flows, steps, tasks, apps, tables, interfaces, chatbots, teammates and workspaces are unlimited, and every feature (Paths, AI steps, audit log, SSO settings, MCP, API) is unlocked. Tasks are only counted as an activity statistic on the Usage page.
- **Inbox:** email steps deliver here unless you connect SMTP, so you can see results without a mail server.

## Using webhooks from the internet

Webhook URLs look like `http://localhost:3000/hooks/catch/<flowId>/<secret>`. To receive webhooks from outside your machine, expose the port with a tunnel such as `cloudflared` or `ngrok`, and set `PUBLIC_URL` to the tunnel URL so the app shows the right links.

## Architecture

```
onetier/
  server/                Node + Express + node:sqlite
    src/engine/          run engine (steps, paths, loops, delays, approvals, billing) and triggers/scheduler
    src/apps/            app catalog: built-in tools, external integrations, custom-app runtime
    src/routes/          REST API (auth, flows, products, platform, public, MCP)
    test/e2e.mjs         end-to-end test suite
  web/                   React 18 + Vite single-page app
```

## Notes and limits

- OneTier never charges anything. The only possible cost is outside OneTier: if you add your own Anthropic API key, Anthropic bills you for the Claude usage of AI steps, Copilot and Chatbots. Without a key, those features use free built-in fallbacks.
- Integrations that only offer OAuth (Google Sheets, Gmail and similar) aren't included, because OAuth needs registered client apps. Every included integration uses API keys, tokens or webhook URLs. You can add more with the Developer platform or the Webhooks app.
- SAML SSO settings are stored and shown on Team/Enterprise, but sign-in through an identity provider is not implemented (it needs a real IdP).
- Code steps run in a separate Node process with the permission model on: no filesystem access, no child processes, network only.
