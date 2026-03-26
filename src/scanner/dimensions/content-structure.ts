import * as cheerio from "cheerio";
import { DimensionResult, Check } from "../../types";

const QUESTION_WORDS = /^(how|what|why|is|can|does|should|which|when|where|who|will|are|has|have|do|was|were|would|could|might|shall)\b/i;

function isQuestionFormat(text: string): boolean {
  const trimmed = text.trim();
  return QUESTION_WORDS.test(trimmed) || trimmed.endsWith("?");
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

export function scoreContentStructure($: cheerio.CheerioAPI): DimensionResult {
  const checks: Check[] = [];

  // --- Check 1: H1 present (3 pts) ---
  const h1Elements = $("h1");
  const h1Count = h1Elements.length;
  const h1Text = h1Elements.first().text().trim();
  checks.push({
    id: "h1-present",
    name: "H1 heading present",
    passed: h1Count > 0,
    points: h1Count > 0 ? 3 : 0,
    maxPoints: 3,
    detail:
      h1Count > 0
        ? `H1 found: "${h1Text.slice(0, 80)}${h1Text.length > 80 ? "..." : ""}"`
        : "No H1 heading found - every page needs exactly one H1 as the primary topic signal",
  });

  // --- Check 2: H1 is question-format or problem-first (4 pts) ---
  const h1IsQuestion = h1Count > 0 && isQuestionFormat(h1Text);
  checks.push({
    id: "h1-question",
    name: "H1 is question-format or problem-first",
    passed: h1IsQuestion,
    points: h1IsQuestion ? 4 : 0,
    maxPoints: 4,
    detail: h1IsQuestion
      ? `H1 starts with a question/problem framing - ideal for AI answer extraction`
      : h1Count > 0
      ? `H1 "${h1Text.slice(0, 60)}" doesn't lead with a question - try starting with How/What/Why/Is`
      : "No H1 to evaluate",
  });

  // --- Check 3: Multiple H2/H3 subheadings (3 pts) ---
  const subheadings = $("h2, h3");
  const subCount = subheadings.length;
  checks.push({
    id: "subheadings",
    name: "3 or more H2/H3 subheadings",
    passed: subCount >= 3,
    partial: subCount > 0 && subCount < 3,
    points: subCount >= 3 ? 3 : subCount > 0 ? 1 : 0,
    maxPoints: 3,
    detail:
      subCount >= 3
        ? `${subCount} H2/H3 subheadings found - good content hierarchy`
        : subCount > 0
        ? `Only ${subCount} H2/H3 found - add more subheadings to structure content for extraction`
        : "No H2/H3 subheadings - structured headings help AI models parse content topics",
  });

  // --- Check 4: At least 2 question-format H2/H3s (6 pts) ---
  const subTexts: string[] = [];
  subheadings.each((_i, el) => {
    subTexts.push($(el).text().trim());
  });
  const questionSubheadings = subTexts.filter(isQuestionFormat);
  const hasEnoughQSubs = questionSubheadings.length >= 2;
  checks.push({
    id: "question-subheadings",
    name: "2+ question-format H2/H3 headings",
    passed: hasEnoughQSubs,
    partial: questionSubheadings.length === 1,
    points: hasEnoughQSubs ? 6 : questionSubheadings.length === 1 ? 3 : 0,
    maxPoints: 6,
    detail: hasEnoughQSubs
      ? `${questionSubheadings.length} question-format subheadings found`
      : questionSubheadings.length === 1
      ? `Only 1 question-format subheading - add one more (e.g. "How does X work?")`
      : subCount > 0
      ? `None of the ${subCount} subheadings use question format - rewrite as "How...", "What...", "Why..."`
      : "No subheadings to evaluate",
  });

  // --- Check 5: Visible FAQ section (5 pts) ---
  // Look for FAQ heading OR <details>/<dl> pattern OR FAQ in class/id
  const faqHeading = $("h2, h3, h4").filter((_i, el) =>
    /faq|frequently asked|questions/i.test($(el).text())
  ).length > 0;
  const faqElement =
    $('[class*="faq"], [id*="faq"], [class*="accordion"], [class*="questions"]').length > 0;
  const hasFaqSection = faqHeading || faqElement;
  checks.push({
    id: "faq-section",
    name: "Visible FAQ section in content",
    passed: hasFaqSection,
    points: hasFaqSection ? 5 : 0,
    maxPoints: 5,
    detail: hasFaqSection
      ? "FAQ section found in HTML structure"
      : "No visible FAQ section - add a FAQ with 3+ Q&A pairs (mirrors FAQPage schema for double reinforcement)",
  });

  // --- Check 6: Sufficient content length (4 pts) ---
  // Count text from body, excluding nav/header/footer/scripts
  $("script, style, nav, header, footer, noscript").remove();
  const bodyText = $("body").text();
  const wordCount = countWords(bodyText);
  checks.push({
    id: "content-length",
    name: "Sufficient content (300+ words)",
    passed: wordCount >= 300,
    partial: wordCount >= 100 && wordCount < 300,
    points: wordCount >= 300 ? 4 : wordCount >= 100 ? 2 : 0,
    maxPoints: 4,
    detail:
      wordCount >= 300
        ? `~${wordCount} words detected - sufficient content for AI extraction`
        : wordCount >= 100
        ? `~${wordCount} words - below 300-word threshold; thin content is harder to cite`
        : `~${wordCount} words - very thin content, AI models need substance to cite`,
  });

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    id: "content-structure",
    name: "Content Structure",
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    checks,
  };
}
