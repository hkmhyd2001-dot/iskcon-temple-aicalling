import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Call {
  id: string;
  targetName?: string | null;
  targetPhone: string;
  status: string;
  durationSeconds?: number | null;
  createdAt: string;
}
interface Agent { id: string; name: string; isActive: boolean; }

export default function DashboardPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [testAgentId, setTestAgentId] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const [c, a] = await Promise.all([
      api.get<{ calls: Call[]; total: number }>("/calls?limit=10"),
      api.get<{ agents: Agent[] }>("/agents")
    ]);
    setCalls(c.calls);
    setTotal(c.total);
    setAgents(a.agents);
    // Default the test-call agent to the first active one (or the first agent).
    setTestAgentId((prev) => prev || a.agents.find((ag) => ag.isActive)?.id || a.agents[0]?.id || "");
  };

  useEffect(() => {
    void load().catch((e) => setErr((e as Error).message));
    // Live refresh so call statuses update on screen as Plivo reports them.
    const timer = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, []);

  const sendTest = async () => {
    setErr(""); setMsg("");
    const agent = agents.find((ag) => ag.id === testAgentId);
    if (!agent) { setErr("Pick an alert message to test (create one on the Alert Message page)."); return; }
    if (!testPhone.trim()) { setErr("Enter a phone number to test."); return; }
    try {
      await api.post("/calls/test", { agentId: agent.id, phone: testPhone.trim() });
      setMsg(`Test call placed to ${testPhone} using "${agent.name}". It should ring shortly.`);
      setTestPhone("");
      setTimeout(() => void load(), 3000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const answered = calls.filter((c) => c.status === "completed").length;

  return (
    <>
      <div className="page-title">Dashboard</div>
      <div className="page-sub">Every camera line-crossing rings all guards. Live status below.</div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="grid">
        <div className="card">
          <div className="label">Total Calls</div>
          <div className="big">{total}</div>
        </div>
        <div className="card">
          <div className="label">Completed (last 10)</div>
          <div className="big">{answered}</div>
        </div>
        <div className="card">
          <div className="label">Active Alert Messages</div>
          <div className="big">{agents.filter((a) => a.isActive).length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <h2>Send a test call</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <label style={{ marginTop: 0 }}>Alert message</label>
            <select
              value={testAgentId}
              onChange={(e) => setTestAgentId(e.target.value)}
              style={{ minWidth: 240 }}
            >
              {agents.length === 0 && <option value="">No alert messages</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.isActive ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ marginTop: 0 }}>Phone number</label>
            <input
              placeholder="+919876543210"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </div>
          <button className="btn" onClick={sendTest}>🔔 Ring this number</button>
        </div>
        <div className="page-sub" style={{ margin: "10px 0 0" }}>
          Rings the chosen number once, speaking the selected alert message.
        </div>
      </div>

      <div className="card">
        <h2>Recent calls</h2>
        <table>
          <thead>
            <tr><th>Guard</th><th>Phone</th><th>Status</th><th>Duration</th><th>Time</th></tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>{c.targetName ?? "—"}</td>
                <td className="mono">{c.targetPhone}</td>
                <td><span className={`pill ${c.status}`}>{c.status}</span></td>
                <td>{c.durationSeconds != null ? `${c.durationSeconds}s` : "—"}</td>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {calls.length === 0 && <tr><td colSpan={5} style={{ color: "#bbb" }}>No calls yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
