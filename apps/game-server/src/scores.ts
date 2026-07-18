interface PendingScore {
  userId: string;
  gameSlug: string;
  score: number;
}

interface QueuedScore extends PendingScore {
  failures: number;
}

type DatabaseModule = typeof import("@gaming-pool/db");

const FLUSH_INTERVAL_MS = 1_000;
const MAX_BATCH_SIZE = 200;
const MAX_QUEUED_SCORES = 10_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_BATCH_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;

const queue: QueuedScore[] = [];
let flushInFlight = false;
let warnedMissingDatabase = false;
let retryNotBefore = 0;
let acceptingScores = true;
let databasePromise: Promise<DatabaseModule> | null = null;

function loadDatabase(): Promise<DatabaseModule> {
  databasePromise ??= import("@gaming-pool/db");
  return databasePromise;
}

function scoreValue(score: QueuedScore): PendingScore {
  return { userId: score.userId, gameSlug: score.gameSlug, score: score.score };
}

function databaseErrorCode(err: unknown): string | null {
  let current = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return null;
}

function isConstraintError(err: unknown): boolean {
  return databaseErrorCode(err)?.startsWith("23") ?? false;
}

function scheduleRetry(batch: QueuedScore[], err: unknown): void {
  const retry = batch
    .map((score) => ({ ...score, failures: score.failures + 1 }))
    .filter((score) => score.failures <= MAX_BATCH_RETRIES);
  const dropped = batch.length - retry.length;
  if (dropped > 0) console.error(`[scores] dropped ${dropped} score(s) after repeated write failures`);
  if (retry.length === 0) {
    retryNotBefore = 0;
    return;
  }

  const failures = Math.max(...retry.map((score) => score.failures));
  const delayMs = Math.min(FLUSH_INTERVAL_MS * 2 ** (failures - 1), MAX_RETRY_DELAY_MS);
  retryNotBefore = Date.now() + delayMs;
  queue.unshift(...retry);
  if (queue.length > MAX_QUEUED_SCORES) {
    const overflow = queue.length - MAX_QUEUED_SCORES;
    queue.splice(MAX_QUEUED_SCORES, overflow);
    console.error(`[scores] queue full; dropped ${overflow} newer score(s)`);
  }
  console.error(`[scores] batch write failed; retrying in ${delayMs}ms:`, err);
}

// A constraint failure aborts the whole insert. Retry rows separately so one
// deleted user cannot poison good scores from the same batch.
async function isolateInvalidScores(
  database: DatabaseModule,
  batch: QueuedScore[],
): Promise<{ retry: QueuedScore[]; error: unknown; dropped: number }> {
  let dropped = 0;
  for (let index = 0; index < batch.length; index++) {
    try {
      await database.db.insert(database.scores).values(scoreValue(batch[index]!));
    } catch (err) {
      if (isConstraintError(err)) {
        dropped++;
        continue;
      }
      return { retry: batch.slice(index), error: err, dropped };
    }
  }
  return { retry: [], error: null, dropped };
}

// Enqueue only validated integer scores; the room tick never waits on Postgres.
export function enqueueScore(score: PendingScore): void {
  if (!acceptingScores) return;
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
  queue.push({ ...score, failures: 0 });
  if (queue.length >= MAX_BATCH_SIZE) void flushScores();
}

// Flush one bounded batch with backoff and a finite retry budget.
export async function flushScores(): Promise<void> {
  if (flushInFlight || queue.length === 0 || !process.env.DATABASE_URL || Date.now() < retryNotBefore) return;
  flushInFlight = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  let database: DatabaseModule | null = null;
  try {
    database = await loadDatabase();
    await database.db.insert(database.scores).values(batch.map(scoreValue));
    retryNotBefore = 0;
  } catch (err) {
    if (database && isConstraintError(err)) {
      const isolated = await isolateInvalidScores(database, batch);
      if (isolated.dropped > 0) {
        console.error(`[scores] dropped ${isolated.dropped} score(s) that violated database constraints`);
      }
      if (isolated.retry.length > 0) scheduleRetry(isolated.retry, isolated.error);
      else retryNotBefore = 0;
    } else {
      scheduleRetry(batch, err);
    }
  } finally {
    flushInFlight = false;
  }
}

const flushTimer = setInterval(() => void flushScores(), FLUSH_INTERVAL_MS);
flushTimer.unref();

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Stop new writes and drain queued batches until empty or the deadline passes.
export async function drainScores(timeoutMs: number): Promise<boolean> {
  acceptingScores = false;
  clearInterval(flushTimer);
  retryNotBefore = 0;
  const deadline = Date.now() + Math.max(0, timeoutMs);

  while ((queue.length > 0 || flushInFlight) && Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    if (!flushInFlight && Date.now() >= retryNotBefore) {
      const completed = await Promise.race([
        flushScores().then(() => true),
        wait(remainingMs).then(() => false),
      ]);
      if (!completed) return false;
      continue;
    }
    await wait(Math.min(50, remainingMs));
  }

  return queue.length === 0 && !flushInFlight;
}
