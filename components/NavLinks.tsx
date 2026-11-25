"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/friends", label: "Friends" },
  { href: "/groups", label: "Groups" },
  { href: "/search", label: "Search" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ vertical = false }: { vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={clsx(vertical ? "flex flex-col gap-1" : "flex flex-wrap gap-1")}>
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-brand-light text-brand-dark" : "text-neutral-600 hover:bg-neutral-100 hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
