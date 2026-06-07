"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Lessons", icon: BookOpen },
  { href: "/worksheets", label: "Worksheets", icon: FileText },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/concepts", label: "Concepts", icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 border-r border-border bg-sidebar flex flex-col z-30">
      <div className="px-6 py-8">
        <Link href="/" className="block group">
          <h1
            className="text-2xl tracking-tight text-primary transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Mathesis
          </h1>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-1 font-light">
            Practice &middot; Track &middot; Master
          </p>
        </Link>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/"
                ? pathname === "/" || pathname.startsWith("/lessons")
                : pathname.startsWith(href);

            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-6 py-6 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="font-light">Ready</span>
        </div>
      </div>
    </aside>
  );
}
