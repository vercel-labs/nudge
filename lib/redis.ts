import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface FollowUp {
  channel: string;
  threadTs: string;          // The message timestamp (unique identifier)
  parentThreadTs?: string;   // Parent thread ts (if message is inside a thread)
  originalMessage: string;
  createdAt: number;
  lastRemindedAt: number | null;
  lastActivityAt: number;
}

const FOLLOWUPS_KEY = "followups";
const FOLLOWUP_PREFIX = "followup:";

export async function addFollowUp(followUp: FollowUp): Promise<void> {
  const key = `${FOLLOWUP_PREFIX}${followUp.channel}:${followUp.threadTs}`;
  await redis.set(key, followUp);
  await redis.zadd(FOLLOWUPS_KEY, {
    score: followUp.createdAt,
    member: key,
  });
}

export async function getFollowUp(
  channel: string,
  threadTs: string
): Promise<FollowUp | null> {
  const key = `${FOLLOWUP_PREFIX}${channel}:${threadTs}`;
  return redis.get<FollowUp>(key);
}

export async function updateFollowUp(
  channel: string,
  threadTs: string,
  updates: Partial<FollowUp>
): Promise<void> {
  const existing = await getFollowUp(channel, threadTs);
  if (!existing) return;

  const key = `${FOLLOWUP_PREFIX}${channel}:${threadTs}`;
  await redis.set(key, { ...existing, ...updates });
}

export async function removeFollowUp(
  channel: string,
  threadTs: string
): Promise<void> {
  const key = `${FOLLOWUP_PREFIX}${channel}:${threadTs}`;
  await redis.del(key);
  await redis.zrem(FOLLOWUPS_KEY, key);
}

export async function getAllPendingFollowUps(): Promise<FollowUp[]> {
  const keys = await redis.zrange<string[]>(FOLLOWUPS_KEY, 0, -1);
  if (keys.length === 0) return [];

  const followUps = await Promise.all(
    keys.map((key) => redis.get<FollowUp>(key))
  );

  return followUps.filter((f): f is FollowUp => f !== null);
}

export async function isTracked(
  channel: string,
  threadTs: string
): Promise<boolean> {
  const key = `${FOLLOWUP_PREFIX}${channel}:${threadTs}`;
  const exists = await redis.exists(key);
  return exists === 1;
}
