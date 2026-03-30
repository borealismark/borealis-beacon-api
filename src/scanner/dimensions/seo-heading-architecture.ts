import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

/**
 * SEO Heading Architecture (15 pts max)
 * Evaluates heading structure - the backbone of on-page SEO.
 * Proper heading hierarchy helps search engines understand content
 * structure and boosts featured snippet eligibility.
 *
 * Checks:
 *  1. single-h1 (4 pts) - Exactly one H1 per page
 *  2. heading-hierarchy (4 pts) - No skipped levels (H1->H3 without H2)
 *  3. h1-keyword-presence (4 pts) - H1 contains substantive keywords (not generic)
 *  4. heading-depth (3 pts) - Uses H2 and H3 for content depth
 */
export function scoreSeoHeadingArchitecture(
  $: cheerio.CheerioAPI
): DimensionResult {
  const checks: Check[] = [];

  // 1. Single H1 (4 pts)
  const h1Count = $("h1").length;
  const singleH1 = h1Count === 1;
  const hasH1 = h1Count > 0;

  checks.push({
    id: "seo-single-h1",
    name: "Single H1 Tag",
    passed: singleH1,
    partial: !singleH1 && hasH1,
    points: singleH1 ? 4 : hasH1 ? 1 : 0,
    maxPoints: 4,
    detail: singleH1
      ? "Exactly one H1 tag found - correct structure for search engines"
      : hasH1
        ? `Found ${h1Count} H1 tags - only one H1 should exist per page. Multiple H1s dilute the primary topic signal`
        : "No H1 tag found - every page needs exactly one H1 as its primary heading",
  });

  // 2. Heading hierarchy - no skipped levels (4 pts)
  const headingLevels: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase() || (el as any).name?.toLowerCase() || "";
    const level = parseInt(tag.replace("h", ""), 10);
    if (!isNaN(level)) headingLevels.push(level);
  });

  let hierarchyValid = true;
  let skippedFrom = "";
  let skippedTo = "";
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      hierarchyValid = false;
      skippedFrom = `H${headingLevels[i - 1]}`;
      skippedTo = `H${headingLevels[i]}`;
      break;
    }
  }

  checks.push({
    id: "seo-heading-hierarchy",
    name: "Heading Hierarchy",
    passed: hierarchyValid && headingLevels.length >= 2,
    partial: hierarchyValid && headingLevels.length < 2,
    points: hierarchyValid && headingLevels.length >= 2 ? 4 : hierarchyValid ? 2 : 0,
    maxPoints: 4,
    detail:
      hierarchyValid && headingLevels.length >= 2
        ? `Heading hierarchy is clean - no skipped levels across ${headingLevels.length} headings`
        : hierarchyValid && headingLevels.length < 2
          ? "Hierarchy is valid but only 1 heading found - add H2s to structure the content"
          : `Heading hierarchy skips from ${skippedFrom} to ${skippedTo} - this confuses search engines about content structure. Use sequential levels (H1 then H2 then H3)`,
  });

  // 3. H1 keyword presence - not generic (4 pts)
  const h1Text = $("h1").first().text().trim().toLowerCase();
  const GENERIC_H1 = /^(home|welcome|untitled|page|index|about|blog|news|main)$/i;
  const h1Substantive = h1Text.length >= 10 && !GENERIC_H1.test(h1Text);
  const h1Short = h1Text.length > 0 && h1Text.length < 10;

  checks.push({
    id: "seo-h1-keyword",
    name: "H1 Keyword Quality",
    passed: h1Substantive,
    partial: h1Short,
    points: h1Substantive ? 4 : h1Short ? 1 : 0,
    maxPoints: 4,
    detail: h1Substantive
      ? "H1 contains substantive keyword-rich text that signals the page topic to search engines"
      : h1Short
        ? `H1 is only ${h1Text.length} characters - expand it to clearly describe the page topic with target keywords`
        : h1Text.length === 0
          ? "No H1 text found - the H1 should contain your primary target keyword or phrase"
          : "H1 is too generic - replace with a specific, keyword-rich heading that describes the page content",
  });

  // 4. Heading depth - uses H2 and H3 (3 pts)
  const h2Count = $("h2").length;
  const h3Count = $("h3").length;
  const hasH2s = h2Count >= 2;
  const hasH3s = h3Count >= 1;
  const goodDepth = hasH2s && hasH3s;
  const someDepth = h2Count >= 1;

  checks.push({
    id: "seo-heading-depth",
    name: "Heading Depth",
    passed: goodDepth,
    partial: !goodDepth && someDepth,
    points: goodDepth ? 3 : someDepth ? 1 : 0,
    maxPoints: 3,
    detail: goodDepth
      ? `Content uses ${h2Count} H2s and ${h3Count} H3s - strong structure for both readers and search engines`
      : someDepth
        ? `Found ${h2Count} H2s and ${h3Count} H3s - add more subheadings to break content into scannable, indexable sections`
        : "No H2 or H3 headings found - structured content with subheadings ranks significantly better",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-heading-architecture",
    name: "Heading Architecture",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
