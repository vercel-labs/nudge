import { WebClient } from "@slack/web-api";
import crypto from "crypto";

// Bot token for sending messages (reminders come from "Nudge")
export const slackBot = new WebClient(process.env.SLACK_BOT_TOKEN);

// User token for reading messages (sees all channels user is in)
export const slackUser = new WebClient(process.env.SLACK_USER_TOKEN);

export const TRACKED_USER_ID = process.env.SLACK_USER_ID!;

export function verifySlackRequest(
  signature: string | null,
  timestamp: string | null,
  body: string
): boolean {
  if (!signature || !timestamp) return false;

  const signingSecret = process.env.SLACK_SIGNING_SECRET!;
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;

  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(sigBaseString).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

export function getThreadLink(channel: string, messageTs: string, parentThreadTs?: string): string {
  // Convert timestamp to link format (remove the dot)
  const linkTs = messageTs.replace(".", "");

  // If message is in a thread, link directly to that message in the thread
  if (parentThreadTs && parentThreadTs !== messageTs) {
    return `https://slack.com/archives/${channel}/p${linkTs}?thread_ts=${parentThreadTs}&cid=${channel}`;
  }

  // Standard link format (works for channels and DMs)
  return `https://slack.com/archives/${channel}/p${linkTs}`;
}

export function escapeSlackText(text: string): string {
  // Escape special characters that break Slack mrkdwn links
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "│") // Replace pipe with similar unicode char
    .replace(/\n/g, " ") // Replace newlines with space
    .replace(/\r/g, ""); // Remove carriage returns
}

export async function sendReminder(
  channel: string,
  threadTs: string,
  createdAt: number
): Promise<void> {
  const link = getThreadLink(channel, threadTs);
  const hoursAgo = Math.round((Date.now() - createdAt) / (1000 * 60 * 60));

  await slackBot.chat.postMessage({
    channel: TRACKED_USER_ID,
    text: `You asked a question ${hoursAgo}h ago with no resolution: ${link}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You asked a question *${hoursAgo}h ago* with no resolution:\n<${link}|View thread>`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Bumped", emoji: true },
            action_id: "followup_bumped",
            value: JSON.stringify({ channel, threadTs }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Resolved", emoji: true },
            action_id: "followup_resolved",
            value: JSON.stringify({ channel, threadTs }),
            style: "primary",
          },
        ],
      },
    ],
  });
}
