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

// Cache workspace URLs so we only call auth.test once per token
const teamUrlCache = new Map<string, string>();

export async function getTeamUrl(client: WebClient): Promise<string> {
  const token = (client as any).token as string;
  if (token && teamUrlCache.has(token)) {
    return teamUrlCache.get(token)!;
  }
  try {
    const auth = await client.auth.test();
    // auth.url is like "https://myworkspace.slack.com/"
    const url = (auth.url as string)?.replace(/\/$/, "") || "https://slack.com";
    if (token) teamUrlCache.set(token, url);
    return url;
  } catch {
    return "https://slack.com";
  }
}

export function getThreadLink(teamUrl: string, channel: string, messageTs: string, parentThreadTs?: string): string {
  // Convert timestamp to link format (remove the dot)
  const linkTs = messageTs.replace(".", "");

  // If message is in a thread, link directly to that message in the thread
  if (parentThreadTs && parentThreadTs !== messageTs) {
    return `${teamUrl}/archives/${channel}/p${linkTs}?thread_ts=${parentThreadTs}&cid=${channel}`;
  }

  // Standard link format (works for channels and DMs)
  return `${teamUrl}/archives/${channel}/p${linkTs}`;
}

// Resolve a channel ID to a short label: first name for DMs, #channel for channels
export async function getConversationLabel(client: WebClient, channel: string): Promise<string> {
  try {
    const info = await client.conversations.info({ channel });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = info.channel as any;

    if (ch?.is_im) {
      try {
        const userInfo = await client.users.info({ user: ch.user });
        const fullName = userInfo.user?.profile?.display_name || userInfo.user?.real_name || userInfo.user?.name || "";
        // Just the first name, lowercase
        return fullName.split(" ")[0].toLowerCase() || "DM";
      } catch {
        return "DM";
      }
    }

    if (ch?.is_mpim) {
      return "group DM";
    }

    const name = ch?.name_normalized || ch?.name;
    return name ? `#${name}` : "channel";
  } catch {
    return "thread";
  }
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
