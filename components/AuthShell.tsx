import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";

/* Shared shell for the logged-out auth pages (login, signup): a two-panel
   card that carries the landing page's brand into the auth flow. Left is a
   deep-ink brand panel (headline, proof bullets, a miniature balances
   card); right is the form. On small screens the panel collapses to a
   compact logo row above the form. */

function Check({ className = "h-5 w-5 text-brand" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}

const BULLETS = [
  "Free forever — no ads, no paywall on the basics",
  "Simplified settle-up: a web of IOUs becomes a couple of payments",
  "Receipts, charts, and 100+ currencies built in",
];

function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white lg:flex">
      <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand/20 blur-2xl" aria-hidden="true" />
      <div className="absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-brand/10 blur-2xl" aria-hidden="true" />
      <div className="relative space-y-8">
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
          SplitTab
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-black leading-tight tracking-tight">
            Split expenses with friends, <span className="text-brand">without the awkward math.</span>
          </h2>
          <p className="max-w-sm text-neutral-300">
            One running tab for dinners, trips, rent, and everything in between — everyone sees who owes whom.
          </p>
        </div>
        <ul className="space-y-2.5 text-sm text-neutral-200">
          {BULLETS.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-10 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Lisbon long weekend</span>
            <span className="rounded-full bg-brand/20 px-2 py-0.5 text-xs font-semibold text-brand">Group</span>
          </div>
          <div className="space-y-1.5 text-sm text-neutral-300">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Avatar name="Leo" seed="Leo" /> Leo pays Priya</span>
              <span className="font-semibold text-white">$41.20</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Avatar name="Maya" seed="Maya" /> Maya pays Leo</span>
              <span className="font-semibold text-white">$9.10</span>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-brand py-1.5 text-center text-xs font-semibold text-white">
            Settle up — and everyone&apos;s even
          </div>
        </div>
        <p className="text-xs text-neutral-400">Open source · GPLv3 · Your data stays exportable, always</p>
      </div>
    </aside>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl py-4 sm:py-8">
      <div className="grid overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl lg:grid-cols-[1.02fr_1fr]">
        <BrandPanel />
        <div className="p-6 sm:p-10">
          <div className="mb-6 flex items-center gap-2 text-lg font-bold tracking-tight text-ink lg:hidden">
            <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
            SplitTab
          </div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight sm:text-[1.7rem]">{title}</h1>
          <p className="mb-6 text-sm leading-relaxed text-neutral-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
