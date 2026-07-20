import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Num { id: string; phoneNumber: string; label?: string | null; isDefaultOutbound: boolean; }
interface SettingsResp {
  providers: { plivo: boolean; cartesia: boolean; gemini: boolean };
  defaults: { plivoNumber: string | null; cartesiaModel: string; geminiModel: string };
  numbers: Num[];
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResp | null>(null);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // inline edit
  const [editId, setEditId] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const load = async () => setData(await api.get<SettingsResp>("/settings"));
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const addNumber = async () => {
    setErr(""); setOk("");
    try {
      await api.post("/settings/numbers", { phoneNumber: phone, label, isDefaultOutbound: (data?.numbers.length ?? 0) === 0 });
      setPhone(""); setLabel(""); setOk("Number added.");
      await load();
    } catch (e) { setErr((e as Error).message); }
  };
  const setDefault = async (id: string) => {
    setErr("");
    try { await api.patch(`/settings/numbers/${id}`, { isDefaultOutbound: true }); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const saveEdit = async () => {
    setErr("");
    try { await api.patch(`/settings/numbers/${editId}`, { phoneNumber: editPhone, label: editLabel }); setEditId(""); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const delNumber = async (id: string) => {
    if (!confirm("Remove this caller number?")) return;
    try { await api.del(`/settings/numbers/${id}`); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  if (!data) return <div>Loading…</div>;
  const badge = (on: boolean) => <span className={`badge ${on ? "on" : "off"}`}>{on ? "configured" : "missing"}</span>;

  return (
    <>
      <div className="page-title">Settings</div>
      <div className="page-sub">Provider credentials are set as environment variables (Fly secrets) — never entered here.</div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Provider status</h2>
        <table>
          <thead><tr><th>Provider</th><th>Status</th><th>Default</th></tr></thead>
          <tbody>
            <tr><td>Plivo (telephony)</td><td>{badge(data.providers.plivo)}</td><td className="mono">{data.defaults.plivoNumber ?? "—"}</td></tr>
            <tr><td>Cartesia (voice)</td><td>{badge(data.providers.cartesia)}</td><td className="mono">{data.defaults.cartesiaModel}</td></tr>
            <tr><td>Gemini (optional)</td><td>{badge(data.providers.gemini)}</td><td className="mono">{data.defaults.geminiModel}</td></tr>
          </tbody>
        </table>
      </div>

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
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                      <button className="btn small" onClick={saveEdit}>Save</button>
                      <button className="btn secondary small" onClick={() => setEditId("")}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={n.id}>
                  <td className="mono">{n.phoneNumber}</td>
                  <td>{n.label ?? "—"}</td>
                  <td>{n.isDefaultOutbound ? <span className="badge on">default</span> : ""}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                      {!n.isDefaultOutbound && <button className="btn secondary small" onClick={() => setDefault(n.id)}>Make default</button>}
                      <button className="btn secondary small" onClick={() => { setEditId(n.id); setEditPhone(n.phoneNumber); setEditLabel(n.label ?? ""); }}>Edit</button>
                      <button className="btn danger small" onClick={() => delNumber(n.id)}>Remove</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {data.numbers.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)" }}>Using the env default only.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
