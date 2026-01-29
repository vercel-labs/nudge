# Nudge

a personal slack agent that reminds you to follow up on unanswered questions.

## how it works

1. **polls** your slack messages hourly for questions you've asked (messages with `?`)
2. **tracks** questions that don't have substantive answers yet
3. **reminds** you via DM at 8am PT and 4pm PT with a digest of pending follow-ups
4. **uses AI** to distinguish real answers from non-committal responses ("looking into it", "will check", etc.)

## features

- detects questions in channels, DMs, and threads
- understands conversation context (thread replies, DM flow)
- `/followups` command to see pending items with dismiss buttons
- AI-powered classification using Vercel AI Gateway

## quick setup (5 min)

### 1. create a slack app

1. go to [api.slack.com/apps](https://api.slack.com/apps)
2. click **"Create New App"** → **"From a manifest"**
3. select your workspace
4. paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json) from this repo
5. click **Create**
6. click **Install to Workspace** and authorize

### 2. get your credentials

from your slack app settings page:
- **Bot Token**: OAuth & Permissions → Bot User OAuth Token (`xoxb-...`)
- **User Token**: OAuth & Permissions → User OAuth Token (`xoxp-...`)
- **Signing Secret**: Basic Information → App Credentials → Signing Secret

get your slack user ID:
1. in slack, click your profile picture → "Profile"
2. click the `⋮` menu → "Copy member ID"

### 3. create upstash redis

1. go to [console.upstash.com](https://console.upstash.com)
2. create a new redis database (free tier works)
3. copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 4. deploy to vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fnudge&env=SLACK_BOT_TOKEN,SLACK_USER_TOKEN,SLACK_SIGNING_SECRET,SLACK_USER_ID,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN,CRON_SECRET&envDescription=Slack%20and%20Redis%20credentials%20for%20Nudge)

| variable | description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | bot token (`xoxb-...`) |
| `SLACK_USER_TOKEN` | user token (`xoxp-...`) |
| `SLACK_SIGNING_SECRET` | from slack app settings |
| `SLACK_USER_ID` | your slack member ID |
| `UPSTASH_REDIS_REST_URL` | from upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | from upstash console |
| `CRON_SECRET` | any random string (e.g. `nudge_abc123`) |

### 5. update slack app URLs

after deploying, go back to your slack app settings and update:

**Slash Commands** → `/followups`:
```
https://your-app.vercel.app/api/slack/commands
```

**Interactivity & Shortcuts** → Request URL:
```
https://your-app.vercel.app/api/slack/interactions
```

## usage

- questions you ask are automatically tracked
- you'll receive DM reminders at 8am PT and 4pm PT
- use `/followups` anytime to see pending items
- click "Dismiss" to remove items you no longer need to track

## tech stack

- [Next.js](https://nextjs.org) app router
- [Vercel AI SDK](https://sdk.vercel.ai) with AI Gateway
- [Upstash Redis](https://upstash.com)
- [Slack Web API](https://api.slack.com)

---

this is v1 — built in a day with [Claude Code](https://claude.ai/code). feedback and contributions welcome!
