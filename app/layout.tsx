import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logoutAction } from "./auth-actions";
import { Avatar } from "@/components/Avatar";
import { NavLinks } from "@/components/NavLinks";
import { Button } from "@/components/ui/ui";

export const metadata: Metadata = { title: "OSS Splitwise", description: "Open-source Splitwise clone — split expenses with friends and groups" };

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-black text-white">S</span>
      OSS&nbsp;Splitwise
    </Link>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="en">
      <body className="min-h-screen bg-app text-ink antialiased">
        {!user ? (
          <>
            <header className="border-b border-neutral-200 bg-white">
              <div className="mx-auto flex max-w-6xl items-center justify-between p-3">
                <Logo />
                <div className="flex items-center gap-2">
                  <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-light">Log in</Link>
                  <Link href="/signup"><Button>Sign up free</Button></Link>
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-6xl p-4">{children}</main>
          </>
        ) : (
          <>
            <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white">
              <div className="mx-auto flex max-w-6xl items-center gap-3 p-3">
                <Logo />
                <div className="ml-auto flex items-center gap-2">
                  <Link href="/settle"><Button variant="owe">Settle up</Button></Link>
                  <Link href="/expenses/new"><Button>+ Add expense</Button></Link>
                  <details className="group relative">
                    <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                      <Avatar name={user.name} seed={user.email} />
                    </summary>
                    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
                      <div className="px-2 py-1.5">
                        <div className="text-sm font-semibold">{user.name}{user.isPro ? " · Pro" : ""}</div>
                        <div className="truncate text-xs text-neutral-500">{user.email}</div>
                      </div>
                      <Link href="/settings" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100">Settings</Link>
                      <Link href="/activity" className="block rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100">Activity</Link>
                      <form action={logoutAction}>
                        <button type="submit" className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50">Log out</button>
                      </form>
                    </div>
                  </details>
                </div>
              </div>
              <div className="border-t border-neutral-100 px-3 py-1.5 md:hidden">
                <NavLinks />
              </div>
            </header>
            <div className="mx-auto flex max-w-6xl gap-6 p-4">
              <aside className="sticky top-24 hidden h-fit w-52 shrink-0 md:block">
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <Avatar name={user.name} seed={user.email} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{user.name}</div>
                    <div className="truncate text-xs text-neutral-500">{user.isPro ? "Pro account" : "Free account"}</div>
                  </div>
                </div>
                <NavLinks vertical />
              </aside>
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </>
        )}
      </body>
    </html>
  );
}
