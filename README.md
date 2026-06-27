# Verify Emails — GitHub Action

[![Verify Emails](https://github.com/james-sib/verify-emails-action/actions/workflows/test.yml/badge.svg)](https://github.com/james-sib/verify-emails-action/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Lint your email lists in CI.** This Action verifies email addresses with the
[Verifly](https://verifly.email) API and **fails the job** when it finds bad
addresses — so a typo'd recipient, a dead mailbox, or a junk row in your
config never makes it into a release, a campaign, or a deploy.

Drop it into any workflow to check:

- the email list for a marketing / outreach campaign before you send,
- contact / notification addresses in a config file before you ship,
- a signup or waitlist export,
- any `.txt` / `.csv` of addresses your pipeline produces.

It prints a clean, color-coded summary, writes a machine-readable JSON report,
and sets a green check (or a red ✗) based on your `fail-on` rule.

```
EMAIL                                           RESULT         RECOMMENDATION
-----------------------------------------------------------------------------
james@sibscientific.com                         deliverable    safe_to_send
zharikot@gmail.com                              deliverable    safe_to_send
asdkjhqweqweqwe@nonexistentdomain-xyz.com       undeliverable  do_not_send

Summary
  deliverable   : 2
  undeliverable : 1
  risky         : 0
  unknown       : 0
  total         : 3
```

---

## Quick start

1. Get a Verifly API key — **self-serve, instant, 100 free credits** at
   [verifly.email](https://verifly.email).
2. Add it as a repository secret named `VERIFLY_API_KEY`
   (*Settings → Secrets and variables → Actions → New repository secret*).
3. Add a workflow:

```yaml
name: Verify email list
on:
  pull_request:
    paths: ['data/recipients.csv']

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Verify recipients
        uses: james-sib/verify-emails-action@v1
        with:
          api-key: ${{ secrets.VERIFLY_API_KEY }}
          file: data/recipients.csv
          fail-on: undeliverable
          output: verify-results.json

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: email-verification-report
          path: verify-results.json
```

### Inline list instead of a file

```yaml
- uses: james-sib/verify-emails-action@v1
  with:
    api-key: ${{ secrets.VERIFLY_API_KEY }}
    emails: |
      alice@example.com
      bob@example.com, carol@example.com
    fail-on: undeliverable, risky
```

### Use the outputs

```yaml
- id: verify
  uses: james-sib/verify-emails-action@v1
  with:
    api-key: ${{ secrets.VERIFLY_API_KEY }}
    emails: alice@example.com, bob@example.com
    fail-on: ''            # report only, never fail

- run: |
    echo "Deliverable:   ${{ steps.verify.outputs.deliverable }}"
    echo "Undeliverable: ${{ steps.verify.outputs.undeliverable }}"
    echo "Total:         ${{ steps.verify.outputs.total }}"
```

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | **yes** | — | Your Verifly API key. Pass it from a secret: `${{ secrets.VERIFLY_API_KEY }}`. |
| `emails` | no | `''` | Addresses to verify, separated by commas and/or newlines. Use with or instead of `file`. |
| `file` | no | `''` | Path to a `.txt` / `.csv` file. Every email-looking token in it is extracted and verified. |
| `fail-on` | no | `undeliverable` | Comma/space-separated result categories that fail the job if matched: `undeliverable`, `risky`, `unknown`. Set to `''` to only report. |
| `output` | no | `''` | Path to write the full JSON results to. |
| `api-url` | no | `https://verifly.email` | Override only for a self-hosted Verifly instance. |

Addresses are de-duplicated (case-insensitive) before verification, so you are
not charged twice for the same address.

## Outputs

| Output | Description |
|--------|-------------|
| `total` | Total number of addresses verified. |
| `deliverable` | Count of deliverable addresses. |
| `undeliverable` | Count of undeliverable addresses. |
| `risky` | Count of risky addresses (e.g. catch-all domains). |
| `unknown` | Count of addresses with an unknown verdict. |
| `failed-count` | Number of addresses that matched the `fail-on` condition. |
| `results-json` | Full results as a JSON string. |

### Result categories

| `result` | Meaning | `recommendation` |
|----------|---------|------------------|
| `deliverable` | Mailbox exists and accepts mail. | `safe_to_send` |
| `undeliverable` | Mailbox/domain does not exist or rejects mail. | `do_not_send` |
| `risky` | Catch-all domain — individual address can't be confirmed. | `risky` |
| `unknown` | Server didn't give a definitive answer. | `risky` |

A job-level summary table is also written to the GitHub **Step Summary** on
every run.

---

## Powered by Verifly

[**Verifly**](https://verifly.email) is an email-verification API built for
humans **and AI agents**:

- **Instant, self-serve key + 100 free credits** — no sales call. Sign up at
  [verifly.email](https://verifly.email).
- **Hosted MCP server** — plug verification straight into Claude, Cursor, or any
  MCP-capable agent: [verifly.email/mcp](https://verifly.email/mcp).
- **SDKs & examples** — [github.com/james-sib](https://github.com/james-sib).
- Simple REST API:
  - `GET https://verifly.email/api/v1/verify?email=<email>`
  - `POST https://verifly.email/api/v1/verify/batch` with `{ "emails": [...] }`
  - Auth: `Authorization: Bearer <key>`

> Only verified emails fly. ✈️

---

## License

[MIT](./LICENSE) © james-sib
