"use client";

import { motion } from "framer-motion";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

// Icons (using simple SVG icons)
const icons = {
  inventory: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  ),
  transfer: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  ),
  sales: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  history: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  purchase: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  ),
};

interface NavItem {
  name: string;
  href: string;
  icon: keyof typeof icons;
  adminOnly?: boolean;
}

const navigation: NavItem[] = [
  { name: "Inventory", href: "/inventory", icon: "inventory" },
  { name: "Transfers", href: "/transfers", icon: "transfer", adminOnly: true },
  { name: "Purchases", href: "/purchases", icon: "purchase", adminOnly: true },
  { name: "Sales History", href: "/sales", icon: "sales" },
  { name: "History", href: "/history", icon: "history" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAdmin, profile } = useAuth();
  const { theme, setTheme } = useTheme();

  const filteredNavigation = navigation.filter(
    (item) => !item.adminOnly || isAdmin
  );

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col">
      <div className="flex flex-col flex-grow pt-5 bg-white dark:bg-black border-r border-black dark:border-[#B8860B] overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center justify-center flex-shrink-0 px-4 mb-6 pt-4">
          <div className="relative w-full max-w-[180px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="CoreSpec"
              className="h-auto w-full object-contain hidden dark:block"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-light.png"
              alt="CoreSpec"
              className="h-auto w-full object-contain dark:hidden"
            />
          </div>
        </div>

        {/* User Info */}
        {profile && (
          <div className="px-4 mb-6">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg">
              <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                {profile.full_name || "User"}
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 capitalize">{profile.role}</p>
              {profile.warehouse_name && (
                <p className="text-xs text-zinc-500 mt-1 truncate">
                  {profile.warehouse_name}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 pb-4">
          {filteredNavigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <div key={item.name} className="relative">
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute left-2 right-2 top-0.5 bottom-0.5 bg-blue-600 rounded-lg"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Link
                  href={item.href}
                  prefetch={true}
                  className={cn(
                    "group relative flex items-center px-5 py-3.5 text-sm font-medium transition-colors z-10 w-full",
                    isActive
                      ? "text-white"
                      : "text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white"
                  )}
                >
                  <motion.span
                    whileHover={{ x: 4 }}
                    transition={{ type: "spring", stiffness: 400, damping: 10 }}
                    className="flex items-center w-full"
                  >
                    <span className="mr-3">{icons[item.icon]}</span>
                    {item.name}
                  </motion.span>
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Theme Toggle */}
        <div className="p-4 border-t border-black dark:border-[#B8860B]/20 flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Toggle Theme"
          >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle Theme</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
