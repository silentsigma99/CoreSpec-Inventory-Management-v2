"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shape returned by GET /api/brands.
 * Each brand is a plain string; the endpoint returns an array of those strings.
 */
type BrandsResponse = string[];

interface BrandFilterProps {
  /** Currently selected brand value.  Use "all" to represent "no filter". */
  value: string;
  /** Called with the new brand value when the user picks an option.
   *  Receives "all" when the user selects "All Brands". */
  onChange: (brand: string) => void;
  /** Optional additional className forwarded to SelectTrigger. */
  className?: string;
}

/**
 * Reusable brand-filter dropdown.
 *
 * Usage:
 *   const [brand, setBrand] = useState("all");
 *   <BrandFilter value={brand} onChange={setBrand} />
 *
 * The parent is responsible for wiring the value into its data-fetching logic.
 * Pass brand === "all" ? undefined : brand  to the API helpers that accept an
 * optional brand parameter (getInventory, getTransactions).
 */
export function BrandFilter({ value, onChange, className }: BrandFilterProps) {
  const { data: brands, isLoading } = useQuery<BrandsResponse>({
    queryKey: ["brands"],
    queryFn: () => api.getBrands(),
  });

  // While the brand list is still loading, render a skeleton that matches
  // the default SelectTrigger height (h-9) and a width consistent with the
  // other filter dropdowns in the toolbar.
  if (isLoading) {
    return <Skeleton className={`h-9 w-[160px] ${className ?? ""}`} />;
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={`w-full sm:w-[160px] bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white ${className ?? ""}`}
      >
        <SelectValue placeholder="All Brands" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Brands</SelectItem>
        {brands?.map((brand) => (
          <SelectItem key={brand} value={brand}>
            {brand}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
