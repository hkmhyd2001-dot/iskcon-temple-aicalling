import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Num { id: string; phoneNumber: string; label?: string | null; isDefaultOutbound: boolean; }
interface ProviderStatus {
  plivo: { configured: boolean; source: string; authId: string | null; defaultNumber: string | null; tokenMask: string | null };
  cartesia: { configured: boolean; source: string; voiceId: string | null; model: string | null; keyMask: string | null };
  gemini: { configured: boolean; source: string; model: string | null; keyMask: string | null };
}
interface SettingsResp { providers: ProviderStatus; numbers: Num[]; }

const SOURCE_LABEL: Record<string, string> = { dashboard: "saved here", env: "from server env", none: "not set" };

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResp | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [plivo, setPlivo] = useState({ authId: "", authToken: "", defaultNumber: "" });
  const [cartesia, setCartesia] = useState({ apiKey: "", voiceId: "", model: "sonic-2" });
  const [gemini, setGemini] = useState({ apiKey: "", model: "gemini-2.5-flash" });

  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [editId, setEditId] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLabel, setEditLabel] = useState("");

  // Seed the form from saved values. Secret fields show the MASK (e.g.
  // "••••••Now123") inside the box; non-secret fields show their real value.
  const seed = (d: SettingsResp) => {
    setPlivo({ authId: d.providers.plivo.authId ?? "", authToken: d.providers.plivo.tokenMask ?? "", defaultNumber: d.providers.plivo.defaultNumber ?? "" });
    setCartesia({ apiKey: d.providers.cartesia.keyMask ?? "", voiceId: d.providers.cartesia.voiceId ?? "", model: d.providers.cartesia.model ?? "sonic-2" });
    setGemini({ apiKey: d.providers.gemini.keyMask ?? "", model: d.providers.gemini.model ?? "gemini-2.5-flash" });
  };

  // A secret still equal to its mask (or blank) means "unchanged" → send "" so
  // the backend keeps the stored value instead of overwriting with the mask.
  const secretOut = (value: string, mask: string | null) => (!value || value === (mask ?? "") ? "" : value);
  // Click a masked field to clear it for editing; leave it empty → restore mask.
  const focusMask = (value: string, mask: string | null) => (value === (mask ?? "") ? "" : value);
  const blurMask = (value: string, mask: string | null) => (value === "" ? mask ?? "" : value);

  const load = async () => {
    const d = await api.get<SettingsResp>("/settings");
    setData(d);
    seed(d);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const saveCred = async (provider: string, body: Record<string, string>) => {
    setErr(""); setOk("");
    try {
      await api.post(`/settings/credentials/${provider}`, body);
      await load();
      setOk(`${provider[0].toUpperCase()}${provider.slice(1)} credentials saved.`);
    } catch (e) { setErr((e as Error).message); }
  };
  const clearCred = async (provider: string) => {
    if (!confirm(`Remove saved ${provider} credentials? It will fall back to server env, if set.`)) return;
    setErr(""); setOk("");
    try { await api.del(`/settings/credentials/${provider}`); await load(); setOk(`${provider} credentials removed.`); }
    catch (e) { setErr((e as Error).message); }
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
      {/* Decoy fields absorb Chrome's login autofill so real credential inputs stay clean. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0, height: 0, width: 0, overflow: "hidden" }}>
        <input type="text" name="username" autoComplete="username" tabIndex={-1} />
        <input type="password" name="password" autoComplete="current-password" tabIndex={-1} />
      </div>

      <div className="page-title">Settings</div>
      <div className="page-sub">
        Enter provider credentials below — they are stored encrypted in the database and take effect immediately.
        Leave a secret field blank to keep the saved value. (Server environment variables are used as a fallback.)
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
            <input name="pl_acct" autoComplete="off" spellCheck={false} value={plivo.authId} onChange={(e) => setPlivo({ ...plivo, authId: e.target.value })} placeholder="MAxxxxxxxxxxxxxxxxxx" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Auth Token</label>
            <input name="pl_tok" type="text" autoComplete="off" className="mono" value={plivo.authToken}
              onFocus={() => setPlivo({ ...plivo, authToken: focusMask(plivo.authToken, p.plivo.tokenMask) })}
              onBlur={() => setPlivo({ ...plivo, authToken: blurMask(plivo.authToken, p.plivo.tokenMask) })}
              onChange={(e) => setPlivo({ ...plivo, authToken: e.target.value })} placeholder="auth token" />
          </div>
          <div style={{ minWidth: 170 }}>
            <label style={{ marginTop: 0 }}>Default number</label>
            <input name="pl_num" autoComplete="off" value={plivo.defaultNumber} onChange={(e) => setPlivo({ ...plivo, defaultNumber: e.target.value })} placeholder="+9180XXXXXXXX" />
          </div>
          <button className="btn" onClick={() => saveCred("plivo", { authId: plivo.authId, authToken: secretOut(plivo.authToken, p.plivo.tokenMask), defaultNumber: plivo.defaultNumber })}>Save</button>
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
            <input name="ca_key" type="text" autoComplete="off" className="mono" value={cartesia.apiKey}
              onFocus={() => setCartesia({ ...cartesia, apiKey: focusMask(cartesia.apiKey, p.cartesia.keyMask) })}
              onBlur={() => setCartesia({ ...cartesia, apiKey: blurMask(cartesia.apiKey, p.cartesia.keyMask) })}
              onChange={(e) => setCartesia({ ...cartesia, apiKey: e.target.value })} placeholder="sk_car_••••" />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Default voice ID</label>
            <input name="ca_voice" autoComplete="off" value={cartesia.voiceId} onChange={(e) => setCartesia({ ...cartesia, voiceId: e.target.value })} placeholder="faf0731e-…" className="mono" />
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={{ marginTop: 0 }}>Model</label>
            <input name="ca_model" autoComplete="off" value={cartesia.model} onChange={(e) => setCartesia({ ...cartesia, model: e.target.value })} placeholder="sonic-2" />
          </div>
          <button className="btn" onClick={() => saveCred("cartesia", { apiKey: secretOut(cartesia.apiKey, p.cartesia.keyMask), voiceId: cartesia.voiceId, model: cartesia.model })}>Save</button>
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
            <input name="ge_key" type="text" autoComplete="off" className="mono" value={gemini.apiKey}
              onFocus={() => setGemini({ ...gemini, apiKey: focusMask(gemini.apiKey, p.gemini.keyMask) })}
              onBlur={() => setGemini({ ...gemini, apiKey: blurMask(gemini.apiKey, p.gemini.keyMask) })}
              onChange={(e) => setGemini({ ...gemini, apiKey: e.target.value })} placeholder="AIza••••" />
          </div>
          <div style={{ minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Model</label>
            <input name="ge_model" autoComplete="off" value={gemini.model} onChange={(e) => setGemini({ ...gemini, model: e.target.value })} placeholder="gemini-2.5-flash" />
          </div>
          <button className="btn" onClick={() => saveCred("gemini", { apiKey: secretOut(gemini.apiKey, p.gemini.keyMask), model: gemini.model })}>Save</button>
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
            {data.numbers.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)" }}>No caller numbers added — the Plivo default number is used.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
