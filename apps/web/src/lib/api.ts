import { getSessionId } from "./session";

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  inventoryCount: number;
  imageUrl: string;
}

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  priceCents: number;
  qty: number;
}

export interface Cart {
  id: string;
  sessionId: string;
  items: CartItem[];
  subtotalCents: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  email: string;
  status: string;
  totalCents: number;
  items: OrderItem[];
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": getSessionId(),
      // Only sent once this bundle has executed in a browser; the API uses
      // it as the "JavaScript ran" signal for human/agent classification.
      "X-Client-Rendered": "1",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  listProducts: (q?: string) => request<{ items: Product[]; total: number }>(`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getProduct: (id: string) => request<Product>(`/products/${id}`),
  getCart: () => request<Cart>("/cart"),
  addCartItem: (productId: string, qty: number) =>
    request<Cart>("/cart/items", { method: "POST", body: JSON.stringify({ productId, qty }) }),
  updateCartItem: (itemId: string, qty: number) =>
    request<Cart>(`/cart/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ qty }) }),
  removeCartItem: (itemId: string) => request<Cart>(`/cart/items/${itemId}`, { method: "DELETE" }),
  checkout: (email: string) => request<Order>("/checkout", { method: "POST", body: JSON.stringify({ email }) }),
  listOrders: (email: string) => request<Order[]>(`/orders?email=${encodeURIComponent(email)}`),
  getOrder: (id: string) => request<Order>(`/orders/${id}`),
};
