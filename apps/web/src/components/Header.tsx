import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function Header() {
  const { data: cart } = useQuery({ queryKey: ["cart"], queryFn: api.getCart });
  const itemCount = cart?.items.reduce((sum, i) => sum + i.qty, 0) ?? 0;

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight text-neutral-900">
          Shopfront
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-600">
          <Link to="/orders" className="hover:text-neutral-900">
            Orders
          </Link>
          <Link to="/cart" className="relative hover:text-neutral-900">
            Cart
            {itemCount > 0 && (
              <span className="ml-1 rounded-full bg-neutral-900 px-1.5 py-0.5 text-xs font-medium text-white">
                {itemCount}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
