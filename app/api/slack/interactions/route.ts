import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySlackRequest, createSlackClient, getThreadLink, getTeamUrl, escapeSlackText } from "@/lib/slack";
import { getFollowUp, getUserFollowUps, updateFollowUp, removeFollowUp, FollowUp } from "@/lib/redis";
import { getUser, updateUser } from "@/lib/db";

// Build follow-up list blocks from provided data (no extra Redis calls)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFollowUpBlocks(followUps: FollowUp[], teamUrl: string): any[] {
  if (followUps.length === 0) {
    return [
      { type: "section", text: { type: "mrkdwn", text: "*All caught up!* No pending follow-ups." } },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*You have ${followUps.length} pending follow-up${followUps.length > 1 ? "s" : ""}:*`,
      },
    },
  ];

  followUps.forEach((f, i) => {
    const link = getThreadLink(teamUrl, f.channel, f.threadTs, f.parentThreadTs);
    const hoursAgo = Math.round((Date.now() - f.createdAt) / (1000 * 60 * 60));
    const preview = escapeSlackText(f.summary || f.originalMessage);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${i + 1}. <${link}|${preview}> _(${hoursAgo}h ago)_`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Dismiss", emoji: true },
        action_id: `dismiss_followup_${i}`,
        value: JSON.stringify({ userId: f.userId, channel: f.channel, threadTs: f.threadTs }),
      },
    });
  });

  return blocks;
}

// Resolve team URL: use cached value on user record, or fetch and cache
async function resolveTeamUrl(userToken: string, userId: string, cachedUrl?: string): Promise<string> {
  if (cachedUrl) return cachedUrl;
  const client = createSlackClient(userToken);
  const url = await getTeamUrl(client);
  // Cache on user record for next time
  updateUser(userId, { teamUrl: url } as any);
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInteraction(payload: any) {
  const action = payload.actions?.[0];
  if (!action) return;

  const actionValue = JSON.parse(action.value || "{}");
  const { userId, channel, threadTs } = actionValue;

  if (!userId || !channel || !threadTs) return;

  // Phase 1: parallel — get user + check existence
  const [user, existing] = await Promise.all([
    getUser(userId),
    getFollowUp(userId, channel, threadTs),
  ]);

  if (!user) return;

  if (action.action_id === "followup_bumped") {
    await updateFollowUp(userId, channel, threadTs, {
      lastActivityAt: Date.now(),
      lastRemindedAt: Date.now(),
    });

    const slackBot = createSlackClient(user.botToken);
    if (payload.channel?.id && payload.message?.ts) {
      await slackBot.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: "Got it - I'll remind you again in 24h if still unresolved.",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "✓ Got it - I'll remind you again in 24h if still unresolved." } },
        ],
      });
    }
  } else if (action.action_id === "followup_resolved") {
    await removeFollowUp(userId, channel, threadTs);

    const slackBot = createSlackClient(user.botToken);
    if (payload.channel?.id && payload.message?.ts) {
      await slackBot.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: "Marked as resolved.",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "✓ Marked as resolved." } },
        ],
      });
    }
  } else if (action.action_id.startsWith("dismiss_followup_")) {
    // Retry guard
    if (!existing) return;

    // Phase 2: parallel — remove from Redis + resolve team URL
    const [, teamUrl] = await Promise.all([
      removeFollowUp(userId, channel, threadTs),
      resolveTeamUrl(user.userToken, userId, (user as any).teamUrl),
    ]);

    // Phase 3: get remaining follow-ups (must be after remove)
    const remainingFollowUps = await getUserFollowUps(userId);
    remainingFollowUps.sort((a, b) => a.createdAt - b.createdAt);

    const blocks = buildFollowUpBlocks(remainingFollowUps, teamUrl);
    const isEphemeral = payload.container?.is_ephemeral === true;

    if (isEphemeral && payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: true, blocks }),
      });
    } else if (payload.channel?.id && payload.message?.ts) {
      const slackBot = createSlackClient(user.botToken);
      await slackBot.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: remainingFollowUps.length > 0 ? `${remainingFollowUps.length} pending follow-ups` : "All caught up!",
        blocks,
      });
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get("payload") || "{}");

  if (payload.type === "block_actions") {
    waitUntil(handleInteraction(payload));
  }

  return NextResponse.json({ ok: true });
}
