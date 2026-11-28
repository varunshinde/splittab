import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Avatar } from "@/components/Avatar";
import { Button, Card } from "@/components/ui/ui";

export const dynamic = "force-dynamic";

/* Landing page for logged-out visitors (logged-in users go straight to
   their dashboard). Original copy; layout in the spirit of classic
   expense-sharing homepages: hero + product mock, how it works, a full
   feature grid, a settle-up spotlight, and a security section. */

function Check({ className = "h-5 w-5 text-brand" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}

function Icon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  split: "M12 3v18 M5 8c2.5 0 2.5 4 5 4 M5 8h5 M19 16c-2.5 0-2.5-4-5-4 M19 16h-5",
  receipt: "M5 3h14v18l-2.3-1.6L14.4 21l-2.4-1.6L9.6 21l-2.3-1.6L5 21Z M9 8h6 M9 12h6",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3a15 15 0 0 1 0 18 a15 15 0 0 1 0-18Z",
  shield: "M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6Z M9 12l2 2 4-4",
  download: "M12 4v11 M7 11l5 5 5-5 M4 20h16",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3",
  layers: "M12 3 2 8l10 5 10-5Z M2 13l10 5 10-5",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8 M10.3 21a2 2 0 0 0 3.4 0",
  scale: "M12 4v16 M6 20h12 M12 6 5 6l3.5 6a3.5 3.5 0 0 1-7 0Z M12 6l7 0-3.5 6a3.5 3.5 0 0 0 7 0Z",
};

const FEATURES: Array<{ icon: string; title: string; body: string }> = [
  { icon: ICONS.users, title: "Groups & friends", body: "Roommates, trips, teams, family — add anyone by email, even before they sign up. Their share is waiting when they join." },
  { icon: ICONS.split, title: "Splits that fit the bill", body: "Split equally, by exact amounts, percentages, or shares. Itemize a receipt and assign each line to whoever actually had it." },
  { icon: ICONS.scale, title: "Balances at a glance", body: "Every group keeps a running ledger. See who owes whom, how much, and why — no spreadsheet archaeology." },
  { icon: ICONS.layers, title: "Simplified settle-up", body: "SplitTab collapses a web of IOUs into the fewest possible payments, so the group squares up in a couple of transfers." },
  { icon: ICONS.receipt, title: "Receipts attached", body: "Snap the receipt onto the expense. Anyone in the group can open it later — proof beats memory." },
  { icon: ICONS.globe, title: "100+ currencies", body: "Log expenses in the currency you spent, convert at tracked rates, and settle in the currency you call home." },
  { icon: ICONS.chart, title: "Charts & totals", body: "Monthly spending, per-person totals, and category breakdowns show where the group's money actually went." },
  { icon: ICONS.search, title: "Search & activity", body: "A full activity feed and fast search across every expense, comment, and settlement — nothing gets lost." },
  { icon: ICONS.download, title: "Your data, exportable", body: "Download your complete ledger any time. No lock-in, no hostage data, no ads — ever." },
];

