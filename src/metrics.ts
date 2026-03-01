export interface RedactionMetrics {
  totalRedactions: number;
  fullRedactions: number;
  partialRedactions: number;
  redactionRatioSum: number;
  observationsProcessed: number;
  highRatioWarnings: number;
  fieldsRedacted: Map<string, number>;
  patternCounts: Map<string, number>;
}

export interface QueueMetrics {
  depth: number;
  processed: number;
  failed: number;
  retries: number;
  circuitBreakerTrips: number;
  lastProcessTime: number | null;
  avgProcessTime: number;
  rateLimitHits: number;
}

export interface TelemetrySnapshot {
  redaction: RedactionMetrics;
  queue: QueueMetrics;
  timestamp: string;
  uptimeMs: number;
}

const startTime = Date.now();

const redactionMetrics: RedactionMetrics = {
  totalRedactions: 0,
  fullRedactions: 0,
  partialRedactions: 0,
  redactionRatioSum: 0,
  observationsProcessed: 0,
  highRatioWarnings: 0,
  fieldsRedacted: new Map<string, number>(),
  patternCounts: new Map<string, number>()
};

const queueMetrics: QueueMetrics = {
  depth: 0,
  processed: 0,
  failed: 0,
  retries: 0,
  circuitBreakerTrips: 0,
  lastProcessTime: null,
  avgProcessTime: 0,
  rateLimitHits: 0
};

const processTimes: number[] = [];
const MAX_PROCESS_TIMES = 100;

export function recordRedaction(
  redactionCount: number,
  fullCount: number,
  partialCount: number,
  ratio: number,
  fields: string[],
  patterns: string[]
): void {
  redactionMetrics.totalRedactions += redactionCount;
  redactionMetrics.fullRedactions += fullCount;
  redactionMetrics.partialRedactions += partialCount;
  redactionMetrics.redactionRatioSum += ratio;
  redactionMetrics.observationsProcessed += 1;
  
  if (ratio > 0.30) {
    redactionMetrics.highRatioWarnings += 1;
  }
  
  for (const field of fields) {
    const current = redactionMetrics.fieldsRedacted.get(field) || 0;
    redactionMetrics.fieldsRedacted.set(field, current + 1);
  }
  
  for (const pattern of patterns) {
    const current = redactionMetrics.patternCounts.get(pattern) || 0;
    redactionMetrics.patternCounts.set(pattern, current + 1);
  }
}

export function recordQueueProcess(success: boolean, processTimeMs: number): void {
  if (success) {
    queueMetrics.processed += 1;
  } else {
    queueMetrics.failed += 1;
  }
  
  queueMetrics.lastProcessTime = processTimeMs;
  
  processTimes.push(processTimeMs);
  if (processTimes.length > MAX_PROCESS_TIMES) {
    processTimes.shift();
  }
  
  queueMetrics.avgProcessTime = processTimes.reduce((a, b) => a + b, 0) / processTimes.length;
}

export function recordQueueRetry(): void {
  queueMetrics.retries += 1;
}

export function recordCircuitBreakerTrip(): void {
  queueMetrics.circuitBreakerTrips += 1;
}

export function recordRateLimitHit(): void {
  queueMetrics.rateLimitHits += 1;
}

export function updateQueueDepth(depth: number): void {
  queueMetrics.depth = depth;
}

export function getQueueDepth(): number {
  return queueMetrics.depth;
}

export function isQueueDepthWarning(): boolean {
  return queueMetrics.depth > 100;
}

export function getRedactionMetrics(): RedactionMetrics {
  return {
    ...redactionMetrics,
    fieldsRedacted: new Map(redactionMetrics.fieldsRedacted),
    patternCounts: new Map(redactionMetrics.patternCounts)
  };
}

export function getQueueMetrics(): QueueMetrics {
  return { ...queueMetrics };
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    redaction: getRedactionMetrics(),
    queue: getQueueMetrics(),
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startTime
  };
}

export function getAverageRedactionRatio(): number {
  if (redactionMetrics.observationsProcessed === 0) return 0;
  return redactionMetrics.redactionRatioSum / redactionMetrics.observationsProcessed;
}

export function getTopRedactedFields(limit = 10): Array<{ field: string; count: number }> {
  const entries = Array.from(redactionMetrics.fieldsRedacted.entries());
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([field, count]) => ({ field, count }));
}

export function getTopPatterns(limit = 10): Array<{ pattern: string; count: number }> {
  const entries = Array.from(redactionMetrics.patternCounts.entries());
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pattern, count]) => ({ pattern, count }));
}

export function resetMetrics(): void {
  redactionMetrics.totalRedactions = 0;
  redactionMetrics.fullRedactions = 0;
  redactionMetrics.partialRedactions = 0;
  redactionMetrics.redactionRatioSum = 0;
  redactionMetrics.observationsProcessed = 0;
  redactionMetrics.highRatioWarnings = 0;
  redactionMetrics.fieldsRedacted.clear();
  redactionMetrics.patternCounts.clear();
  
  queueMetrics.depth = 0;
  queueMetrics.processed = 0;
  queueMetrics.failed = 0;
  queueMetrics.retries = 0;
  queueMetrics.circuitBreakerTrips = 0;
  queueMetrics.lastProcessTime = null;
  queueMetrics.avgProcessTime = 0;
  queueMetrics.rateLimitHits = 0;
  
  processTimes.length = 0;
}

export function formatTelemetryReport(): string {
  const snapshot = getTelemetrySnapshot();
  const avgRatio = getAverageRedactionRatio();
  const topFields = getTopRedactedFields(5);
  const topPatterns = getTopPatterns(5);
  
  const lines = [
    "## Telemetry Report",
    "",
    "### Redaction Metrics",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Redactions | ${snapshot.redaction.totalRedactions} |`,
    `| Full Redactions | ${snapshot.redaction.fullRedactions} |`,
    `| Partial Redactions | ${snapshot.redaction.partialRedactions} |`,
    `| Observations Processed | ${snapshot.redaction.observationsProcessed} |`,
    `| Avg Redaction Ratio | ${(avgRatio * 100).toFixed(2)}% |`,
    `| High Ratio Warnings | ${snapshot.redaction.highRatioWarnings} |`,
    "",
    "### Top Redacted Fields",
    ...topFields.map(f => `- ${f.field}: ${f.count}`),
    "",
    "### Top Patterns",
    ...topPatterns.map(p => `- ${p.pattern}: ${p.count}`),
    "",
    "### Queue Metrics",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Queue Depth | ${snapshot.queue.depth} ${snapshot.queue.depth > 100 ? "⚠️" : ""} |`,
    `| Processed | ${snapshot.queue.processed} |`,
    `| Failed | ${snapshot.queue.failed} |`,
    `| Retries | ${snapshot.queue.retries} |`,
    `| Circuit Breaker Trips | ${snapshot.queue.circuitBreakerTrips} |`,
    `| Rate Limit Hits | ${snapshot.queue.rateLimitHits} |`,
    `| Avg Process Time | ${snapshot.queue.avgProcessTime.toFixed(0)}ms |`,
    "",
    `Uptime: ${(snapshot.uptimeMs / 1000 / 60).toFixed(1)} minutes`
  ];
  
  return lines.join("\n");
}
