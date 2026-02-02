"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

// User profile from our API
interface UserProfile {
  id: string;
  role: "admin" | "partner";
  full_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Track if we've already fetched profile to avoid redundant calls
  const profileFetchedRef = useRef(false);

  const supabase = getSupabaseClient();

  // Fetch user profile from our API
  const fetchProfile = async (force = false) => {
    // Skip if already fetched (unless forced)
    if (profileFetchedRef.current && !force) return;

    try {
      const profileData = await api.getMe();
      setProfile(profileData);
      profileFetchedRef.current = true;
    } catch (error) {
      console.error("Failed to fetch profile:", error);
      setProfile(null);
    }
  };

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Get initial session from cookie (fast, no network call)
        const {
          data: { session: initialSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Session error:", error);
          // Don't block - just proceed without session
        }

        if (initialSession) {
          setSession(initialSession);
          setUser(initialSession.user);
          await fetchProfile();
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        // Gracefully handle - user will be redirected to login
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes - only refetch profile on meaningful events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      // Only fetch profile on sign in, not on token refresh or initial session
      // (initAuth already handles initial session)
      if (event === "SIGNED_IN" && !profileFetchedRef.current) {
        await fetchProfile();
      } else if (event === "SIGNED_OUT") {
        setProfile(null);
        profileFetchedRef.current = false;
      }
      // Skip profile fetch for TOKEN_REFRESHED and INITIAL_SESSION events

      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setSession(null);
      router.push("/login"); // Redirect to login page
    } finally {
      setIsLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (session) {
      await fetchProfile(true); // Force refresh
    }
  };

  const value: AuthContextType = {
    user,
    profile,
    session,
    isLoading,
    isAdmin: profile?.role === "admin",
    signIn,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
