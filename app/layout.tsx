import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "OSS Splitwise", description: "Open-source Splitwise clone with Pro-tier features" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800"><nav className="mx-auto flex max-w-5xl gap-4 p-4 text-sm font-medium">
        <Link href="/">OSS Splitwise</Link><Link href="/groups">Groups</Link><Link href="/search">Search</Link><Link href="/settings">Settings</Link>
      </nav></header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </body></html>
  );
}
