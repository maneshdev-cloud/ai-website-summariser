import type { Extraction, LengthMode, SummariseResponse, Summary } from './api';

export function summaryToMarkdown(
  extraction: Extraction,
  result: SummariseResponse,
): string {
  const { summary } = result;
  const lines: string[] = [
    `# ${extraction.title}`,
    '',
    extraction.url ? `Source: ${extraction.url}` : 'Source: pasted text',
    extraction.siteName ? `Site: ${extraction.siteName}` : '',
    `Original: ${extraction.wordCount.toLocaleString()} words · ~${extraction.readingTimeMinutes} min read`,
    `Summary mode: ${result.mode} · Engine: ${result.engine}`,
    '',
    '## TL;DR',
    '',
    summary.tldr,
    '',
    '## Key points',
    '',
    ...summary.keyPoints.map((point) => `- ${point}`),
    '',
    '## Summary',
    '',
    summary.detailedSummary,
    '',
  ];
  if (summary.topics.length) {
    lines.push(`Topics: ${summary.topics.join(', ')} · Tone: ${summary.tone}`, '');
  }
  lines.push('---', 'Generated with AI Website Summariser');
  return lines.filter((line, i) => line !== '' || lines[i - 1] !== '').join('\n');
}

export function summaryToPlainText(summary: Summary): string {
  return [
    `TL;DR: ${summary.tldr}`,
    '',
    'Key points:',
    ...summary.keyPoints.map((point, i) => `${i + 1}. ${point}`),
    '',
    summary.detailedSummary,
  ].join('\n');
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function fileNameFor(extraction: Extraction, mode: LengthMode): string {
  const slug = extraction.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'summary'}-${mode}-summary.md`;
}
