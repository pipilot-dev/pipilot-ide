# Deploy Hub

End-to-end deployment in one virtual editor tab. Push to GitHub/GitLab, deploy to 5 cloud providers, manage env vars + custom domains + webhooks, roll back, all without leaving the IDE.

Open: activity bar → **Deploy** → **🚀 Open Deploy Hub** (the big button at the top of the sidebar). The Hub is a virtual editor tab — same pattern as Settings / Welcome / Help.

## Layout

```
┌────────────────────────────────────────────────────────────┐
│  ⓜ my-project                                              │
│  ✓ git initialized · branch · main · a1b2c3d · ↗ origin    │
├────────────────────────────────────────────────────────────┤
│  01 · CODE HOSTING                                         │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ 🐙 GitHub         │  │ 🦊 GitLab         │                │
│  │ connected · @you  │  │ not connected     │                │
│  │ [↗ Push project]  │  │ [Connect GitLab]  │                │
│  └──────────────────┘  └──────────────────┘                │
├────────────────────────────────────────────────────────────┤
│  02 · CLOUD DEPLOY                                         │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║ ▲  Detected: Vercel · vercel.json   [▶ Deploy now]   ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ ▲ Vercel      │  │ ◈ Netlify     │  │ ☁ CF Pages    │ … │
│  │ connected     │  │ connected     │  │ connected     │   │
│  │ ✓ a1b2c3d.…   │  │ ✓ my-site.…   │  │ -             │   │
│  │ [▶ Preview]   │  │ [▶ Preview]   │  │ [▶ Preview]   │   │
│  │ [→ Production]│  │ [→ Production]│  │ [→ Production]│   │
│  │ 🔐 🌐 🪝 ⏱ 5    │  │ 🔐 🌐 🪝 ⏱ 2    │  │ 🔐 🌐 🪝 ⏱ 1    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
├────────────────────────────────────────────────────────────┤
│  03 · DEV SERVERS                                          │
│  ● http://localhost:5173    npm run dev          [Stop]   │
└────────────────────────────────────────────────────────────┘
```

## 01 · Code hosting (GitHub + GitLab)

One-click "create the repo and push everything".

