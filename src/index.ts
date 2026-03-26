import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { validateUrl } from "./utils/ssrf-protection";
import { runScan } from "./scanner";
import { ScanResult } from "./types";

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);

// In-memory scan store (MVP - replace with SQLite in v2)
const scanStore = new Map<string, ScanResult>();
const SCAN_TTL_MS = parseInt(process.env.SCAN_TTL_MS || "604800000", 10); // 7 days

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, scan] of scanStore) {
    const age = now - new Date(scan.scannedAt).getTime();
    if (age > SCAN_TTL_MS) {
      scanStore.delete(id);
    }
  }
}, 3600000); // run every hour

// CORS
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,https://borealisterminal.com,https://borealisprotocol.ai"
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
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10kb" }));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    service: "borealis-beacon-api",
    scansInMemory: scanStore.size,
    uptime: Math.round(process.uptime()),
  });
});

// Rate limiter for scan endpoint
const scanLimiter = rateLimit({
  windowMs: parseInt(process.env.SCAN_RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 min
  max: parseInt(process.env.SCAN_RATE_LIMIT_MAX || "10", 10),
  message: {
    error: "Too many scan requests. Free tier allows 10 scans per 15 minutes.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /v1/scan - Run a new AEO scan
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

  // SSRF protection
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
      res.status(422).json({
        error: "Could not fetch the URL. Make sure it is publicly accessible.",
        code: "FETCH_FAILED",
      });
    } else if (message.includes("abort") || message.includes("timeout")) {
      res.status(422).json({
        error: "The URL took too long to respond. Try again or check the site.",
        code: "FETCH_TIMEOUT",
      });
    } else {
      res.status(500).json({
        error: "Scan failed. Please try again.",
        code: "SCAN_ERROR",
      });
    }
  }
});

// GET /v1/scan/:id - Retrieve a previous scan
app.get("/v1/scan/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const scan = scanStore.get(id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found or expired", code: "NOT_FOUND" });
    return;
  }
  res.json({ success: true, data: scan });
});

// GET /v1/badge/:id - SVG badge for embedding
app.get("/v1/badge/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const scan = scanStore.get(id);

  const score = scan ? scan.overallScore : null;
  const grade = scan ? scan.grade : "Not Found";
  const color = scan ? scan.gradeColor : "#6b7280";
  const scoreText = score !== null ? `${score}/100` : "N/A";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
  </defs>
  <rect width="220" height="40" rx="6" fill="url(#bg)" stroke="#2d2d4e" stroke-width="1"/>
  <text x="10" y="14" font-family="system-ui,sans-serif" font-size="9" fill="#7c8fa6" font-weight="500">BOREALIS BEACON</text>
  <text x="10" y="30" font-family="system-ui,sans-serif" font-size="11" fill="#e2e8f0">AEO Score</text>
  <text x="110" y="30" font-family="system-ui,sans-serif" font-size="18" fill="${color}" font-weight="700">${scoreText}</text>
  <text x="165" y="30" font-family="system-ui,sans-serif" font-size="8" fill="${color}">${score !== null && score >= 85 ? "AUTHORITY" : score !== null && score >= 70 ? "BASELINE" : score !== null && score >= 50 ? "GAPS" : "PRE-AEO"}</text>
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(svg);
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

app.listen(PORT, () => {
  console.log(`Borealis Beacon API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
