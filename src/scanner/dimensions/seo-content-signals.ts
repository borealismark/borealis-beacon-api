import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

/**
 * SEO Content Signals (10 pts max)
 * Evaluates content quality markers that search engines use to
 * gauge page value. Thin content, missing alt text, and unstructured
 * text all hurt rankings.
 *
 * Checks:
 *  1. content-length-seo (3 pts) - Sufficient word count for ranking
 *  2. image-alt-coverage (4 pts) - Alt text on images for accessibility + SEO
 *  3. structured-content (3 pts) - Uses lists, tables, or definition elements
 */
export function scoreSeoContentSignals($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // Clone DOM to count words without nav/header/footer
  const $clone = cheerio.load($.html());
  $clone("script, style, nav, header, footer, noscript").remove();
  const bodyText = $clone("body").text();
  const words = bodyText
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;

  // 1. Content length for SEO (3 pts)
  // SEO research shows 1,000+ words correlates with higher rankings
  // 300+ is minimum, 600+ is decent
  const goodLength = wordCount >= 800;
  const okLength = wordCount >= 300;

  checks.push({
    id: "seo-content-length",
    name: "Content Depth",
    passed: goodLength,
    partial: !goodLength && okLength,
    points: goodLength ? 3 : okLength ? 2 : wordCount >= 100 ? 1 : 0,
    maxPoints: 3,
    detail: goodLength
      ? `${wordCount} words - substantial content depth signals expertise and thoroughness to search engines`
      : okLength
        ? `${wordCount} words - adequate but pages with 800+ words tend to rank higher for competitive queries. Consider expanding with related subtopics`
        : `${wordCount} words - thin content struggles to rank. Aim for 800+ words covering the topic comprehensively`,
  });

  // 2. Image alt text coverage (4 pts)
  const images = $("img");
  const totalImages = images.length;
  let imagesWithAlt = 0;
  let imagesWithGoodAlt = 0;

  images.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt !== undefined && alt !== null) {
      imagesWithAlt++;
      // "Good" alt text is descriptive (not just "image", "photo", "img", etc.)
      const trimmed = alt.trim().toLowerCase();
      if (
        trimmed.length >= 5 &&
        !/^(image|photo|img|picture|icon|logo|banner|screenshot|untitled|\.jpg|\.png|\.gif|\.svg)$/i.test(
          trimmed
        )
      ) {
        imagesWithGoodAlt++;
      }
    }
  });

  const altPct = totalImages > 0 ? imagesWithAlt / totalImages : 1;
  const goodAltPct = totalImages > 0 ? imagesWithGoodAlt / totalImages : 1;
  const allHaveAlt = altPct >= 0.9;
  const mostHaveAlt = altPct >= 0.6;

  checks.push({
    id: "seo-image-alt",
    name: "Image Alt Text",
    passed: allHaveAlt && totalImages > 0,
    partial: !allHaveAlt && mostHaveAlt,
    points:
      totalImages === 0
        ? 2  // No images is neutral, not penalized heavily
        : allHaveAlt
          ? 4
          : mostHaveAlt
            ? 2
            : 1,
    maxPoints: 4,
    detail:
      totalImages === 0
        ? "No images found - consider adding relevant images with descriptive alt text for visual search and accessibility"
        : allHaveAlt
          ? `${imagesWithAlt}/${totalImages} images have alt text (${imagesWithGoodAlt} descriptive) - good for accessibility and image search ranking`
          : mostHaveAlt
            ? `${imagesWithAlt}/${totalImages} images have alt text - add descriptive alt text to all images for accessibility compliance and SEO`
            : `Only ${imagesWithAlt}/${totalImages} images have alt text - missing alt text hurts accessibility scores and image search visibility`,
  });

  // 3. Structured content elements (3 pts)
  // Pages with lists, tables, and structured elements rank better
  // and are more likely to be selected for featured snippets
  const hasOrderedList = $("ol").length > 0;
  const hasUnorderedList = $("ul").not("nav ul").not("header ul").not("footer ul").length > 0;
  const hasTable = $("table").length > 0;
  const hasDetails = $("details").length > 0;
  const hasDl = $("dl").length > 0;
  const hasBlockquote = $("blockquote").length > 0;
  const hasCode = $("pre, code").length > 0;

  const structuredElements = [
    hasOrderedList,
    hasUnorderedList,
    hasTable,
    hasDetails,
    hasDl,
    hasBlockquote,
    hasCode,
  ].filter(Boolean).length;

  const goodStructure = structuredElements >= 2;
  const someStructure = structuredElements >= 1;

  checks.push({
    id: "seo-structured-content",
    name: "Structured Content Elements",
    passed: goodStructure,
    partial: !goodStructure && someStructure,
    points: goodStructure ? 3 : someStructure ? 1 : 0,
    maxPoints: 3,
    detail: goodStructure
      ? `${structuredElements} types of structured content found (lists, tables, etc.) - improves featured snippet eligibility and readability signals`
      : someStructure
        ? "One type of structured content found - add lists, tables, or FAQ accordions to increase featured snippet chances"
        : "No structured content elements found - pages with lists, tables, and organized content are more likely to earn featured snippets",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-content-signals",
    name: "Content Signals",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
