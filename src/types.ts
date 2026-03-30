export interface ScanRequest {
  url: string;
}

export interface Check {
  id: string;
  name: string;
  passed: boolean;
  partial?: boolean;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface DimensionResult {
  id: string;
  name: string;
  score: number;
  maxScore: number;
  percentage: number;
  checks: Check[];
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export interface Issue {
  severity: IssueSeverity;
  dimension: string;
  title: string;
  description: string;
  fix: string;
  aeoImpact: string;
}

export interface Recommendation {
  priority: number;
  title: string;
  description: string;
  dimension: string;
  estimatedGain: number;
}

export type AeoGrade =
  | "Strong AEO Authority"
  | "Functional Baseline"
  | "Visible Gaps"
  | "Pre-AEO";

export type SeoGrade =
  | "SEO Powerhouse"
  | "Well Optimized"
  | "Needs Work"
  | "SEO Critical";

// Keep backward compat alias
export type ScoreGrade = AeoGrade;

export interface ScoreBlock {
  score: number;
  maxScore: number;
  percentage: number;
  grade: string;
  gradeColor: string;
  dimensions: Record<string, DimensionResult>;
  topIssues: Issue[];
  recommendations: Recommendation[];
}

export interface ScanResult {
  id: string;
  url: string;
  scannedAt: string;
  durationMs: number;
  // Legacy fields (AEO - backward compatible)
  overallScore: number;
  grade: AeoGrade;
  gradeColor: string;
  dimensions: {
    schemaCoverage: DimensionResult;
    contentStructure: DimensionResult;
    crawlability: DimensionResult;
    copySequencing: DimensionResult;
    crossLinking: DimensionResult;
  };
  topIssues: Issue[];
  recommendations: Recommendation[];
  // Dual score blocks
  aeo: ScoreBlock;
  seo: ScoreBlock;
  meta: {
    title: string;
    description: string;
    canonical: string | null;
    lang: string | null;
  };
}

export interface FetchedPage {
  html: string;
  url: string;
  finalUrl: string;
  statusCode: number;
  fetchTimeMs: number;
  contentLength: number;
}

export interface AuxiliaryFetches {
  sitemapXml: string | null;
  robotsTxt: string | null;
}
