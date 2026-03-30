import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import {
  ScanResult,
  AeoGrade,
  SeoGrade,
  ScoreBlock,
  Issue,
  Recommendation,
  DimensionResult,
} from "../types";
import { fetchPage, fetchAuxiliary } from "../utils/html-fetcher";

// AEO dimensions (existing)
import { scoreSchemaCoverage } from "./dimensions/schema-coverage";
import { scoreContentStructure } from "./dimensions/content-structure";
import { scoreCrawlability } from "./dimensions/crawlability";
import { scoreCopySequencing } from "./dimensions/copy-sequencing";
import { scoreCrossLinking } from "./dimensions/cross-linking";

// SEO dimensions (new)
import { scoreSeoMetaHealth } from "./dimensions/seo-meta-health";
import { scoreSeoHeadingArchitecture } from "./dimensions/seo-heading-architecture";
import { scoreSeoSchemaRichness } from "./dimensions/seo-schema-richness";
import { scoreSeoLinkArchitecture } from "./dimensions/seo-link-architecture";
import { scoreSeoTechnicalFoundations } from "./dimensions/seo-technical-foundations";
import { scoreSeoContentSignals } from "./dimensions/seo-content-signals";

// ── Grade calculators ──────────────────────────────────────────────

function getAeoGrade(score: number): { grade: AeoGrade; color: string } {
  if (score >= 85) return { grade: "Strong AEO Authority", color: "#10b981" };
  if (score >= 70) return { grade: "Functional Baseline", color: "#00e5ff" };
  if (score >= 50) return { grade: "Visible Gaps", color: "#f59e0b" };
  return { grade: "Pre-AEO", color: "#ef4444" };
}

function getSeoGrade(score: number): { grade: SeoGrade; color: string } {
  if (score >= 85) return { grade: "SEO Powerhouse", color: "#10b981" };
  if (score >= 70) return { grade: "Well Optimized", color: "#00e5ff" };
  if (score >= 50) return { grade: "Needs Work", color: "#f59e0b" };
  return { grade: "SEO Critical", color: "#ef4444" };
}

// ── Issue extraction ───────────────────────────────────────────────

function extractIssues(
  dims: Record<string, DimensionResult>,
  severityMap: Record<string, "critical" | "high" | "medium" | "low">,
  impactFn: (id: string) => string,
  limit: number
): Issue[] {
  const issues: Issue[] = [];

  for (const dim of Object.values(dims)) {
    for (const check of dim.checks) {
      if (!check.passed) {
        issues.push({
          severity: severityMap[check.id] || "medium",
          dimension: dim.name,
          title: check.name,
          description: check.detail,
          fix: getFix(check.id),
          aeoImpact: impactFn(check.id),
        });
      }
    }
  }

  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return issues.slice(0, limit);
}

// ── AEO severity + impact maps ─────────────────────────────────────

const aeoSeverityMap: Record<string, "critical" | "high" | "medium" | "low"> = {
  "faq-schema": "critical",
  "sitemap": "critical",
  "no-noindex": "critical",
  "robots-txt": "high",
  "h1-present": "high",
  "title-intent": "high",
  "article-schema": "high",
  "h1-question": "medium",
  "question-subheadings": "medium",
  "meta-problem-first": "medium",
  "faq-section": "medium",
  "content-length": "medium",
  "entity-schema": "medium",
  "opengraph": "low",
  "canonical": "low",
  "page-title": "low",
  "subheadings": "low",
  "answer-first-opening": "medium",
  "has-internal-links": "high",
  "link-density": "medium",
  "anchor-text": "low",
  "nav-structure": "low",
  "rich-schema": "low",
};