function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -left-6 -top-6 h-28 w-28 rounded-full bg-brand-light" aria-hidden="true" />
      <div className="absolute -bottom-8 -right-4 h-36 w-36 rounded-full bg-brand-light" aria-hidden="true" />
      <Card className="relative shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-bold">Lisbon long weekend</div>
            <div className="text-xs text-neutral-500">4 friends · 12 expenses</div>
          </div>
          <span className="rounded-full bg-brand-light px-2.5 py-1 text-xs font-semibold text-brand-dark">Group</span>
        </div>
        <div className="space-y-2.5 text-sm">
          {[
            { name: "Maya", what: "Seafood dinner", amt: "$96.00", note: "split 4 ways" },
            { name: "Leo", what: "Tram passes", amt: "$38.40", note: "split 4 ways" },
            { name: "Priya", what: "Airbnb — night 2", amt: "$210.00", note: "split 4 ways" },
          ].map((r) => (
            <div key={r.what} className="flex items-center gap-3 rounded-lg bg-app px-3 py-2">
              <Avatar name={r.name} seed={r.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.what}</div>
                <div className="text-xs text-neutral-500">{r.name} paid · {r.note}</div>
              </div>
              <div className="font-semibold">{r.amt}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-neutral-100 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Simplified balances</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between"><span>Leo pays Priya</span><span className="font-semibold text-owe">$41.20</span></div>
            <div className="flex items-center justify-between"><span>You pay Priya</span><span className="font-semibold text-owe">$18.65</span></div>
            <div className="flex items-center justify-between"><span>Maya pays Leo</span><span className="font-semibold text-owe">$9.10</span></div>
          </div>
          <div className="mt-3 rounded-lg bg-brand py-2 text-center text-sm font-semibold text-white">Settle up — 3 payments and everyone&apos;s even</div>
        </div>
      </Card>
      <div className="absolute -right-3 top-16 hidden rotate-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg sm:block">
        <div className="text-xs text-neutral-500">Receipt attached</div>
        <div className="text-sm font-semibold">tasca-do-chico.pdf</div>
      </div>
      <div className="absolute -left-4 bottom-14 hidden -rotate-2 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg sm:flex">
        <Check className="h-4 w-4 text-brand" />
        <div className="text-sm font-semibold">Maya confirmed your payment</div>
      </div>
    </div>
  );
}

export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  return (
    <div className="space-y-20 pb-16 pt-6">
      {/* Hero */}
      <section className="grid items-center gap-10 lg:grid-cols-2">
        <div className="space-y-5 text-center lg:text-left">
          <img src="/logo-mark.svg" alt="SplitTab logo" className="mx-auto h-16 w-16 lg:mx-0" />
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight md:text-5xl">
            Split expenses with friends, <span className="text-brand">without the awkward math.</span>
          </h1>
          <p className="mx-auto max-w-lg text-lg text-neutral-600 lg:mx-0">
            SplitTab keeps a running tab for your group — dinners, trips, rent, and everything in between —
            so nobody has to be the spreadsheet person ever again.
          </p>
          <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
            <Link href="/signup"><Button className="px-7 py-3 text-base">Sign up free</Button></Link>
            <Link href="/login"><Button variant="secondary" className="px-7 py-3 text-base">Log in</Button></Link>
          </div>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-sm text-neutral-600 lg:justify-start">
            {["Free to use", "No ads", "Open source", "2-minute setup"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-brand" />{t}</li>
            ))}
          </ul>
        </div>
        <HeroMock />
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-8 text-center text-3xl font-black tracking-tight">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { n: "1", title: "Add an expense", body: "Anyone in the group logs what they paid — a dinner, a cab, the Airbnb — in seconds, receipt attached." },
            { n: "2", title: "SplitTab does the math", body: "Shares, percentages, and itemized lines are tallied into one clear balance per person. No formulas, no disputes." },
            { n: "3", title: "Settle up, simply", body: "The app reduces everyone's debts to the fewest payments. Both sides confirm, and the tab is closed." },
          ].map((s) => (
            <Card key={s.n} className="text-left">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-lg font-black text-white">{s.n}</div>
              <div className="mb-1 font-semibold">{s.title}</div>
              <p className="text-sm text-neutral-600">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="mb-2 text-center text-3xl font-black tracking-tight">Everything you need to stay even</h2>
        <p className="mx-auto mb-8 max-w-xl text-center text-neutral-600">The whole toolkit — groups, splits, receipts, currencies, and charts — in one calm, ad-free place.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="text-left">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark">
                <Icon d={f.icon} />
              </div>
              <div className="mb-1 font-semibold">{f.title}</div>
              <p className="text-sm text-neutral-600">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Settle-up spotlight */}
      <section className="overflow-hidden rounded-2xl bg-ink text-white">
        <div className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-12">
          <div className="space-y-3">
            <h2 className="text-3xl font-black tracking-tight">Six IOUs in, two payments out.</h2>
            <p className="text-neutral-300">
              In a busy group, everyone owes everyone a little of everything. SplitTab&apos;s simplify-debts engine
              nets it all out, so instead of a dozen awkward payment requests, the group settles with the fewest
              transfers possible — and each payment is confirmed by both sides before it counts.
            </p>
            <Link href="/signup"><Button className="px-6 py-3">Try it with your group</Button></Link>
          </div>
          <div className="space-y-2 rounded-xl bg-white/5 p-5 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Before</div>
            {["Leo → Maya $12", "Maya → You $30", "You → Leo $22", "Priya → Maya $9", "Leo → Priya $17", "You → Priya $14"].map((t) => (
              <div key={t} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5 text-neutral-300"><span>{t.split(" $")[0]}</span><span>${t.split(" $")[1]}</span></div>
            ))}
            <div className="mb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-brand">After — simplified</div>
            {["You → Maya $24", "Leo → Priya $27"].map((t) => (
              <div key={t} className="flex justify-between rounded-lg bg-brand/20 px-3 py-1.5 font-medium"><span>{t.split(" $")[0]}</span><span>${t.split(" $")[1]}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section>
        <h2 className="mb-8 text-center text-3xl font-black tracking-tight">Built like your money matters</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="text-left">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark"><Icon d={ICONS.shield} /></div>
            <div className="mb-1 font-semibold">Sign-ins that check twice</div>
            <p className="text-sm text-neutral-600">New devices confirm with an emailed code, passwords are hashed with bcrypt, and sign-ins from new places trigger an alert to you.</p>
          </Card>
          <Card className="text-left">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark"><Icon d={ICONS.bell} /></div>
            <div className="mb-1 font-semibold">Nothing counts unilaterally</div>
            <p className="text-sm text-neutral-600">Settlements only count once the other person confirms them — nobody can quietly rewrite the ledger in their own favor.</p>
          </Card>
          <Card className="text-left">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-dark"><Icon d={ICONS.download} /></div>
            <div className="mb-1 font-semibold">Leave whenever, data in hand</div>
            <p className="text-sm text-neutral-600">Export everything or delete your account entirely. Your name disappears from shared history — your friends&apos; records stay intact.</p>
          </Card>
        </div>
      </section>

      {/* Open source + final CTA */}
      <section className="space-y-6">
        <Card className="text-center">
          <h2 className="mb-2 text-2xl font-black tracking-tight">Free, open source, and yours</h2>
          <p className="mx-auto mb-4 max-w-lg text-neutral-600">
            SplitTab is GPLv3 open source — read the code, run your own copy, or just enjoy the hosted one.
            No ads, no selling data, no premium paywall on the basics.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/signup"><Button className="px-7 py-3 text-base">Create your free account</Button></Link>
            <a href="https://github.com/varunshinde/splittab" target="_blank" rel="noreferrer"><Button variant="secondary" className="px-7 py-3 text-base">View on GitHub</Button></a>
          </div>
        </Card>
        <footer className="flex flex-col items-center justify-between gap-2 pb-2 text-sm text-neutral-500 sm:flex-row">
          <span>SplitTab — split expenses, stay friends.</span>
          <span className="flex gap-4">
            <Link href="/login" className="hover:text-brand">Log in</Link>
            <Link href="/signup" className="hover:text-brand">Sign up</Link>
            <a href="https://github.com/varunshinde/splittab" target="_blank" rel="noreferrer" className="hover:text-brand">GitHub</a>
          </span>
        </footer>
      </section>
    </div>
  );
}
