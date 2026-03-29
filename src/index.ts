import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";
import { validateUrl } from "./utils/ssrf-protection";
import { runScan } from "./scanner";
import { ScanResult } from "./types";
import {
  getDb,
  countIpClaims,
  logIpClaim,
  findKeyByEmail,
  findKeyByToken,
  insertBeaconKey,
  activateBeaconKey,
  insertForgePurchase,
  completeForgePurchase,
  getForgePurchase,
  enrollInNurture,
  getNurturePendingDay3,
  getNurturePendingDay7,
  markNurtureDay3Sent,
  markNurtureDay7Sent,
} from "./db/database";
import {
  generateBTSKey,
  generateConfirmToken,
  generateReceiptId,
} from "./services/key-generator";
import {
  sendKeyConfirmationEmail,
  sendKeyDeliveryEmail,
  sendDay3NurtureEmail,
  sendDay7NurtureEmail,
  sendForgeDeliveryEmail,
} from "./services/email";
import { generateForgeSchema } from "./services/forge-generator";

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);
const BEACON_URL = process.env.BEACON_URL ?? "https://beacon.borealisprotocol.ai";
const IP_CLAIM_MAX = parseInt(process.env.IP_CLAIM_MAX || "3", 10);
const IP_CLAIM_WINDOW_MS = parseInt(process.env.IP_CLAIM_WINDOW_MS || "86400000", 10); // 24h

// ─── Stripe setup ─────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// ─── In-memory scan store (primary, SQLite for persistence not required for scans) ──

const scanStore = new Map<string, ScanResult>();
const SCAN_TTL_MS = parseInt(process.env.SCAN_TTL_MS || "604800000", 10);

setInterval(() => {
  const now = Date.now();
  for (const [id, scan] of scanStore) {
    if (now - new Date(scan.scannedAt).getTime() > SCAN_TTL_MS) {
      scanStore.delete(id);
    }
  }
}, 3600000);

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,https://beacon.borealisprotocol.ai,https://borealisprotocol.ai,https://borealisterminal.com"
).split(",").map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(new Error("CORS: origin not allowed"));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
  })
);

// Stripe webhook needs raw body - mount BEFORE express.json()
app.post(
  "/v1/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json({ limit: "10kb" }));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  const dbOk = (() => { try { getDb(); return true; } catch { return false; } })();
  res.json({
    status: "ok",
    version: "0.2.0",
    service: "borealis-beacon-api",
    scansInMemory: scanStore.size,
    db: dbOk ? "ok" : "error",
    uptime: Math.round(process.uptime()),
    stripe: !!process.env.STRIPE_SECRET_KEY,
    email: !!process.env.RESEND_API_KEY,
  });
});

// ─── POST /v1/scan ────────────────────────────────────────────────────────────

