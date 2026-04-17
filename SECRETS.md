# GitHub Secrets Required for CI/CD & Auto-Updater

This document lists every GitHub Actions secret you must configure under
**Settings → Secrets and variables → Actions** in this repository before the
release pipeline will work correctly.

---

## 1. Tauri Updater Signing Keys (all platforms)

These are used to sign every release artifact so that the built-in updater can
verify authenticity before applying an update.

### Generate the key pair once

```bash
# Inside the repo root (requires tauri-cli)
pnpm exec tauri signer generate -w ~/.tauri/pipilot-ide.key
```

This writes:
- `~/.tauri/pipilot-ide.key`   ← **private key** (keep secret)
- `~/.tauri/pipilot-ide.key.pub` ← **public key** (safe to share)

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `~/.tauri/pipilot-ide.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose when generating (blank if none) |
| `TAURI_SIGNING_PUBLIC_KEY` | Full contents of `~/.tauri/pipilot-ide.key.pub` |

> **Important:** Copy the **public key** value into `src-tauri/tauri.conf.json`
> under `plugins.updater.pubkey` as well, so the app knows which key to trust
> at runtime.

---

## 2. macOS Code Signing & Notarisation

Required only when building on `macos-13` / `macos-14` runners.

| Secret name | How to obtain |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` exported from Keychain Access.<br>`base64 -i MyCert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The full name shown in Keychain, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `KEYCHAIN_PASSWORD` | A random string — only used for the ephemeral CI keychain |
| `APPLE_ID` | Your Apple Developer email |
| `APPLE_ID_PASSWORD` | An **App-Specific Password** from <https://appleid.apple.com> |
| `APPLE_TEAM_ID` | Your 10-character Apple Team ID (shown in the developer portal) |

---

## 3. Windows Code Signing

Required only when building on `windows-latest`.

| Secret name | How to obtain |
|---|---|
| `WINDOWS_PFX_BASE64` | Base64-encoded `.pfx` certificate file.<br>`base64 -w 0 MyCert.pfx` (Linux) or<br>`[Convert]::ToBase64String([IO.File]::ReadAllBytes("MyCert.pfx"))` (PowerShell) |
| `WINDOWS_PFX_PASSWORD` | Password protecting the `.pfx` |

> For CI-only testing without a paid EV certificate, you can omit these two
> secrets and remove the Windows signing steps from `release.yml`.

---

## 4. GitHub Token

`GITHUB_TOKEN` is **automatically provided** by GitHub Actions — you do not
need to create it manually.

---

## Quick-start checklist

1. Generate your signing key pair:
   ```bash
   pnpm exec tauri signer generate -- -w ~/.tauri/pipilot-ide.key
   ```
2. Copy the **public key** printed to stdout into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
3. Add `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_SIGNING_PUBLIC_KEY` to GitHub secrets.
4. *(macOS)* Export your Developer ID certificate as `.p12` and add the Apple secrets.
5. *(Windows)* Export your code-signing certificate as `.pfx` and add the Windows secrets.
6. Push a tag: `git tag v0.1.0 && git push origin v0.1.0`
7. Watch the **Release** workflow create signed installers and publish them to GitHub Releases.
8. The app will check for updates at startup via the `latest.json` manifest attached to each release.
