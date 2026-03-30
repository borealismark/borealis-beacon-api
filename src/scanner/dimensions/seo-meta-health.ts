import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

/**
 * SEO Meta Health (20 pts max)
 * Evaluates the quality and completeness of meta tags - the first thing
 * search engines read when indexing a page.
 *
 * Checks:
 *  1. title-quality (5 pts) - Title exists, proper length (30-60 chars optimal)
 *  2. meta-description-quality (5 pts) - Description exists, proper length (120-160 chars)
 *  3. og-completeness (4 pts) - Full Open Graph tag set for rich social previews
 *  4. canonical-present (3 pts) - Canonical URL prevents duplicate content issues
 *  5. lang-attribute (3 pts) - Language declared for international SEO
 */
export function scoreSeoMetaHealth($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // 1. Title quality (5 pts)
  const title = $("title").first().text().trim();
  const titleLen = title.length;
  const titleOptimal = titleLen >= 30 && titleLen <= 60;
  const titleAcceptable = titleLen >= 10 && titleLen <= 120;
  const titleExists = titleLen > 0;

  checks.push({
    id: "seo-title-quality",
    name: "Title Tag Quality",
    passed: titleOptimal,
    partial: !titleOptimal && titleAcceptable,
    points: titleOptimal ? 5 : titleAcceptable ? 3 : titleExists ? 1 : 0,
    maxPoints: 5,
    detail: titleOptimal
      ? `Title is ${titleLen} characters - optimal range for search results display`
      : titleAcceptable
        ? `Title is ${titleLen} characters - works but 30-60 characters is optimal for click-through rate`
        : titleExists
          ? `Title is ${titleLen} characters - too ${titleLen < 10 ? "short" : "long"} for effective search display`
          : "No title tag found - this is the most important on-page SEO element",
  });

  // 2. Meta description quality (5 pts)
  const metaDesc =
    $('meta[name="description"]').attr("content")?.trim() || "";
  const descLen = metaDesc.length;
  const descOptimal = descLen >= 120 && descLen <= 160;
  const descAcceptable = descLen >= 50 && descLen <= 300;
  const descExists = descLen > 0;

  checks.push({
    id: "seo-meta-description",
    name: "Meta Description Quality",
    passed: descOptimal,
    partial: !descOptimal && descAcceptable,
    points: descOptimal ? 5 : descAcceptable ? 3 : descExists ? 1 : 0,
    maxPoints: 5,
    detail: descOptimal
      ? `Meta description is ${descLen} characters - optimal length for search snippets`
      : descAcceptable
        ? `Meta description is ${descLen} characters - aim for 120-160 chars for best display in search results`
        : descExists
          ? `Meta description is ${descLen} characters - too ${descLen < 50 ? "short to be useful" : "long and will be truncated"}`
          : "No meta description found - Google will auto-generate one, often poorly",
  });

  // 3. Open Graph completeness (4 pts)
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || "";
  const ogType = $('meta[property="og:type"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const ogUrl = $('meta[property="og:url"]').attr("content") || "";

  const ogPresent = [ogTitle, ogDesc, ogType, ogImage, ogUrl].filter(
    (v) => v.length > 0
  ).length;
  const ogFull = ogPresent >= 4;
  const ogPartial = ogPresent >= 2;

  checks.push({
    id: "seo-og-completeness",
    name: "Open Graph Tags",
    passed: ogFull,
    partial: !ogFull && ogPartial,
    points: ogFull ? 4 : ogPartial ? 2 : 0,
    maxPoints: 4,
    detail: ogFull
      ? `${ogPresent}/5 Open Graph tags present - social shares will display rich previews`
      : ogPartial
        ? `${ogPresent}/5 Open Graph tags found - add og:title, og:description, og:type, og:image, og:url for complete social previews`
        : "No Open Graph tags found - social media shares will show generic previews with no control over display",
  });

  // 4. Canonical URL (3 pts)
  const canonical = $('link[rel="canonical"]').attr("href") || "";
  const hasCanonical = canonical.length > 0;

  checks.push({
    id: "seo-canonical",
    name: "Canonical URL",
    passed: hasCanonical,
    points: hasCanonical ? 3 : 0,
    maxPoints: 3,
    detail: hasCanonical
      ? "Canonical URL is set - prevents duplicate content penalties from URL variations"
      : "No canonical URL found - search engines may index duplicate versions of this page (with/without www, trailing slashes, query params)",
  });

  // 5. Language attribute (3 pts)
  const lang = $("html").attr("lang") || "";
  const hasLang = lang.length > 0;

  checks.push({
    id: "seo-lang-attribute",
    name: "Language Declaration",
    passed: hasLang,
    points: hasLang ? 3 : 0,
    maxPoints: 3,
    detail: hasLang
      ? `Language declared as "${lang}" - helps search engines serve the page to the right audience`
      : "No lang attribute on <html> - search engines may misidentify the page language, hurting international ranking",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-meta-health",
    name: "Meta Health",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
