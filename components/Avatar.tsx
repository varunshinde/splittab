import { clsx } from "clsx";
import { avatarColor, initials } from "@/lib/format";

/** Round avatar with the user's initials on a deterministic palette color. */
export function Avatar({ name, seed, size = "md" }: { name: string; seed?: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  return (
    <span
      className={clsx("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", sz, avatarColor(seed ?? name))}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
