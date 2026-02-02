"use client";

import { useAuth } from "@/context/AuthContext";
import { MobileNav } from "./MobileNav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { profile, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-black border-b border-black dark:border-[#B8860B]">
      <div className="flex items-center justify-between h-16 px-4">
        {/* Mobile menu button */}
        <div className="flex items-center gap-4">
          <MobileNav />
          <div className="md:hidden w-32">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="CoreSpec"
              className="h-8 w-auto object-contain hidden dark:block"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-light.png"
              alt="CoreSpec"
              className="h-8 w-auto object-contain dark:hidden"
            />
          </div>
        </div>

        {/* Desktop user dropdown */}
        <div className="hidden md:flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2 text-zinc-900 dark:text-zinc-300 hover:text-black dark:hover:text-white"
              >
                <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-700 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {profile?.full_name?.[0]?.toUpperCase() || "U"}
                  </span>
                </div>
                <span className="hidden lg:inline-block">
                  {profile?.full_name || "User"}
                </span>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{profile?.full_name || "User"}</span>
                  <span className="text-xs font-normal text-zinc-500 capitalize">
                    {profile?.role}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {profile?.warehouse_name && (
                <>
                  <DropdownMenuItem disabled className="text-zinc-500">
                    {profile.warehouse_name}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => signOut()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile sign out */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-700 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {profile?.full_name?.[0]?.toUpperCase() || "U"}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {profile?.full_name || "User"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
