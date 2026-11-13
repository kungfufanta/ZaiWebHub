// apps/webhub — internal/workers.ts (3.6-H)
// GET /internal/workers — endpoint MỚI, READ-ONLY: snapshot registry + stats cho Hub UI (:3000).
// Auth: header X-Worker-Secret phải khớp WORKER_SECRET (timing-safe, CÙNG cơ chế gate với
// /internal/worker-token — Đợt 3.5). Thiếu/sai → 401. KHÔNG sửa bất kỳ route hiện có nào.
// Response:
//   { "workers": [ { id, status, connected_at, last_heartbeat, inflight, total_jobs,
//                    capabilities } ],
//     "uptime_seconds": N, "total_jobs_all_time": N }
// Số liệu live (inflight, last_heartbeat) lấy TRỰC TIẾP từ registry (authoritative);
// connected_at + total_jobs lấy từ HubStats (bộ đếm quan sát, xem internal/stats.ts).
import { Hono } from 'hono';
import { isWorkerSecretRequired, matchesWorkerSecret } from '../auth';
import { log } from '../logger';
import type { WorkerHub } from '../hub/ws';
import type { HubStats } from './stats';

export interface InternalWorkersDeps {
  hub: WorkerHub;
  stats: HubStats;
}

export function createInternalWorkersRouter(deps: InternalWorkersDeps): Hono {
  const router = new Hono();

  router.get('/internal/workers', (c) => {
    const provided = c.req.header('X-Worker-Secret');
    if (isWorkerSecretRequired() && !matchesWorkerSecret(provided)) {
      log('warn', 'internal/workers refused: missing/wrong X-Worker-Secret', {
        forwarded_for: c.req.header('X-Forwarded-For') ?? 'unknown',
        path: c.req.path,
      });
      return c.json(
        { error: { message: 'worker secret required (header X-Worker-Secret)' } },
        401,
      );
    }

    const now = Date.now();
    deps.stats.pruneOffline(now);
    const registry = deps.hub.registry;
    const workers = deps.stats.currentList().map((rec) => {
      const live = registry.get(rec.worker_id);
      // 3.6-H spec: field đầu tiên là `id` (worker_id tương đương — giữ thêm cho tiện debug)
      const base = {
        id: rec.worker_id,
        worker_id: rec.worker_id,
        status: rec.status,
        connected_at: rec.connected_at,
        last_heartbeat: rec.last_heartbeat,
        inflight: rec.inflight,
        total_jobs: rec.total_jobs,
        capabilities: rec.capabilities,
      };
      if (live) {
        // worker đang online → số liệu live từ registry là authoritative
        return {
          ...base,
          status: 'online' as const,
          inflight: live.inflight,
          last_heartbeat: live.last_heartbeat,
          capabilities: { ...live.capabilities },
        };
      }
      return { ...base, status: 'offline' as const };
    });

    return c.json({
      workers,
      uptime_seconds: Math.floor(process.uptime()),
      total_jobs_all_time: deps.stats.totalJobsAll,
    });
  });

  return router;
}
