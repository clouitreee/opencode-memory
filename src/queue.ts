import { recordQueueProcess, recordQueueRetry, recordCircuitBreakerTrip, recordRateLimitHit, updateQueueDepth, getQueueDepth, isQueueDepthWarning } from "./metrics";

export interface QueueJob<T = unknown> {
  id: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface QueueConfig {
  maxConcurrent: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrent: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitterFactor: 0.3,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 5 * 60 * 1000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 60
};

interface RateLimitState {
  requests: number[];
  currentRate: number;
  adaptiveMultiplier: number;
}

export class ProcessingQueue<T = unknown> {
  private queue: QueueJob<T>[] = [];
  private processing: Set<string> = new Set();
  private consecutiveFailures = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerOpenAt: number | null = null;
  private config: QueueConfig;
  private rateLimitState: RateLimitState;
  private processor: (job: QueueJob<T>) => Promise<void>;
  private jobIdCounter = 0;
  
  constructor(
    processor: (job: QueueJob<T>) => Promise<void>,
    config?: Partial<QueueConfig>
  ) {
    this.processor = processor;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimitState = {
      requests: [],
      currentRate: 1.0,
      adaptiveMultiplier: 1.0
    };
  }
  
  enqueue(data: T, maxAttempts = 3): string {
    const id = `job-${++this.jobIdCounter}-${Date.now()}`;
    
    const job: QueueJob<T> = {
      id,
      data,
      attempts: 0,
      maxAttempts,
      createdAt: Date.now(),
      lastAttemptAt: null,
      lastError: null,
      status: "pending"
    };
    
    this.queue.push(job);
    updateQueueDepth(this.queue.length);
    
    if (isQueueDepthWarning()) {
      console.warn(`[opencode-memory] Queue depth warning: ${this.queue.length} jobs`);
    }
    
    this.tryProcess();
    
    return id;
  }
  
  private async tryProcess(): Promise<void> {
    if (this.circuitBreakerOpen) {
      if (Date.now() - (this.circuitBreakerOpenAt || 0) > this.config.circuitBreakerResetMs) {
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenAt = null;
        this.consecutiveFailures = 0;
        console.log("[opencode-memory] Circuit breaker reset");
      } else {
        return;
      }
    }
    
    if (this.processing.size >= this.config.maxConcurrent) {
      return;
    }
    
    const job = this.queue.find(j => j.status === "pending");
    if (!job) return;
    
    if (!this.checkRateLimit()) {
      return;
    }
    
    job.status = "processing";
    this.processing.add(job.id);
    
    const startTime = Date.now();
    
    try {
      await this.processor(job);
      job.status = "completed";
      this.consecutiveFailures = 0;
      this.increaseRate();
      recordQueueProcess(true, Date.now() - startTime);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      job.lastError = errorMsg;
      job.attempts++;
      job.lastAttemptAt = Date.now();
      
      if (this.shouldRetry(error, job)) {
        job.status = "pending";
        recordQueueRetry();
        const delay = this.calculateBackoff(job.attempts);
        setTimeout(() => this.tryProcess(), delay);
      } else {
        job.status = "failed";
        recordQueueProcess(false, Date.now() - startTime);
      }
      
      this.consecutiveFailures++;
      this.decreaseRate();
      
      if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        this.tripCircuitBreaker();
      }
    } finally {
      this.processing.delete(job.id);
      
      if (job.status === "completed" || job.status === "failed") {
        this.queue = this.queue.filter(j => j.id !== job.id);
        updateQueueDepth(this.queue.length);
      }
      
      this.tryProcess();
    }
  }
  
  private shouldRetry(error: unknown, job: QueueJob<T>): boolean {
    if (job.attempts >= job.maxAttempts) return false;
    
    const errorMsg = error instanceof Error ? error.message : String(error);
    const statusMatch = errorMsg.match(/status[:\s]*(\d{3})/i);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : null;
    
    if (status === 401 || status === 403) {
      return false;
    }
    
    if (status === 429 || (status && status >= 500)) {
      return true;
    }
    
    if (errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("too many")) {
      return true;
    }
    
    return true;
  }
  
  private calculateBackoff(attempt: number): number {
    const baseDelay = this.config.baseDelayMs * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(baseDelay, this.config.maxDelayMs);
    
    const jitter = cappedDelay * this.config.jitterFactor * Math.random();
    
    const adjustedDelay = cappedDelay + jitter;
    
    return adjustedDelay * this.rateLimitState.adaptiveMultiplier;
  }
  
  private checkRateLimit(): boolean {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindowMs;
    
    this.rateLimitState.requests = this.rateLimitState.requests.filter(t => t > windowStart);
    
    if (this.rateLimitState.requests.length >= this.config.rateLimitMaxRequests * this.rateLimitState.currentRate) {
      recordRateLimitHit();
      return false;
    }
    
    this.rateLimitState.requests.push(now);
    return true;
  }
  
  private increaseRate(): void {
    this.rateLimitState.currentRate = Math.min(1.0, this.rateLimitState.currentRate + 0.1);
    this.rateLimitState.adaptiveMultiplier = Math.max(1.0, this.rateLimitState.adaptiveMultiplier - 0.1);
  }
  
  private decreaseRate(): void {
    this.rateLimitState.currentRate = Math.max(0.2, this.rateLimitState.currentRate * 0.5);
    this.rateLimitState.adaptiveMultiplier = Math.min(3.0, this.rateLimitState.adaptiveMultiplier + 0.5);
  }
  
  private tripCircuitBreaker(): void {
    this.circuitBreakerOpen = true;
    this.circuitBreakerOpenAt = Date.now();
    recordCircuitBreakerTrip();
    console.warn(
      `[opencode-memory] Circuit breaker tripped. Pausing for ${this.config.circuitBreakerResetMs / 1000}s`
    );
  }
  
  getStats(): {
    queueLength: number;
    processing: number;
    circuitBreakerOpen: boolean;
    consecutiveFailures: number;
    currentRate: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing.size,
      circuitBreakerOpen: this.circuitBreakerOpen,
      consecutiveFailures: this.consecutiveFailures,
      currentRate: this.rateLimitState.currentRate
    };
  }
  
  isHealthy(): boolean {
    return !this.circuitBreakerOpen && this.consecutiveFailures < this.config.circuitBreakerThreshold;
  }
}

export function createCompressionQueue(
  processor: (job: QueueJob<{ observationId: number; toolName: string; toolInput: string; toolOutput: string }>) => Promise<void>
): ProcessingQueue<{ observationId: number; toolName: string; toolInput: string; toolOutput: string }> {
  return new ProcessingQueue(processor, {
    maxConcurrent: 2,
    baseDelayMs: 2000,
    maxDelayMs: 120000,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 300000,
    rateLimitMaxRequests: 30
  });
}
