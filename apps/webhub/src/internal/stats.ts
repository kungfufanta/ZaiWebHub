// apps/webhub — internal/stats.ts (3.6-H)
// HubStats: bộ đếm THUẦN QUAN SÁT (pure observation) cho endpoint GET /internal/workers.
// KHÔNG đổi hành vi registry/dispatch — chỉ được feed từ các hook đã tồn tại trong index.ts
// (onWorkerRegistered / onWorkerRemoved / onAck). Không có effect phụ nào khác.
//
// Ý nghĩa số liệu:
// - connected_at   : mốc connection HIỆN TẠI của worker (re-register → cập nhật theo lần mới nhất)
// - total_jobs     : số job KHÁC NHAU worker đã nhận (đếm theo job.ack đầu tiên của mỗi job_id;
//                    dedupe toàn hub nên job re-dispatch sang worker khác không bị đếm trùng)
// - total_jobs_all_time : tổng số job duy nhất đã tới tay worker (mọi worker cộng lại, dedupe)
// - worker offline : giữ lại OFFLINE_TTL_MS sau khi mất kết nối để Hub UI hiển thị badge
//                    "offline", hết TTL thì tự rơi khỏi danh sách.
import type { WorkerEntry } from '../hub/ws.js';

export interface WorkerStatRecord {
  worker_id: string;
  status: 'online' | 'offline';
  connected_at: number;
  last_heartbeat: number;
  inflight: number;
  total_jobs: number;
  capabilities: WorkerEntry['capabilities'];
}

export const OFFLINE_TTL_MS = 15 * 60_000;
// chặn tăng trưởng vô hạn của Set dedupe — vượt ngưỡng thì reset (chấp nhận lệch nhẹ, dev-only)
const MAX_ACKED_JOBS = 100_000;

export class HubStats {
  private workers = new Map<string, WorkerStatRecord>();
  private ackedJobs = new Set<string>();
  private totalJobsAllTime = 0;

  // gọi từ hook onWorkerRegistered — re-register (worker restart) → giữ nguyên lifetime counter
  noteWorkerRegistered(entry: WorkerEntry): void {
    const previous = this.workers.get(entry.worker_id);
    this.workers.set(entry.worker_id, {
      worker_id: entry.worker_id,
      status: 'online',
      connected_at: Date.now(),
      last_heartbeat: entry.last_heartbeat,
      inflight: entry.inflight,
      total_jobs: previous?.total_jobs ?? 0,
      capabilities: { ...entry.capabilities },
    });
  }

  // gọi từ hook onWorkerRemoved — giữ bản ghi để UI hiển thị badge offline (hết TTL → prune)
  noteWorkerRemoved(entry: WorkerEntry): void {
    const previous = this.workers.get(entry.worker_id);
    if (!previous) {
      this.workers.set(entry.worker_id, {
        worker_id: entry.worker_id,
        status: 'offline',
        connected_at: entry.last_heartbeat,
        last_heartbeat: entry.last_heartbeat,
        inflight: entry.inflight,
        total_jobs: 0,
        capabilities: { ...entry.capabilities },
      });
      return;
    }
    previous.status = 'offline';
    previous.last_heartbeat = entry.last_heartbeat;
    previous.inflight = entry.inflight;
    previous.capabilities = { ...entry.capabilities };
  }

  // gọi từ hook onAck — đếm mỗi job_id DUY NHẤT đúng 1 lần toàn hub
  noteJobAck(workerId: string, jobId: string): void {
    if (this.ackedJobs.size >= MAX_ACKED_JOBS) this.ackedJobs.clear();
    if (this.ackedJobs.has(jobId)) return;
    this.ackedJobs.add(jobId);
    this.totalJobsAllTime += 1;
    const rec = this.workers.get(workerId);
    if (rec) rec.total_jobs += 1;
  }

  // danh sách bản ghi thô (endpoint tự merge số liệu live từ registry trước khi trả)
  currentList(): WorkerStatRecord[] {
    return [...this.workers.values()];
  }

  // dọn bản ghi offline đã quá TTL (gọi từ handler khi build response)
  pruneOffline(now: number): void {
    for (const [id, rec] of this.workers) {
      if (rec.status === 'offline' && now - rec.last_heartbeat > OFFLINE_TTL_MS) {
        this.workers.delete(id);
      }
    }
  }

  get totalJobsAll(): number {
    return this.totalJobsAllTime;
  }
}
