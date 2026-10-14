import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ProductCard } from "../components/ProductCard";
import { api } from "../lib/api";

export function CatalogPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["products", q], queryFn: () => api.listProducts(q) });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Shop the collection</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products..."
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
        />
      </div>

      {isLoading && <p className="text-sm text-neutral-500">Loading products...</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {data?.items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="text-sm text-neutral-500">No products match "{q}".</p>
      )}
    </div>
  );
}
