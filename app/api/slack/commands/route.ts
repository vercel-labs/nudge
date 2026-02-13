import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySlackRequest, getThreadLink, getTeamUrl, escapeSlackText, getConversationLabel, createSlackClient } from "@/lib/slack";
import { getUser, updateUser } from "@/lib/db";
import { getUserFollowUps, updateFollowUp } from "@/lib/redis";
import { summarizeQuestion } from "@/lib/ai";

// Parse time like "9am", "2pm", "14:00" to UTC hour
function parseTimeToUTC(timeStr: string, timezone: string): number | null {
  const lower = timeStr.toLowerCase().trim();

  // Parse 12-hour format (9am, 2pm)
  const match12 = lower.match(/^(\d{1,2})(am|pm)$/);
  if (match12) {
    let hour = parseInt(match12[1]);
    const isPM = match12[2] === "pm";
    if (hour === 12) hour = isPM ? 12 : 0;
    else if (isPM) hour += 12;

    // Convert to UTC (simplified - assumes PT = UTC-8)
    const tzOffset = timezone === "PT" ? 8 : 0;
    return (hour + tzOffset) % 24;
  }

  // Parse 24-hour format (14:00, 9:00)
  const match24 = lower.match(/^(\d{1,2}):?(\d{2})?$/);
  if (match24) {
    const hour = parseInt(match24[1]);
    const tzOffset = timezone === "PT" ? 8 : 0;
    return (hour + tzOffset) % 24;
  }

  return null;
}

function formatUTCHourToLocal(utcHour: number, timezone: string): string {
  const tzOffset = timezone === "PT" ? -8 : 0;
  let localHour = (utcHour + tzOffset + 24) % 24;
  const isPM = localHour >= 12;
  if (localHour === 0) localHour = 12;
  else if (localHour > 12) localHour -= 12;
  return `${localHour}${isPM ? "pm" : "am"}`;
}

function formatSchedule(user: { reminderHours?: number[]; reminderInterval?: number; timezone?: string }): string {
  const timezone = user.timezone || "PT";

  if (user.reminderInterval) {
    if (user.reminderInterval === 1) {
      return "every hour";
    }
    return `every ${user.reminderInterval} hours`;
  }

  const hours = user.reminderHours || [16, 0];
  if (hours.length === 0) {
    return "disabled";
  }

  const times = hours.map(h => formatUTCHourToLocal(h, timezone)).join(" and ");
  return `${times} (${timezone})`;
}

