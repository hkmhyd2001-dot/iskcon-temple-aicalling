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
interface Voice {
  id: string;
  name: string;
  language?: string;
  description?: string;
}

const DEFAULT_MESSAGE =
  "Attention security team. Someone has crossed the restricted area near the entrance gate. Please check immediately.";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesConfigured, setVoicesConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [instruction, setInstruction] = useState("");

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const loadAgents = async (keepId?: string) => {
    const res = await api.get<{ agents: Agent[] }>("/agents");
    setAgents(res.agents);
    setSelectedId(keepId ?? res.agents[0]?.id ?? "");
    setLoading(false);
  };

  useEffect(() => {
    void loadAgents().catch((e) => {
      setErr((e as Error).message);
      setLoading(false);
    });
    // Voice list (Cartesia) for the picker — non-fatal if it fails.
    void api
      .get<{ voices: Voice[]; configured: boolean }>("/voices")
      .then((r) => {
        setVoices(r.voices);
        setVoicesConfigured(r.configured);
      })
      .catch(() => setVoicesConfigured(false));
  }, []);

  const patch = (fields: Partial<Agent>) => {
    if (!selected) return;
    setAgents((prev) => prev.map((a) => (a.id === selected.id ? { ...a, ...fields } : a)));
  };

  const createAgent = async () => {
    setErr(""); setOk("");
    try {
      const res = await api.post<{ agent: Agent }>("/agents", {
        name: `Alert ${agents.length + 1}`,
        message: DEFAULT_MESSAGE,
        language: "en"
      });
      await loadAgents(res.agent.id);
      setOk("New alert message created.");
    } catch (e) { setErr((e as Error).message); }
  };

  const save = async () => {
    if (!selected) return;
    setErr(""); setOk("");
    try {
      const res = await api.patch<{ agent: Agent }>(`/agents/${selected.id}`, {
        name: selected.name,
        message: selected.message,
        language: selected.language,
        fromNumber: selected.fromNumber ?? "",
        voiceId: selected.voiceId ?? "",
        isActive: selected.isActive
      });
      setAgents((prev) => prev.map((a) => (a.id === res.agent.id ? res.agent : a)));
      setOk("Saved. The new message will be spoken on the next call.");
    } catch (e) { setErr((e as Error).message); }
  };

  const remove = async () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"? This can't be undone.`)) return;
    setErr(""); setOk("");
    try {
      await api.del(`/agents/${selected.id}`);
      await loadAgents();
      setOk("Alert message deleted.");
    } catch (e) { setErr((e as Error).message); }
  };

  const compose = async () => {
    if (!instruction.trim() || !selected) return;
    setErr("");
    try {
      const res = await api.post<{ message: string }>("/agents/compose", {
        instruction, language: selected.language
      });
      patch({ message: res.message });
    } catch (e) { setErr((e as Error).message); }
  };

  const preview = () => {
    if (!selected) return;
    fetch(`${api.base}/agents/${selected.id}/preview`, {
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
      <div className="page-title">Alert Messages</div>
      <div className="page-sub">
        Create one or more alert agents — each has its own message, voice, caller number, and Agent ID.
      </div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* Agent switcher */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ marginTop: 0 }}>Editing agent</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {agents.length === 0 && <option value="">No agents yet</option>}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.isActive ? "" : "(disabled)"}
                </option>
              ))}
            </select>
          </div>
          <button className="btn secondary" onClick={createAgent}>+ New alert</button>
          {selected && agents.length > 1 && (
            <button className="btn danger" onClick={remove}>Delete</button>
          )}
        </div>
        <div className="page-sub" style={{ margin: "10px 0 0" }}>
          {agents.length} alert agent{agents.length === 1 ? "" : "s"} total.
        </div>
      </div>

      {!selected ? (
        <div className="card">
          <p style={{ marginBottom: 14 }}>No alert message yet.</p>
          <button className="btn" onClick={createAgent}>Create your first alert message</button>
        </div>
      ) : (
        <div className="card">
          <label style={{ marginTop: 0 }}>Name</label>
          <input value={selected.name} onChange={(e) => patch({ name: e.target.value })} />

          <label>Spoken message</label>
          <textarea value={selected.message} onChange={(e) => patch({ message: e.target.value })} />

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
              <select value={selected.language} onChange={(e) => patch({ language: e.target.value })}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
                <option value="ta">Tamil</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Caller number (optional)</label>
              <input
                value={selected.fromNumber ?? ""}
                onChange={(e) => patch({ fromNumber: e.target.value })}
                placeholder="+9180XXXXXXXX"
              />
            </div>
          </div>

          {/* Cartesia voice picker */}
          <label>Voice (Cartesia)</label>
          {voicesConfigured && voices.length > 0 ? (
            <select
              value={selected.voiceId ?? ""}
              onChange={(e) => patch({ voiceId: e.target.value })}
            >
              <option value="">Default voice</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.language ? ` — ${v.language}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={selected.voiceId ?? ""}
              onChange={(e) => patch({ voiceId: e.target.value })}
              className="mono"
              placeholder={voicesConfigured ? "faf0731e-… (paste a Cartesia voice ID)" : "Add CARTESIA_API_KEY to load the voice list"}
            />
          )}
          {voicesConfigured && voices.length > 0 && (
            <div className="page-sub" style={{ margin: "5px 0 0" }}>
              {voices.length} Cartesia voices available. Blank = account default.
            </div>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={save}>💾 Save</button>
            <button className="btn secondary" onClick={preview}>▶ Preview voice</button>
            <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={selected.isActive}
                onChange={(e) => patch({ isActive: e.target.checked })}
              />
              Active
            </label>
          </div>

          <div className="ok" style={{ marginTop: 16, marginBottom: 0 }}>
            <strong>Agent ID</strong> (put this in the Pi's <span className="mono">config.json</span> as <span className="mono">veytrix_agent_id</span>):
            <div className="mono" style={{ marginTop: 5 }}>{selected.id}</div>
          </div>
        </div>
      )}
    </>
  );
}