function getAeoImpact(checkId: string): string {
  const impacts: Record<string, string> = {
    "faq-schema": "FAQPage schemas are directly parsed by AI answer engines - missing this is the #1 reason pages get skipped for citation",
    "sitemap": "AI training crawlers rely on sitemaps to discover pages - without it, many pages remain unindexed",
    "no-noindex": "Noindex prevents all search engines and AI crawlers from indexing this page entirely",
    "robots-txt": "Incorrectly configured robots.txt can block AI crawlers from accessing the entire site",
    "h1-present": "H1 is the primary topic signal - AI models use it to categorize and extract page context",
    "title-intent": "Titles leading with user intent match query patterns AI models use to select citation candidates",
    "article-schema": "Article schema provides authorship and publication signals that increase citation trust",
    "h1-question": "Question-format H1 directly maps to user queries that AI models are trained to answer",
    "question-subheadings": "Question subheadings create extractable Q&A pairs that AI models can directly cite",
    "meta-problem-first": "Problem-first meta descriptions signal relevance when AI models match queries to pages",
    "faq-section": "Visible FAQ sections reinforce JSON-LD schema and provide additional extractable answers",
    "content-length": "Thin content is rarely selected for citation - AI models need substance to extract answers from",
    "entity-schema": "Entity schemas establish organizational identity, increasing trust signals for AI citation",
    "opengraph": "OpenGraph tags help AI models understand page type and context during crawling",
    "canonical": "Missing canonicals can cause duplicate content confusion, reducing citation confidence",
    "page-title": "Page title is a primary indexing signal used by all crawlers and AI models",
    "subheadings": "Structured headings help AI models segment and extract specific answers from your content",
    "answer-first-opening": "Opening with the answer directly matches featured snippet selection patterns",
    "has-internal-links": "Internal links create concept clustering that signals topic authority to AI models",
    "link-density": "Higher internal link density signals that this page is a hub for its topic area",
    "anchor-text": "Descriptive anchor text tells crawlers what the linked page is about, reinforcing topic relationships",
    "nav-structure": "Semantic nav/footer structure provides consistent site-wide link discovery paths",
    "rich-schema": "Rich schemas create additional retrieval opportunities in specific query contexts",
  };
  return impacts[checkId] || "Impacts AI model retrieval and citation selection";
}

// ── SEO severity + impact maps ─────────────────────────────────────

const seoSeverityMap: Record<string, "critical" | "high" | "medium" | "low"> = {
  // Technical Foundations
  "seo-https": "critical",
  "seo-no-noindex": "critical",
  "seo-robots-health": "high",
  "seo-sitemap": "high",
  "seo-viewport-mobile": "critical",
  // Meta Health
  "seo-title-quality": "high",
  "seo-meta-description": "high",
  "seo-og-completeness": "low",
  "seo-canonical": "medium",
  "seo-lang-attribute": "low",
  // Heading Architecture
  "seo-single-h1": "high",
  "seo-heading-hierarchy": "medium",
  "seo-h1-keyword": "high",
  "seo-heading-depth": "medium",
  // Schema Richness
  "seo-json-ld-present": "high",
  "seo-faq-schema": "critical",
  "seo-breadcrumb-schema": "medium",
  "seo-author-org-schema": "medium",
  "seo-multi-schema": "low",
  // Link Architecture
  "seo-internal-link-count": "high",
  "seo-anchor-text-quality": "medium",
  "seo-body-contextual-links": "high",
  "seo-unique-destinations": "medium",
  // Content Signals
  "seo-content-length": "medium",
  "seo-image-alt": "medium",
  "seo-structured-content": "low",
};

