# Code Review — 10 February 2026

**Scope:** Uncommitted changes on `main`

| File | Status | Lines |
|------|--------|-------|
| `frontend/src/app/(dashboard)/inventory/page.tsx` | Modified | ~1008 |
| `frontend/src/hooks/useIsMobile.ts` | New | 13 |
| `database/migrations/014_reverse_sale.sql` | New | 74 |

Reviewer context: full read of the changed files plus the surrounding codebase (schema, RLS policies, API routes, `AuthContext`, `api.ts`, `supabase-server.ts`, `void_invoice` function, existing hooks).

---

## 1. `frontend/src/hooks/useIsMobile.ts` (New file)

### 1.1 Summary

A lightweight React hook that returns `true` when the viewport is <= 767 px. Used in the inventory page to swap between an inline expanded row (desktop) and a bottom `Sheet` (mobile) for the quick-sell form.

### 1.2 Correctness

| Check | Result | Notes |
|-------|--------|-------|
| SSR safety | Pass | `useState(false)` + `useEffect` means the hook never touches `window` during server render. Server and first client paint agree on `false`, avoiding hydration mismatch. |
| Resize / orientation | Pass | `matchMedia("change")` fires on any viewport width change that crosses the breakpoint. |
| Cleanup | Pass | `removeEventListener` on unmount prevents leaks. |
| Re-render efficiency | Pass | The effect runs once (`[]`), and the listener only sets state when the boolean actually changes (MQL only fires when the match flips). |

### 1.3 Issues

#### [Low] Initial value mismatch on mobile devices

The hook always starts as `false` (desktop). On a real phone, for the first paint the inventory page will render the desktop expand row, then swap to the Sheet after the effect fires.

- **Impact:** A ~16 ms flash of the wrong UI on mobile. Functionally harmless because the expand row is hidden until the user taps a row.
- **Fix (optional):** Accept a `defaultValue` param, or set initial state from `typeof window !== "undefined" ? window.matchMedia(...).matches : false` (safe because `useState` initialiser runs only on first render, but be cautious with SSR frameworks — here it's fine since the component is `"use client"`).

#### [Nit] Hardcoded breakpoint

767 px works for this project but isn't reusable elsewhere. A small improvement:

```ts
export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`;
  // ...
}
```

### 1.4 Verdict

Clean, correct, idiomatic. No blocking issues.

---

## 2. `database/migrations/014_reverse_sale.sql` (New file)

### 2.1 Summary

Adds soft-delete capability to the `transactions` table and a `reverse_sale` RPC that undoes a standalone (non-invoiced) SALE transaction by:
1. Restoring inventory quantity.
2. Inserting an ADJUSTMENT audit record.
3. Soft-deleting the original SALE (sets `deleted_at = NOW()`).

### 2.2 DDL review

| Check | Result | Notes |
|-------|--------|-------|
| `ALTER TABLE ADD COLUMN IF NOT EXISTS` | Pass | Idempotent; safe to re-run. |
| Partial index `WHERE deleted_at IS NOT NULL` | See 2.3.1 | Indexes "deleted" rows, but queries filter for "active" rows. |
| `CREATE OR REPLACE FUNCTION` | Pass | Idempotent. |

### 2.3 Function logic review

#### Control flow

```
Lock transaction FOR UPDATE
  -> NULL check (not found or already soft-deleted)
  -> Type guard (must be SALE)
  -> Invoice guard (cannot reverse invoiced sales — use void_invoice)
Lock inventory row FOR UPDATE
  -> If inventory row missing: INSERT new row
  -> Else: UPDATE quantity += original qty
