import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { formatCents } from "../lib/money";

export function CartPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: cart, isLoading } = useQuery({ queryKey: ["cart"], queryFn: api.getCart });

  const updateQty = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: string; qty: number }) => api.updateCartItem(itemId, qty),
    onSuccess: (cart) => queryClient.setQueryData(["cart"], cart),
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.removeCartItem(itemId),
    onSuccess: (cart) => queryClient.setQueryData(["cart"], cart),
  });

  if (isLoading) return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-neutral-500">Loading...</div>;

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold text-neutral-900">Your cart is empty</h1>
        <Link to="/" className="mt-4 inline-block text-sm text-neutral-600 underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Your cart</h1>
      <div className="divide-y divide-neutral-200 border-y border-neutral-200">
        {cart.items.map((item) => (
          <div key={item.id} className="flex items-center gap-4 py-4">
            <div className="h-16 w-16 shrink-0 rounded bg-neutral-100" />
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-900">{item.name}</p>
              <p className="text-sm text-neutral-500">{formatCents(item.priceCents)}</p>
            </div>
            <input
              type="number"
              min={1}
              value={item.qty}
              onChange={(e) => updateQty.mutate({ itemId: item.id, qty: Number(e.target.value) || 1 })}
              className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
            <button
              onClick={() => removeItem.mutate(item.id)}
              className="text-sm text-neutral-400 hover:text-neutral-900"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-lg font-semibold text-neutral-900">Subtotal: {formatCents(cart.subtotalCents)}</p>
        <button
          onClick={() => navigate("/checkout")}
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Checkout
        </button>
      </div>
    </div>
  );
}