async function handleNudgeCommand(responseUrl: string, userId: string, text: string) {
  const user = await getUser(userId);
  if (!user) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "You haven't installed Nudge yet. Visit https://nudge.labs.vercel.dev to get started.",
      }),
    });
    return;
  }

  const args = text.trim().toLowerCase();
  const timezone = user.timezone || "PT";

  // Show current settings
  if (!args || args === "settings" || args === "status") {
    const schedule = formatSchedule(user);

    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Your Nudge settings:*\n\n📅 Reminders: *${schedule}*\n\nCommands:\n• \`/nudge list\` - show all pending follow-ups\n• \`/nudge hourly\` - remind every hour\n• \`/nudge 9am 5pm\` - remind at specific times\n• \`/nudge off\` - disable reminders`,
            },
          },
        ],
      }),
    });
    return;
  }

  // Show all follow-ups with dismiss buttons
  if (args === "list" || args === "all" || args === "show") {
    const followUps = await getUserFollowUps(userId);

    if (followUps.length === 0) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: "🎉 *All caught up!* No pending follow-ups.",
        }),
      });
      return;
    }

    // Sort by createdAt (oldest first)
    followUps.sort((a, b) => a.createdAt - b.createdAt);

    // Build blocks with dismiss buttons - show ALL follow-ups
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

    // Generate summaries and resolve conversation labels
    const SUMMARY_VERSION = 3;
    const slackUser = createSlackClient(user.userToken);
    await Promise.all(
      followUps.map(async (f) => {
        if (!f.summary || f.summaryVersion !== SUMMARY_VERSION) {
          try {
            const [topic, label] = await Promise.all([
              summarizeQuestion(f.originalMessage),
              getConversationLabel(slackUser, f.channel),
            ]);
            f.summary = `${label} - ${topic}`;
            f.summaryVersion = SUMMARY_VERSION;
            await updateFollowUp(f.userId, f.channel, f.threadTs, {
              summary: f.summary,
              summaryVersion: SUMMARY_VERSION,
            });
          } catch {
            f.summary = f.originalMessage.length > 80
              ? f.originalMessage.slice(0, 80) + "..."
              : f.originalMessage;
          }
        }
      })
    );

    const teamUrl = await getTeamUrl(slackUser);
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
          text: {
            type: "plain_text",
            text: "Dismiss",
            emoji: true,
          },
          action_id: `dismiss_followup_${i}`,
          value: JSON.stringify({
            userId: userId,
            channel: f.channel,
            threadTs: f.threadTs,
          }),
        },
      });
    });

    // Slack has a limit of 50 blocks, so truncate if needed
    if (blocks.length > 49) {
      blocks.length = 49;
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_Showing first 48 follow-ups_",
          },
        ],
      });
    }

    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        blocks,
      }),
    });
    return;
  }

  // Turn off reminders
  if (args === "off" || args === "disable" || args === "stop") {
    await updateUser(userId, { reminderHours: [], reminderInterval: undefined });
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "✓ Reminders disabled. Use `/nudge` anytime to re-enable.",
      }),
    });
    return;
  }

  // Check for "hourly" or "every hour"
  if (args === "hourly" || args === "every hour") {
    await updateUser(userId, { reminderInterval: 1, reminderHours: undefined, timezone });
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "✓ Reminders set for *every hour*",
      }),
    });
    return;
  }

  // Check for "every X hours" pattern
  const everyMatch = args.match(/^every\s+(\d+)\s*h(?:ours?)?$/);
  if (everyMatch) {
    const interval = parseInt(everyMatch[1]);
    if (interval >= 1 && interval <= 24) {
      await updateUser(userId, { reminderInterval: interval, reminderHours: undefined, timezone });
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: `✓ Reminders set for *every ${interval} hour${interval > 1 ? "s" : ""}*`,
        }),
      });
      return;
    }
  }

  // Check for shorthand like "2h", "4h"
  const shorthandMatch = args.match(/^(\d+)h$/);
  if (shorthandMatch) {
    const interval = parseInt(shorthandMatch[1]);
    if (interval >= 1 && interval <= 24) {
      await updateUser(userId, { reminderInterval: interval, reminderHours: undefined, timezone });
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: `✓ Reminders set for *every ${interval} hour${interval > 1 ? "s" : ""}*`,
        }),
      });
      return;
    }
  }

  // Parse schedule times (9am, 9am 5pm, etc.)
  const timeParts = args.split(/[\s,]+/).filter(Boolean);
  const utcHours: number[] = [];

  for (const part of timeParts) {
    const hour = parseTimeToUTC(part, timezone);
    if (hour !== null) {
      utcHours.push(hour);
    }
  }

  if (utcHours.length === 0) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "Couldn't understand that schedule. Try:\n• `/nudge hourly`\n• `/nudge every 2 hours` or `/nudge 2h`\n• `/nudge 9am` or `/nudge 9am 5pm`\n• `/nudge off`",
      }),
    });
    return;
  }

  await updateUser(userId, { reminderHours: utcHours, reminderInterval: undefined, timezone });
  const times = utcHours.map(h => formatUTCHourToLocal(h, timezone)).join(" and ");

  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text: `✓ Reminders set for *${times}* (${timezone})`,
    }),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get("command");
  const userId = params.get("user_id");
  const responseUrl = params.get("response_url");
  const text = params.get("text") || "";

  if (command === "/nudge" && userId && responseUrl) {
    waitUntil(handleNudgeCommand(responseUrl, userId, text));
    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
