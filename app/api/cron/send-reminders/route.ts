import { NextRequest, NextResponse } from "next/server";
import { createSlackClient, getThreadLink, escapeSlackText, getConversationLabel } from "@/lib/slack";
import { getUserFollowUps, updateFollowUp } from "@/lib/redis";
import { getAllUsers } from "@/lib/db";
import { summarizeQuestion } from "@/lib/ai";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await getAllUsers();

  if (users.length === 0) {
    return NextResponse.json({ ok: true, message: "No users registered" });
  }

  const now = new Date();
  const currentHourUTC = now.getUTCHours();
  const results = [];
  const skipped = [];

  for (const user of users) {
    // Check if current hour matches user's schedule
    let shouldSend = false;
    const reminderHours = user.reminderHours ?? [16, 0];

    if (user.reminderInterval) {
      // Interval-based: send if current hour is divisible by interval
      shouldSend = currentHourUTC % user.reminderInterval === 0;
    } else {
      // Specific hours or default (8am PT = 16 UTC, 4pm PT = 0 UTC)
      shouldSend = reminderHours.length > 0 && reminderHours.includes(currentHourUTC);
    }

    if (!shouldSend) {
      skipped.push({
        userId: user.slackUserId,
        schedule: user.reminderInterval ? `every ${user.reminderInterval}h` : reminderHours,
      });
      continue;
    }

    const followUps = await getUserFollowUps(user.slackUserId);

    if (followUps.length === 0) {
      results.push({ userId: user.slackUserId, sent: 0 });
      continue;
    }

    // Sort by createdAt (oldest first)
    followUps.sort((a, b) => a.createdAt - b.createdAt);

    // Limit to 10 follow-ups to avoid Slack block text limits
    const maxToShow = 10;
    const displayedFollowUps = followUps.slice(0, maxToShow);
    const hiddenCount = followUps.length - displayedFollowUps.length;

    // Build blocks with dismiss buttons for each follow-up
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
      displayedFollowUps.map(async (f) => {
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

    // Add each follow-up as a section with dismiss button
    displayedFollowUps.forEach((f, i) => {
      const link = getThreadLink(f.channel, f.threadTs, f.parentThreadTs);
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
            userId: user.slackUserId,
            channel: f.channel,
            threadTs: f.threadTs,
          }),
        },
      });
    });

    if (hiddenCount > 0) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_...and ${hiddenCount} more. Use \`/nudge list\` to see all._`,
          },
        ],
      });
    }

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Use `/nudge` to adjust your reminder schedule",
        },
      ],
    });

    try {
      const slackBot = createSlackClient(user.botToken);
      await slackBot.chat.postMessage({
        channel: user.slackUserId,
        text: `You have ${followUps.length} pending follow-up${followUps.length > 1 ? "s" : ""}`,
        blocks,
      });

      results.push({ userId: user.slackUserId, sent: followUps.length });
    } catch (error) {
      results.push({ userId: user.slackUserId, error: String(error) });
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    currentHourUTC,
    usersTotal: users.length,
    usersNotified: results.filter(r => !("error" in r) && r.sent > 0).length,
    usersSkipped: skipped.length,
    results,
    skipped,
  });
}
