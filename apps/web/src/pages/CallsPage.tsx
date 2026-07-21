import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../stores/authStore";

interface Call {
  id: string;
  agentName?: string | null;
  targetName?: string | null;
  targetPhone: string;
  fromNumber?: string | null;
  status: string;
  source: string;
  durationSeconds?: number | null;
  errorMessage?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export default function CallsPage() {
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const [calls, setCalls] = useState<Call[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [err, setErr] = useState("");

  const load = async (p: number) => {
    try {
      const res = await api.get<{ calls: Call[]; pages: number }>(`/calls?page=${p}&limit=50`);
      setCalls(res.calls);
      setPages(res.pages);
      setPage(p);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(1); }, []);

  const del = async (id: string) => {
    if (!confirm("Delete this call record?")) return;
    try { await api.del(`/calls/${id}`); await load(page); }
    catch (e) { setErr((e as Error).message); }
  };
  const clearAll = async () => {
    if (!confirm("Clear the ENTIRE call history? This cannot be undone.")) return;
    try { await api.post("/calls/clear"); await load(1); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-title">Call History</div>
      <div className="page-sub">Every guard dial, newest first.</div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        {isAdmin && calls.length > 0 && (
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
            <button className="btn danger small" onClick={clearAll}>Clear history</button>
          </div>
        )}
        <table>
          <thead>
            <tr><th>Alert</th><th>Guard</th><th>Phone</th><th>Status</th><th>Source</th><th>Duration</th><th>Time</th><th></th></tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>{c.agentName ?? "—"}</td>
                <td>{c.targetName ?? "—"}</td>
                <td className="mono">{c.targetPhone}</td>
                <td>
                  <span className={`pill ${c.status}`}>{c.status}</span>
                  {c.acknowledgedAt && <span className="badge on" style={{ marginLeft: 6 }}>ack'd</span>}
                  {c.errorMessage && <div className="page-sub" style={{ margin: 0 }}>{c.errorMessage}</div>}
                </td>
                <td>{c.source}</td>
                <td>{c.durationSeconds != null ? `${c.durationSeconds}s` : "—"}</td>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn danger small" onClick={() => del(c.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {calls.length === 0 && <tr><td colSpan={8} style={{ color: "var(--ink-3)" }}>No calls yet.</td></tr>}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="row" style={{ marginTop: 14, justifyContent: "center" }}>
            <button className="btn secondary small" disabled={page <= 1} onClick={() => void load(page - 1)}>← Prev</button>
            <span className="page-sub" style={{ margin: 0 }}>Page {page} / {pages}</span>
            <button className="btn secondary small" disabled={page >= pages} onClick={() => void load(page + 1)}>Next →</button>
          </div>
        )}
      </div>
    </>
  );
}
