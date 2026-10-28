# Zapier — End-to-End Knowledge File

> Reference compiled 2026-10-15 from web research plus general knowledge.
> Confidence tags: **[official]** = taken from zapier.com / docs.zapier.com / help.zapier.com;
> **[secondary]** = blogs or profiles, may be stale or conflicting; untagged = long-standing general knowledge.
> Prices, app counts and AI features change often. Check zapier.com/pricing and help.zapier.com before relying on specifics.

---

## 1. What Zapier is

- A cloud, no-code / low-code **automation and AI orchestration platform** that connects SaaS apps so data moves between them and work happens without manual effort.
- Current positioning: an "AI orchestration platform" connecting **~8,000–9,000+ apps** and **30,000–66,000+ triggers and actions**. The figures differ by page. **[official]**
- Core unit: the **Zap**, an automated workflow made of **one trigger plus one or more actions**.
- Target users: SMBs, ops/marketing/sales/support teams, solo founders, and more and more enterprise IT teams (governance features).
- Cloud-only, with no self-hosting. That's a key difference from n8n.

## 2. Company facts

| Item | Detail |
|---|---|
| Founded | 2011 as a side project in Columbia, Missouri |
| Founders | **Wade Foster** (CEO), **Bryan Helmig** (CTO), **Mike Knoop** (co-founder; left in 2022, later co-founded ARC Prize / Ndea) |
| Accelerator | Y Combinator, Summer 2012 (rejected the first time). Public beta in May 2012 |
| HQ | San Francisco on paper; **fully remote since day one**, no offices |
| Funding | About $1.3M total outside funding (2012 seed led by Bessemer + DFJ) |
| Profitable | Since 2014 |
| Valuation | **$5B** (Jan 2021 secondary sale, Sequoia + Steadfast bought from early investors). Later secondary-market estimates of about $4–5B **[secondary]** |
| Employees | About 730–900 across about 38–40 countries (2025–26 estimates) **[secondary]** |
| Revenue | Private, not disclosed. Passed $100M ARR around 2020; current ARR not public |
| Culture notes | Remote-first pioneer; 2017 "$10k de-location package" for leaving the Bay Area; publishes extensive remote-work guides |
| Security | SOC 2 Type II, SOC 3, GDPR, SAML SSO / SCIM on higher tiers **[official]** |

### Acquisitions
- **Makerpad** (Mar 2021): no-code education community
- **Vowel** (Mar 2024): AI video meetings
- **NoCodeOps** (Jul 2024): no-code ops platform
- **Utopian Labs** (Oct 2025): AI sales-email agents (shut down the next month)

### Product timeline (approximate)
- 2012: Zaps (two-step trigger→action)
- 2016–17: Multi-step Zaps, Filters, Formatter, Code by Zapier, Webhooks
- 2019–20: Paths (branching), Platform CLI matured
- 2022–23: Interfaces (forms/pages), Tables (database), Canvas (process diagrams), AI by Zapier steps, ChatGPT plugin, Zapier Central (agent beta)
- 2024: Copilot (natural-language Zap builder), Chatbots, Zapier Agents (agents.zapier.com)
- 2025: Zapier MCP (beta to GA), Copilot across the whole platform, enterprise AI governance, Lead Router
- 2026: Official MCP integration GA; **Agents folded into Zaps** (looping tool calls GA on 15 Jul 2026); "Next Gen Zaps" deployable from AI clients (early access) **[secondary/official mix]**

---

## 3. Core concepts (the mental model)

### Zap anatomy
```
TRIGGER (event in App A)  →  [optional: Filter / Formatter / Paths / Delay / Code / AI]  →  ACTION(S) (App B, C, ...)
```
- **Trigger**: the event that starts a Zap, e.g. "New row in Google Sheets" or "New Stripe charge".
  - **Polling triggers** check the app every *N* minutes (15 min on Free, 2 on Pro, 1 on Team/Enterprise).
  - **Instant triggers** use webhooks (REST hooks) and fire right away. They're marked "Instant".
- **Action**: something Zapier does, e.g. create a record, send an email, or update a row.
  - **Create** actions write data.
  - **Search** actions find existing records ("Find or create" is a common pattern).
- **Step / field mapping**: data from earlier steps is mapped into later steps' fields by inserting variables.
- **Zap runs**: each execution. Visible in **Zap History** with per-step input/output, errors, and replay.

