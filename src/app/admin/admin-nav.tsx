"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/directory", label: "Directory" },
  { href: "/admin/approvers", label: "Approvers" },
  { href: "/admin/apps", label: "Apps & Sync", superOnly: true },
  { href: "/admin/audit", label: "Audit" },
];

export function AdminNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {ITEMS.filter((item) => !item.superOnly || isSuperAdmin).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