Insert ADJUSTMENT audit record
Soft-delete original transaction (set deleted_at)
Return TRUE
```

#### Correctness table

| Check | Result | Notes |
|-------|--------|-------|
| Row locking | Pass | Both the transaction and inventory rows are locked with `FOR UPDATE`, preventing concurrent modifications. Matches `record_sale`, `record_transfer`, and `void_invoice` patterns. |
| Guard: not found / already deleted | Pass | `WHERE deleted_at IS NULL` combined with `FOR UPDATE` prevents double-reversal races. |
| Guard: type check | Pass | Only allows `SALE`. |
| Guard: invoice check | Pass | Prevents reversing invoiced sales, correctly directing users to `void_invoice` instead. Consistent with API route at `sales/[transactionId]/route.ts` which performs the same check. |
| Inventory restoration | Pass | Handles both cases: (a) inventory row exists — add quantity back, (b) row was deleted — create new row. Case (b) is defensive and handles edge cases like product re-assignment. |
| Audit trail | Pass | ADJUSTMENT record with `to_warehouse_id` matching the original sale's `from_warehouse_id`. This matches the `void_invoice` pattern exactly (migration 013, line 118-126). |
| Soft-delete | Pass | Sets `deleted_at = NOW()` on the original transaction. |
| `SET search_path = ''` | Pass | Matches all other functions in migration 011+. Prevents search_path injection. |
| Return type | Pass | Returns `BOOLEAN`. |

### 2.3 Issues

#### 2.3.1 [Medium] Partial index direction is backwards

```sql
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at
ON public.transactions(deleted_at)
WHERE deleted_at IS NOT NULL;
```

This indexes only the **deleted** rows. However, the dominant query pattern (in `transactions/[warehouseId]/route.ts`, lines 143 and 167) is:

```sql
WHERE deleted_at IS NULL
```

The partial index won't help these queries — Postgres can't use a `WHERE IS NOT NULL` index to satisfy an `IS NULL` filter. The existing `idx_transactions_created_at` (on `created_at DESC`) is what these queries actually use, but as the number of soft-deleted rows grows, every transaction query will still scan deleted rows.

**Recommendation:** Either replace or supplement with an index that covers active rows:

```sql
-- Covers the most common query: "active transactions ordered by date"
CREATE INDEX IF NOT EXISTS idx_transactions_active
ON public.transactions(created_at DESC)
WHERE deleted_at IS NULL;
```

Keep the `deleted_at IS NOT NULL` index only if you anticipate admin queries that list deleted transactions.

#### 2.3.2 [Medium] No UPDATE policy on transactions table

The function performs:

```sql
UPDATE public.transactions SET deleted_at = NOW() WHERE id = p_transaction_id;
```

But scanning every migration reveals that the `transactions` table has **no RLS UPDATE policy** — only SELECT and INSERT policies exist (migrations 002, 005, 012).

**Why it works today:** The API route (`sales/[transactionId]/route.ts`, line 27) calls this RPC via `createServiceClient()` which uses the service role key and bypasses RLS entirely. This is consistent with how `void_invoice` and all other RPC calls work in this codebase.

**Why it's still a concern:**
- If anyone calls `reverse_sale` via a regular authenticated Supabase client (e.g., from a future client-side call or a different API route using the anon key), the UPDATE will be silently blocked by RLS.
- Adding a targeted UPDATE policy or marking the function `SECURITY DEFINER` would make the function self-contained and not dependent on the caller using a service key.

**Recommendation (pick one):**

*Option A — Add an UPDATE policy (preferred, minimal scope):*
```sql
CREATE POLICY "Update transactions for soft-delete"
    ON public.transactions FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
```

*Option B — Make the function `SECURITY DEFINER`:*
```sql
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
```
This would match the pattern used by `handle_new_user` and helper functions in migration 002/005. However, the other data-mutation RPCs (`record_sale`, `record_transfer`, `void_invoice`) are **not** `SECURITY DEFINER` and also rely on the service client, so Option A is more consistent.

#### 2.3.3 [Low] No GRANT EXECUTE statement

Other functions in the codebase don't include explicit `GRANT EXECUTE` either (they rely on the service client which is the function owner's role). This is consistent, but worth noting: if you ever need to call this from a non-service context, you'd need:

```sql
GRANT EXECUTE ON FUNCTION public.reverse_sale(UUID, UUID) TO authenticated;
```

#### 2.3.4 [Low] Audit note could be richer

The current note:
```sql
'Reversed sale ' || v_txn.id::TEXT
```

Compare with `void_invoice`:
```sql
'Voided Invoice ' || v_invoice.invoice_number
```

The sale's `reference_note` (e.g., "John's Auto Shop") and the original date would be helpful for support/audit. Suggestion:

```sql
'Reversed sale ' || v_txn.id::TEXT
    || COALESCE(' (' || v_txn.reference_note || ')', '')
