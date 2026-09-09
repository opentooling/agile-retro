/**
 * Sentiment of a board column.
 *
 * Column types carry their sentiment as a suffix (see retro-templates.ts), with
 * the three original types mapped by name. This is the single definition:
 * `columnAccent` in RetroBoard colours by it, and analytics buckets by it, so
 * the two cannot disagree about whether a column is positive or negative.
 */
export type Sentiment = 'positive' | 'negative' | 'improve' | 'risk' | 'neutral';

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: 'Positive',
  negative: 'Negative',
  improve: 'To improve',
  risk: 'Risks',
  neutral: 'Neutral',
};

export function columnSentiment(type: string): Sentiment {
  switch (type) {
    case 'START':
    case 'WHAT_WENT_WELL':
      return 'positive';
    case 'STOP':
    case 'WHAT_DIDNT_GO_WELL':
      return 'negative';
    case 'CONTINUE':
    case 'WHAT_SHOULD_BE_IMPROVED':
      return 'improve';
  }
  if (type.endsWith('_POSITIVE')) return 'positive';
  if (type.endsWith('_NEGATIVE')) return 'negative';
  if (type.endsWith('_IMPROVE')) return 'improve';
  if (type.endsWith('_RISK')) return 'risk';
  return 'neutral';
}
