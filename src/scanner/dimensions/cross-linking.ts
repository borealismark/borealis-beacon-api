import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

const WEAK_ANCHOR_PATTERNS = /^(click here|read more|learn more|here|this|more|link|page|article|post|see more|view more|find out)$/i;

function extractInternalLinks($: cheerio.CheerioAPI, baseOrigin: string): string[] {
  const links: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $( el).attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }
    try {
      const absolute = href.startsWith("http") ? href : new URL(href, baseOrigin).href;
      const parsed = new URL(absolute);
      if (parsed.origin === baseOrigin) {
        links.push(parsed.href);
      }
    } catch {
      // relative path that failed to parse - skip
    }
  });
  return links;
}

function extractAnchorTexts($: cheerio.CheerioAPI, baseOrigin: string): string[] {
  const anchors: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $( el).attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      const isInternal = href.startsWith("/") || (href.startsWith("http") && new URL(href).origin === baseOrigin);
      if (isInternal) {
        const text = $(el).text().trim();
        if (text) anchors.push(text);
      }
    } catch {
      // skip
    }
  });
  return anchors;
}

export function scoreCrossLinking($: cheerio.CheerioAPI, finalUrl: string): DimensionResult {
  const checks: Check[] = [];
  let origin = "";
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    origin = "";
  }

  const internalLinks = origin ? extractInternalLinks($, origin) : [];
  const uniqueInternalLinks = [...new Set(internalLinks)];
  const anchorTexts = origin ? extractAnchorTexts($, origin) : [];

  // --- Check 1: Has internal links (4 pts) ---
  const hasLinks = uniqueInternalLinks.length > 0;
  checks.push({
    id: "has-internal-links",
    name: "Internal links present",
    passed: hasLinks,
    points: hasLinks ? 4 : 0,
    maxPoints: 4,
    detail: hasLinks
      ? `${uniqueInternalLinks.length} unique internal link${uniqueInternalLinks.length === 1 ? "" : "s"} found`
      : "No internal links detected - pages must link to each other to create concept gravity",
  });

  // --- Check 2: Link density - 5+ internal links (5 pts) ---
  const goodDensity = uniqueInternalLinks.length >= 5;
  checks.push({
    id: "link-density",
    name: "5 or more unique internal links",
    passed: goodDensity,
    partial: uniqueInternalLinks.length > 0 && uniqueInternalLinks.length < 5,
    points: goodDensity ? 5 : uniqueInternalLinks.length > 0 ? 2 : 0,
    maxPoints: 5,
    detail: goodDensity
      ? `${uniqueInternalLinks.length} internal links - strong internal linking structure`
      : uniqueInternalLinks.length > 0
      ? `${uniqueInternalLinks.length} internal link${uniqueInternalLinks.length === 1 ? "" : "s"} - aim for 5+ to build concept clustering`
      : "No internal links to count",
  });

  // --- Check 3: Descriptive anchor text (3 pts) ---
  const weakAnchors = anchorTexts.filter((t) => WEAK_ANCHOR_PATTERNS.test(t));
  const weakRatio = anchorTexts.length > 0 ? weakAnchors.length / anchorTexts.length : 0;
  const goodAnchors = weakRatio < 0.3 && anchorTexts.length > 0;
  checks.push({
    id: "anchor-text",
    name: "Descriptive anchor text (not 'click here')",
    passed: goodAnchors,
    partial: anchorTexts.length > 0 && !goodAnchors && weakRatio < 0.6,
    points: goodAnchors ? 3 : anchorTexts.length > 0 && weakRatio < 0.6 ? 1 : 0,
    maxPoints: 3,
    detail: goodAnchors
      ? "Internal links use descriptive anchor text - helps AI models understand link context"
      : weakAnchors.length > 0
      ? `${weakAnchors.length} weak anchor${weakAnchors.length === 1 ? "" : "s"} found (e.g. "${weakAnchors[0]}") - use keyword-rich descriptive text`
      : anchorTexts.length === 0
      ? "No internal link anchor texts to evaluate"
      : "Good anchor text quality",
  });

  // --- Check 4: Navigation/footer structure (3 pts) ---
  const hasNav = $("nav, [role='navigation']").length > 0;
  const hasFooter = $("footer, [role='contentinfo']").length > 0;
  const hasStructure = hasNav || hasFooter;
  checks.push({
    id: "nav-structure",
    name: "Navigation and/or footer structure",
    passed: hasStructure,
    partial: hasNav !== hasFooter,
    points: hasNav && hasFooter ? 3 : hasStructure ? 2 : 0,
    maxPoints: 3,
    detail: hasNav && hasFooter
      ? "Navigation and footer structure found - provides consistent internal linking paths"
      : hasNav
      ? "Navigation found but no footer - add footer links for additional internal linking"
      : hasFooter
      ? "Footer found but no nav element - add semantic <nav> for crawlers"
      : "No nav or footer structure - add semantic navigation to improve link architecture",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "cross-linking",
    name: "Cross-Linking",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
