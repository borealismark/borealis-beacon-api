import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import {
  ScanResult,
  ScoreGrade,
  Issue,
  Recommendation,
} from "../types";
import { fetchPage, fetchAuxiliary } from "../utils/html-fetcher";
import { scoreSchemaCoverage } from "./dimensions/schema-coverage";
import { scoreContentStructure } from "./dimensions/content-structure";
import { scoreCrawlability } from "./dimensions/crawlability";
import { scoreCopySequencing } from "./dimensions/copy-sequencing";
import { scoreCrossLinking } from "./dimensions/cross-linking";

function getGrade(score: number): { grade: ScoreGrade; color: string } {
  if (score >= 85) return { grade: "Strong AEO Authority", color: "#10b981" };
  if (score >= 70) return { grade: "Functional Baseline", color: "#00e5ff" };
  if (score >= 50) return { grade: "Visible Gaps", color: "#f59e0b" };
  return { grade: "Pre-AEO", color: "#ef4444" };
}

function extractTopIssues(result: ScanResult): Issue[] {
  const issues: Issue[] = [];

  const severityMap: Record<string, "critical" | "high" | "medium" | "low"> = {
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

  const allDimensions = Object.values(result.dimensions);
  for (const dim of allDimensions) {
    for (const check of dim.checks) {
      if (!check.passed) {
        issues.push({
          severity: severityMap[check.id] || "medium",
          dimension: dim.name,
          title: check.name,
          description: check.detail,
          fix: getFix(check.id),
          aeoImpact: getAeoImpact(check.id),
        });
      }
    }
  }

  // Sort by severity
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return issues.slice(0, 5);
}

function getFix(checkId: string): string {
  const fixes: Record<string, string> = {
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
  };
  return fixes[checkId] || "Review this element and improve it following AEO best practices";
}

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

function buildRecommendations(result: ScanResult): Recommendation[] {
  const recs: Recommendation[] = [];
  const allDimensions = Object.values(result.dimensions);
  let priority = 1;

  // Prioritize by dimension score (lowest score = highest priority)
  const sortedDims = [...allDimensions].sort(
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

    if (recs.length >= 3) break;
  }

  return recs;
}

export async function runScan(url: string): Promise<ScanResult> {
  const startTime = Date.now();
  const id = `scan_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const [page, aux] = await Promise.all([
    fetchPage(url),
    fetchAuxiliary(url),
  ]);

  const $ = cheerio.load(page.html);

  const dimensions = {
    schemaCoverage: scoreSchemaCoverage($),
    contentStructure: scoreContentStructure($),
    crawlability: scoreCrawlability($, page, aux),
    copySequencing: scoreCopySequencing($),
    crossLinking: scoreCrossLinking($, page.finalUrl),
  };

  const overallScore = Object.values(dimensions).reduce(
    (sum, d) => sum + d.score,
    0
  );

  const { grade, color: gradeColor } = getGrade(overallScore);

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
    overallScore,
    grade,
    gradeColor,
    dimensions,
    topIssues: [],
    recommendations: [],
    meta,
  };

  result.topIssues = extractTopIssues(result);
  result.recommendations = buildRecommendations(result);

  return result;
}