```

#### 2.3.5 [Info] No migration for downstream query changes

The transactions API route (`transactions/[warehouseId]/route.ts`) already filters `deleted_at IS NULL` (lines 143, 167), and the `sales/[transactionId]/route.ts` DELETE endpoint already checks `transaction.deleted_at`. These were clearly added alongside this migration — good coordination.

### 2.4 Verdict

Logic is sound and consistent with `void_invoice`. The row locking, guards, and audit pattern are correct. The two medium items (index direction and missing UPDATE policy) are worth addressing before this migration runs against production.

---

## 3. `frontend/src/app/(dashboard)/inventory/page.tsx` (Modified)

### 3.1 Summary

The inventory page is a complex component (~1008 lines) that serves multiple user flows:

- **Partner view:** Inventory table with click-to-expand quick-sell (desktop = inline row, mobile = bottom Sheet).
- **Admin view — Main Warehouse:** Inventory table with checkbox-based bulk transfer.
- **Admin view — Partner Warehouse:** Same as partner view (expand to sell).
- **Viewer:** Read-only inventory table.

The modification adds the `useIsMobile` hook integration to conditionally render the sale form as either an inline expanded `<TableRow>` (desktop) or a `<Sheet>` bottom drawer (mobile).

### 3.2 Architecture and patterns

| Check | Result | Notes |
|-------|--------|-------|
| Client component (`"use client"`) | Pass | Required for hooks, mutations, and interactive state. |
| TanStack Query for server state | Pass | Consistent with project pattern. Proper `queryKey` arrays for cache segmentation. |
| Auth context usage | Pass | `isAdmin`, `isViewer`, `canSell` derived correctly from `useAuth()`. |
| API client usage | Pass | Uses `api.recordSale()`, `api.createBulkTransfer()`, `api.getInventory()`. |
| Cache invalidation | Pass | Both `["inventory"]` and `["transactions"]` invalidated after sale/transfer mutations. |
| shadcn/ui components | Pass | `Table`, `Card`, `Sheet`, `Select`, `Input`, `Button`, `Badge`, `Skeleton` all from `@/components/ui`. |
| Dark mode | Pass | All elements have explicit dark variants. Matches project pattern. |

### 3.3 Issues

#### 3.3.1 [Medium] Duplicated profit/total/stock-after-sale calculation (3 copies)

The same profit calculation logic appears in three places:

1. **Desktop expanded row — inline profit hint** (lines 719-733): unit profit + total profit under the price input.
2. **Desktop expanded row — summary footer** (lines 761-783): total, profit, stock after sale.
3. **Mobile Sheet — profit hint** (lines 929-943) and **summary** (lines 961-983): duplicates of #1 and #2.

Each copy independently parses `sellPrice`/`sellQuantity` and computes the same values. If business logic changes (e.g., adding tax), all three must be updated.

**Recommendation:** Extract a helper:

```ts
function computeSaleSummary(
  sellPrice: string,
  sellQuantity: string,
  costPrice: number | undefined | null,
  quantityOnHand: number
) {
  const qty = parseInt(sellQuantity || "0", 10);
  const price = parseFloat(sellPrice || "0");
  const total = price * (isNaN(qty) ? 0 : qty);
  const unitProfit = costPrice != null ? price - costPrice : null;
  const totalProfit = unitProfit != null ? unitProfit * (isNaN(qty) ? 0 : qty) : null;
  const stockAfter = quantityOnHand - (isNaN(qty) ? 0 : qty);
  return { qty, price, total, unitProfit, totalProfit, stockAfter };
}
```

Then use it in both desktop and mobile blocks, reducing ~90 lines of near-identical JSX + calculation to shared helpers.

#### 3.3.2 [Medium] "Total Units" stat card computes on current page, not full inventory

```tsx
// Line 517
inventory?.items.reduce((sum, item) => sum + item.quantity_on_hand, 0) || 0
```

`inventory.items` is the **current page** (50/100/200 items), not the full warehouse. When paginated, "Total Units" shows the sum for only the visible page, which is misleading.

- "Products" (`total_items`) and "Low Stock" (`low_stock_count`) are server-side totals — they're correct.
- "Total Units" is a client-side sum of the current page.

**Options:**
- Add a `total_units` field to the API response (computed server-side).
- Or rename the card to "Page Units" / "Visible Units" to set expectations.

#### 3.3.3 [Low] Select-all checkbox lacks indeterminate state

Lines 534-536:

```tsx
checked={inventory?.items?.length
  ? inventory.items.filter((i) => i.quantity_on_hand > 0).length > 0 &&
    inventory.items.filter((i) => i.quantity_on_hand > 0).every((i) => selectedItems[i.product_id])
  : false}
