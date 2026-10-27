/**
 * Exponential moving average for noisy per-frame measurements (FR-05 "smooth noisy measurements").
 * alpha ∈ (0,1]: higher = more responsive, lower = smoother. A gap (null) resets nothing but
 * is skipped, so a single dropped frame doesn't drag the value toward zero.
 */
export class Ema {
  private value: number | null = null;

  constructor(private readonly alpha: number) {
    if (alpha <= 0 || alpha > 1) throw new RangeError("alpha must be in (0, 1]");
  }

  push(sample: number | null): number | null {
    if (sample === null || Number.isNaN(sample)) return this.value;
    this.value = this.value === null ? sample : this.alpha * sample + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }

  get current(): number | null {
    return this.value;
  }
}