### Built-in tools ("by Zapier" apps)
| Tool | Purpose |
|---|---|
| **Filter by Zapier** | Continue only if conditions match |
| **Paths by Zapier** | If/else branching, up to multiple branches |
| **Formatter by Zapier** | Text, number, date, and utility transforms (split, lookup tables, line-items) |
| **Delay by Zapier** | Delay For / Delay Until / Delay After Queue |
| **Schedule by Zapier** | Time-based trigger (hourly/daily/weekly/monthly) |
| **Webhooks by Zapier** | Catch hook (trigger) and GET/POST/PUT/custom requests (action). Premium |
| **Code by Zapier** | Run JavaScript (Node) or Python snippets. Runtime is limited per plan |
| **Looping by Zapier** | Iterate over line items/arrays |
| **Sub-Zap by Zapier** | Reusable callable Zap (modular workflows) |
| **Digest by Zapier** | Batch items and release them on a schedule |
| **Storage by Zapier** | Small key-value store across runs |
| **Email by Zapier / Email Parser** | Send email, or parse inbound emails |
| **AI by Zapier** | LLM step: prompt, extract, classify, summarize. Can call tools (agentic loop) |
| **Approvals / Human in the loop** | Pause for a human to approve or edit before continuing |
| **Transfer** | Bulk-move existing historical data between apps |
| **Lead Router** | Route inbound leads to reps (round-robin, rules) **[secondary, beta]** |

### Reliability features
- **Autoreplay**: automatically retries failed steps.
- **Error handling paths**: custom branch when a step errors.
- **Zap History / Replay**: inspect and re-run runs.
- **Version history** (longer on Enterprise), Zap status alerts, and turning off Zaps that keep erroring.
- **Folders, shared app connections, permissions** (Team+).

---

## 4. The product suite (2026)

| Product | What it does |
|---|---|
| **Zaps** | Core automation engine (trigger + actions) |
| **Tables** | No-code database: store and edit data, trigger Zaps from records. Free 2.5k records, Pro 100k, Team 500k |
| **Interfaces** (aka Forms) | Build forms, portals, and simple pages that feed Zaps/Tables. Custom domain on Team+ |
| **Canvas** | AI-assisted diagramming to map business processes. Mixes manual steps with Zaps, Tables, Chatbots, Forms |
| **Chatbots** | No-code AI chatbots with knowledge sources, embeddable, able to trigger actions. Add-on pricing |
| **Agents** | AI agents that reason and use tools. **In 2026 being folded into Zaps as AI steps** (see §6) |
| **Copilot** | Natural-language assistant across Zaps, Canvas, Interfaces, Tables, Functions. Builds and edits workflows from prompts |
| **Zapier MCP** | Exposes Zapier's app/action catalog to external AI clients (Claude, ChatGPT, Cursor, etc.) via Model Context Protocol |
| **Functions** | Code-first workflows (Python) inside Zapier **[less certain about current status]** |
| **Developer Platform** | Build public or private integrations (Platform UI or CLI) |
| **Embed / Partner API** | Embed Zapier templates and workflow builder inside your own SaaS product |
| **Enterprise admin** | SSO/SCIM, app/action restrictions, audit logs, observability API, AI governance controls |

---

## 5. Pricing (as of Oct 2026) **[official, via zapier.com/pricing]**

| Plan | Price | Tasks/mo | Users | Polling | Highlights |
|---|---|---|---|---|---|
| **Free** | $0 | 100 | 1 | 15 min | Two-step Zaps only; no premium apps/webhooks; 2,500 Table records; 2 Chatbots; 400 Agent activities |
| **Professional** | from **$19.99/mo annual** ($29.99 monthly) for 750 tasks, up to about $3,389/mo annual for 2M | 750 → 2M | 1 | 2 min | Multi-step, premium apps, webhooks, Paths, Formatter, AI by Zapier, 100k Table records |
| **Team** | from **$69/mo annual** ($103.50 monthly) for 2,000 tasks | 2k → 2M | 25 | 1 min | Shared workspace and connections, SAML SSO, folder permissions, 6-month audit log, 500k records, priority support |
| **Enterprise** | Custom (sales) | Annual pool | Unlimited | 1 min | SCIM, domain capture, app/action restrictions, data retention, observability API, multiple workspaces, 1-year audit log, TAM |

### How tasks are counted
- **One task is one successful action step.** Triggers, polling, and failed steps are **free**.
- **Free built-ins (no tasks):** Formatter, Filter, Paths, Delay, Looping, Sub-Zap, Digest, Storage, Tables, Forms.
- **Zapier MCP:** one tool call = **2 tasks**.
- **AI steps:** cost varies by model tier and number of tool calls.
- **Code by Zapier:** included runtime is 1s on Free, 30s on Pro/Team, 2 min on Enterprise. Beyond that, 1 task per extra 30s.
- **Overages (pay-per-task):** 1.25× base rate on annual plans, 2.5× on monthly. Capped at 3× the plan, then paused.
- Allowances **reset monthly**, even on annual plans. Enterprise uses an annual pool.
- 14-day Pro trial (no card). Nonprofits get 15% off. Annual billing is about 33% off.
- Chatbots and Agents are priced as **add-ons** and don't draw from the task pool.

