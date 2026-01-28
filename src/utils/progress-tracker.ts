export class ProgressTracker {
  private total: number;
  private completed: number;
  private failed: number;
  private startTime: number;
  private currentProduct: string;

  constructor(total: number) {
    this.total = total;
    this.completed = 0;
    this.failed = 0;
    this.startTime = Date.now();
    this.currentProduct = '';
  }

  start(productCode: string) {
    this.currentProduct = productCode;
    this.display();
  }

  complete(success: boolean) {
    if (success) {
      this.completed++;
    } else {
      this.failed++;
    }
    this.display();
  }

  private display() {
    const processed = this.completed + this.failed;
    const percentage = Math.round((processed / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const avgTime = processed > 0 ? elapsed / processed : 0;
    const remaining = this.total - processed;
    const eta = remaining > 0 ? Math.round((avgTime * remaining) / 1000) : 0;

    const bar = this.createProgressBar(percentage);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Progress: ${bar} ${percentage}%`);
    console.log(`Status: ${processed}/${this.total} | Success: ${this.completed} | Failed: ${this.failed}`);
    console.log(`Current: ${this.currentProduct}`);
    console.log(`Elapsed: ${this.formatTime(elapsed)} | ETA: ${eta}s`);
    console.log(`${'='.repeat(70)}`);
  }

  private createProgressBar(percentage: number): string {
    const width = 30;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getSummary() {
    const elapsed = Date.now() - this.startTime;
    return {
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      successRate: this.total > 0 ? (this.completed / this.total) * 100 : 0,
      elapsedMs: elapsed,
    };
  }
}
