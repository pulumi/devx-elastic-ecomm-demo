import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatCents } from "../lib/money";

export function OrderHistoryPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders", submitted],
    queryFn: () => api.listOrders(submitted),
    enabled: !!submitted,
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Order history</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(email);
        }}
        className="mb-6 flex gap-2"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Look up orders by email"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Look up
        </button>
      </form>

      {isLoading && <p className="text-sm text-neutral-500">Loading...</p>}
      {submitted && orders && orders.length === 0 && <p className="text-sm text-neutral-500">No orders for {submitted}.</p>}

      <div className="space-y-3">
        {orders?.map((order) => (
          <Link
            key={order.id}
            to={`/orders/${order.id}`}
            className="flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 text-sm hover:bg-neutral-50"
          >
            <div>
              <p className="font-medium text-neutral-900">{order.id}</p>
              <p className="text-neutral-500">{new Date(order.createdAt).toLocaleDateString()}</p>
            </div>
            <p className="font-medium text-neutral-900">{formatCents(order.totalCents)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
