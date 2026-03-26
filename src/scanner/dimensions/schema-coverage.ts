import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

interface ParsedSchema {
  "@type"?: string | string[];
  "@graph"?: ParsedSchema[];
  mainEntity?: unknown;
  [key: string]: unknown;
}

function flattenGraphTypes(schemas: ParsedSchema[]): string[] {
  const types: string[] = [];
  for (const schema of schemas) {
    if (schema["@graph"] && Array.isArray(schema["@graph"])) {
      for (const node of schema["@graph"] as ParsedSchema[]) {
        const t = node["@type"];
        if (typeof t === "string") types.push(t);
        else if (Array.isArray(t)) types.push(...t);
      }
    }
    const t = schema["@type"];
    if (typeof t === "string") types.push(t);
    else if (Array.isArray(t)) types.push(...t);
  }
  return types;
}

function countFaqPairs(schemas: ParsedSchema[]): number {
  let count = 0;
  for (const schema of schemas) {
    const graphs: ParsedSchema[] = [];
    if (schema["@graph"]) {
      graphs.push(...(schema["@graph"] as ParsedSchema[]));
    }
    graphs.push(schema);
    for (const node of graphs) {
      const type = node["@type"];
      if (type === "FAQPage" || (Array.isArray(type) && type.includes("FAQPage"))) {
        const entities = node["mainEntity"];
        if (Array.isArray(entities)) {
          count += entities.length;
        }
      }
    }
  }
  return count;
}

export function scoreSchemaCoverage($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // Parse all JSON-LD blocks
  const schemas: ParsedSchema[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      if (Array.isArray(parsed)) {
        schemas.push(...parsed);
      } else {
        schemas.push(parsed);
      }
    } catch {
      // malformed JSON-LD - skip
    }
  });

  const allTypes = flattenGraphTypes(schemas);
  const typesLower = allTypes.map((t) => t.toLowerCase());

  // Check 1: FAQPage with Q&A pairs (8 pts max)
  const faqPairs = countFaqPairs(schemas);
  const hasFaq = faqPairs > 0;
  const faqFull = faqPairs >= 3;
  checks.push({
    id: "faq-schema",
    name: "FAQPage JSON-LD schema",
    passed: faqFull,
    partial: hasFaq && !faqFull,
    points: faqFull ? 8 : hasFaq ? 4 : 0,
    maxPoints: 8,
    detail: faqFull
      ? `FAQPage found with ${faqPairs} Q&A pairs`
      : hasFaq
      ? `FAQPage found but only ${faqPairs} Q&A pair${faqPairs === 1 ? "" : "s"} - need 3+ for full points`
      : "No FAQPage JSON-LD schema found - this is the highest-value AEO schema type",
  });

  // Check 2: Article / BlogPosting / NewsArticle (5 pts)
  const hasArticle = typesLower.some((t) =>
    ["article", "blogposting", "newsarticle", "technicalarticle"].includes(t)
  );
  checks.push({
    id: "article-schema",
    name: "Article or BlogPosting schema",
    passed: hasArticle,
    points: hasArticle ? 5 : 0,
    maxPoints: 5,
    detail: hasArticle
      ? "Article/BlogPosting schema found - helps with citation attribution"
      : "No Article schema found - add Article JSON-LD to content pages for authorship signals",
  });

  // Check 3: Organization / WebSite / Person entity (4 pts)
  const hasOrg = typesLower.some((t) =>
    ["organization", "website", "person", "localbusiness"].includes(t)
  );
  checks.push({
    id: "entity-schema",
    name: "Organization or WebSite entity schema",
    passed: hasOrg,
    points: hasOrg ? 4 : 0,
    maxPoints: 4,
    detail: hasOrg
      ? "Entity schema found - establishes organizational identity for AI models"
      : "No Organization/WebSite schema - add to establish entity authority",
  });

  // Check 4: Rich content schema (Product, HowTo, DefinedTerm, SoftwareApplication) (4 pts)
  const richTypes = ["product", "howto", "definedterm", "softwareapplication", "recipe", "event", "course"];
  const hasRich = typesLower.some((t) => richTypes.includes(t));
  checks.push({
    id: "rich-schema",
    name: "Rich content schema (Product, HowTo, DefinedTerm)",
    passed: hasRich,
    points: hasRich ? 4 : 0,
    maxPoints: 4,
    detail: hasRich
      ? `Rich schema found: ${allTypes.filter((t) => richTypes.includes(t.toLowerCase())).join(", ")}`
      : "No rich content schema - consider adding HowTo or DefinedTerm for instructional/glossary content",
  });

  // Check 5: OpenGraph tags (4 pts)
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDescription = $('meta[property="og:description"]').attr("content") || "";
  const ogType = $('meta[property="og:type"]').attr("content") || "";
  const ogComplete = !!(ogTitle && ogDescription && ogType);
  checks.push({
    id: "opengraph",
    name: "OpenGraph meta tags",
    passed: ogComplete,
    partial: !!(ogTitle || ogDescription) && !ogComplete,
    points: ogComplete ? 4 : (ogTitle || ogDescription) ? 2 : 0,
    maxPoints: 4,
    detail: ogComplete
      ? "OpenGraph tags complete (title, description, type)"
      : `OpenGraph incomplete - missing: ${[!ogTitle && "og:title", !ogDescription && "og:description", !ogType && "og:type"].filter(Boolean).join(", ")}`,
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "schema-coverage",
    name: "Schema Coverage",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
