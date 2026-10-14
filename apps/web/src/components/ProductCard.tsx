import { Link } from "react-router-dom";
import type { Product } from "../lib/api";
import { formatCents } from "../lib/money";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      to={`/products/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:shadow-md"
    >
      <div className="aspect-square bg-neutral-100" />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-sm font-medium text-neutral-900 group-hover:underline">{product.name}</h3>
        <p className="line-clamp-2 text-sm text-neutral-500">{product.description}</p>
        <p className="mt-auto pt-2 text-sm font-semibold text-neutral-900">
          {formatCents(product.priceCents, product.currency)}
        </p>
      </div>
    </Link>
  );
}
