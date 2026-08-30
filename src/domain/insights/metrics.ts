import { InsightConfidence, InsightMetric, InsightSource } from './types';

/**
 * Determines the truthful source badge for insights given current environment.
 */
export function getInsightSource(os?: string): InsightSource {
  if (os === 'android') return 'android-observed';
  if (os === 'ios') return 'ios-device-activity';
  return 'local-engine';
}

/**
 * Wraps a calculated value into a typed InsightMetric with source and confidence.
 */
export function createInsightMetric<T>(
  value: T,
  confidence: InsightConfidence = 'exact',
  os?: string
): InsightMetric<T> {
  return {
    value,
    source: getInsightSource(os),
    confidence,
  };
}

/**
 * Formats minutes into human-readable duration strings (e.g. "1h 45m" or "45m").
 */
export function formatMinutesToHumanReadable(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}
