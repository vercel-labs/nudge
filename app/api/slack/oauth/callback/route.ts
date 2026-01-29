import { NextRequest, NextResponse } from "next/server";
import { saveUser } from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}?error=${error}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}?error=no_code`
    );
  }

  try {
    // Exchange code for tokens
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/oauth/callback`,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error("OAuth error:", data);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}?error=${data.error}`
      );
    }

    // Save user to database
    await saveUser({
      slackUserId: data.authed_user.id,
      slackTeamId: data.team.id,
      botToken: data.access_token,
      userToken: data.authed_user.access_token,
      installedAt: Date.now(),
    });

    // Redirect to Slack
    return NextResponse.redirect(
      `https://app.slack.com/client/${data.team.id}`
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}?error=server_error`
    );
  }
}
