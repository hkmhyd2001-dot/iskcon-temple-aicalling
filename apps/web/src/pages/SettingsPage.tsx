import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Num { id: string; phoneNumber: string; label?: string | null; isDefaultOutbound: boolean; }
interface ProviderStatus {
  plivo: { configured: boolean; source: string; defaultNumber: string | null; hasAuthId: boolean };
  cartesia: { configured: boolean; source: string; voiceId: string | null; model: string | null };
  gemini: { configured: boolean; source: string; model: string | null };
}
interface SettingsResp { providers: ProviderStatus; numbers: Num[]; }

const SOURCE_LABEL: Record<string, string> = { dashboard: "saved here", env: "from server env", none: "not set" };

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResp | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // credential form drafts
  const [plivo, setPlivo] = useState({ authId: "", authToken: "", defaultNumber: "" });
  const [cartesia, setCartesia] = useState({ apiKey: "", voiceId: "", model: "sonic-2" });
  const [gemini, setGemini] = useState({ apiKey: "", model: "gemini-2.5-flash" });

  // numbers
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [editId, setEditId] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const load = async () => setData(await api.get<SettingsResp>("/settings"));
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const saveCred = async (provider: string, body: Record<string, string>) => {
    setErr(""); setOk("");
    try {
      const res = await api.post<{ providers: ProviderStatus }>(`/settings/credentials/${provider}`, body);
      setData((d) => (d ? { ...d, providers: res.providers } : d));
      setOk(`${provider[0].toUpperCase()}${provider.slice(1)} credentials saved.`);
    } catch (e) { setErr((e as Error).message); }
  };
  const clearCred = async (provider: string) => {
    if (!confirm(`Remove saved ${provider} credentials? It will fall back to server env, if set.`)) return;
    setErr(""); setOk("");
    try {
      const res = await api.del<{ providers: ProviderStatus }>(`/settings/credentials/${provider}`);
      setData((d) => (d ? { ...d, providers: res.providers } : d));
      setOk(`${provider} credentials removed.`);
    } catch (e) { setErr((e as Error).message); }
  };

  const addNumber = async () => {
    setErr(""); setOk("");
    try {
      await api.post("/settings/numbers", { phoneNumber: phone, label, isDefaultOutbound: (data?.numbers.length ?? 0) === 0 });
      setPhone(""); setLabel(""); await load();
    } catch (e) { setErr((e as Error).message); }
  };
  const setDefault = async (id: string) => {
    try { await api.patch(`/settings/numbers/${id}`, { isDefaultOutbound: true }); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const saveEdit = async () => {
    try { await api.patch(`/settings/numbers/${editId}`, { phoneNumber: editPhone, label: editLabel }); setEditId(""); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const delNumber = async (id: string) => {
    if (!confirm("Remove this caller number?")) return;
    try { await api.del(`/settings/numbers/${id}`); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  if (!data) return <div>Loading…</div>;
  const p = data.providers;
  const statusBadge = (s: { configured: boolean; source: string }) =>
    s.configured
      ? <span className="badge on">configured · {SOURCE_LABEL[s.source] ?? s.source}</span>
      : <span className="badge off">missing</span>;

  return (
    <>
      <div className="page-title">Settings</div>
      <div className="page-sub">
        Enter provider credentials below — they are stored encrypted in the database and take effect immediately.
        (Server environment variables are used as a fallback.)
      </div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* Plivo */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Plivo — telephony</span>{statusBadge(p.plivo)}
        </h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Auth ID</label>
            <input autoComplete="off" value={plivo.authId} onChange={(e) => setPlivo({ ...plivo, authId: e.target.value })} placeholder={p.plivo.hasAuthId ? "•••••• (saved)" : "MAxxxxxxxxxxxxxxxxxx"} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Auth Token</label>
            <input autoComplete="off" type="password" value={plivo.authToken} onChange={(e) => setPlivo({ ...plivo, authToken: e.target.value })} placeholder="••••••••" />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ marginTop: 0 }}>Default number</label>
            <input value={plivo.defaultNumber} onChange={(e) => setPlivo({ ...plivo, defaultNumber: e.target.value })} placeholder={p.plivo.defaultNumber ?? "+9180XXXXXXXX"} />
          </div>
          <button className="btn" onClick={() => saveCred("plivo", plivo)}>Save</button>
          {p.plivo.source === "dashboard" && <button className="btn danger" onClick={() => clearCred("plivo")}>Remove</button>}
        </div>
      </div>

      {/* Cartesia */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Cartesia — voice (TTS)</span>{statusBadge(p.cartesia)}
        </h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ marginTop: 0 }}>API Key</label>
            <input autoComplete="off" type="password" value={cartesia.apiKey} onChange={(e) => setCartesia({ ...cartesia, apiKey: e.target.value })} placeholder="sk_car_••••" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Default voice ID</label>
            <input value={cartesia.voiceId} onChange={(e) => setCartesia({ ...cartesia, voiceId: e.target.value })} placeholder={p.cartesia.voiceId ?? "faf0731e-…"} className="mono" />
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={{ marginTop: 0 }}>Model</label>
            <input value={cartesia.model} onChange={(e) => setCartesia({ ...cartesia, model: e.target.value })} placeholder={p.cartesia.model ?? "sonic-2"} />
          </div>
          <button className="btn" onClick={() => saveCred("cartesia", cartesia)}>Save</button>
          {p.cartesia.source === "dashboard" && <button className="btn danger" onClick={() => clearCred("cartesia")}>Remove</button>}
        </div>
      </div>

      {/* Gemini */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Gemini — message drafting (optional)</span>{statusBadge(p.gemini)}
        </h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ marginTop: 0 }}>API Key</label>
            <input autoComplete="off" type="password" value={gemini.apiKey} onChange={(e) => setGemini({ ...gemini, apiKey: e.target.value })} placeholder="AIza••••" />
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Model</label>
            <input value={gemini.model} onChange={(e) => setGemini({ ...gemini, model: e.target.value })} placeholder={p.gemini.model ?? "gemini-2.5-flash"} />
          </div>
          <button className="btn" onClick={() => saveCred("gemini", gemini)}>Save</button>
          {p.gemini.source === "dashboard" && <button className="btn danger" onClick={() => clearCred("gemini")}>Remove</button>}
        </div>
      </div>

      {/* Caller numbers */}
      <div className="card">
        <h2>Caller numbers</h2>
        <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
          <div style={{ minWidth: 200 }}>
            <label style={{ marginTop: 0 }}>Number (E.164)</label>
            <input placeholder="+9180XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={{ marginTop: 0 }}>Label (optional)</label>
            <input placeholder="e.g. Main gate" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <button className="btn" onClick={addNumber}>+ Add number</button>
        </div>
        <table>
          <thead><tr><th>Number</th><th>Label</th><th>Default</th><th></th></tr></thead>
          <tbody>
            {data.numbers.map((n) => (
              editId === n.id ? (
                <tr key={n.id}>
                  <td><input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="mono" style={{ maxWidth: 180 }} /></td>
                  <td><input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={{ maxWidth: 150 }} /></td>
                  <td>{n.isDefaultOutbound ? <span className="badge on">default</span> : ""}</td>
                  <td><div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    <button className="btn small" onClick={saveEdit}>Save</button>
                    <button className="btn secondary small" onClick={() => setEditId("")}>Cancel</button>
                  </div></td>
                </tr>
              ) : (
                <tr key={n.id}>
                  <td className="mono">{n.phoneNumber}</td>
                  <td>{n.label ?? "—"}</td>
                  <td>{n.isDefaultOutbound ? <span className="badge on">default</span> : ""}</td>
                  <td><div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    {!n.isDefaultOutbound && <button className="btn secondary small" onClick={() => setDefault(n.id)}>Make default</button>}
                    <button className="btn secondary small" onClick={() => { setEditId(n.id); setEditPhone(n.phoneNumber); setEditLabel(n.label ?? ""); }}>Edit</button>
                    <button className="btn danger small" onClick={() => delNumber(n.id)}>Remove</button>
                  </div></td>
                </tr>
              )
            ))}
            {data.numbers.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)" }}>No caller numbers added — using the Plivo default.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
