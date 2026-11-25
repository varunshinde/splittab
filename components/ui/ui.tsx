import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { formatMoney } from "@/lib/format";
// shadcn/ui-style primitives (Tailwind + clsx) styled with the SplitTab
// design tokens: brand teal primary, owe orange, ink text, white cards.

type Variant = "primary" | "owe" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  owe: "bg-owe text-white hover:bg-owe-dark",
  secondary: "bg-white text-ink border border-neutral-300 hover:bg-neutral-50",
  ghost: "bg-transparent text-ink hover:bg-neutral-100",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "flex h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30",
        className,
      )}
      {...props}
    />
  );
}

export const selectClass =
  "h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";
export const textareaClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-xl border border-neutral-200 bg-white p-4 shadow-sm", className)}>{children}</div>;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-neutral-700">
      {children}
    </label>
  );
}

/** Colored amount: teal when you're owed, orange when you owe, gray at zero. */
export function BalanceText({ cents, currency = "USD", className }: { cents: number; currency?: string; className?: string }) {
  const text = cents === 0 ? "settled up" : formatMoney(Math.abs(cents), currency);
  return (
    <span className={clsx("font-semibold", cents > 0 ? "text-brand" : cents < 0 ? "text-owe" : "text-neutral-400", className)}>
      {cents > 0 ? `owes you ${text}` : cents < 0 ? `you owe ${text}` : text}
    </span>
  );
}
