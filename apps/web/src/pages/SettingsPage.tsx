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
  const [err, setErr] = useState("");

  const load = async () => setData(await api.get<SettingsResp>("/settings"));
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const addNumber = async () => {
    setErr("");
    try { await api.post("/settings/numbers", { phoneNumber: phone, isDefaultOutbound: true }); setPhone(""); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const delNumber = async (id: string) => {
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

      <div className="card" style={{ marginBottom: 22 }}>
        <h2>Provider status</h2>
        <table>
          <tbody>
            <tr><td>Plivo (telephony)</td><td>{badge(data.providers.plivo)}</td><td className="mono">{data.defaults.plivoNumber ?? "no default number"}</td></tr>
            <tr><td>Cartesia (voice)</td><td>{badge(data.providers.cartesia)}</td><td className="mono">{data.defaults.cartesiaModel}</td></tr>
            <tr><td>Gemini (optional)</td><td>{badge(data.providers.gemini)}</td><td className="mono">{data.defaults.geminiModel}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Caller numbers</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <input placeholder="+9180XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn" onClick={addNumber}>+ Add & make default</button>
        </div>
        <table>
          <thead><tr><th>Number</th><th>Default</th><th></th></tr></thead>
          <tbody>
            {data.numbers.map((n) => (
              <tr key={n.id}>
                <td className="mono">{n.phoneNumber}</td>
                <td>{n.isDefaultOutbound ? <span className="badge on">default</span> : ""}</td>
                <td><button className="btn danger small" onClick={() => delNumber(n.id)}>Remove</button></td>
              </tr>
            ))}
            {data.numbers.length === 0 && <tr><td colSpan={3} style={{ color: "#bbb" }}>Using env default only.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
