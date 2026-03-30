import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

/**
 * SEO Internal Link Architecture (20 pts max)
 * Internal linking can boost rankings by up to 40%. This dimension
 * evaluates link quantity, quality, anchor text, and distribution.
 * In 2026, internal linking IS authority signaling.
 *
 * Checks:
 *  1. internal-link-count (5 pts) - Sufficient internal links present
 *  2. anchor-text-quality (5 pts) - Descriptive vs generic anchors
 *  3. body-contextual-links (5 pts) - Links within content, not just nav
 *  4. unique-destinations (5 pts) - Links to diverse internal pages
 */
export function scoreSeoLinkArchitecture(
  $: cheerio.CheerioAPI,
  pageUrl: string
): DimensionResult {
  const checks: Check[] = [];

  // Parse base origin
  let baseOrigin = "";
  try {
    baseOrigin = new URL(pageUrl).origin;
  } catch {
    // fallback
  }

  // Collect all internal links
  const allInternalLinks: { href: string; text: string; inBody: boolean }[] = [];
  const bodySelector = "main, article, .content, #content, [role='main']";
  const bodyEl = $(bodySelector).length > 0 ? $(bodySelector) : $("body");

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();

    // Skip fragments, javascript, mailto, tel
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    )
      return;

    // Check if internal
    let isInternal = false;
    if (href.startsWith("/") && !href.startsWith("//")) {
      isInternal = true;
    } else {
      try {
        const parsed = new URL(href, pageUrl);
        isInternal = parsed.origin === baseOrigin;
      } catch {
        return;
      }
    }

    if (!isInternal) return;

    // Check if this link is within body content (not nav/header/footer)
    const inBody = $(el).closest("nav, header, footer, [role='navigation'], [role='banner'], [role='contentinfo']").length === 0;

    allInternalLinks.push({ href, text, inBody });
  });

  const totalLinks = allInternalLinks.length;
  const bodyLinks = allInternalLinks.filter((l) => l.inBody);
  const uniqueDestinations = new Set(
    allInternalLinks.map((l) => {
      try {
        return new URL(l.href, pageUrl).pathname;
      } catch {
        return l.href;
      }
    })
  );

  // 1. Internal link count (5 pts)
  const goodCount = totalLinks >= 10;
  const okCount = totalLinks >= 5;

  checks.push({
    id: "seo-internal-link-count",
    name: "Internal Link Count",
    passed: goodCount,
    partial: !goodCount && okCount,
    points: goodCount ? 5 : okCount ? 3 : totalLinks > 0 ? 1 : 0,
    maxPoints: 5,
    detail: goodCount
      ? `${totalLinks} internal links found - strong internal linking signals topic authority`
      : okCount
        ? `${totalLinks} internal links found - aim for 10+ to build stronger topical relevance signals`
        : totalLinks > 0
          ? `Only ${totalLinks} internal link${totalLinks === 1 ? "" : "s"} found - pages with robust internal linking rank up to 40% higher`
          : "No internal links found - internal linking is one of the most impactful SEO factors you control",
  });

  // 2. Anchor text quality (5 pts)
  const WEAK_ANCHORS =
    /^(click here|read more|learn more|here|this|more|link|page|see more|view more|find out|click|go|next|previous|back|home|\d+|\.+)$/i;
  const linksWithText = allInternalLinks.filter((l) => l.text.length > 0);
  const weakAnchors = linksWithText.filter((l) => WEAK_ANCHORS.test(l.text));
  const weakPct =
    linksWithText.length > 0
      ? weakAnchors.length / linksWithText.length
      : 0;
  const goodAnchors = weakPct < 0.2;
  const okAnchors = weakPct < 0.5;

  checks.push({
    id: "seo-anchor-text-quality",
    name: "Anchor Text Quality",
    passed: goodAnchors && linksWithText.length > 0,
    partial: !goodAnchors && okAnchors,
    points:
      goodAnchors && linksWithText.length > 0
        ? 5
        : okAnchors
          ? 3
          : linksWithText.length > 0
            ? 1
            : 0,
    maxPoints: 5,
    detail:
      goodAnchors && linksWithText.length > 0
        ? `${Math.round((1 - weakPct) * 100)}% of anchor text is descriptive - search engines use this to understand linked page topics`
        : okAnchors
          ? `${Math.round(weakPct * 100)}% of anchors are generic ("click here", "read more") - replace with keyword-rich descriptive text`
          : linksWithText.length > 0
            ? `${weakAnchors.length} of ${linksWithText.length} anchors are generic - descriptive anchor text is a direct ranking signal`
            : "No anchor text found to evaluate",
  });

  // 3. Body contextual links - links within content, not just nav (5 pts)
  const bodyLinkCount = bodyLinks.length;
  const goodBodyLinks = bodyLinkCount >= 5;
  const someBodyLinks = bodyLinkCount >= 2;

  checks.push({
    id: "seo-body-contextual-links",
    name: "Contextual Body Links",
    passed: goodBodyLinks,
    partial: !goodBodyLinks && someBodyLinks,
    points: goodBodyLinks ? 5 : someBodyLinks ? 2 : 0,
    maxPoints: 5,
    detail: goodBodyLinks
      ? `${bodyLinkCount} contextual links within body content - these carry more SEO weight than navigation links`
      : someBodyLinks
        ? `Only ${bodyLinkCount} links within body content - aim for 5+ contextual in-content links (2-5 per 1,000 words is optimal)`
        : `No contextual links in body content - all ${totalLinks} links are in nav/header/footer. In-content links are significantly more valuable for SEO`,
  });

  // 4. Unique destinations (5 pts)
  const uniqueCount = uniqueDestinations.size;
  const goodUnique = uniqueCount >= 8;
  const okUnique = uniqueCount >= 4;

  checks.push({
    id: "seo-unique-destinations",
    name: "Link Destination Diversity",
    passed: goodUnique,
    partial: !goodUnique && okUnique,
    points: goodUnique ? 5 : okUnique ? 3 : uniqueCount > 0 ? 1 : 0,
    maxPoints: 5,
    detail: goodUnique
      ? `Links point to ${uniqueCount} unique internal pages - distributes authority across your site effectively`
      : okUnique
        ? `Links point to ${uniqueCount} unique pages - expand to 8+ to build stronger topical clusters`
        : uniqueCount > 0
          ? `Only ${uniqueCount} unique destination${uniqueCount === 1 ? "" : "s"} - spread links across more pages to build site-wide authority`
          : "No unique internal destinations found",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-link-architecture",
    name: "Link Architecture",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