1. **Connect** the provider — paste a personal access token (`ghp_…` / `glpat-…`). Tokens encrypted via Electron's `safeStorage` (OS keychain) and verified before save by calling the provider's `/user` endpoint; rolled back if rejected.
2. **↗ Push project** — pre-fills repo name from your folder name. Pick the owner (your account or any org you're in for GitHub; any namespace for GitLab), description, public/private toggle. Click **Create + Push**.
3. Live progress log streams the steps:
   - `Creating repo on github…` → calls the API to create the repo
   - `git init` → initialises git if needed; sets the initial branch to match the remote default
   - `Project is empty — seeding README + .gitignore` → only if your working tree is empty
   - `git add -A && git commit` → configures `user.name`/`user.email` locally if missing, then commits
   - `git remote add origin <url>` → replaces any existing `origin`
   - `git push -u origin <branch>` → uses a one-shot URL with the PAT embedded so no credential helper required
4. On success, the primary button morphs into **Open Repo** which deep-links to github.com / gitlab.com.

## 02 · Cloud deploy (5 providers)

Connect once, deploy whenever. Each card shows the connection state, the most-recent deploy summary (✓/✗ + URL + relative time), and per-provider action buttons.

| Provider | Deploy mechanism | Rollback | Env vars | Domains | Hooks |
|----------|------------------|:--:|:--:|:--:|:--:|
| **Vercel**            | `npx vercel deploy` (CLI)    | ✓ promote | ✓ REST | ✓ REST | dashboard link |
| **Netlify**           | `npx netlify deploy` (CLI)   | ✓ restore | ✓ REST | ✓ REST + primary | ✓ full inline |
| **Cloudflare Pages**  | `npx wrangler pages deploy`  | ✓ REST | ✓ per-target | ✓ REST | dashboard link |
| **Cloudflare Workers**| `npx wrangler deploy`        | — | — | — | dashboard link |
| **Railway**           | `npx @railway/cli up`        | ✓ GraphQL | ✓ GraphQL | ✓ GraphQL | dashboard link |
| **Render**            | REST poll (no CLI)           | ✓ REST | ✓ REST | ✓ REST | dashboard link |

### Deploy preview vs production

Two action buttons per card (one for Render — they only have production):

- **▶ Deploy preview** — safe preview URL. Your live site is untouched.
- **→ Production** — warns you first, updates your live URL.

Both spawn the provider's CLI under the hood (or REST in Render's case), stream the entire log into the dialog, parse the deploy URL from output. First run downloads the CLI (~30s, surfaced explicitly in the log so it doesn't feel hung). Subsequent deploys are fast.

### Auto-detect banner

Based on marker files at the project root: `vercel.json` / `netlify.toml` / `wrangler.toml` / `railway.json` / `render.yaml`. Plus framework heuristics (`next.config.*` → Vercel, `_redirects` → Netlify) at lower confidence. Highest hit only — banner shows above the cards with one-click "Deploy now" or "Connect <Provider>" depending on state.

### Deploy history

⏱ button on any card with prior deploys → modal with last 30 entries:

- ✓/✗ status pill
- URL with click-to-open
- Target (preview / production)
- Relative time + duration
- **📜 Logs** — opens the provider's build-logs dashboard at the exact deployment (red-tinted on failures so the eye lands on "go see why" first)
- **↻ Re-run** — deploy again with the same config + target
- **↑ Promote / Restore / Rollback** — depends on provider; promotes a preview to production

### Env vars (🔐 button)

Per-provider env management.

- **Vercel** — first open per project asks which Vercel project the local folder maps to (auto-suggests by folder name, persists in `vercel-project-map.json`). Then full list with key + target pills (production / preview / development) + masked values (click to reveal). + Add / Edit / Delete with target picker.
- **Netlify** — auto-discovers site from the most recent deploy's metadata. Site-wide env vars (no per-context scoping in the v1 API). Add / Edit / Delete inline.
- **Cloudflare Pages** — per-environment (production OR preview). Adding the same key to both targets is two entries.
- **Cloudflare Workers** — env management via `wrangler.toml`; not surfaced in the IDE today.
- **Railway** — per-service, per-environment. Reads project / service / environment IDs from `.railway/config.json`.
- **Render** — flat env vars per service.

### Custom domains (🌐 button)

Same dialog pattern across providers. List shows domain + verified/pending pill + Open button + Remove. + Add domain dialog normalises input (strips `https://`, paths, lowercases) and shows a brief "configure DNS at the provider" hint.

- **Vercel** — `/v9/projects/{id}/domains`. Shows verification challenges if pending.
- **Netlify** — `custom_domain` (primary) + `domain_aliases` (extras). Add dialog has a "set as primary" toggle.
- **Cloudflare Pages** — `/accounts/{a}/pages/projects/{name}/domains`.
- **Render** — `/v1/services/{id}/custom-domains`.
- **Railway** — combined custom domains + service domains (the auto-generated `up.railway.app` subdomain is always shown for reference).

### Webhooks (🪝 button)

POST URLs that trigger deploys — perfect for GitHub Actions, cron jobs, "deploy on CMS publish" flows.

- **Netlify** — full inline management. List / Create / Copy URL / Delete. Each hook has a name and optional branch.
- **Vercel / Cloudflare / Railway / Render** — clear "managed in dashboard" dialog with a deep-link to the provider's hooks page.

## 03 · Dev servers

Moved from the sidebar into the tab. Pulse-dot status indicator, click URL to open in browser, inline Stop button per server. The sidebar still has its own list as a quick-access mirror.

## Storage on disk

Everything in `<userData>/`:

- `cloud-tokens.json` — encrypted PATs, one per connector.
- `deploy-history.json` — last 30 entries per provider.
- `deploy-config.json` — per-`<provider>:<projectPath>` extra config (Cloudflare project name, account ID, dist dir, etc.).
- `vercel-project-map.json` — local folder → Vercel project mapping.
- `render-service-map.json` — local folder → Render service mapping.

Tokens are encrypted via Electron's `safeStorage` (OS keychain on macOS / Windows) with a base64 fallback elsewhere.

## Tips

- After GitHub push, the cloud cards detect your repo on the next refresh — Vercel/Netlify/Cloudflare Pages can then "import from git" via their dashboards. Pipeline becomes: PiPilot push → provider auto-deploys.
- For Cloudflare Workers, your `wrangler.toml` is the source of truth for `name` / `main` / `routes`. The deploy dialog only collects the optional account ID.
- For Railway, you must `npx @railway/cli@latest link` once in a terminal first — that creates `.railway/config.json` which the IDE reads for the project / service / environment IDs.
- For Render, deploys trigger a fresh build of the linked git repo. So push to GitHub → trigger Render → it pulls + builds + deploys. Cache can be cleared via the dialog's "Clear build cache" toggle.
