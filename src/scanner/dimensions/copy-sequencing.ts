import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

const QUESTION_STARTERS = /^(how|what|why|is|can|does|should|which|when|where|who|will|are|has|have|do|was|were|would|could|might|your|you|if your|every|most|many)\b/i;
const PROBLEM_INDICATORS = /\b(problem|challenge|issue|struggle|difficulty|hard to|fail|broken|risk|danger|mistake|wrong|miss|lack|without|need|want|trying|looking for|invisible|ignored|overlooked|missing|losing|lost|stuck|confused|uncertain|unclear|expensive|slow|unreliable|untrusted|not ready|falling behind|left out|skip|skipped|choose|choosing|cited|cite)\b/i;
const BRAND_FIRST_PATTERN = /^[A-Z][a-zA-Z\s]+(is|are|was|were|offers|provides|delivers|helps|builds|creates|makes)\b/;

function isUserIntentFirst(text: string): boolean {
  const trimmed = text.trim();
  return QUESTION_STARTERS.test(trimmed) || PROBLEM_INDICATORS.test(trimmed);
}

function isProblemFirstMeta(meta: string): boolean {
  if (!meta) return false;
  // Fail if meta starts with what looks like a brand/product name (capitalized noun phrase + verb)
  if (BRAND_FIRST_PATTERN.test(meta.trim())) return false;
  return QUESTION_STARTERS.test(meta.trim()) || PROBLEM_INDICATORS.test(meta.trim());
}

function getFirstSubstantialParagraph($: cheerio.CheerioAPI): string {
  let result = "";
  // Look in main content areas first
  const selectors = ["main p", "article p", ".content p", "#content p", "body p"];
  for (const sel of selectors) {
    $(sel).each((_i, el) => {
      const text = $(el).text().trim();
      if (text.length > 80 && !result) {
        result = text;
      }
    });
    if (result) break;
  }
  // Fallback to any paragraph
  if (!result) {
    $("p").each((_i, el) => {
      const text = $(el).text().trim();
      if (text.length > 80 && !result) {
        result = text;
      }
    });
  }
  return result;
}

export function scoreCopySequencing($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // --- Check 1: Title leads with user intent (5 pts) ---
  const title = $("title").first().text().trim();
  const titleIntentFirst = title.length > 0 && isUserIntentFirst(title);
  checks.push({
    id: "title-intent",
    name: "Title leads with user intent or question",
    passed: titleIntentFirst,
    points: titleIntentFirst ? 5 : 0,
    maxPoints: 5,
    detail: titleIntentFirst
      ? `Title opens with user intent framing`
      : title.length > 0
      ? `Title "${title.slice(0, 60)}" starts with brand/product name - reframe to lead with the user's question or problem. e.g. "How to [X] | Brand"`
      : "No title tag to evaluate",
  });

  // --- Check 2: Meta description is problem-first (5 pts) ---
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  const metaProblemFirst = isProblemFirstMeta(metaDesc);
  checks.push({
    id: "meta-problem-first",
    name: "Meta description is problem-first",
    passed: metaProblemFirst,
    partial: metaDesc.length > 0 && !metaProblemFirst,
    points: metaProblemFirst ? 5 : metaDesc.length > 0 ? 2 : 0,
    maxPoints: 5,
    detail: metaProblemFirst
      ? "Meta description opens with the user's problem or question"
      : metaDesc.length > 0
      ? `Meta description starts with "${metaDesc.slice(0, 60)}" - lead with the problem the user faces, not your brand name`
      : "No meta description found - add one that leads with the user's problem",
  });

  // --- Check 3: First paragraph is answer-first / problem-oriented (5 pts) ---
  const firstPara = getFirstSubstantialParagraph($);
  const paraAnswerFirst = firstPara.length > 0 && isUserIntentFirst(firstPara);
  checks.push({
    id: "answer-first-opening",
    name: "Opening paragraph is answer-first",
    passed: paraAnswerFirst,
    partial: firstPara.length > 0 && !paraAnswerFirst,
    points: paraAnswerFirst ? 5 : firstPara.length > 0 ? 2 : 0,
    maxPoints: 5,
    detail: paraAnswerFirst
      ? "Opening paragraph leads with the problem or answer - ideal featured snippet structure"
      : firstPara.length > 0
      ? `Opening paragraph begins: "${firstPara.slice(0, 80)}..." - restructure to answer the user's question immediately`
      : "No substantial paragraph found to evaluate",
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "copy-sequencing",
    name: "Copy Sequencing",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
