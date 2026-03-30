import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

/**
 * SEO Schema Richness (20 pts max)
 * Evaluates structured data depth - the single biggest SEO lever in 2026.
 * Pages with schema get 30-40% higher CTR. FAQ schema makes pages 3.2x
 * more likely to appear in AI Overviews. Multiple complementary schemas
 * compound the effect.
 *
 * Checks:
 *  1. json-ld-present (4 pts) - Has any JSON-LD structured data
 *  2. faq-schema-seo (5 pts) - FAQPage with proper Q&A pairs
 *  3. breadcrumb-schema (4 pts) - BreadcrumbList for site hierarchy
 *  4. author-org-schema (4 pts) - Author/Organization for E-E-A-T
 *  5. multi-schema (3 pts) - Multiple complementary schema types
 */
export function scoreSeoSchemaRichness($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // Parse all JSON-LD blocks
  const jsonLdBlocks: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html() || "";
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        jsonLdBlocks.push(...parsed);
      } else {
        jsonLdBlocks.push(parsed);
      }
    } catch {
      // Skip malformed JSON-LD
    }
  });

  const allTypes = jsonLdBlocks.map((b) => (b["@type"] || "").toLowerCase());

  // 1. JSON-LD present (4 pts)
  const hasJsonLd = jsonLdBlocks.length > 0;

  checks.push({
    id: "seo-json-ld-present",
    name: "JSON-LD Structured Data",
    passed: hasJsonLd,
    points: hasJsonLd ? 4 : 0,
    maxPoints: 4,
    detail: hasJsonLd
      ? `Found ${jsonLdBlocks.length} JSON-LD block${jsonLdBlocks.length === 1 ? "" : "s"} - search engines can extract rich data from this page`
      : "No JSON-LD structured data found - adding schema markup can boost click-through rates by 30-40%",
  });

  // 2. FAQ schema with proper Q&A pairs (5 pts)
  const faqBlocks = jsonLdBlocks.filter(
    (b) => (b["@type"] || "").toLowerCase() === "faqpage"
  );
  let faqQACount = 0;
  for (const faq of faqBlocks) {
    const mainEntity = faq.mainEntity || [];
    const entities = Array.isArray(mainEntity) ? mainEntity : [mainEntity];
    faqQACount += entities.filter(
      (e: any) =>
        (e["@type"] || "").toLowerCase() === "question" && e.acceptedAnswer
    ).length;
  }

  const faqFull = faqQACount >= 3;
  const faqPartial = faqQACount >= 1;

  checks.push({
    id: "seo-faq-schema",
    name: "FAQ Schema",
    passed: faqFull,
    partial: !faqFull && faqPartial,
    points: faqFull ? 5 : faqPartial ? 3 : 0,
    maxPoints: 5,
    detail: faqFull
      ? `FAQPage schema with ${faqQACount} Q&A pairs - eligible for rich FAQ snippets and 3.2x more likely to appear in AI Overviews`
      : faqPartial
        ? `FAQPage schema found but only ${faqQACount} Q&A pair${faqQACount === 1 ? "" : "s"} - add at least 3 for full rich snippet eligibility`
        : "No FAQPage schema found - FAQ markup is the highest-impact schema type for both traditional search and AI visibility",
  });

  // 3. Breadcrumb schema (4 pts)
  const hasBreadcrumb = allTypes.includes("breadcrumblist");
  // Also check for breadcrumb-like microdata
  const hasBreadcrumbMicrodata =
    $('[itemtype*="BreadcrumbList"]').length > 0 ||
    $('[class*="breadcrumb"]').length > 0;
  const breadcrumbPresent = hasBreadcrumb || hasBreadcrumbMicrodata;

  checks.push({
    id: "seo-breadcrumb-schema",
    name: "Breadcrumb Schema",
    passed: hasBreadcrumb,
    partial: !hasBreadcrumb && hasBreadcrumbMicrodata,
    points: hasBreadcrumb ? 4 : hasBreadcrumbMicrodata ? 2 : 0,
    maxPoints: 4,
    detail: hasBreadcrumb
      ? "BreadcrumbList JSON-LD present - search results will show site hierarchy, improving click-through rate"
      : hasBreadcrumbMicrodata
        ? "Breadcrumb HTML structure found but no JSON-LD BreadcrumbList schema - add structured data for rich breadcrumb display in search results"
        : "No breadcrumb schema found - BreadcrumbList markup shows site hierarchy in search results and improves navigation signals",
  });

  // 4. Author/Organization schema for E-E-A-T (4 pts)
  const hasOrg = allTypes.some(
    (t) =>
      t === "organization" ||
      t === "localbusiness" ||
      t === "corporation"
  );
  const hasPerson = allTypes.includes("person");
  const hasAuthorInArticle = jsonLdBlocks.some(
    (b) =>
      b.author &&
      ((typeof b.author === "object" && b.author["@type"]) ||
        typeof b.author === "string")
  );
  const hasEEAT = hasOrg || hasPerson || hasAuthorInArticle;
  const hasOrgAndAuthor = hasOrg && (hasPerson || hasAuthorInArticle);

  checks.push({
    id: "seo-author-org-schema",
    name: "Author & Organization Schema",
    passed: hasOrgAndAuthor,
    partial: hasEEAT && !hasOrgAndAuthor,
    points: hasOrgAndAuthor ? 4 : hasEEAT ? 2 : 0,
    maxPoints: 4,
    detail: hasOrgAndAuthor
      ? "Both Organization and Author schema present - strong E-E-A-T signals for Google's trust evaluation"
      : hasEEAT
        ? `Found ${hasOrg ? "Organization" : ""}${hasOrg && (hasPerson || hasAuthorInArticle) ? " and " : ""}${hasPerson || hasAuthorInArticle ? "Author" : ""} schema - add both for complete E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)`
        : "No Author or Organization schema found - E-E-A-T signals are a major Google ranking factor. Add Organization and Author structured data",
  });

  // 5. Multiple complementary schema types (3 pts)
  const uniqueTypes = new Set(allTypes.filter((t) => t.length > 0));
  const multiSchema = uniqueTypes.size >= 3;
  const someSchema = uniqueTypes.size >= 2;

  checks.push({
    id: "seo-multi-schema",
    name: "Schema Variety",
    passed: multiSchema,
    partial: !multiSchema && someSchema,
    points: multiSchema ? 3 : someSchema ? 1 : 0,
    maxPoints: 3,
    detail: multiSchema
      ? `${uniqueTypes.size} distinct schema types found (${[...uniqueTypes].slice(0, 4).join(", ")}${uniqueTypes.size > 4 ? "..." : ""}) - complementary schemas compound visibility across different search features`
      : someSchema
        ? `${uniqueTypes.size} schema type${uniqueTypes.size === 1 ? "" : "s"} found - add complementary types (Article + FAQ + Organization) for maximum rich snippet opportunities`
        : "No structured data types found - pages with multiple complementary schemas get significantly more search visibility",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "seo-schema-richness",
    name: "Schema Richness",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
