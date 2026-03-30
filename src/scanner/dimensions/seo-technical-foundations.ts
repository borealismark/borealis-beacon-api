import * as cheerio from "cheerio";
import { DimensionResult, Check, FetchedPage, AuxiliaryFetches } from "../../types";

/**
 * SEO Technical Foundations (15 pts max)
 * Core technical signals that search engines evaluate before
 * even looking at content. Get these wrong and nothing else matters.
 *
 * Checks:
 *  1. https-secure (3 pts) - HTTPS is a confirmed ranking signal
 *  2. robots-health (3 pts) - robots.txt exists and doesn't block crawling
 *  3. sitemap-present (3 pts) - XML sitemap for crawl discovery
 *  4. viewport-mobile (3 pts) - Mobile viewport for mobile-first indexing
 *  5. no-noindex (3 pts) - Page is not blocking indexing
 */
export function scoreSeoTechnicalFoundations(
  $: cheerio.CheerioAPI,
  page: FetchedPage,
  aux: AuxiliaryFetches
): DimensionResult {
  const checks: Check[] = [];

  // 1. HTTPS (3 pts)
  let isHttps = false;
  try {
    isHttps = new URL(page.finalUrl).protocol === "https:";
  } catch {
    // fallback
  }

  checks.push({
    id: "seo-https",
    name: "HTTPS Security",
    passed: isHttps,
    points: isHttps ? 3 : 0,
    maxPoints: 3,
    detail: isHttps
      ? "Site uses HTTPS - confirmed Google ranking signal and required for user trust"
      : "Site is not using HTTPS - Google explicitly ranks HTTPS sites higher and Chrome flags HTTP sites as 'Not Secure'",
  });

  // 2. Robots.txt health (3 pts)
  const robotsTxt = aux.robotsTxt || "";
  const hasRobots = robotsTxt.length > 0;
  const blocksAll = robotsTxt.includes("Disallow: /\n") || robotsTxt.includes("Disallow: / \n");
  const robotsHealthy = hasRobots && !blocksAll;

  checks.push({
    id: "seo-robots-health",
    name: "Robots.txt Health",
    passed: robotsHealthy,
    partial: hasRobots && blocksAll,
    points: robotsHealthy ? 3 : hasRobots && blocksAll ? 0 : 1,
    maxPoints: 3,
    detail: robotsHealthy
      ? "robots.txt is present and allows crawling - search engines can discover your pages"
      : hasRobots && blocksAll
        ? "robots.txt contains 'Disallow: /' which blocks all search engine crawlers from your entire site"
        : "No robots.txt found - while not critical, having one gives you control over crawler behavior and signals professionalism",
  });

  // 3. Sitemap (3 pts)
  const sitemapXml = aux.sitemapXml || "";
  const hasSitemap = sitemapXml.length > 0;
  const validSitemap =
    hasSitemap &&
    (sitemapXml.includes("<?xml") ||
      sitemapXml.includes("<urlset") ||
      sitemapXml.includes("<sitemapindex"));

  // Count URLs in sitemap
  const urlMatches = sitemapXml.match(/<url>/g);
  const urlCount = urlMatches ? urlMatches.length : 0;

  checks.push({
    id: "seo-sitemap",
    name: "XML Sitemap",
    passed: validSitemap,
    partial: hasSitemap && !validSitemap,
    points: validSitemap ? 3 : hasSitemap ? 1 : 0,
    maxPoints: 3,
    detail: validSitemap
      ? `Valid XML sitemap found with ${urlCount > 0 ? urlCount + " URLs" : "content"} - helps search engines discover and index all your pages`
      : hasSitemap
        ? "sitemap.xml exists but doesn't appear to be valid XML - ensure it uses proper <urlset> format"
        : "No sitemap.xml found - sitemaps help search engines discover pages that might be missed during normal crawling",
  });

  // 4. Mobile viewport (3 pts)
  const viewport = $('meta[name="viewport"]').attr("content") || "";
  const hasViewport = viewport.length > 0;
  const goodViewport = hasViewport && viewport.includes("width=device-width");

  checks.push({
    id: "seo-viewport-mobile",
    name: "Mobile Viewport",
    passed: goodViewport,
    partial: hasViewport && !goodViewport,
    points: goodViewport ? 3 : hasViewport ? 1 : 0,
    maxPoints: 3,
    detail: goodViewport
      ? "Mobile viewport is properly configured - essential for Google's mobile-first indexing"
      : hasViewport
        ? "Viewport meta tag exists but may not be optimally configured - ensure 'width=device-width' is set"
        : "No viewport meta tag found - Google uses mobile-first indexing, so without this your page may rank poorly on all devices",
  });

  // 5. No noindex (3 pts)
  const robotsMeta = $('meta[name="robots"]').attr("content") || "";
  const hasNoindex =
    robotsMeta.toLowerCase().includes("noindex") ||
    robotsMeta.toLowerCase().includes("none");
  const isIndexable = !hasNoindex;

  checks.push({
    id: "seo-no-noindex",
    name: "Index Status",
    passed: isIndexable,
    points: isIndexable ? 3 : 0,
    maxPoints: 3,
    detail: isIndexable
      ? "Page is indexable - no noindex directive found in robots meta tag"
      : "Page has a 'noindex' meta robots tag - search engines will NOT index this page. Remove it unless you intentionally want this page hidden",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-technical-foundations",
    name: "Technical Foundations",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
