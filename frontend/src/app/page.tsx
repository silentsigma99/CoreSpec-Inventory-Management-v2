"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function HomePage() {
  const { isLoading, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && profile) {
      // Redirect to inventory page
      router.push("/inventory");
    }
  }, [isLoading, profile, router]);

  // Loading state
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-zinc-400">Loading...</p>
      </div>
    </div>
  );
}