---

## 6. AI at Zapier (most important 2025–26 changes)

### AI by Zapier steps
- An LLM step inside a Zap for extraction, classification, summarization, and drafting.
- Choose a model tier, use structured outputs, and give it access to tools (other Zapier actions) with **per-tool approvals**.
- **Looping tool calls** (agentic behavior inside a Zap) went **GA on 15 Jul 2026**. **[secondary]**

### Agents → folded into Zaps (2026) **[secondary, Collab365 summary of Zapier help docs]**
- The standalone agents.zapier.com product is being migrated. **Each agent becomes a Zap with a native trigger plus one AI step** that keeps its prompt, tools, and reasoning.
- What you gain: filters and branching, shared history, model choice, per-tool approvals, structured I/O, admin controls, task-based billing, and a **75-task run pause** safety limit.
- Still missing (as of Sept 2026): automatic splitting of tools into native steps, a direct equivalent for **chat-triggered on-demand agents**, and knowledge sources from HubSpot, Asana, Zendesk, Zoom, and Jira (promised for later in Q3 2026).
- Enterprise agent trials ended on 15 Aug 2026 and converted to free Agents accounts.
- Advice: treat migration as an audit. Add fixed inputs, human approval gates, and clear stop conditions.

### Zapier MCP **[official]**
- Connects AI clients (**Claude, ChatGPT, Cursor**, others) to Zapier's catalog of apps and actions.
- Setup: add the Zapier MCP server URL to the client, choose the allowed apps and actions, then prompt the agent.
- The agent searches the catalog, asks for missing parameters, and executes. **Code Actions** let the agent write and run custom code for internal APIs.
- **Included in all plans. 2 tasks per tool call.**
- Credentials stay inside Zapier (never exposed to the model). App/action access controls, every call logged in History, Enterprise per-workspace on/off switch.
- **Next Gen Zaps**: deploying Zaps directly from AI clients (early access; free while in EA, then 1 task per standard action).

### Copilot
- Natural-language builder ("When a Typeform is submitted, add to HubSpot and Slack the sales team").
- Works across Zaps, Canvas, Interfaces, Tables, and Functions. Keeps chat history and full platform context.

### Scale stat
- "593M+ AI tasks" were run on Zapier (Aug 2026 newsletter). **[secondary]**

---

## 7. Building integrations (Developer Platform) **[official docs.zapier.com/platform]**

Two ways to build:
1. **Platform UI** (visual builder in the browser). Good for most REST APIs.
2. **Platform CLI** (`zapier-platform-cli` + `zapier-platform-core`, Node.js). Full code control, local tests, CI.

### Integration structure (CLI `index.js` exports one app definition)
```js
module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication: { /* basic | custom (API key) | digest | session | oauth2 | oauth1 */ },
  beforeRequest: [ /* add auth headers */ ],
  afterResponse: [ /* error handling */ ],
  triggers: { /* polling or REST-hook (instant) */ },
  searches: { /* find records */ },
  creates:  { /* write records */ },
  resources:{ /* object type → auto-generates trigger/search/create */ },
};
```
- **Triggers** return arrays of objects, each with a unique `id` that Zapier uses for deduplication.
- **REST Hooks**: `performSubscribe` / `performUnsubscribe` / `perform` for instant triggers.
- **Dynamic fields / dropdowns**: fields loaded from the API.
- Common CLI commands: `zapier init`, `zapier test`, `zapier push`, `zapier validate`, `zapier promote`, `zapier migrate`, `zapier env:set`, `zapier logs`.
- **Lifecycle**: private (invite-only) → submit for public review → **beta** → **public** (partner program tiers based on usage and quality).
- **Embed / Workflow API**: lets SaaS products show Zap templates and build Zaps for their users inside their own UI.

---

## 8. Common use cases / patterns
- **Lead capture**: form (Typeform, Facebook Lead Ads, Interfaces) → CRM (HubSpot/Salesforce) → Slack alert → email sequence.
- **Sales ops**: new deal stage → create invoice (Stripe/QuickBooks) → notify finance.
- **Support**: new ticket → AI classify urgency → route via Paths → Slack escalation.
- **Marketing**: new blog post (RSS) → AI-write social copy → schedule to Buffer/LinkedIn.
- **Ops/data sync**: Sheets ↔ Airtable ↔ Tables, scheduled digests, reporting.
- **E-commerce**: Shopify order → fulfillment app → Google Sheet → customer email.
- **AI agentic workflows**: trigger → AI step with tools (search CRM, draft reply, human approval) → send.
- **Internal tools**: Interfaces portal + Tables backend + Zaps logic (no-code app stack).

