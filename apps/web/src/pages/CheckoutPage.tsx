import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { formatCents } from "../lib/money";

export function CheckoutPage() {
  const [email, setEmail] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: cart } = useQuery({ queryKey: ["cart"], queryFn: api.getCart });

  const checkout = useMutation({
    mutationFn: () => api.checkout(email),
    onSuccess: (order) => {
      queryClient.setQueryData(["cart"], { ...cart, items: [], subtotalCents: 0 });
      navigate(`/orders/${order.id}`, { state: { justPlaced: true } });
    },
  });

  if (cart && cart.items.length === 0 && !checkout.isSuccess) {
    return <Navigate to="/cart" replace />;
  }

  return (
    <div className="mx-auto max-w-md px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Checkout</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          checkout.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </div>

        {cart && (
          <p className="text-sm text-neutral-600">
            Total: <span className="font-semibold text-neutral-900">{formatCents(cart.subtotalCents)}</span>
          </p>
        )}

        {checkout.isError && <p className="text-sm text-red-600">{(checkout.error as Error).message}</p>}

        <button
          type="submit"
          disabled={checkout.isPending}
          className="w-full rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {checkout.isPending ? "Placing order..." : "Place order"}
        </button>
      </form>
    </div>
  );
}
