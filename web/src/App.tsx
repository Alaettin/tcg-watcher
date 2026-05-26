import { Routes, Route } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { DashboardPage } from "./pages/Dashboard";
import { WatchlistPage } from "./pages/Watchlist";
import { SetListsPage } from "./pages/SetLists";
import { ShopsPage } from "./pages/Shops";
import { ProspektePage } from "./pages/Prospekte";
import { CardmarketPage } from "./pages/Cardmarket";
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
          <Route path="/cardmarket" element={<CardmarketPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
