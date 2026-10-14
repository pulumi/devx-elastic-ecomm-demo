import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { CartPage } from "./pages/CartPage";
import { CatalogPage } from "./pages/CatalogPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrderHistoryPage } from "./pages/OrderHistoryPage";
import { ProductPage } from "./pages/ProductPage";

function App() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <Header />
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/products/:id" element={<ProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrderHistoryPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
      </Routes>
    </div>
  );
}

export default App;
