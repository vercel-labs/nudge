import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface FollowUp {
  userId: string;              // Slack user ID who asked the question
  channel: string;
  threadTs: string;            // The message timestamp (unique identifier)
  parentThreadTs?: string;     // Parent thread ts (if message is inside a thread)
  originalMessage: string;
  summary?: string;
  createdAt: number;
  lastRemindedAt: number | null;
  lastActivityAt: number;
}

// Per-user keys
function getUserFollowupsKey(userId: string): string {
  return `followups:${userId}`;
}

function getFollowupKey(userId: string, channel: string, threadTs: string): string {
  return `followup:${userId}:${channel}:${threadTs}`;
}

export async function addFollowUp(followUp: FollowUp): Promise<void> {
  const key = getFollowupKey(followUp.userId, followUp.channel, followUp.threadTs);
  const setKey = getUserFollowupsKey(followUp.userId);
  await redis.set(key, followUp);
  await redis.zadd(setKey, {
    score: followUp.createdAt,
    member: key,
  });
}

export async function getFollowUp(
  userId: string,
  channel: string,
  threadTs: string
): Promise<FollowUp | null> {
  const key = getFollowupKey(userId, channel, threadTs);
  return redis.get<FollowUp>(key);
}

export async function updateFollowUp(
  userId: string,
  channel: string,
  threadTs: string,
  updates: Partial<FollowUp>
): Promise<void> {
  const existing = await getFollowUp(userId, channel, threadTs);
  if (!existing) return;

  const key = getFollowupKey(userId, channel, threadTs);
  await redis.set(key, { ...existing, ...updates });
}

export async function removeFollowUp(
  userId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const key = getFollowupKey(userId, channel, threadTs);
  const setKey = getUserFollowupsKey(userId);
  await redis.del(key);
  await redis.zrem(setKey, key);
}

export async function getUserFollowUps(userId: string): Promise<FollowUp[]> {
  const setKey = getUserFollowupsKey(userId);
  const keys = await redis.zrange<string[]>(setKey, 0, -1);
  if (keys.length === 0) return [];

  const followUps = await Promise.all(
    keys.map((key) => redis.get<FollowUp>(key))
  );

  return followUps.filter((f): f is FollowUp => f !== null);
}

export async function isTracked(
  userId: string,
  channel: string,
  threadTs: string
): Promise<boolean> {
  const key = getFollowupKey(userId, channel, threadTs);
  const exists = await redis.exists(key);
  return exists === 1;
}

// Clear all followups for a user
export async function clearUserFollowUps(userId: string): Promise<number> {
  const setKey = getUserFollowupsKey(userId);
  const keys = await redis.zrange<string[]>(setKey, 0, -1);

  let deleted = 0;
  for (const key of keys) {
    await redis.del(key);
    deleted++;
  }
  await redis.del(setKey);

  return deleted;
}
