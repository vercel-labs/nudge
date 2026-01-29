import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/oauth/callback`;

  // Request both bot and user scopes
  const botScopes = ["chat:write", "commands"].join(",");
  const userScopes = [
    "channels:history",
    "channels:read",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "search:read",
  ].join(",");

  const slackUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackUrl.searchParams.set("client_id", clientId!);
  slackUrl.searchParams.set("scope", botScopes);
  slackUrl.searchParams.set("user_scope", userScopes);
  slackUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(slackUrl.toString());
}
