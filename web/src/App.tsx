import { Routes, Route } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { DashboardPage } from "./pages/Dashboard";
import { WatchlistPage } from "./pages/Watchlist";
import { SetListsPage } from "./pages/SetLists";
import { ShopsPage } from "./pages/Shops";
import { ProspektePage } from "./pages/Prospekte";
import { CardmarketPage } from "./pages/Cardmarket";
import { CmDashboardPage } from "./pages/CmDashboard";
import { CmMoversPage } from "./pages/CmMovers";
import { CmProductPage } from "./pages/CmProduct";
import { CmWatchlistPage } from "./pages/CmWatchlist";
import { CmSetsPage } from "./pages/CmSets";
import { CmSetPage } from "./pages/CmSet";
import { EventsPage } from "./pages/Events";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <NavBar />
      <main className="flex-1 mx-auto w-full max-w-6xl px-3 md:px-6 py-4 pb-24 md:pb-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/lists" element={<SetListsPage />} />
          <Route path="/shops" element={<ShopsPage />} />
          <Route path="/prospekte" element={<ProspektePage />} />
          <Route path="/cardmarket" element={<CmDashboardPage />} />
          <Route path="/cardmarket/products" element={<CardmarketPage />} />
          <Route path="/cardmarket/movers" element={<CmMoversPage />} />
          <Route path="/cardmarket/watchlist" element={<CmWatchlistPage />} />
          <Route path="/cardmarket/sets" element={<CmSetsPage />} />
          <Route path="/cardmarket/sets/:idExpansion" element={<CmSetPage />} />
          <Route path="/cardmarket/p/:idProduct" element={<CmProductPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
