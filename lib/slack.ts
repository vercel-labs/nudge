import { WebClient } from "@slack/web-api";
import crypto from "crypto";

// Create a WebClient with a specific token
export function createSlackClient(token: string): WebClient {
  return new WebClient(token);
}

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
