import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <main className="flex flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-5xl">🚦</span>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Traffic Alert
          </h1>
          <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
            Real-time crowd-sourced traffic updates for Dhaka.
            Skip the jams, find better routes.
          </p>
        </div>
        <Link
          href="/chat"
          className="rounded-full bg-zinc-900 px-8 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Open Chat
        </Link>
      </main>
    </div>
  );
}