```

The checkbox shows either "all selected" or "none selected". When some items are checked, it shows unchecked, which is confusing. A `ref` callback to set `indeterminate` would be more standard:

```tsx
<input
  type="checkbox"
  ref={(el) => {
    if (el) {
      const withStock = inventory?.items?.filter((i) => i.quantity_on_hand > 0) ?? [];
      const selectedCount = withStock.filter((i) => selectedItems[i.product_id]).length;
      el.indeterminate = selectedCount > 0 && selectedCount < withStock.length;
    }
  }}
  checked={/* ... */}
  onChange={/* ... */}
/>
```

#### 3.3.4 [Low] PDF export hard limit of 10,000 items

Line 309:

```ts
const allData = await api.getInventory(selectedWarehouse, { limit: 10000 });
```

The API caps `page_size` at 200 (`supabase-server` inventory route, line 49: `Math.min(..., 200)`), so `limit: 10000` is silently clamped to 200. The PDF would only contain the first 200 items.

**Fix:** Either:
- Paginate client-side (loop until all pages fetched).
- Add a dedicated export endpoint that bypasses the 200-item cap.
- Increase the cap for export requests (with a query param like `?export=true`).

#### 3.3.5 [Low] `handleRowClick` shows toast for zero-stock, but the row already has `opacity-60` and no cursor

Line 227-229:

```tsx
if (item.quantity_on_hand <= 0) {
  toast.error("No stock available to sell");
  return;
}
```

The row click handler is already guarded at line 605:

```tsx
onClick={() => canSell && !(showTransferUI && isMainWarehouse) && hasStock && handleRowClick(item)}
```

`hasStock` is `item.quantity_on_hand > 0`, so when `hasStock` is `false`, the `onClick` short-circuits and `handleRowClick` is never called. The toast inside `handleRowClick` is dead code for the zero-stock case.

Not harmful, but could be removed for clarity.

#### 3.3.6 [Low] Transfer quantity input doesn't prevent exceeding stock

Line 639-645:

```tsx
<Input
  type="number"
  min={1}
  max={item.quantity_on_hand}
  value={transferQty}
  onChange={(e) => handleTransferQuantityChange(item.product_id, e.target.value)}
