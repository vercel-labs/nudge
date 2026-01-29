export default function Home({
  searchParams,
}: {
  searchParams: { success?: string; error?: string };
}) {
  const success = searchParams.success === "true";
  const error = searchParams.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-xl flex-col items-center justify-center py-16 px-8 bg-white dark:bg-black">
        <div className="flex flex-col items-center gap-8 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-black dark:text-zinc-50">
            Nudge
          </h1>

          <p className="max-w-md text-lg leading-7 text-zinc-600 dark:text-zinc-400">
            A personal Slack agent that reminds you to follow up on unanswered questions.
          </p>

          {success ? (
            <div className="flex flex-col items-center gap-4 p-6 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <p className="text-green-700 dark:text-green-400 font-medium">
                ✓ Nudge is now installed!
              </p>
              <p className="text-sm text-green-600 dark:text-green-500">
                Your questions will be tracked automatically. Use{" "}
                <code className="bg-green-100 dark:bg-green-800 px-1 rounded">/followups</code>{" "}
                in Slack to see pending items.
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 p-6 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-red-700 dark:text-red-400 font-medium">
                Something went wrong
              </p>
              <p className="text-sm text-red-600 dark:text-red-500">
                Error: {error}
              </p>
            </div>
          ) : (
            <a
              href="/api/slack/oauth"
              className="flex h-12 items-center justify-center gap-3 rounded-lg bg-[#4A154B] px-6 text-white font-medium transition-colors hover:bg-[#611f64]"
            >
              <svg width="20" height="20" viewBox="0 0 54 54" fill="none">
                <path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" fill="#36C5F0"/>
                <path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" fill="#2EB67D"/>
                <path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" fill="#ECB22E"/>
                <path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.386" fill="#E01E5A"/>
              </svg>
              Add to Slack
            </a>
          )}

          <div className="mt-8 text-sm text-zinc-500 dark:text-zinc-500">
            <p>
              <a
                href="https://github.com/vercel-labs/nudge"
                className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                View on GitHub
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
