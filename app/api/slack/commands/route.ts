import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest, getThreadLink, escapeSlackText } from "@/lib/slack";
import { getUserFollowUps } from "@/lib/redis";
import { getUser } from "@/lib/db";
import { pollUserMessages } from "@/lib/poll";

async function sendFollowUpsResponse(responseUrl: string, userId: string) {
  // First, eagerly poll for new questions so results are always fresh
  const user = await getUser(userId);
  if (user) {
    try {
      await pollUserMessages(user);
    } catch (err) {
      console.error("Error polling messages on-demand:", err);
      // Continue anyway - we'll show whatever is cached
    }
  }

  // Now fetch the (freshly updated) followups
  const followUps = await getUserFollowUps(userId);

  if (followUps.length === 0) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "No pending follow-ups. You're all caught up!",
      }),
    });
    return;
  }

  // Sort by createdAt (oldest first)
  followUps.sort((a, b) => a.createdAt - b.createdAt);

  // Build blocks with dismiss buttons for each item
  const blocks: object[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Pending follow-ups (${followUps.length}):*`,
      },
    },
  ];

  followUps.forEach((f, i) => {
    const link = getThreadLink(f.channel, f.threadTs, f.parentThreadTs);
    const hoursAgo = Math.round((Date.now() - f.createdAt) / (1000 * 60 * 60));
    const rawPreview =
      f.originalMessage.length > 40
        ? f.originalMessage.slice(0, 40) + "..."
        : f.originalMessage;
    const preview = escapeSlackText(rawPreview);

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
        value: JSON.stringify({ userId, channel: f.channel, threadTs: f.threadTs }),
      },
    });
  });

  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      blocks,
    }),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  // Verify request is from Slack
  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse form data
  const params = new URLSearchParams(body);
  const command = params.get("command");
  const userId = params.get("user_id");
  const responseUrl = params.get("response_url");

  if (command === "/followups" && userId && responseUrl) {
    // Respond async to avoid Slack timeout/retries
    sendFollowUpsResponse(responseUrl, userId).catch(console.error);

    // Acknowledge immediately with a loading message
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Checking your messages for unanswered questions...",
    });
  }

  return NextResponse.json({ ok: true });
}
