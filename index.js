#!/usr/bin/env node
'use strict';

/**
 * Verify Emails — GitHub Action entrypoint (Node 20, zero dependencies).
 *
 * Calls the Verifly batch email-verification API for every address found in the
 * `emails` input and/or the `file` input, prints a clean summary, optionally
 * writes the full JSON results, and fails the job when any address matches one
 * of the `fail-on` result categories.
 *
 * Verifly docs: https://verifly.email  ·  Hosted MCP: https://verifly.email/mcp
 */

const fs = require('fs');

const API_URL_DEFAULT = 'https://verifly.email';
const BATCH_LIMIT = 100; // Verifly batch API hard limit per request.
const VALID_RESULTS = ['deliverable', 'undeliverable', 'risky', 'unknown'];

// ---------------------------------------------------------------------------
// GitHub Actions plumbing (mirrors @actions/core so we need no dependencies).
// ---------------------------------------------------------------------------

function getInput(name, { required = false } = {}) {
  const envName = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  const value = (process.env[envName] || '').trim();
  if (required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // Use a random heredoc delimiter to support multi-line values safely.
  const delim = `ghadelim_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, markdown + '\n');
}

function log(msg = '') {
  process.stdout.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// ANSI helpers. GitHub Actions logs render ANSI; disable with NO_COLOR.
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const useColor = !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));
const C = {
  green: wrap('32'),
  red: wrap('31'),
  yellow: wrap('33'),
  gray: wrap('90'),
  bold: wrap('1'),
};

// ---------------------------------------------------------------------------
// Email collection
// ---------------------------------------------------------------------------

// Loose extractor: pull anything that looks like an email out of free-form
// text (CSV cells, newline lists, comma lists). The API does strict
// validation server-side, so we only need to be permissive here.
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

function extractEmails(text) {
  if (!text) return [];
  return text.match(EMAIL_RE) || [];
}

function dedupePreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function collectEmails() {
  const emailsInput = getInput('emails');
  const fileInput = getInput('file');

  const collected = [];
  if (emailsInput) collected.push(...extractEmails(emailsInput));

  if (fileInput) {
    if (!fs.existsSync(fileInput)) {
      throw new Error(`file not found: ${fileInput}`);
    }
    collected.push(...extractEmails(fs.readFileSync(fileInput, 'utf8')));
  }

  return dedupePreserveOrder(collected);
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function verifyBatch(apiUrl, apiKey, emails) {
  const res = await fetch(`${apiUrl}/api/v1/verify/batch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ emails }),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response from API (HTTP ${res.status}): ${raw.slice(0, 300)}`);
  }

  if (!res.ok || json.success === false) {
    const err = json.error || {};
    throw new Error(
      `API error (HTTP ${res.status}): ${err.code || 'unknown'} - ${err.message || raw.slice(0, 200)}`
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function colorForResult(result) {
  switch (result) {
    case 'deliverable': return C.green;
    case 'undeliverable': return C.red;
    case 'risky': return C.yellow;
    default: return C.gray;
  }
}

function printTable(results) {
  if (results.length === 0) return;
  const emailW = Math.min(Math.max(5, ...results.map((r) => r.email.length)), 50);
  const header = `${'EMAIL'.padEnd(emailW)}  ${'RESULT'.padEnd(13)}  RECOMMENDATION`;
  log(C.bold(header));
  log(C.gray('-'.repeat(header.length)));
  for (const r of results) {
    const color = colorForResult(r.result);
    const email = r.email.length > emailW ? r.email.slice(0, emailW - 1) + '…' : r.email;
    log(`${email.padEnd(emailW)}  ${color((r.result || 'unknown').padEnd(13))}  ${r.recommendation || ''}`);
  }
}

function counts(results) {
  const c = { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
  for (const r of results) {
    const key = VALID_RESULTS.includes(r.result) ? r.result : 'unknown';
    c[key] += 1;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = getInput('api-key', { required: true });
  const apiUrl = (getInput('api-url') || API_URL_DEFAULT).replace(/\/+$/, '');
  const outputPath = getInput('output');

  // Parse fail-on into a set of result categories.
  const failOn = getInput('fail-on')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknownFailOn = failOn.filter((f) => !VALID_RESULTS.includes(f));
  if (unknownFailOn.length) {
    log(C.yellow(`Warning: ignoring unknown fail-on value(s): ${unknownFailOn.join(', ')}`));
  }
  const failOnSet = new Set(failOn.filter((f) => VALID_RESULTS.includes(f)));

  const emails = collectEmails();
  if (emails.length === 0) {
    throw new Error('No emails to verify. Provide the `emails` and/or `file` input.');
  }

  log(`Verifying ${C.bold(String(emails.length))} email(s) via ${apiUrl} ...`);
  log('');

  const allResults = [];
  const allSkipped = [];
  let creditsUsed = 0;
  let creditsRemaining = null;

  for (const group of chunk(emails, BATCH_LIMIT)) {
    const json = await verifyBatch(apiUrl, apiKey, group);
    if (Array.isArray(json.results)) allResults.push(...json.results);
    if (Array.isArray(json.skipped)) allSkipped.push(...json.skipped);
    if (json.credits) {
      creditsUsed += json.credits.used || 0;
      creditsRemaining = json.credits.remaining;
    }
  }

  printTable(allResults);
  log('');

  const c = counts(allResults);
  log(C.bold('Summary'));
  log(`  ${C.green('deliverable')}   : ${c.deliverable}`);
  log(`  ${C.red('undeliverable')} : ${c.undeliverable}`);
  log(`  ${C.yellow('risky')}         : ${c.risky}`);
  log(`  ${C.gray('unknown')}       : ${c.unknown}`);
  log(`  total         : ${allResults.length}`);
  if (allSkipped.length) log(`  skipped       : ${allSkipped.length}`);
  log(`  credits used  : ${creditsUsed}${creditsRemaining != null ? `  (remaining: ${creditsRemaining})` : ''}`);
  log('');

  const payload = {
    total: allResults.length,
    counts: c,
    credits: { used: creditsUsed, remaining: creditsRemaining },
    skipped: allSkipped,
    results: allResults,
  };
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    log(`Wrote results to ${outputPath}`);
  }

  // Determine offending addresses per fail-on.
  const offenders = failOnSet.size
    ? allResults.filter((r) => failOnSet.has(VALID_RESULTS.includes(r.result) ? r.result : 'unknown'))
    : [];

  // Set outputs.
  setOutput('total', String(allResults.length));
  setOutput('deliverable', String(c.deliverable));
  setOutput('undeliverable', String(c.undeliverable));
  setOutput('risky', String(c.risky));
  setOutput('unknown', String(c.unknown));
  setOutput('failed-count', String(offenders.length));
  setOutput('results-json', JSON.stringify(payload));

  // Markdown step summary.
  const rows = allResults
    .map((r) => `| ${r.email} | ${r.result} | ${r.recommendation || ''} | ${r.reason || ''} |`)
    .join('\n');
  summary(
    `## Verify Emails results\n\n` +
      `| Metric | Count |\n|---|---|\n` +
      `| deliverable | ${c.deliverable} |\n` +
      `| undeliverable | ${c.undeliverable} |\n` +
      `| risky | ${c.risky} |\n` +
      `| unknown | ${c.unknown} |\n` +
      `| **total** | **${allResults.length}** |\n\n` +
      (failOnSet.size ? `**fail-on:** \`${[...failOnSet].join(', ')}\` - matched **${offenders.length}**\n\n` : '') +
      `<details><summary>Per-address results</summary>\n\n` +
      `| Email | Result | Recommendation | Reason |\n|---|---|---|---|\n${rows}\n\n</details>\n\n` +
      `_Powered by [Verifly](https://verifly.email) - email verification API for AI agents._`
  );

  if (offenders.length > 0) {
    log(C.red(`FAILED: ${offenders.length} address(es) matched fail-on [${[...failOnSet].join(', ')}]:`));
    for (const o of offenders.slice(0, 50)) {
      log(C.red(`  - ${o.email} (${o.result})`));
    }
    process.exitCode = 1;
    return;
  }

  log(C.green('PASSED: no addresses matched the fail-on condition.'));
}

main().catch((err) => {
  log(`::error::${err.message}`);
  process.exitCode = 1;
});