function getSeoImpact(checkId: string): string {
  const impacts: Record<string, string> = {
    "seo-https": "HTTPS is a confirmed Google ranking signal since 2014 - Chrome flags HTTP as 'Not Secure' which tanks user trust",
    "seo-no-noindex": "Noindex completely prevents search engine indexing - the page is invisible to organic search",
    "seo-robots-health": "Blocking crawlers via robots.txt prevents indexing of your entire site",
    "seo-sitemap": "Sitemaps help search engines discover pages missed during normal crawling, especially on larger sites",
    "seo-viewport-mobile": "Google uses mobile-first indexing - without a viewport tag, ranking drops on ALL devices",
    "seo-title-quality": "Title tags are the strongest on-page ranking signal and directly affect click-through rate in search results",
    "seo-meta-description": "While not a direct ranking factor, meta descriptions influence CTR which indirectly affects rankings",
    "seo-og-completeness": "Open Graph tags control how your page appears when shared on social media, driving referral traffic",
    "seo-canonical": "Missing canonicals cause duplicate content issues that split ranking signals across URL variations",
    "seo-lang-attribute": "Language declaration helps search engines serve your page to the right geographic and language audience",
    "seo-single-h1": "Multiple H1 tags dilute the primary topic signal - search engines expect exactly one per page",
    "seo-heading-hierarchy": "Skipped heading levels confuse search engines about content structure and reduce featured snippet eligibility",
    "seo-h1-keyword": "The H1 should contain your primary target keyword - it is the strongest heading signal for relevance",
    "seo-heading-depth": "Pages with structured H2/H3 subheadings rank better and are more likely to earn featured snippets",
    "seo-json-ld-present": "Pages with structured data get 30-40% higher click-through rates via rich results in Google",
    "seo-faq-schema": "FAQ schema generates expandable rich results in search and makes pages 3.2x more likely to appear in AI Overviews",
    "seo-breadcrumb-schema": "BreadcrumbList schema shows site hierarchy in search results, improving CTR and user navigation",
    "seo-author-org-schema": "Author and Organization schema are key E-E-A-T signals that Google uses for trust evaluation",
    "seo-multi-schema": "Multiple complementary schemas compound search visibility across different SERP features",
    "seo-internal-link-count": "Internal linking can boost rankings by up to 40% - it is the most impactful on-site factor you control",
    "seo-anchor-text-quality": "Descriptive anchor text is a direct ranking signal that tells Google what the linked page is about",
    "seo-body-contextual-links": "In-content links carry significantly more SEO weight than navigation or footer links",
    "seo-unique-destinations": "Linking to diverse internal pages distributes page authority and builds topical clusters",
    "seo-content-length": "Pages with 800+ words tend to rank higher for competitive queries - thin content struggles to rank",
    "seo-image-alt": "Missing alt text hurts both accessibility scores and image search visibility",
    "seo-structured-content": "Pages with lists, tables, and organized content are more likely to earn featured snippets",
  };
  return impacts[checkId] || "Impacts search engine ranking and organic visibility";
}

// ── Fix map (unified for both AEO and SEO) ─────────────────────────