const scanLimiter = rateLimit({
  windowMs: parseInt(process.env.SCAN_RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: parseInt(process.env.SCAN_RATE_LIMIT_MAX || "10", 10),
  message: { error: "Too many scan requests. Please wait 15 minutes.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/v1/scan", scanLimiter, async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required", code: "MISSING_URL" });
    return;
  }
  const trimmedUrl = url.trim();
  if (trimmedUrl.length > 2048) {
    res.status(400).json({ error: "URL too long", code: "URL_TOO_LONG" });
    return;
  }
  const validation = await validateUrl(trimmedUrl);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error, code: "INVALID_URL" });
    return;
  }
  try {
    const result = await runScan(validation.normalizedUrl!);
    scanStore.set(result.id, result);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Scan failed for ${trimmedUrl}:`, message);
    if (message.includes("fetch") || message.includes("network") || message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
      res.status(422).json({ error: "Could not fetch the URL. Make sure it is publicly accessible.", code: "FETCH_FAILED" });
    } else if (message.includes("abort") || message.includes("timeout")) {
      res.status(422).json({ error: "The URL took too long to respond.", code: "FETCH_TIMEOUT" });
    } else {
      res.status(500).json({ error: "Scan failed. Please try again.", code: "SCAN_ERROR" });
    }
  }
});

// ─── GET /v1/scan/:id ─────────────────────────────────────────────────────────

app.get("/v1/scan/:id", (req: Request, res: Response) => {
  const scan = scanStore.get(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found or expired", code: "NOT_FOUND" });
    return;
  }
  res.json({ success: true, data: scan });
});

// ─── GET /v1/badge/:id ────────────────────────────────────────────────────────

app.get("/v1/badge/:id", (req: Request, res: Response) => {
  const scan = scanStore.get(req.params.id);
  const score = scan ? scan.overallScore : null;
  const grade = scan ? scan.grade : "Not Found";
  const color = scan ? scan.gradeColor : "#6b7280";
  const scoreText = score !== null ? `${score}/100` : "N/A";
  const tier = score !== null && score >= 85 ? "AUTHORITY" : score !== null && score >= 70 ? "BASELINE" : score !== null && score >= 50 ? "GAPS" : "PRE-AEO";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0a0a0f"/><stop offset="100%" stop-color="#1a1a2e"/></linearGradient></defs>
  <rect width="220" height="40" rx="6" fill="url(#bg)" stroke="#2d2d4e" stroke-width="1"/>
  <text x="10" y="14" font-family="system-ui,sans-serif" font-size="9" fill="#7c8fa6" font-weight="500">BOREALIS BEACON</text>
  <text x="10" y="30" font-family="system-ui,sans-serif" font-size="11" fill="#e2e8f0">AEO Score</text>
  <text x="110" y="30" font-family="system-ui,sans-serif" font-size="18" fill="${color}" font-weight="700">${scoreText}</text>
  <text x="165" y="30" font-family="system-ui,sans-serif" font-size="8" fill="${color}">${tier}</text>
</svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(svg);
});

// ─── POST /v1/claim-key ───────────────────────────────────────────────────────
// Claim a free BTS identity key. Email confirmation required.

const claimLimiter = rateLimit({
  windowMs: 3600000, // 1h
  max: 10,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "Too many key claim attempts. Try again in an hour.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/v1/claim-key", claimLimiter, async (req: Request, res: Response) => {
  const { email, scanId } = req.body as { email?: string; scanId?: string };

  if (!email || typeof email !== "string") {
    res.status(400).json({ success: false, error: "Email is required." });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ success: false, error: "Invalid email address." });
    return;
  }
  if (cleanEmail.length > 320) {
    res.status(400).json({ success: false, error: "Email too long." });
    return;
  }

  // Check IP rate limit (3 keys per IP per 24h)
  const ip = req.ip ?? "unknown";
  const ipCount = countIpClaims(ip, IP_CLAIM_WINDOW_MS);
  if (ipCount >= IP_CLAIM_MAX) {
    res.status(429).json({ success: false, error: "Key claim limit reached for your IP today. Try again tomorrow.", code: "IP_LIMIT" });
    return;
  }

  // Check email uniqueness (1 key per email)
  const existing = findKeyByEmail(cleanEmail);
  if (existing) {
    if (existing.status === "pending") {
      res.status(200).json({
        success: true,
        message: "A confirmation email was already sent. Check your inbox (and spam folder).",
        alreadySent: true,
      });
    } else {
      res.status(409).json({
        success: false,
        error: "A BTS key has already been issued to this email address.",
        code: "ALREADY_CLAIMED",
      });
    }
    return;
  }

  // Retrieve scan context if scanId provided
  const scan = scanId ? scanStore.get(scanId) : null;
  const scannedUrl = scan?.url ?? null;
  const scanScore = scan?.overallScore ?? null;

  // Generate key and confirmation token
  const { rawKey, keyHash } = generateBTSKey();
  const confirmToken = generateConfirmToken();
  const keyId = uuidv4();

  try {
    insertBeaconKey({
      id: keyId,
      email: cleanEmail,
      bts_key: rawKey,
      key_hash: keyHash,
      scan_id: scanId ?? null,
      scanned_url: scannedUrl,
      status: "pending",
      confirm_token: confirmToken,
      ip,
      created_at: Date.now(),
    });
    logIpClaim(ip);
  } catch (err) {
    console.error("[claim-key] DB insert failed:", err);
    res.status(500).json({ success: false, error: "Could not process your request. Please try again." });
    return;
  }

  const confirmUrl = `${BEACON_URL}?confirm=${confirmToken}`;

  const emailSent = await sendKeyConfirmationEmail(cleanEmail, confirmUrl, scannedUrl);

  res.json({
    success: true,
    message: emailSent
      ? "Confirmation email sent. Check your inbox to activate your key."
      : "Key registered. Email delivery may be delayed - contact support if needed.",
    emailSent,
  });
});

// ─── GET /v1/claim-key/confirm/:token ─────────────────────────────────────────
// Activates the key and sends the BTS key delivery email.

app.get("/v1/claim-key/confirm/:token", async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length !== 64) {
    res.status(400).json({ success: false, error: "Invalid confirmation token." });
    return;
  }

  const keyRecord = activateBeaconKey(token);
  if (!keyRecord) {
    res.status(404).json({ success: false, error: "Token not found or already used.", code: "TOKEN_INVALID" });
    return;
  }

  // Retrieve scan context
  const scan = keyRecord.scan_id ? scanStore.get(keyRecord.scan_id) : null;
  const scanScore = scan?.overallScore ?? null;
  const weakestDim = scan ? getWeakestDimension(scan) : null;

  // Enroll in nurture sequence
  try {
    enrollInNurture(uuidv4(), keyRecord.email, keyRecord.scan_id, keyRecord.id, scanScore, weakestDim);
  } catch (err) {
    console.warn("[nurture] Enroll failed:", err);
  }

  // Send key delivery email
  await sendKeyDeliveryEmail(keyRecord.email, keyRecord.bts_key, keyRecord.scanned_url, scanScore);

  res.json({
    success: true,
    message: "Email confirmed. Your BTS key has been delivered.",
    btsKey: keyRecord.bts_key,
    keyPrefix: keyRecord.bts_key.substring(0, 11),
    scanUrl: keyRecord.scanned_url,
  });
});

// ─── POST /v1/forge/checkout ──────────────────────────────────────────────────
// Create a Stripe checkout session for a $19 schema fix.

const forgeLimiter = rateLimit({
  windowMs: 900000, // 15 min
  max: 20,
  message: { error: "Too many checkout attempts. Please wait.", code: "RATE_LIMITED" },
});

app.post("/v1/forge/checkout", forgeLimiter, async (req: Request, res: Response) => {
  const { scanId, issueIndex, email } = req.body as {
    scanId?: string;
    issueIndex?: number;
    email?: string;
  };

  if (!scanId || typeof issueIndex !== "number") {
    res.status(400).json({ success: false, error: "scanId and issueIndex are required." });
    return;
  }

  const scan = scanStore.get(scanId);
  if (!scan) {
    res.status(404).json({ success: false, error: "Scan not found or expired. Please rescan first.", code: "SCAN_NOT_FOUND" });
    return;
  }

  const issue = scan.topIssues[issueIndex];
  if (!issue) {
    res.status(400).json({ success: false, error: "Issue not found in scan results." });
    return;
  }

  const receiptId = generateReceiptId();
  const cleanEmail = email?.trim().toLowerCase() ?? null;

  try {
    insertForgePurchase({
      receipt_id: receiptId,
      scan_id: scanId,
      issue_index: issueIndex,
      issue_title: issue.title,
      issue_dimension: issue.dimension,
      email: cleanEmail,
      stripe_session_id: null, // filled after Stripe session created
      scanned_url: scan.url,
      page_title: scan.meta.title,
      page_description: scan.meta.description,
      status: "pending",
      created_at: Date.now(),
    });
  } catch (err) {
    console.error("[forge/checkout] DB insert failed:", err);
    res.status(500).json({ success: false, error: "Could not create purchase record." });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ success: false, error: "Payment system not configured.", code: "STRIPE_NOT_CONFIGURED" });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 1900,
            product_data: {
              name: `AEO Schema Fix: ${issue.title}`,
              description: `Generated JSON-LD schema fix for ${scan.url} - delivered instantly to your email`,
              images: [],
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        receipt_id: receiptId,
        scan_id: scanId,
        issue_index: String(issueIndex),
        scanned_url: scan.url.substring(0, 200),
      },
      customer_email: cleanEmail ?? undefined,
      success_url: `${BEACON_URL}?forge_success=${receiptId}&scan=${scanId}`,
      cancel_url: `${BEACON_URL}?scan=${scanId}`,
    });

    // Update with Stripe session ID
    getDb().prepare(
      "UPDATE forge_purchases SET stripe_session_id = ? WHERE receipt_id = ?"
    ).run(session.id, receiptId);

    res.json({ success: true, checkoutUrl: session.url, receiptId });
  } catch (err) {
    console.error("[forge/checkout] Stripe error:", err);
    res.status(500).json({ success: false, error: "Could not create checkout session. Please try again.", code: "STRIPE_ERROR" });
  }
});

// ─── GET /v1/forge/purchase/:receiptId ────────────────────────────────────────
// Poll for schema delivery status and retrieve generated schema.

app.get("/v1/forge/purchase/:receiptId", (req: Request, res: Response) => {
  const { receiptId } = req.params;
  const purchase = getForgePurchase(receiptId);
  if (!purchase) {
    res.status(404).json({ success: false, error: "Purchase not found.", code: "NOT_FOUND" });
    return;
  }
  res.json({
    success: true,
    status: purchase.status,
    schema: purchase.generated_schema ?? null,
    issueTitle: purchase.issue_title,
    scannedUrl: purchase.scanned_url,
    completedAt: purchase.completed_at,
  });
});

// ─── POST /v1/stripe/webhook ──────────────────────────────────────────────────
// Handle Stripe payment completion - generate schema and email to customer.

async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_FORGE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("[webhook] STRIPE_FORGE_WEBHOOK_SECRET not set - skipping signature verification");
    res.json({ received: true });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  if (event.type !== "checkout.session.completed") {
    res.json({ received: true });
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const receiptId = session.metadata?.receipt_id;

  if (!receiptId) {
    console.warn("[webhook] No receipt_id in session metadata");
    res.json({ received: true });
    return;
  }

  const purchase = getForgePurchase(receiptId);
  if (!purchase) {
    console.warn(`[webhook] Purchase not found: ${receiptId}`);
    res.json({ received: true });
    return;
  }

  if (purchase.status === "completed") {
    // Idempotent - already processed
    res.json({ received: true });
    return;
  }

  // Generate the schema
  const forgeOutput = generateForgeSchema({
    scannedUrl: purchase.scanned_url ?? "",
    pageTitle: purchase.page_title,
    pageDescription: purchase.page_description,
    issueTitle: purchase.issue_title ?? "Missing schema",
    issueDimension: purchase.issue_dimension ?? "schema-coverage",
  });

  const completedPurchase = completeForgePurchase(session.id, forgeOutput.json);

  // Email the customer
  const customerEmail = session.customer_email ?? purchase.email;
  if (customerEmail) {
    await sendForgeDeliveryEmail(
      customerEmail,
      purchase.issue_title ?? "AEO Schema Fix",
      forgeOutput.json,
      receiptId,
      purchase.scanned_url,
    );
  }

  console.log(`[webhook] Forge schema delivered: ${receiptId}`);
  res.json({ received: true });
}

// ─── Email nurture scheduler ───────────────────────────────────────────────────
// Runs every hour to dispatch Day 3 and Day 7 emails.

function startNurtureScheduler(): void {
  setInterval(async () => {
    try {
      // Day 3
      const day3 = getNurturePendingDay3();
      for (const row of day3) {
        await sendDay3NurtureEmail(row.email, row.weakest_dim, row.scan_score);
        markNurtureDay3Sent(row.id);
      }
      if (day3.length > 0) console.log(`[nurture] Day 3 sent: ${day3.length} emails`);

      // Day 7
      const day7 = getNurturePendingDay7();
      for (const row of day7) {
        await sendDay7NurtureEmail(row.email, row.scan_score);
        markNurtureDay7Sent(row.id);
      }
      if (day7.length > 0) console.log(`[nurture] Day 7 sent: ${day7.length} emails`);
    } catch (err) {
      console.error("[nurture] Scheduler error:", err);
    }
  }, 3600000); // every hour
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeakestDimension(scan: ScanResult): string | null {
  const dims = Object.entries(scan.dimensions);
  if (!dims.length) return null;
  let weakest = dims[0];
  for (const d of dims) {
    if (d[1].percentage < weakest[1].percentage) weakest = d;
  }
  return weakest[0].replace(/([A-Z])/g, '-$1').toLowerCase(); // camelCase → kebab-case
}

// ─── 404 / Error handlers ─────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`Borealis Beacon API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  startNurtureScheduler();
});

export default app;
