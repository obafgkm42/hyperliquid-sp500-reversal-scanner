# Security Policy

## Supported version

Security fixes are applied to the latest commit on the default branch.

## Reporting a vulnerability

Use GitHub's private security advisory feature when a remote repository is
available. Do not open a public issue containing a webhook URL, token, account
identifier, private dataset, exploit detail, or other secret.

Include the affected version, impact, reproduction steps, and a suggested fix
when possible. Remove or replace all personal and production data.

## Secrets

- Store `DISCORD_WEBHOOK_URL` and `MANUAL_SCAN_TOKEN` as Cloudflare secrets.
- Use `.dev.vars` only for local development; it is ignored by Git.
- Never place secrets in `wrangler.toml`, screenshots, logs, fixtures, or issues.
- Rotate a Discord webhook or token immediately if it is exposed.

The Worker does not require a Hyperliquid wallet, private key, or trading API
credential. A contribution that adds any account or trading capability requires
a separate threat model and maintainer approval.
