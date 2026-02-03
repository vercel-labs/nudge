import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { getUser, updateUser } from "@/lib/db";

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
    const currentHours = user.reminderHours || [16, 0]; // Default: 8am PT, 4pm PT
    const times = currentHours.map(h => formatUTCHourToLocal(h, timezone)).join(" and ");

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
              text: `*Your Nudge settings:*\n\n📅 Reminders: *${times}* (${timezone})\n\nTo change your schedule:\n• \`/nudge 9am\` - once daily\n• \`/nudge 9am 5pm\` - twice daily\n• \`/nudge off\` - disable reminders`,
            },
          },
        ],
      }),
    });
    return;
  }

  // Turn off reminders
  if (args === "off" || args === "disable" || args === "stop") {
    await updateUser(userId, { reminderHours: [] });
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

  // Parse schedule times
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
        text: "Couldn't understand that schedule. Try:\n• `/nudge 9am` - once daily\n• `/nudge 9am 5pm` - twice daily\n• `/nudge off` - disable",
      }),
    });
    return;
  }

  await updateUser(userId, { reminderHours: utcHours, timezone });
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
    handleNudgeCommand(responseUrl, userId, text).catch(console.error);
    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
