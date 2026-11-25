import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
// shadcn/ui-style components (Tailwind + cva-style variants) — see README note:
// a full shadcn CLI init was replaced by these equivalent hand-written primitives.
export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={clsx("inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-black", className)} {...props} />;
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("flex h-10 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm", className)} {...props} />;
}
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900", className)}>{children}</div>;
}
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium">{children}</label>;
}
