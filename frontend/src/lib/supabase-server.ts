/**
 * Server-side Supabase client and auth utilities for Next.js API routes.
 * Uses service role key to bypass RLS for admin operations.
 */

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Types
export interface UserContext {
  userId: string;
  email: string | null;
  role: "admin" | "partner" | "viewer";
  warehouseId: string | null;
}

export interface AuthResult {
  user: UserContext | null;
  error: NextResponse | null;
}

/**
 * Create a Supabase client with service role key (bypasses RLS).
 * Use this for admin operations in API routes.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create a Supabase client that reads auth from cookies.
 * Use this to verify the user's session.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

/**
 * Get the current authenticated user from the request.
 * Returns user context with role and warehouse info.
 */
export async function getUserFromRequest(): Promise<AuthResult> {
  try {
    // Get user from session cookie
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        user: null,
        error: NextResponse.json(
          { detail: "Unauthorized" },
          { status: 401 }
        ),
      };
    }

    // Use service client to fetch profile (bypasses RLS)
    const serviceClient = createServiceClient();

    // Get profile with role
    const { data: profiles } = await serviceClient
      .from("profiles")
      .select("*")
      .eq("id", user.id);

    let profile = profiles?.[0];

    // Auto-create profile if it doesn't exist
    if (!profile) {
      const newProfile = {
        id: user.id,
        role: "partner",
        full_name: user.email,
      };
      await serviceClient.from("profiles").insert(newProfile);
      profile = newProfile;
    }

    const role = (profile.role as "admin" | "partner" | "viewer") || "partner";

    // Get warehouse if user is a partner
    let warehouseId: string | null = null;
    if (role === "partner") {
      const { data: warehouses } = await serviceClient
        .from("warehouses")
        .select("id")
        .eq("manager_id", user.id);

      if (warehouses?.[0]) {
        warehouseId = warehouses[0].id;
      }
    }

    return {
      user: {
        userId: user.id,
        email: user.email || null,
        role,
        warehouseId,
      },
      error: null,
    };
  } catch (err) {
    console.error("Auth error:", err);
    return {
      user: null,
      error: NextResponse.json(
        { detail: "Authentication failed" },
        { status: 401 }
      ),
    };
  }
}

/**
 * Require admin role. Returns error response if not admin.
 */
export function requireAdmin(user: UserContext): NextResponse | null {
  if (user.role !== "admin") {
    return NextResponse.json(
      { detail: "Admin access required" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Require access to a specific warehouse. Returns error response if no access.
 * Admins have access to all warehouses.
 * Partners only have access to their assigned warehouse.
 */
export function requireWarehouseAccess(
  user: UserContext,
  warehouseId: string
): NextResponse | null {
  if (user.role === "admin" || user.role === "viewer") {
    return null;
  }

  if (user.warehouseId !== warehouseId) {
    return NextResponse.json(
      { detail: "You do not have access to this warehouse" },
      { status: 403 }
    );
  }

  return null;
}
