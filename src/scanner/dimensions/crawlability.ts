import * as cheerio from "cheerio";
import { DimensionResult, Check, AuxiliaryFetches, FetchedPage } from "../../types";

function robotsTxtBlocksCrawlers(robotsTxt: string): boolean {
  const lines = robotsTxt.toLowerCase().split("\n");
  let isGlobalAgent = false;
  let isGooglebotAgent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("user-agent:")) {
      const agent = trimmed.replace("user-agent:", "").trim();
      isGlobalAgent = agent === "*";
      isGooglebotAgent = agent === "googlebot" || agent === "bingbot";
    }
    if ((isGlobalAgent || isGooglebotAgent) && trimmed.startsWith("disallow:")) {
      const path = trimmed.replace("disallow:", "").trim();
      if (path === "/" || path === "") {
        // Disallow: / blocks everything; Disallow: (empty) allows everything
        if (path === "/") return true;
      }
    }
  }
  return false;
}

export function scoreCrawlability(
  $: cheerio.CheerioAPI,
  page: FetchedPage,
  aux: AuxiliaryFetches
): DimensionResult {
  const checks: Check[] = [];

  // --- Check 1: sitemap.xml accessible (6 pts) ---
  let sitemapPts = 0;
  let sitemapDetail = "sitemap.xml not found at /sitemap.xml - required for AI training crawlers to index all pages";
  if (aux.sitemapXml) {
    const isXml =
      aux.sitemapXml.trim().startsWith("<?xml") ||
      aux.sitemapXml.includes("<urlset") ||
      aux.sitemapXml.includes("<sitemapindex");
    if (isXml) {
      // Count URLs in sitemap
      const urlCount = (aux.sitemapXml.match(/<url>/g) || []).length;
      sitemapPts = 6;
      sitemapDetail = `sitemap.xml found${urlCount > 0 ? ` with ${urlCount} URLs` : " (no <url> count detected)"}`;
    } else {
      sitemapPts = 2;
      sitemapDetail = "sitemap.xml exists but may not be valid XML - verify format";
    }
  }
  checks.push({
    id: "sitemap",
    name: "sitemap.xml accessible",
    passed: sitemapPts === 6,
    partial: sitemapPts > 0 && sitemapPts < 6,
    points: sitemapPts,
    maxPoints: 6,
    detail: sitemapDetail,
  });

  // --- Check 2: robots.txt present and permissive (4 pts) ---
  let robotsPts = 0;
  let robotsDetail = "robots.txt not found - add one to control crawler behavior";
  if (aux.robotsTxt) {
    const blocks = robotsTxtBlocksCrawlers(aux.robotsTxt);
    if (!blocks) {
      robotsPts = 4;
      robotsDetail = "robots.txt present and not blocking major crawlers";
    } else {
      robotsPts = 0;
      robotsDetail = "robots.txt found but appears to block crawlers (Disallow: /) - this prevents AEO indexing";
    }
  }
  checks.push({
    id: "robots-txt",
    name: "robots.txt present and permissive",
    passed: robotsPts === 4,
    partial: robotsPts > 0 && robotsPts < 4,
    points: robotsPts,
    maxPoints: 4,
    detail: robotsDetail,
  });

  // --- Check 3: No noindex meta tag (4 pts) ---
  const metaRobots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const hasNoindex = metaRobots.includes("noindex") || metaRobots.includes("none");
  checks.push({
    id: "no-noindex",
    name: "Page is indexable (no noindex meta)",
    passed: !hasNoindex,
    points: !hasNoindex ? 4 : 0,
    maxPoints: 4,
    detail: !hasNoindex
      ? metaRobots
        ? `Meta robots: "${metaRobots}" - page is crawlable`
        : "No robots meta tag - page is crawlable by default"
      : `Meta robots contains "${metaRobots}" - this page is excluded from indexing`,
  });

  // --- Check 4: Canonical URL (3 pts) ---
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  checks.push({
    id: "canonical",
    name: "Canonical URL specified",
    passed: !!canonical,
    points: canonical ? 3 : 0,
    maxPoints: 3,
    detail: canonical
      ? `Canonical URL: ${canonical}`
      : "No canonical link tag - add <link rel='canonical'> to prevent duplicate content issues",
  });

  // --- Check 5: Meaningful page title (3 pts) ---
  const title = $("title").first().text().trim();
  const titleMeaningful = title.length > 10 && title.length < 120;
  checks.push({
    id: "page-title",
    name: "Meaningful page title (10-120 chars)",
    passed: titleMeaningful,
    partial: title.length > 0 && !titleMeaningful,
    points: titleMeaningful ? 3 : title.length > 0 ? 1 : 0,
    maxPoints: 3,
    detail: titleMeaningful
      ? `Title (${title.length} chars): "${title.slice(0, 70)}${title.length > 70 ? "..." : ""}"`
      : title.length === 0
      ? "No <title> tag found - required for AI model citation"
      : title.length <= 10
      ? `Title too short (${title.length} chars): "${title}"`
      : `Title very long (${title.length} chars) - trim to under 120 characters`,
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "crawlability",
    name: "Crawlability",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
