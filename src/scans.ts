import type { DB } from './db.js';

export interface ScanEvent {
  linkId: number;
  scannedAt: number;
  country: string | null;
  device: string;
}

/**
 * Buffers scan events in memory and writes them to SQLite in one transaction
 * right after the redirect response has been handed off, so logging never
 * delays the redirect itself.
 */
export class ScanLogger {
  private queue: ScanEvent[] = [];
  private scheduled = false;
  private readonly insertScan;
  private readonly bumpCount;

  constructor(private readonly db: DB) {
    this.insertScan = db.prepare(
      'INSERT INTO scans (link_id, scanned_at, country, device) VALUES (@linkId, @scannedAt, @country, @device)',
    );
    this.bumpCount = db.prepare('UPDATE links SET scan_count = scan_count + 1 WHERE id = ?');
  }

  record(event: ScanEvent): void {
    this.queue.push(event);
    if (!this.scheduled) {
      this.scheduled = true;
      setImmediate(() => this.flush());
    }
  }

  /** Writes all queued scans. Safe to call at any time (e.g. on shutdown or in tests). */
  flush(): void {
    this.scheduled = false;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      this.db.transaction((events: ScanEvent[]) => {
        for (const e of events) {
          // The link may have been deleted between the redirect and this write.
          if (this.bumpCount.run(e.linkId).changes > 0) this.insertScan.run(e);
        }
      })(batch);
    } catch (err) {
      console.error('Failed to write scan log:', err);
    }
  }
}
