"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";

/* Interactive, account-free product demo for the landing page. Everything
   runs in the browser on seeded sample data — adding expenses, balances,
   simplified settle-up (with the product's real two-step confirm rule),
   charts, and receipt itemization all actually work. Nothing is sent to
   the server and nothing persists. */

type Person = { id: string; name: string };
const PEOPLE: Person[] = [
  { id: "you", name: "You" },
  { id: "maya", name: "Maya" },
  { id: "leo", name: "Leo" },
  { id: "priya", name: "Priya" },
];
const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? id;

const CATEGORIES = ["Food", "Stay", "Transport", "Fun"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_STYLES: Record<Category, string> = {
  Food: "bg-orange-100 text-orange-700",
  Stay: "bg-indigo-100 text-indigo-700",
  Transport: "bg-sky-100 text-sky-700",
  Fun: "bg-pink-100 text-pink-700",
};

type Expense = { id: number; desc: string; cents: number; paidBy: string; among: string[]; category: Category };
const SEED_EXPENSES: Expense[] = [
  { id: 1, desc: "Seafood dinner", cents: 9600, paidBy: "maya", among: ["you", "maya", "leo", "priya"], category: "Food" },
  { id: 2, desc: "Airbnb — night 1", cents: 21000, paidBy: "you", among: ["you", "maya", "leo", "priya"], category: "Stay" },
  { id: 3, desc: "Tram passes", cents: 3840, paidBy: "leo", among: ["you", "maya", "leo", "priya"], category: "Transport" },
  { id: 4, desc: "Surf lesson", cents: 12000, paidBy: "priya", among: ["you", "maya", "priya"], category: "Fun" },
  { id: 5, desc: "Groceries for the flat", cents: 5430, paidBy: "leo", among: ["you", "maya", "leo", "priya"], category: "Food" },
];

type Settlement = { from: string; to: string; cents: number };

type ReceiptItem = { id: number; name: string; cents: number; assign: string }; // assign: personId or "all"
const SEED_RECEIPT: ReceiptItem[] = [
  { id: 1, name: "Grilled sardines", cents: 1800, assign: "maya" },
  { id: 2, name: "Seafood rice for two", cents: 3200, assign: "all" },
  { id: 3, name: "Vinho verde", cents: 1400, assign: "leo" },
  { id: 4, name: "Octopus salad", cents: 2100, assign: "you" },
  { id: 5, name: "Pastéis de nata ×4", cents: 900, assign: "priya" },
];

const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

function splitShares(cents: number, among: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const base = Math.floor(cents / among.length);
  let remainder = cents - base * among.length;
  for (const id of among) {
    out.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

function computeNets(expenses: Expense[], confirmed: Settlement[]): Map<string, number> {
  const nets = new Map<string, number>(PEOPLE.map((p) => [p.id, 0]));
  for (const e of expenses) {
    nets.set(e.paidBy, (nets.get(e.paidBy) ?? 0) + e.cents);
    for (const [id, share] of splitShares(e.cents, e.among)) {
      nets.set(id, (nets.get(id) ?? 0) - share);
    }
  }
  for (const s of confirmed) {
    nets.set(s.from, (nets.get(s.from) ?? 0) + s.cents);
    nets.set(s.to, (nets.get(s.to) ?? 0) - s.cents);
  }
  return nets;
}

function simplify(nets: Map<string, number>): Settlement[] {
  const debtors = [...nets.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).map(([id, v]) => ({ id, amt: -v }));
  const creditors = [...nets.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, amt: v }));
  const out: Settlement[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, cents: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i += 1;
    if (creditors[j].amt === 0) j += 1;
  }
  return out;
}

const TABS = ["Expenses", "Balances", "Settle up", "Charts", "Receipt split"] as const;
type Tab = (typeof TABS)[number];

export function DemoPlayground() {
  const [tab, setTab] = useState<Tab>("Expenses");
  const [expenses, setExpenses] = useState<Expense[]>(SEED_EXPENSES);
  const [confirmed, setConfirmed] = useState<Settlement[]>([]);
  const [pending, setPending] = useState<Settlement | null>(null);
  const [receipt, setReceipt] = useState<ReceiptItem[]>(SEED_RECEIPT);
  const [nextId, setNextId] = useState(100);

  // Add-expense form state
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("you");
  const [category, setCategory] = useState<Category>("Food");
  const [among, setAmong] = useState<string[]>(PEOPLE.map((p) => p.id));
  const [formError, setFormError] = useState("");

  const nets = useMemo(() => computeNets(expenses, confirmed), [expenses, confirmed]);
  const suggestions = useMemo(() => simplify(nets), [nets]);
  const totalSpent = expenses.reduce((s, e) => s + e.cents, 0);
  const allSettled = suggestions.length === 0 && !pending;

  const paidTotals = useMemo(() => {
    const m = new Map<string, number>(PEOPLE.map((p) => [p.id, 0]));
    for (const e of expenses) m.set(e.paidBy, (m.get(e.paidBy) ?? 0) + e.cents);
    return m;
  }, [expenses]);
  const categoryTotals = useMemo(() => {
    const m = new Map<Category, number>(CATEGORIES.map((c) => [c, 0]));
    for (const e of expenses) m.set(e.category, (m.get(e.category) ?? 0) + e.cents);
    return m;
  }, [expenses]);
  const receiptTotals = useMemo(() => {
    const m = new Map<string, number>(PEOPLE.map((p) => [p.id, 0]));
    for (const item of receipt) {
      if (item.assign === "all") {
        for (const [id, share] of splitShares(item.cents, PEOPLE.map((p) => p.id))) m.set(id, (m.get(id) ?? 0) + share);
      } else {
        m.set(item.assign, (m.get(item.assign) ?? 0) + item.cents);
      }
    }
    return m;
  }, [receipt]);

  function toggleAmong(id: string) {
    setAmong((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addExpense(ev: React.FormEvent) {
    ev.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!desc.trim()) return setFormError("Give the expense a name.");
    if (!Number.isFinite(cents) || cents <= 0) return setFormError("Enter an amount above $0.");
    if (among.length === 0) return setFormError("Pick at least one person to split with.");
    setFormError("");
    setExpenses((prev) => [{ id: nextId, desc: desc.trim(), cents, paidBy, among: [...among], category }, ...prev]);
    setNextId((n) => n + 1);
    setDesc("");
    setAmount("");
  }

  function resetDemo() {
    setExpenses(SEED_EXPENSES);
    setConfirmed([]);
    setPending(null);
    setReceipt(SEED_RECEIPT);
    setFormError("");
  }

  const tabBtn = (t: Tab) =>
    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-brand text-white" : "bg-app text-neutral-600 hover:bg-brand-light hover:text-brand-dark"}`;

  return (
    <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
      {/* Demo header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-2.5">
          <span className="flex -space-x-2">
            {PEOPLE.map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-white"><Avatar name={p.name} seed={p.id} /></span>
            ))}
          </span>
          <div>
            <div className="font-bold leading-tight">Lisbon long weekend</div>
            <div className="text-xs text-neutral-500">4 friends · {expenses.length} expenses · {fmt(totalSpent)} total</div>
          </div>
        </div>
        <span className="rounded-full bg-owe/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-owe">Live demo</span>
        <button type="button" onClick={resetDemo} className="ml-auto text-sm font-medium text-neutral-400 hover:text-brand">Reset demo</button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 px-5 pt-4 sm:px-7">
        {TABS.map((t) => (
          <button key={t} type="button" className={tabBtn(t)} onClick={() => setTab(t)}>
            {t}
            {t === "Settle up" && suggestions.length > 0 && (
              <span className="ml-1.5 rounded-full bg-owe px-1.5 py-0.5 text-[0.65rem] font-bold text-white">{suggestions.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="px-5 py-5 sm:px-7">
        {tab === "Expenses" && (
          <div className="space-y-4">
            <form onSubmit={addExpense} className="space-y-3 rounded-2xl bg-app p-4">
              <div className="text-sm font-semibold">Add an expense — try it</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Taxi to the airport" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$ 0.00" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-500">Paid by</span>
                <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm">
                  {PEOPLE.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-neutral-500">Split between</span>
                <span className="flex flex-wrap gap-1.5">
                  {PEOPLE.map((p) => (
                    <button key={p.id} type="button" onClick={() => toggleAmong(p.id)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${among.includes(p.id) ? "bg-brand text-white" : "bg-white text-neutral-500 ring-1 ring-neutral-300"}`}>
                      {p.name}
                    </button>
                  ))}
                </span>
                <button type="submit" className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Add expense</button>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </form>

            <ul className="divide-y divide-neutral-100">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={nameOf(e.paidBy)} seed={e.paidBy} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{e.desc}</div>
                    <div className="text-xs text-neutral-500">
                      {nameOf(e.paidBy)} paid · split {e.among.length === PEOPLE.length ? "4 ways" : `between ${e.among.map(nameOf).join(", ")}`}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[e.category]}`}>{e.category}</span>
                  <span className="w-20 text-right text-sm font-semibold">{fmt(e.cents)}</span>
                  <button type="button" title="Remove expense" onClick={() => setExpenses((prev) => prev.filter((x) => x.id !== e.id))} className="text-neutral-300 hover:text-red-500">✕</button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-neutral-400">Tip: add or remove an expense, then check the Balances and Settle up tabs — everything recalculates instantly.</p>
          </div>
        )}

        {tab === "Balances" && (
          <div className="space-y-3">
            {PEOPLE.map((p) => {
              const net = nets.get(p.id) ?? 0;
              const max = Math.max(...[...nets.values()].map((v) => Math.abs(v)), 1);
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <Avatar name={p.name} seed={p.id} />
                  <span className="w-14 text-sm font-medium">{p.name}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-app">
                    <div className={`h-full rounded-full ${net >= 0 ? "bg-brand" : "bg-owe"}`} style={{ width: `${Math.max(4, (Math.abs(net) / max) * 100)}%` }} />
                  </div>
                  <span className={`w-32 text-right text-sm font-semibold ${net > 0 ? "text-brand" : net < 0 ? "text-owe" : "text-neutral-400"}`}>
                    {net > 0 ? `is owed ${fmt(net)}` : net < 0 ? `owes ${fmt(net)}` : "settled up"}
                  </span>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-neutral-400">One running ledger per group — no spreadsheet, no mental math, no &ldquo;wait, who got the taxi?&rdquo;</p>
          </div>
        )}

        {tab === "Settle up" && (
          <div className="space-y-3">
            {pending && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold">{nameOf(pending.from)} recorded a payment of {fmt(pending.cents)} to {nameOf(pending.to)}</div>
                <p className="mt-0.5 text-sm text-neutral-600">In SplitTab a settlement only counts once the other side confirms it — nobody can rewrite the ledger alone. Confirm it as {nameOf(pending.to)}:</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => { setConfirmed((prev) => [...prev, pending]); setPending(null); }} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Confirm as {nameOf(pending.to)}</button>
                  <button type="button" onClick={() => setPending(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-600 ring-1 ring-neutral-300 hover:bg-app">Reject</button>
                </div>
              </div>
            )}
            {suggestions.map((s) => (
              <div key={`${s.from}-${s.to}-${s.cents}`} className="flex flex-wrap items-center gap-3 rounded-2xl bg-app px-4 py-3">
                <span className="flex items-center gap-2 text-sm"><Avatar name={nameOf(s.from)} seed={s.from} /> <strong>{nameOf(s.from)}</strong> pays <strong>{nameOf(s.to)}</strong></span>
                <span className="text-sm font-bold text-owe">{fmt(s.cents)}</span>
                <button type="button" disabled={!!pending} onClick={() => setPending(s)} className="ml-auto rounded-lg bg-owe px-4 py-2 text-sm font-semibold text-white hover:bg-owe-dark disabled:cursor-not-allowed disabled:opacity-40">
                  Record payment
                </button>
              </div>
            ))}
            {allSettled && (
              <div className="rounded-2xl bg-brand-light px-4 py-6 text-center">
                <div className="font-bold text-brand-dark">Everyone&apos;s even — no payments left.</div>
                <p className="text-sm text-neutral-600">That&apos;s the whole point. Add an expense in the Expenses tab to stir things up again.</p>
              </div>
            )}
            {confirmed.length > 0 && (
              <p className="text-xs text-neutral-400">Confirmed so far: {confirmed.map((s) => `${nameOf(s.from)} → ${nameOf(s.to)} ${fmt(s.cents)}`).join(" · ")}</p>
            )}
            <p className="text-xs text-neutral-400">SplitTab&apos;s simplify-debts engine turns the group&apos;s whole web of IOUs into the fewest payments possible — here, {suggestions.length + confirmed.length} instead of one per expense.</p>
          </div>
        )}

        {tab === "Charts" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold">Who paid</div>
              <div className="space-y-2">
                {PEOPLE.map((p) => {
                  const v = paidTotals.get(p.id) ?? 0;
                  const max = Math.max(...paidTotals.values(), 1);
                  return (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="w-12">{p.name}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-app"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></div>
                      <span className="w-16 text-right font-medium">{fmt(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">Where it went</div>
              <div className="space-y-2">
                {CATEGORIES.map((c) => {
                  const v = categoryTotals.get(c) ?? 0;
                  const max = Math.max(...categoryTotals.values(), 1);
                  return (
                    <div key={c} className="flex items-center gap-2 text-sm">
                      <span className="w-20"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[c]}`}>{c}</span></span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-app"><div className="h-full rounded-full bg-owe" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></div>
                      <span className="w-16 text-right font-medium">{fmt(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-neutral-400 sm:col-span-2">The real app adds monthly trends and per-person breakdowns for every group and friend.</p>
          </div>
        )}

        {tab === "Receipt split" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-app/60 p-4">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-bold">Tasca do Chico</span>
                <span className="text-xs text-neutral-500">Receipt · itemized</span>
              </div>
              <ul className="divide-y divide-neutral-200/70">
                {receipt.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1">{item.name}</span>
                    <span className="font-medium">{fmt(item.cents)}</span>
                    <select
                      value={item.assign}
                      onChange={(e) => setReceipt((prev) => prev.map((x) => (x.id === item.id ? { ...x, assign: e.target.value } : x)))}
                      className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs"
                      aria-label={`Assign ${item.name}`}
                    >
                      <option value="all">Everyone</option>
                      {PEOPLE.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between border-t border-neutral-300 pt-2 text-sm font-semibold">
                <span>Total</span><span>{fmt(receipt.reduce((s, i) => s + i.cents, 0))}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PEOPLE.map((p) => (
                <div key={p.id} className="rounded-xl bg-app px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-xs text-neutral-500"><Avatar name={p.name} seed={p.id} /> {p.name}</div>
                  <div className="font-bold">{fmt(receiptTotals.get(p.id) ?? 0)}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-neutral-400">Assign each line to whoever had it — shared plates split across everyone. No more &ldquo;I only had a salad&rdquo; math at the table.</p>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 bg-app/60 px-5 py-3 text-center text-xs text-neutral-400 sm:px-7">
        Demo data lives only in this browser tab — nothing is saved or sent anywhere. Sign up to keep your own groups for real.
      </div>
    </div>
  );
}