function getFix(checkId: string): string {
  const fixes: Record<string, string> = {
    // AEO fixes (existing)
    "faq-schema": `Add a FAQPage JSON-LD block in a <script type="application/ld+json"> tag with 3+ Q&A pairs mirroring your visible FAQ content`,
    "sitemap": "Create a sitemap.xml at your domain root listing all pages. Submit to Google Search Console and reference it in robots.txt",
    "no-noindex": "Remove or modify the robots meta tag - change 'noindex' to 'index, follow'",
    "robots-txt": "Update robots.txt to allow Googlebot and other crawlers. Use Disallow: for only specific private paths",
    "h1-present": "Add exactly one <h1> tag per page containing the primary topic as a question or problem statement",
    "title-intent": "Rewrite the <title> tag to start with the user's question: e.g. 'How to [topic] | Brand' or 'What is [concept] - Brand'",
    "article-schema": `Add Article JSON-LD: {"@type":"Article","headline":"...","author":{"@type":"Person","name":"..."},"datePublished":"..."}`,
    "h1-question": "Rewrite your H1 to start with How, What, Why, Is, Can, Does - or end with a question mark",
    "question-subheadings": "Rewrite at least 2 H2/H3 headings as questions: 'How does X work?' 'What are the benefits of Y?'",
    "meta-problem-first": "Rewrite meta description to lead with the user's problem: 'AI agents are untrustworthy without... [solution]'",
    "faq-section": "Add a visible FAQ section in your HTML. Use <details>/<summary> or heading + paragraph pairs",
    "content-length": "Expand content to at least 300 words. Focus on depth - answer follow-up questions the user would ask",
    "entity-schema": `Add Organization JSON-LD: {"@type":"Organization","name":"...","url":"...","logo":"..."}`,
    "opengraph": "Add og:title, og:description, og:type, og:url, og:image meta tags in the <head>",
    "canonical": "Add <link rel='canonical' href='https://yourdomain.com/this-page'> in the <head>",
    "page-title": "Add a descriptive <title> tag between 10-120 characters that includes the primary keyword",
    "subheadings": "Add at least 3 H2 or H3 subheadings to structure your content into scannable sections",
    "answer-first-opening": "Rewrite your opening paragraph to answer the primary question immediately, before any introductory fluff",
    "has-internal-links": "Add links to other pages on your site. Every page should link to at least 3-5 related pages",
    "link-density": "Increase internal links to 5 or more unique pages. Add contextual links within body text, not just nav",
    "anchor-text": "Replace vague anchors ('click here', 'read more') with keyword-rich descriptive text",
    "nav-structure": "Add a semantic <nav> element for site navigation and a <footer> with site links",
    "rich-schema": "Consider adding HowTo, DefinedTerm, or Product JSON-LD schema if your page type supports it",

    // SEO fixes (new)
    "seo-https": "Migrate to HTTPS - obtain an SSL certificate (free via Let's Encrypt) and set up 301 redirects from HTTP to HTTPS",
    "seo-no-noindex": "Remove the 'noindex' meta robots tag unless this page is intentionally hidden from search engines",
    "seo-robots-health": "Create or fix your robots.txt - remove 'Disallow: /' and only block private/admin paths. Reference your sitemap",
    "seo-sitemap": "Generate a sitemap.xml at your domain root with <urlset> format listing all public pages. Submit to Google Search Console",
    "seo-viewport-mobile": "Add <meta name='viewport' content='width=device-width, initial-scale=1'> to the <head> of every page",
    "seo-title-quality": "Write a title tag between 30-60 characters that includes your primary keyword and is compelling to click",
    "seo-meta-description": "Write a meta description between 120-160 characters that summarizes the page value proposition with a call to action",
    "seo-og-completeness": "Add all 5 core Open Graph tags: og:title, og:description, og:type, og:image, og:url in the <head>",
    "seo-canonical": "Add <link rel='canonical' href='[full URL of this page]'> to prevent duplicate content issues across URL variations",
    "seo-lang-attribute": "Add a lang attribute to your <html> tag (e.g., <html lang='en'>) to declare the page language",
    "seo-single-h1": "Ensure exactly one <h1> tag per page. Move additional H1s to H2 if they are section headings",
    "seo-heading-hierarchy": "Fix heading levels to be sequential - go H1 then H2 then H3. Never skip from H1 to H3 or H2 to H4",
    "seo-h1-keyword": "Rewrite the H1 to be at least 10 characters and include your primary target keyword or topic phrase",
    "seo-heading-depth": "Add at least 2 H2 subheadings and 1 H3 to create clear content sections that search engines can index individually",
    "seo-json-ld-present": "Add at least one JSON-LD structured data block - start with Organization or Article schema as a baseline",
    "seo-faq-schema": `Add FAQPage JSON-LD with 3+ Q&A pairs: {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"...","acceptedAnswer":{"@type":"Answer","text":"..."}}]}`,
    "seo-breadcrumb-schema": `Add BreadcrumbList JSON-LD showing the page's position in your site hierarchy for rich breadcrumb display in search`,
    "seo-author-org-schema": "Add both Organization and Author/Person JSON-LD schemas to establish E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)",
    "seo-multi-schema": "Add complementary schema types - combine Article + FAQPage + Organization for maximum rich snippet opportunities",
    "seo-internal-link-count": "Add more internal links - aim for 10+ per page. Link to related content, category pages, and pillar articles",
    "seo-anchor-text-quality": "Replace generic anchor text ('click here', 'read more', 'learn more') with descriptive keyword-rich phrases",
    "seo-body-contextual-links": "Add 5+ internal links within your body content paragraphs - these carry far more SEO weight than nav links",
    "seo-unique-destinations": "Link to at least 8 different internal pages - spread authority across your site to build topical clusters",
    "seo-content-length": "Expand your content to 800+ words covering the topic comprehensively with related subtopics and examples",
    "seo-image-alt": "Add descriptive alt text to all images - describe the image content specifically, not just 'image' or 'photo'",
    "seo-structured-content": "Add structured content elements - use ordered/unordered lists, tables, <details> accordions, or <blockquote> elements",
  };
  return fixes[checkId] || "Review this element and improve it following SEO best practices";
}

// ── Recommendation builder ─────────────────────────────────────────

