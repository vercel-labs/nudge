import { NextRequest, NextResponse } from "next/server";
import { pollUserMessages } from "@/lib/poll";
import { getAllUsers } from "@/lib/db";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await getAllUsers();

  if (users.length === 0) {
    return NextResponse.json({ ok: true, message: "No users registered" });
  }

  const results = await Promise.all(
    users.map(async (user) => {
      const stats = await pollUserMessages(user);
      return {
        userId: user.slackUserId,
        ...stats,
      };
    })
  );

  const totals = results.reduce(
    (acc, r) => ({
      messagesSearched: acc.messagesSearched + r.messagesSearched,
      questionsFound: acc.questionsFound + r.questionsFound,
      newTracked: acc.newTracked + r.newTracked,
      resolved: acc.resolved + r.resolved,
      errors: [...acc.errors, ...r.errors],
    }),
    { messagesSearched: 0, questionsFound: 0, newTracked: 0, resolved: 0, errors: [] as string[] }
  );

  return NextResponse.json({
    ok: true,
    usersPolled: users.length,
    ...totals,
    perUser: results,
  });
}
