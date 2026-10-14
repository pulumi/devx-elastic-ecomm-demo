import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatCents } from "../lib/money";

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [added, setAdded] = useState(false);

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: () => api.getProduct(id!),
    enabled: !!id,
  });

  const addToCart = useMutation({
    mutationFn: () => api.addCartItem(id!, 1),
    onSuccess: (cart) => {
      queryClient.setQueryData(["cart"], cart);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    },
  });

  if (isLoading) return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-neutral-500">Loading...</div>;
  if (!product) return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-neutral-500">Product not found.</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square rounded-lg bg-neutral-100" />
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{product.name}</h1>
          <p className="mt-2 text-lg font-medium text-neutral-700">{formatCents(product.priceCents, product.currency)}</p>
          <p className="mt-4 text-sm text-neutral-600">{product.description}</p>
          <p className="mt-2 text-xs text-neutral-400">{product.inventoryCount} in stock &middot; SKU {product.sku}</p>
          <button
            onClick={() => addToCart.mutate()}
            disabled={addToCart.isPending}
            className="mt-6 rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {added ? "Added to cart" : addToCart.isPending ? "Adding..." : "Add to cart"}
          </button>
        </div>
      </div>
    </div>
  );
}
