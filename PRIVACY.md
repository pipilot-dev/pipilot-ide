# Privacy

PiPilot is built on the assumption that you should know exactly what leaves your machine. This page tells you, plainly.

## What we collect

When you sign in to use AI features, we ask GitHub for and store the following in our backend database:

| Field | Source | Why we need it |
| --- | --- | --- |
| GitHub user ID + login (e.g. `octocat`) | GitHub `/user` endpoint | Stable identity for the JWT we issue you |
| Primary verified email | GitHub `/user/emails` endpoint | Account recovery + future paid-plan support |
| Avatar URL | GitHub `/user` endpoint | Display in Settings → Account |

That's it. We do **not** request `repo`, `gist`, `workflow`, or any code-access scope. The `read:user user:email` scopes are the bare minimum for OAuth.

## What we log

For every chat turn that goes through `pipilot-proxy`, we log a record with:

- Your user ID (the GitHub one above)
- Timestamp (Unix seconds)
- Model identifier the request used (a short string)
- Input / output / cache tokens (counts only — never the content)
- HTTP status code
- Total duration in milliseconds

This data exists so we can: (a) detect abuse, (b) calibrate future paid plans, (c) debug your individual issue if you report one. It will never be sold or shared with third parties.

## What we do NOT collect

- **Your code.** Prompts you send to the AI are forwarded to the upstream model and **not stored** by our proxy. We see token counts, not content.
- **Your prompts.** Same as above — the request body is streamed straight to the upstream API.
- **Your file paths.** We don't know what you're working on.
- **Telemetry / analytics.** No Sentry, no PostHog, no Mixpanel. The IDE doesn't phone home outside the auth + AI flow.
- **Crash reports.** Not in v0.1. If we add them later, it will be opt-in, anonymised, and clearly disclosed in release notes.

## Where data lives

| Data | Storage | Lifetime |
| --- | --- | --- |
| Your GitHub identity row | Encrypted backend store (US East region) | Until you ask us to delete it |
| Your usage records | Encrypted backend store | Currently retained indefinitely; we'll add automatic 90-day rotation in v0.2 |
| Your JWT | Local OS keychain via Electron `safeStorage` (Mac Keychain / Windows DPAPI / GNOME Keyring) | 7 days, then refresh by re-running device flow |
| Your code, prompts, chat history | **Your machine only**, in `<userData>/sessions/` and the project's `.pipilot/` directory | Until you delete them |

## Third parties in the request path

Every chat turn touches:

1. **Our edge proxy host** — sees the JWT and the request body in transit; does not log payloads.
2. **An upstream model API** we operate — receives your prompt, returns a response. Subject to standard model-provider data policies.
3. **An inline-completion provider** — currently called directly from your machine using a bundled API key. Will be moved behind our proxy in v0.2.

For features other than AI:

- **GitHub** — only when you push commits or use the Source Control panel, you trigger normal git network calls.
- **The Cloud providers in Deploy Hub** (Vercel, Netlify, etc.) — only when you click Deploy. Your tokens for those providers stay in your local OS keychain via `safeStorage`.

## Your rights

- **Sign out** wipes your local JWT immediately (Settings → Account → Sign Out).
- **Delete account** — open an issue at the repo or email us; we'll wipe your records within 7 days.
- **Export your data** — also an issue or email; we'll send your `users` and `usage` rows as JSON.

## Changes to this policy

We'll bump the version at the bottom and call out the change in `CHANGELOG.md`. If a change is material (we start collecting something new, share data with a new third party, etc.), we'll require re-consent on next launch.

---

**Last updated:** 2026-05-03 — applies to PiPilot IDE v0.1.0.