function buildRecommendations(dims: Record<string, DimensionResult>, limit: number): Recommendation[] {
  const recs: Recommendation[] = [];
  let priority = 1;

  const sortedDims = Object.values(dims).sort(
    (a, b) => a.percentage - b.percentage
  );

  for (const dim of sortedDims) {
    const failedChecks = dim.checks.filter((c) => !c.passed);
    if (failedChecks.length === 0) continue;

    const maxGain = failedChecks.reduce((sum, c) => sum + (c.maxPoints - c.points), 0);
    recs.push({
      priority: priority++,
      dimension: dim.name,
      title: `Improve ${dim.name} (+${maxGain} pts possible)`,
      description: `${failedChecks.length} check${failedChecks.length === 1 ? "" : "s"} failing: ${failedChecks
        .slice(0, 2)
        .map((c) => c.name)
        .join(", ")}${failedChecks.length > 2 ? ` and ${failedChecks.length - 2} more` : ""}`,
      estimatedGain: maxGain,
    });

    if (recs.length >= limit) break;
  }

  return recs;
}

// ── Main scan ──────────────────────────────────────────────────────

export async function runScan(url: string): Promise<ScanResult> {
  const startTime = Date.now();
  const id = `scan_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const [page, aux] = await Promise.all([
    fetchPage(url),
    fetchAuxiliary(url),
  ]);

  const $ = cheerio.load(page.html);

  // ── AEO dimensions (existing 5, 100 pts total) ──
  const aeoDimensions = {
    schemaCoverage: scoreSchemaCoverage($),
    contentStructure: scoreContentStructure($),
    crawlability: scoreCrawlability($, page, aux),
    copySequencing: scoreCopySequencing($),
    crossLinking: scoreCrossLinking($, page.finalUrl),
  };

  const aeoScore = Object.values(aeoDimensions).reduce(
    (sum, d) => sum + d.score, 0
  );
  const aeoMaxScore = Object.values(aeoDimensions).reduce(
    (sum, d) => sum + d.maxScore, 0
  );
  const { grade: aeoGradeLabel, color: aeoColor } = getAeoGrade(aeoScore);

  // ── SEO dimensions (new 6, 100 pts total) ──
  const seoDimensions = {
    metaHealth: scoreSeoMetaHealth($),
    headingArchitecture: scoreSeoHeadingArchitecture($),
    schemaRichness: scoreSeoSchemaRichness($),
    linkArchitecture: scoreSeoLinkArchitecture($, page.finalUrl),
    technicalFoundations: scoreSeoTechnicalFoundations($, page, aux),
    contentSignals: scoreSeoContentSignals($),
  };

  const seoScore = Object.values(seoDimensions).reduce(
    (sum, d) => sum + d.score, 0
  );
  const seoMaxScore = Object.values(seoDimensions).reduce(
    (sum, d) => sum + d.maxScore, 0
  );
  const { grade: seoGradeLabel, color: seoColor } = getSeoGrade(seoScore);

  // ── Build score blocks ──
  const aeoBlock: ScoreBlock = {
    score: aeoScore,
    maxScore: aeoMaxScore,
    percentage: Math.round((aeoScore / aeoMaxScore) * 100),
    grade: aeoGradeLabel,
    gradeColor: aeoColor,
    dimensions: aeoDimensions,
    topIssues: extractIssues(aeoDimensions, aeoSeverityMap, getAeoImpact, 5),
    recommendations: buildRecommendations(aeoDimensions, 3),
  };

  const seoBlock: ScoreBlock = {
    score: seoScore,
    maxScore: seoMaxScore,
    percentage: Math.round((seoScore / seoMaxScore) * 100),
    grade: seoGradeLabel,
    gradeColor: seoColor,
    dimensions: seoDimensions,
    topIssues: extractIssues(seoDimensions, seoSeverityMap, getSeoImpact, 5),
    recommendations: buildRecommendations(seoDimensions, 3),
  };

  const meta = {
    title: $("title").first().text().trim(),
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    canonical: $('link[rel="canonical"]').attr("href") || null,
    lang: $("html").attr("lang") || null,
  };

  const result: ScanResult = {
    id,
    url,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    // Legacy fields (backward compat - AEO values)
    overallScore: aeoScore,
    grade: aeoGradeLabel,
    gradeColor: aeoColor,
    dimensions: aeoDimensions,
    topIssues: aeoBlock.topIssues,
    recommendations: aeoBlock.recommendations,
    // Dual score blocks
    aeo: aeoBlock,
    seo: seoBlock,
    meta,
  };

  return result;
}
