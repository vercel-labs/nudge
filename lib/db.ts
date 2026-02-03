import { redis } from "./redis";

export interface NudgeUser {
  slackUserId: string;
  slackTeamId: string;
  botToken: string;
  userToken: string;
  installedAt: number;
  // Schedule preferences (hours in UTC)
  reminderHours?: number[];
  timezone?: string;
}

const USERS_KEY = "nudge:users";
const USER_PREFIX = "nudge:user:";

export async function saveUser(user: NudgeUser): Promise<void> {
  const key = `${USER_PREFIX}${user.slackUserId}`;
  await redis.set(key, user);
  await redis.sadd(USERS_KEY, user.slackUserId);
}

export async function getUser(slackUserId: string): Promise<NudgeUser | null> {
  const key = `${USER_PREFIX}${slackUserId}`;
  return redis.get<NudgeUser>(key);
}

export async function getAllUsers(): Promise<NudgeUser[]> {
  const userIds = await redis.smembers(USERS_KEY);
  if (userIds.length === 0) return [];

  const users = await Promise.all(
    userIds.map((id) => getUser(id as string))
  );

  return users.filter((u): u is NudgeUser => u !== null);
}

export async function removeUser(slackUserId: string): Promise<void> {
  const key = `${USER_PREFIX}${slackUserId}`;
  await redis.del(key);
  await redis.srem(USERS_KEY, slackUserId);
}

export async function updateUser(
  slackUserId: string,
  updates: Partial<NudgeUser>
): Promise<void> {
  const existing = await getUser(slackUserId);
  if (!existing) return;

  const key = `${USER_PREFIX}${slackUserId}`;
  await redis.set(key, { ...existing, ...updates });
}
