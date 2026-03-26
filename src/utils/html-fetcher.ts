import { FetchedPage, AuxiliaryFetches } from "../types";

const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "10000", 10);

const USER_AGENT =
  "Mozilla/5.0 (compatible; BorealisBeacon/0.1; +https://borealisprotocol.ai/beacon) AppleWebKit/537.36";

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const start = Date.now();
  const response = await fetchWithTimeout(url);

  if (!response.ok && response.status !== 200) {
    // Still try to parse the body for 4xx/5xx in case there's useful content
  }

  const html = await response.text();
  const fetchTimeMs = Date.now() - start;

  return {
    html,
    url,
    finalUrl: response.url,
    statusCode: response.status,
    fetchTimeMs,
    contentLength: html.length,
  };
}

export async function fetchAuxiliary(baseUrl: string): Promise<AuxiliaryFetches> {
  const origin = new URL(baseUrl).origin;

  const [sitemapResult, robotsResult] = await Promise.allSettled([
    fetchWithTimeout(`${origin}/sitemap.xml`, 5000),
    fetchWithTimeout(`${origin}/robots.txt`, 5000),
  ]);

  let sitemapXml: string | null = null;
  let robotsTxt: string | null = null;

  if (sitemapResult.status === "fulfilled" && sitemapResult.value.ok) {
    const ct = sitemapResult.value.headers.get("content-type") || "";
    if (ct.includes("xml") || ct.includes("text") || ct.includes("application")) {
      sitemapXml = await sitemapResult.value.text();
    }
  }

  if (robotsResult.status === "fulfilled" && robotsResult.value.ok) {
    robotsTxt = await robotsResult.value.text();
  }

  return { sitemapXml, robotsTxt };
}
