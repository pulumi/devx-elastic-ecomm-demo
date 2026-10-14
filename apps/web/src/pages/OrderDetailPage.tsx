import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatCents } from "../lib/money";

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const justPlaced = Boolean((location.state as { justPlaced?: boolean } | null)?.justPlaced);

  const { data: order, isLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.getOrder(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="mx-auto max-w-2xl px-6 py-8 text-sm text-neutral-500">Loading...</div>;
  if (!order) return <div className="mx-auto max-w-2xl px-6 py-8 text-sm text-neutral-500">Order not found.</div>;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {justPlaced && (
        <div className="mb-6 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Thanks — your order is confirmed.
        </div>
      )}
      <h1 className="text-xl font-semibold text-neutral-900">Order {order.id}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {new Date(order.createdAt).toLocaleString()} &middot; {order.status}
      </p>

      <div className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200">
        {order.items.map((item) => (
          <div key={item.productId} className="flex items-center justify-between py-3 text-sm">
            <span className="text-neutral-900">
              {item.name} &times; {item.qty}
            </span>
            <span className="text-neutral-600">{formatCents(item.unitPriceCents * item.qty)}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-right text-lg font-semibold text-neutral-900">Total: {formatCents(order.totalCents)}</p>
    </div>
  );
}
