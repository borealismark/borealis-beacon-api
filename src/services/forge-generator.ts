/**
 * Borealis Forge - Schema Generator
 *
 * Generates valid, copy-pasteable JSON-LD schema markup tailored to
 * the specific page and issue type detected during the scan.
 *
 * MVP scope: Article JSON-LD (the highest-ROI schema for AEO).
 * Future: FAQPage, HowTo, BreadcrumbList, Organization.
 */

export interface ForgeInput {
  scannedUrl: string;
  pageTitle: string | null;
  pageDescription: string | null;
  issueTitle: string;
  issueDimension: string;
}

export interface ForgeOutput {
  schemaType: string;
  json: string;
  instructions: string;
  estimatedScoreGain: number;
}

export function generateForgeSchema(input: ForgeInput): ForgeOutput {
  const { scannedUrl, pageTitle, pageDescription, issueDimension } = input;

  // Determine best schema type based on dimension
  if (issueDimension === 'schema-coverage') {
    return generateArticleSchema(input);
  }
  if (issueDimension === 'content-structure') {
    return generateFAQSchema(input);
  }
  // Default to Article for all other dimensions
  return generateArticleSchema(input);
}

function generateArticleSchema(input: ForgeInput): ForgeOutput {
  const { scannedUrl, pageTitle, pageDescription } = input;

  const baseUrl = extractBaseUrl(scannedUrl);
  const orgName = extractOrgName(scannedUrl);
  const today = new Date().toISOString().split('T')[0];
  const cleanTitle = pageTitle ?? 'Add your page headline here';
  const cleanDesc = pageDescription ?? 'Add a concise description of this page (160 chars max).';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: cleanTitle,
    description: cleanDesc,
    url: scannedUrl,
    datePublished: today,
    dateModified: today,
    author: {
      '@type': 'Organization',
      name: orgName,
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: orgName,
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/logo.png`,
        width: 200,
        height: 60,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': scannedUrl,
    },
  };

  return {
    schemaType: 'Article',
    json: JSON.stringify(schema, null, 2),
    instructions: [
      '1. Copy the JSON-LD block above.',
      '2. Add it inside a <script type="application/ld+json"> tag in the <head> of your page.',
      '3. Update "logo.png" to your actual logo URL.',
      '4. Update "datePublished" to the actual date this article was first published.',
      '5. If your CMS generates dates, use the real publication date, not today.',
      '6. Validate with Google\'s Rich Results Test before deploying.',
    ].join('\n'),
    estimatedScoreGain: 8,
  };
}

function generateFAQSchema(input: ForgeInput): ForgeOutput {
  const { scannedUrl, pageTitle } = input;
  const topic = pageTitle ? pageTitle.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 60) : 'your topic';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `What is ${topic} and why does it matter?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Add your answer here. AI models search for direct, factual answers to questions. Keep this under 300 words, start with the direct answer, then expand with context.',
        },
      },
      {
        '@type': 'Question',
        name: `How does ${topic} work?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Add your step-by-step explanation here. Use numbered steps or a clear process description. AI models cite structured, sequential explanations.',
        },
      },
      {
        '@type': 'Question',
        name: `What are the benefits of ${topic}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Add 3-5 concrete benefits here. Be specific. Vague benefits like "saves time" are ignored by AI models. Quantify where possible.',
        },
      },
    ],
  };

  return {
    schemaType: 'FAQPage',
    json: JSON.stringify(schema, null, 2),
    instructions: [
      '1. Copy the JSON-LD block above.',
      '2. Add it inside a <script type="application/ld+json"> tag in the <head> of your page.',
      '3. Replace the template question names with your ACTUAL page questions.',
      '4. The answer text MUST match the visible content on your page (Google requires this).',
      '5. Add at least 3 Q&A pairs - more is better, up to about 10.',
      '6. Validate with Google\'s Rich Results Test before deploying.',
    ].join('\n'),
    estimatedScoreGain: 6,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return url;
  }
}

function extractOrgName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const parts = hostname.split('.');
    const domain = parts[0] ?? hostname;
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return 'Your Organization';
  }
}
