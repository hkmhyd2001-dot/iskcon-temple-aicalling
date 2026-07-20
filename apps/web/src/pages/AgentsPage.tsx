import { useEffect, useState } from "react";
import { api, getToken } from "../lib/api";

interface Agent {
  id: string;
  name: string;
  message: string;
  language: string;
  fromNumber?: string | null;
  voiceId?: string | null;
  isActive: boolean;
}

export default function AgentsPage() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [instruction, setInstruction] = useState("");

  const load = async () => {
    const res = await api.get<{ agents: Agent[] }>("/agents");
    setAgent(res.agents[0] ?? null);
    setLoading(false);
  };
  useEffect(() => { void load().catch((e) => { setErr((e as Error).message); setLoading(false); }); }, []);

  const create = async () => {
    setErr("");
    try {
      const res = await api.post<{ agent: Agent }>("/agents", {
        name: "Line-Crossing Security Alert",
        message: "Attention security team. Someone has crossed the restricted area near the entrance gate. Please check immediately.",
        language: "en"
      });
      setAgent(res.agent);
    } catch (e) { setErr((e as Error).message); }
  };

  const save = async () => {
    if (!agent) return;
    setErr(""); setOk("");
    try {
      const res = await api.patch<{ agent: Agent }>(`/agents/${agent.id}`, {
        name: agent.name,
        message: agent.message,
        language: agent.language,
        fromNumber: agent.fromNumber ?? "",
        voiceId: agent.voiceId ?? "",
        isActive: agent.isActive
      });
      setAgent(res.agent);
      setOk("Saved. The new message will be spoken on the next call.");
    } catch (e) { setErr((e as Error).message); }
  };

  const compose = async () => {
    if (!instruction.trim() || !agent) return;
    setErr("");
    try {
      const res = await api.post<{ message: string }>("/agents/compose", {
        instruction, language: agent.language
      });
      setAgent({ ...agent, message: res.message });
    } catch (e) { setErr((e as Error).message); }
  };

  const preview = () => {
    if (!agent) return;
    // Fetch the preview audio with auth, then play it.
    fetch(`${api.base}/agents/${agent.id}/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` }
    })
      .then((r) => { if (!r.ok) throw new Error("Preview failed"); return r.blob(); })
      .then((blob) => new Audio(URL.createObjectURL(blob)).play())
      .catch((e) => setErr((e as Error).message));
  };

  if (loading) return <div>Loading…</div>;

  return (
    <>
      <div className="page-title">Alert Message</div>
      <div className="page-sub">The exact words spoken to every guard when the camera detects a crossing.</div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {!agent ? (
        <div className="card">
          <p style={{ marginBottom: 14 }}>No alert message yet.</p>
          <button className="btn" onClick={create}>Create default alert message</button>
        </div>
      ) : (
        <div className="card">
          <label>Name</label>
          <input value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} />

          <label>Spoken message</label>
          <textarea value={agent.message} onChange={(e) => setAgent({ ...agent, message: e.target.value })} />

          <div className="row" style={{ marginTop: 8 }}>
            <input
              placeholder="Ask Gemini to draft/translate… (optional)"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn secondary small" onClick={compose}>✨ Draft with Gemini</button>
          </div>

          <div className="row" style={{ marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <label>Language</label>
              <select value={agent.language} onChange={(e) => setAgent({ ...agent, language: e.target.value })}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
                <option value="ta">Tamil</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Caller number (optional)</label>
              <input value={agent.fromNumber ?? ""} onChange={(e) => setAgent({ ...agent, fromNumber: e.target.value })} placeholder="+9180XXXXXXXX" />
            </div>
          </div>

          <label>Cartesia voice ID (optional — blank uses the default)</label>
          <input value={agent.voiceId ?? ""} onChange={(e) => setAgent({ ...agent, voiceId: e.target.value })} placeholder="faf0731e-…" />

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={save}>💾 Save</button>
            <button className="btn secondary" onClick={preview}>▶ Preview voice</button>
            <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={agent.isActive}
                onChange={(e) => setAgent({ ...agent, isActive: e.target.checked })}
              />
              Active
            </label>
          </div>
          <p className="page-sub" style={{ marginTop: 14 }}>
            Agent ID (put this in the Pi's <span className="mono">config.json</span>): <span className="mono">{agent.id}</span>
          </p>
        </div>
      )}
    </>
  );
}
