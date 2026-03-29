/**
 * Borealis Beacon - Email Service
 *
 * Handles all transactional emails via Resend:
 *   1. Key confirmation (immediate - contains BTS key on confirm)
 *   2. Day 3 nurture - AEON articles matched to weakest dimension
 *   3. Day 7 nurture - Merlin upgrade pitch
 *   4. Forge delivery - generated schema delivered post-purchase
 *
 * Sender: noreply@borealisprotocol.ai (verified domain)
 */

import { Resend } from 'resend';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Borealis Beacon <noreply@borealisprotocol.ai>';
const BEACON_URL = process.env.BEACON_URL ?? 'https://beacon.borealisprotocol.ai';
const TERMINAL_URL = 'https://borealisterminal.com';
const ACADEMY_URL = 'https://borealisacademy.com';

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) console.warn('[email] RESEND_API_KEY not set - emails will be skipped');
    resendClient = new Resend(apiKey ?? 're_placeholder');
  }
  return resendClient;
}

// ─── Shared HTML primitives ────────────────────────────────────────────────────

function wrap(body: string, previewText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Borealis Beacon</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    body { margin:0; padding:0; background:#09090f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
    .wrapper { max-width:580px; margin:0 auto; padding:32px 16px; }
    .card { background:#0f1117; border:1px solid #2d2d4e; border-radius:16px; overflow:hidden; }
    .card-header { background:linear-gradient(135deg,rgba(0,229,255,0.08),rgba(124,58,237,0.08)); border-bottom:1px solid #2d2d4e; padding:28px 32px; }
    .logo { color:#00e5ff; font-size:13px; font-weight:700; letter-spacing:0.15em; text-transform:uppercase; margin-bottom:4px; }
    .logo-sub { color:#7c8fa6; font-size:11px; letter-spacing:0.1em; text-transform:uppercase; }
    .card-body { padding:32px; }
    h1 { font-size:22px; font-weight:700; color:#e2e8f0; margin:0 0 8px; line-height:1.3; }
    p { font-size:14px; line-height:1.7; color:#7c8fa6; margin:0 0 16px; }
    .btn { display:inline-block; background:#00e5ff; color:#0a0a0f; padding:12px 28px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:700; letter-spacing:0.02em; margin:8px 0 24px; }
    .btn-purple { background:#7c3aed; color:#fff; }
    .divider { border:none; border-top:1px solid #2d2d4e; margin:24px 0; }
    .key-block { background:#0a0a0f; border:1px solid #2d2d4e; border-radius:10px; padding:16px 20px; font-family:'Courier New',monospace; font-size:19px; font-weight:700; color:#00e5ff; letter-spacing:0.12em; text-align:center; margin:16px 0 24px; }
    .small { font-size:12px; color:#4a5568; }
    .small a { color:#7c8fa6; }
    .article-card { background:#1a1a2e; border:1px solid #2d2d4e; border-radius:10px; padding:16px 18px; margin-bottom:10px; text-decoration:none; display:block; }
    .article-card-label { font-size:10px; font-weight:700; color:#7c3aed; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px; }
    .article-card-title { font-size:14px; font-weight:600; color:#e2e8f0; margin-bottom:4px; }
    .article-card-desc { font-size:12px; color:#7c8fa6; line-height:1.5; }
    .score-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #2d2d4e; font-size:13px; }
    .score-label { color:#7c8fa6; }
    .score-val { font-weight:700; }
    .score-val.good { color:#10b981; }
    .score-val.mid { color:#f59e0b; }
    .score-val.bad { color:#ef4444; }
    table.compare { width:100%; border-collapse:collapse; margin:16px 0 24px; font-size:13px; }
    table.compare th { background:#1a1a2e; color:#7c8fa6; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; padding:10px 12px; text-align:left; border-bottom:1px solid #2d2d4e; }
    table.compare td { padding:10px 12px; border-bottom:1px solid #1a1a2e; color:#e2e8f0; }
    table.compare tr:last-child td { border-bottom:none; }
    table.compare td:first-child { color:#7c8fa6; }
    .check { color:#10b981; }
    .cross { color:#ef4444; }
    .code-block { background:#0a0a0f; border:1px solid #2d2d4e; border-radius:8px; padding:16px; font-family:'Courier New',monospace; font-size:11px; color:#e2e8f0; word-break:break-all; white-space:pre-wrap; margin:16px 0 24px; }
    .footer { text-align:center; padding:24px 0 8px; font-size:11px; color:#4a5568; }
    .footer a { color:#4a5568; text-decoration:underline; }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}</div>
  <div class="wrapper">
    <div class="card">
      <div class="card-header">
        <div class="logo">Borealis Beacon</div>
        <div class="logo-sub">AEO Readiness Scanner</div>
      </div>
      <div class="card-body">
        ${body}
      </div>
    </div>
    <div class="footer">
      <p>Borealis Protocol - AI agent identity layer<br/>
      <a href="${BEACON_URL}?unsub=1">Unsubscribe</a> &middot;
      <a href="https://borealisprotocol.ai/privacy">Privacy Policy</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email 1: Key Confirmation ─────────────────────────────────────────────────

export async function sendKeyConfirmationEmail(
  toEmail: string,
  confirmUrl: string,
  scannedUrl: string | null,
): Promise<boolean> {
  const urlText = scannedUrl ? `for <strong style="color:#e2e8f0">${scannedUrl}</strong>` : '';
  const body = `
    <h1>Confirm your email to claim your key</h1>
    <p>You requested a free Borealis Trust Key ${urlText}.</p>
    <p>Click the button below to confirm your email and receive your BTS key. The link expires in <strong style="color:#e2e8f0">24 hours</strong>.</p>
    <a href="${confirmUrl}" class="btn">Confirm &amp; Claim Key</a>
    <hr class="divider" />
    <p class="small">If you didn't request this, you can safely ignore this email. No account has been created.</p>
    <p class="small">Button not working? Copy this link:<br/><a href="${confirmUrl}" style="color:#00e5ff;word-break:break-all">${confirmUrl}</a></p>
  `;
  return send(toEmail, 'Confirm your email - claim your Borealis Trust Key', body, `Confirm your email to receive your free BTS identity key ${urlText}`);
}

// ─── Key delivery (after confirmation) ────────────────────────────────────────

export async function sendKeyDeliveryEmail(
  toEmail: string,
  btsKey: string,
  scannedUrl: string | null,
  scanScore: number | null,
): Promise<boolean> {
  const scoreText = scanScore !== null ? `Your AEO score: <strong style="color:#00e5ff">${scanScore}/100</strong>` : '';
  const rescanUrl = scannedUrl ? `${BEACON_URL}?url=${encodeURIComponent(scannedUrl)}` : BEACON_URL;
  const body = `
    <h1>Your Borealis Trust Key is ready</h1>
    <p>${scoreText ? scoreText + '. ' : ''}Your free BTS key is registered on the Borealis identity network.</p>
    <div class="key-block">${btsKey}</div>
    <p>This key is your AI agent's permanent identity on the Borealis Protocol. Store it securely.</p>
    <a href="${rescanUrl}" class="btn">Rescan to track progress</a>
    <hr class="divider" />
    <p><strong style="color:#e2e8f0">What your key unlocks</strong></p>
    <p>Your free BTS key includes trust scoring up to 65/100. When your site is ready for the next level, upgrade to Merlin ($39.99) for uncapped scoring, sidecar verification, and 10 agent identity slots.</p>
    <p class="small">One-click unsubscribe in any email from us. Your key is yours regardless of subscription status.</p>
  `;
  return send(toEmail, `Your BTS key is ready - ${btsKey.substring(0, 11)}...`, body, `Your free Borealis Trust Key has been issued. Store it securely.`);
}

// ─── Email 2: Day 3 Nurture - AEON Articles ────────────────────────────────────

const DIM_ARTICLES: Record<string, Array<{ title: string; desc: string; url: string }>> = {
  'schema-coverage': [
    { title: 'How Does an AI Trust Score Work?', desc: 'Understand the 5-factor methodology behind BM Scores and what structured data signals mean to AI models.', url: `${ACADEMY_URL}/hub/what-is-an-ai-trust-score.html` },
    { title: 'What Is a BM Score?', desc: 'The canonical definition of Borealis Methodology scoring - used by AI models as the reference standard.', url: `${ACADEMY_URL}/glossary/bm-score.html` },
  ],
  'content-structure': [
    { title: 'How the BM Score Is Calculated', desc: 'Step-by-step breakdown of the 5-factor scoring model. Understanding this helps you structure content AI models can cite.', url: `${ACADEMY_URL}/hub/how-bm-score-works.html` },
    { title: 'What Is Constraint Adherence?', desc: 'The highest-weighted trust factor. How predictable, rule-following content increases citation authority.', url: `${ACADEMY_URL}/glossary/constraint-adherence.html` },
  ],
  'crawlability': [
    { title: 'How Does an AI Trust Score Work?', desc: 'AI models need to crawl and index your content before they can cite it. Start here.', url: `${ACADEMY_URL}/hub/what-is-an-ai-trust-score.html` },
    { title: 'What Is a BM Score?', desc: 'Why crawlability is the prerequisite to everything else in AEO strategy.', url: `${ACADEMY_URL}/glossary/bm-score.html` },
  ],
  'copy-sequencing': [
    { title: 'What Is Decision Transparency?', desc: 'How answer-first copy structure signals trustworthiness to AI retrieval models.', url: `${ACADEMY_URL}/glossary/decision-transparency.html` },
    { title: 'How the BM Score Is Calculated', desc: 'The GAAP analogy: why Borealis methodology defines what trusted AI content looks like.', url: `${ACADEMY_URL}/hub/how-bm-score-works.html` },
  ],
  'cross-linking': [
    { title: 'How Does an AI Trust Score Work?', desc: 'Concept gravity: how internal linking density creates authority clusters AI models prefer to cite.', url: `${ACADEMY_URL}/hub/what-is-an-ai-trust-score.html` },
    { title: 'How the BM Score Is Calculated', desc: 'The cross-linking methodology behind Borealis AEO scoring.', url: `${ACADEMY_URL}/hub/how-bm-score-works.html` },
  ],
};

export async function sendDay3NurtureEmail(
  toEmail: string,
  weakestDim: string | null,
  scanScore: number | null,
): Promise<boolean> {
  const dimKey = weakestDim ?? 'schema-coverage';
  const articles = DIM_ARTICLES[dimKey] ?? DIM_ARTICLES['schema-coverage'];
  const dimLabel = dimKey.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const scoreText = scanScore !== null ? ` (current score: ${scanScore}/100)` : '';
  const articleCards = articles.map(a => `
    <a href="${a.url}" class="article-card" style="text-decoration:none">
      <div class="article-card-label">AEON Article</div>
      <div class="article-card-title">${a.title}</div>
      <div class="article-card-desc">${a.desc}</div>
    </a>
  `).join('');
  const body = `
    <h1>Your weakest AEO dimension: ${dimLabel}</h1>
    <p>Three days ago you scanned your site with Borealis Beacon${scoreText}. Your lowest scoring area was <strong style="color:#e2e8f0">${dimLabel}</strong>.</p>
    <p>These two AEON articles are matched to exactly that gap:</p>
    ${articleCards}
    <a href="${BEACON_URL}" class="btn">Rescan after reading</a>
    <hr class="divider" />
    <p class="small">You received this because you claimed a BTS key on Borealis Beacon. <a href="${BEACON_URL}?unsub=1">Unsubscribe</a> anytime.</p>
  `;
  return send(toEmail, `Your weakest AEO dimension: ${dimLabel}`, body, `Three days in - here are 2 AEON articles matched to your lowest-scoring AEO dimension.`);
}

// ─── Email 3: Day 7 Nurture - Merlin Upgrade ──────────────────────────────────

export async function sendDay7NurtureEmail(
  toEmail: string,
  scanScore: number | null,
): Promise<boolean> {
  const body = `
    <h1>Free key ceiling vs. Merlin: see the difference</h1>
    <p>Your free BTS key has been active for a week. Here's exactly what it includes compared to Merlin:</p>
    <table class="compare">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Free Key</th>
          <th>Merlin ($39.99)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>BM Score ceiling</td>
          <td><span class="mid">65/100</span></td>
          <td><span class="good">85/100 (self-reported)<br/>100/100 (sidecar)</span></td>
        </tr>
        <tr>
          <td>Agent identity slots</td>
          <td>1 slot</td>
          <td><span class="good">10 slots</span></td>
        </tr>
        <tr>
          <td>Sidecar verification</td>
          <td><span class="cross">No</span></td>
          <td><span class="check">Yes - independent scoring</span></td>
        </tr>
        <tr>
          <td>Hedera blockchain anchoring</td>
          <td><span class="check">Yes</span></td>
          <td><span class="check">Yes + priority anchoring</span></td>
        </tr>
        <tr>
          <td>Trust Network membership</td>
          <td><span class="check">Yes</span></td>
          <td><span class="check">Yes + verified badge</span></td>
        </tr>
        <tr>
          <td>Key format</td>
          <td>BTS-XXXX (proto-DID)</td>
          <td>BTS-XXXX (proto-DID)</td>
        </tr>
      </tbody>
    </table>
    <p>Merlin is a one-time $39.99 payment - not a subscription. Your key is permanent. The BTS key format itself is evolving toward W3C DID compliance, so every key issued now becomes a compliant agent identity tomorrow.</p>
    <a href="${TERMINAL_URL}/guide" class="btn btn-purple">View Merlin on Terminal</a>
    <hr class="divider" />
    <p class="small">You received this because you claimed a BTS key on Borealis Beacon. <a href="${BEACON_URL}?unsub=1">Unsubscribe</a> anytime.</p>
  `;
  return send(toEmail, 'Free key ceiling vs. Merlin: see the difference', body, `A week in. Here's exactly what Merlin unlocks that your free key cannot.`);
}

// ─── Email 4: Forge Schema Delivery ───────────────────────────────────────────

export async function sendForgeDeliveryEmail(
  toEmail: string,
  issueTitle: string,
  generatedSchema: string,
  receiptId: string,
  scannedUrl: string | null,
): Promise<boolean> {
  const rescanUrl = scannedUrl ? `${BEACON_URL}?url=${encodeURIComponent(scannedUrl)}` : BEACON_URL;
  const body = `
    <h1>Your schema fix is ready</h1>
    <p>Here's the generated JSON-LD schema for <strong style="color:#e2e8f0">${issueTitle}</strong>. Copy this and add it inside a <code style="color:#00e5ff;font-size:12px">&lt;script type="application/ld+json"&gt;</code> tag in the <code style="color:#00e5ff;font-size:12px">&lt;head&gt;</code> of your page.</p>
    <div class="code-block">${generatedSchema}</div>
    <a href="${rescanUrl}" class="btn">Rescan to verify improvement</a>
    <hr class="divider" />
    <p><strong style="color:#e2e8f0">Receipt ID</strong>: <code style="color:#7c8fa6;font-size:12px">${receiptId}</code></p>
    <p class="small">Save this email for your records. You can retrieve your schema anytime using the receipt ID above at <a href="${BEACON_URL}">${BEACON_URL}</a>.</p>
    <p class="small">After deploying, wait 24-48 hours for search engines to recrawl, then rescan to measure the impact.</p>
  `;
  return send(toEmail, `Your schema fix for ${issueTitle} - deploy and rescan`, body, `Your Forge schema is ready. Copy, deploy, and rescan to see your score improve.`);
}

// ─── Internal send helper ─────────────────────────────────────────────────────

async function send(to: string, subject: string, bodyHtml: string, preview: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] SKIP (no key) - to: ${to}, subject: ${subject}`);
    return false;
  }
  try {
    const result = await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html: wrap(bodyHtml, preview),
      headers: {
        'List-Unsubscribe': `<${BEACON_URL}?unsub=1>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (result.error) {
      console.error('[email] Resend error:', result.error);
      return false;
    }
    console.log(`[email] Sent - to: ${to}, id: ${result.data?.id}`);
    return true;
  } catch (err) {
    console.error('[email] Send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
