import { NextRequest, NextResponse } from "next/server";
import { slackUser, TRACKED_USER_ID } from "@/lib/slack";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const specificChannel = req.nextUrl.searchParams.get("channel");

  // If specific channel requested, just fetch that
  if (specificChannel) {
    try {
      const sixHoursAgo = Math.floor(Date.now() / 1000) - (6 * 3600);
      const historyResult = await slackUser.conversations.history({
        channel: specificChannel,
        oldest: sixHoursAgo.toString(),
        limit: 20,
      });

      const messages = (historyResult.messages || []).map(m => ({
        user: m.user,
        isTrackedUser: m.user === TRACKED_USER_ID,
        text: m.text?.slice(0, 100),
        hasQuestion: m.text?.includes("?"),
        ts: m.ts,
        thread_ts: m.thread_ts,
      }));

      return NextResponse.json({
        trackedUserId: TRACKED_USER_ID,
        channel: specificChannel,
        messageCount: messages.length,
        messages,
      });
    } catch (error) {
      return NextResponse.json({ error: String(error), channel: specificChannel });
    }
  }

  try {
    // Get channels
    const channelsResult = await slackUser.users.conversations({
      user: TRACKED_USER_ID,
      types: "public_channel,private_channel",
      limit: 200,
    });

    const channels = channelsResult.channels || [];

    // Find specific test channel
    const testChannel = channels.find(c => c.name === "temp-test-nudge");
    const allTestChannels = channels.filter(c => c.name?.includes("test") || c.name?.includes("nudge"));
    const channelsToCheck = testChannel ? [testChannel] : allTestChannels.slice(0, 5);

    const channelDetails = [];

    // Get recent messages
    for (const channel of channelsToCheck) {
      if (!channel.id) continue;

      const sixHoursAgo = Math.floor(Date.now() / 1000) - (6 * 3600);

      const historyResult = await slackUser.conversations.history({
        channel: channel.id,
        oldest: sixHoursAgo.toString(),
        limit: 20,
      });

      const messages = (historyResult.messages || []).map(m => ({
        user: m.user,
        isTrackedUser: m.user === TRACKED_USER_ID,
        text: m.text?.slice(0, 100),
        hasQuestion: m.text?.includes("?"),
        ts: m.ts,
        thread_ts: m.thread_ts,
      }));

      channelDetails.push({
        id: channel.id,
        name: channel.name,
        messageCount: historyResult.messages?.length || 0,
        messages,
      });
    }

    return NextResponse.json({
      trackedUserId: TRACKED_USER_ID,
      totalChannels: channels.length,
      testChannelFound: !!testChannel,
      allMatchingChannels: allTestChannels.map(c => c.name),
      sampleChannels: channelDetails,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) });
  }
}
