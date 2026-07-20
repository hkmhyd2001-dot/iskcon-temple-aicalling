import { useEffect } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./stores/authStore";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import AgentsPage from "./pages/AgentsPage";
import CallsPage from "./pages/CallsPage";
import ApiKeysPage from "./pages/ApiKeysPage";
import SettingsPage from "./pages/SettingsPage";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🛡️ ISKCON Alerts</h1>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/agents">Alert Message</NavLink>
          <NavLink to="/calls">Call History</NavLink>
          <NavLink to="/api-keys">API Keys</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="foot">
          {user?.email}
          <br />
          <button onClick={() => { logout(); navigate("/login"); }}>Log out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const loadMe = useAuth((s) => s.loadMe);
  useEffect(() => { void loadMe(); }, [loadMe]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/agents" element={<Protected><AgentsPage /></Protected>} />
      <Route path="/calls" element={<Protected><CallsPage /></Protected>} />
      <Route path="/api-keys" element={<Protected><ApiKeysPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