/>
```

The `max` attribute is a hint for browser UI (spinner), but doesn't prevent typing a larger number. `handleTransferQuantityChange` (line 254-258) only checks `qty >= 1`:

```ts
const qty = parseInt(value, 10);
if (isNaN(qty) || qty < 1) return;
```

A user can type 999 for an item with stock of 5. The server-side `record_bulk_transfer` RPC will reject it, but a client-side guard would prevent wasted network calls and give instant feedback.

**Fix:** Add an upper bound check:

```ts
const maxQty = inventory?.items.find(i => i.product_id === productId)?.quantity_on_hand;
if (maxQty !== undefined && qty > maxQty) return;
```

#### 3.3.7 [Low] Price validation allows `0`

Line 352-355:

```ts
const price = sellPrice ? parseFloat(sellPrice) : undefined;
if (price !== undefined && (isNaN(price) || price < 0)) {
  toast.error("Price must be a valid positive number");
  return;
}
```

`price < 0` rejects negatives, but `price === 0` is allowed. A zero-price sale is valid (promotional, sample), so this may be intentional. If not, change to `price <= 0`.

#### 3.3.8 [Info] Component size

At ~1008 lines, this is a large single component. The desktop expand row and mobile Sheet share a lot of structure. Extracting sub-components (e.g., `<SaleForm>`, `<TransferToolbar>`, `<InventoryStatsCards>`) would improve readability and testability. Not a bug, but worth considering as the page grows.

#### 3.3.9 [Info] Animation variants defined inside render

Lines 378-391:

```tsx
const containerVariants = { /* ... */ };
const itemVariants = { /* ... */ };
```

These objects are recreated on every render. Since they're static, moving them outside the component (or wrapping in `useMemo`) avoids unnecessary object allocation. Performance impact is negligible for this page, but it's a good practice.

### 3.4 Mobile Sheet integration review

The new `isMobile` integration is well-done:

| Check | Result | Notes |
|-------|--------|-------|
| Desktop: expanded row renders only when `!isMobile` | Pass | Line 673: `{!isMainWarehouse && !isMobile && (` |
| Mobile: Sheet renders only when `isMobile` | Pass | Line 887: `{isMobile && (` |
| Sheet opens based on `expandedItem` | Pass | `open={!!expandedItem}` — reuses existing `expandedRowId` state. |
| Sheet close resets form | Pass | `onOpenChange` calls `handleCancel()`. |
| Auto-focus prevented | Pass | `onOpenAutoFocus={(e) => e.preventDefault()}` — good for mobile keyboards. |
| Sheet close button hidden | Pass | `showCloseButton={false}` — swipe-down dismissal is standard for bottom sheets. |
| Sell form fields match desktop | Pass | Same fields: quantity, unit price (with PKR prefix), customer/note (required), profit display. |
| Same mutation used | Pass | Both call `handleSaleSubmit(expandedItem)`. |

### 3.5 Verdict

The mobile Sheet integration is clean and correct. The medium-priority items (duplicated calculations, misleading Total Units stat, PDF export limit) are worth addressing. The rest are minor improvements.

---

## 4. Cross-cutting concerns

### 4.1 API route ↔ migration consistency

| Concern | Status | Notes |
|---------|--------|-------|
| `sales/[transactionId]/route.ts` checks `deleted_at` before calling RPC | Pass | Line 43: `if (transaction.deleted_at)` returns 400. |
| `transactions/[warehouseId]/route.ts` filters `deleted_at IS NULL` | Pass | Lines 143, 167. |
| Transaction type `ADJUSTMENT` in enum | Pass | Defined in migration 001 as part of `transaction_type` enum. |
| `from_warehouse_id` on SALE transactions | Pass | `record_sale` (migration 011) sets `from_warehouse_id = p_warehouse_id`. `reverse_sale` reads `v_txn.from_warehouse_id` to restore inventory. |

### 4.2 Data flow for sale reversal

```
Client: DELETE /api/sales/{id}
  -> API: Validate auth + warehouse access + guards
  -> API: supabase.rpc("reverse_sale", {...}) via service client
    -> DB: Lock transaction + inventory rows
    -> DB: Restore quantity
    -> DB: Insert ADJUSTMENT record
    -> DB: Soft-delete original SALE
  -> API: Return success
```

All guard checks are performed **both** in the API route (for fast failure with clear HTTP status codes) **and** in the RPC function (for database-level integrity). This defense-in-depth is good practice.

### 4.3 Inventory API `page_size` cap vs PDF export

The inventory API route caps `page_size` at 200 (line 49 of `inventory/[warehouseId]/route.ts`):

```ts
const pageSize = Math.min(parseInt(searchParams.get("page_size") || "50", 10), 200);
```

But the PDF export requests `limit: 10000`. Since `api.getInventory` maps `limit` to the `page_size` query parameter, the server clamps it to 200. The PDF will only contain the first page.

---

## 5. Summary of findings

### By severity

| Severity | Count | Items |
|----------|-------|-------|
| Medium | 4 | Partial index direction (2.3.1), Missing UPDATE policy (2.3.2), Duplicated profit logic (3.3.1), Total Units stat is per-page (3.3.2) |
| Low | 6 | Initial `isMobile` value (1.3), Hardcoded breakpoint (1.3), No GRANT EXECUTE (2.3.3), Richer audit note (2.3.4), PDF export capped at 200 (3.3.4), Transfer qty no upper bound (3.3.6) |
| Info | 4 | Dead code in handleRowClick (3.3.5), Zero-price allowed (3.3.7), Large component (3.3.8), Animation variants in render (3.3.9) |

### Recommended action items (prioritized)

1. **Fix the partial index** to cover `WHERE deleted_at IS NULL` (the common read path).
2. **Add an UPDATE policy on transactions** (or accept the service-client-only constraint and document it).
3. **Fix the PDF export** to either paginate or raise the cap for export requests.
4. **Fix the Total Units card** to use a server-side total.
5. **Extract profit calculation helper** to reduce duplication.
6. **Add transfer quantity upper-bound check** on the client.

### What's done well

- Row locking and guard checks in `reverse_sale` are thorough and match existing patterns.
- Defense-in-depth: API route + RPC both validate.
- Mobile/desktop split using `useIsMobile` + Sheet is clean.
- Soft-delete is the right approach (preserves audit trail).
- Transaction queries already filter `deleted_at IS NULL`.
- `SET search_path = ''` on the function matches security hardening in migration 011.
- Dark mode, loading skeletons, and toast feedback are consistent across the page.
