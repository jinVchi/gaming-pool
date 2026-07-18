interface PendingScore {
  userId: string;
  gameSlug: string;
  score: number;
}

const FLUSH_INTERVAL_MS = 1_000;
const MAX_BATCH_SIZE = 200;
const MAX_QUEUED_SCORES = 10_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const queue: PendingScore[] = [];
let flushInFlight = false;
let warnedMissingDatabase = false;

// Enqueue only validated integer scores; the room tick never waits on Postgres.
export function enqueueScore(score: PendingScore): void {
  if (!process.env.DATABASE_URL) {
    if (!warnedMissingDatabase) {
      warnedMissingDatabase = true;
      console.warn("[scores] DATABASE_URL is not set; signed-in scores will not be persisted");
    }
    return;
  }
  if (!Number.isSafeInteger(score.score) || score.score < 0 || score.score > MAX_POSTGRES_INTEGER) return;
  if (queue.length >= MAX_QUEUED_SCORES) {
    console.error("[scores] queue full; dropping score");
    return;
  }
  queue.push(score);
  if (queue.length >= MAX_BATCH_SIZE) void flushScores();
}

// Flush one bounded batch. Failed batches return to the front for retry.
export async function flushScores(): Promise<void> {
  if (flushInFlight || queue.length === 0 || !process.env.DATABASE_URL) return;
  flushInFlight = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    const { db, scores } = await import("@gaming-pool/db");
    await db.insert(scores).values(batch);
  } catch (err) {
    queue.unshift(...batch);
    console.error("[scores] batch write failed:", err);
  } finally {
    flushInFlight = false;
  }
}

const flushTimer = setInterval(() => void flushScores(), FLUSH_INTERVAL_MS);
flushTimer.unref();