---

## 9. Competitive landscape

| Tool | Positioning vs Zapier |
|---|---|
| **Make** (ex-Integromat) | Visual scenario builder, cheaper per operation, better for complex branching/data mapping. Fewer integrations (~2–3k) |
| **n8n** | Open-source, **self-hostable**, developer-friendly, priced per execution, strong AI-agent nodes. About 1k+ integrations |
| **Workato** | Enterprise iPaaS, governance-heavy, expensive. Competes for enterprise IT |
| **Microsoft Power Automate** | Bundled with M365, strong in Microsoft ecosystems, RPA |
| **Pipedream** | Developer-first, code steps, generous free tier |
| **IFTTT** | Consumer and simple applets |
| **Tray.io, Boomi, MuleSoft** | Enterprise integration/iPaaS |
| **Lindy, Relevance AI, Gumloop, OpenAI/Anthropic agent tools** | AI-agent-native challengers |

**Zapier's moats:** largest integration catalog, easiest UX, brand and SEO (huge template and app-pair landing pages), partner ecosystem, and now MCP distribution into AI clients.
**Common criticisms:** cost at scale (task-based pricing, often called 2–3× pricier than Make/n8n), no self-hosting, limited complex data handling, and polling delays on lower tiers.

---

## 10. Business model and growth engine
- **Freemium SaaS**, usage-based on tasks, with seat-based Team/Enterprise layers and AI add-ons (Chatbots, Agents).
- **Product-led growth**: free plan → Pro trial → upgrade on task limits, premium apps, and multi-step needs.
- **SEO machine**: millions of programmatic "App A + App B integrations" pages and templates. Partners (app developers) build integrations and promote them.
- **Partner program**: SaaS companies build and maintain their own Zapier integrations for distribution.
- **Enterprise motion**: governance, security, and AI controls sold to IT. "AI orchestration" is the 2025–26 enterprise narrative.
- **Education/community**: Zapier blog, Zapier Learn, Community forum, Experts directory (certified freelancers/agencies), Makerpad legacy.

---

## 11. Glossary
- **Zap**: one automated workflow. **Zap run**: one execution of it.
- **Task**: a billed successful action.
- **Trigger / Action / Search**: start event / do something / look something up.
- **Premium app**: an app needing a paid plan (e.g. Salesforce, Webhooks).
- **Polling interval**: how often Zapier checks a polling trigger.
- **Instant**: webhook-based trigger.
- **Paths**: branching logic. **Filter**: stop or continue condition.
- **Sub-Zap**: reusable workflow called from other Zaps.
- **AI step**: LLM step, optionally with tools (agentic).
- **MCP**: Model Context Protocol, the standard that lets AI clients call Zapier actions.
- **Activities**: unit of Agent usage (legacy Agents billing).
- **Autoreplay**: automatic retry of failed steps.

---

## 12. Open questions / verify before using
- Exact current Pro task tiers and prices change. Check zapier.com/pricing/rates.
- Status of the Agents→Zaps migration and the chat-triggered agent replacement.
- The real current app count (8k vs 9k+) and action count (30k vs 66k+).
- Revenue, valuation, and headcount: there's no official recent disclosure.
- Whether "Functions" remains a separate product.

## Sources
- https://zapier.com/pricing (fetched 2026-10-14/15)
- https://zapier.com/mcp
- https://docs.zapier.com/platform/quickstart · https://docs.zapier.com/platform/build-cli/overview · https://docs.zapier.com/platform/reference/cli-docs
- https://help.zapier.com/hc/en-us/articles/37518970271245-What-is-Zapier
- https://en.wikipedia.org/wiki/Zapier
- https://spaces.collab365.com/posts/zapier-folds-standalone-agents-into-normal-zaps-kkimyhta
- https://sdtimes.com/zapier-adds-copilot-assistant-and-enterprise-grade-governance-to-ai-orchestration-platform/
- https://blog.mean.ceo/?p=10066 (Aug 2026 news roundup)
- https://stockanalysis.com/private/zapier/ · https://www.trueup.io/co/zapier
- https://www.jetadmin.io/blog/zapier-pricing/ · https://automationatlas.io/answers/zapier-pricing-changes-2025-2026/
- https://www.digidop.com/blog/n8n-vs-make-vs-zapier · https://aiagentrank.io/blog/zapier-alternatives-2026
