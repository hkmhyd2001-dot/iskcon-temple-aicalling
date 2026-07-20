import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Key {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("Raspberry Pi");
  const [fresh, setFresh] = useState<string>("");
  const [err, setErr] = useState("");

  const load = async () => {
    const res = await api.get<{ keys: Key[] }>("/api-keys");
    setKeys(res.keys);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const create = async () => {
    setErr(""); setFresh("");
    try {
      const res = await api.post<{ key: string }>("/api-keys", { name });
      setFresh(res.key);
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? The Pi using it will stop working.")) return;
    try { await api.post(`/api-keys/${id}/revoke`); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-title">API Keys</div>
      <div className="page-sub">The Raspberry Pi authenticates with one of these keys (put it in config.json).</div>
      {err && <div className="error">{err}</div>}

      {fresh && (
        <div className="ok">
          <strong>Copy this key now — it is shown only once:</strong>
          <div className="mono" style={{ marginTop: 6 }}>{fresh}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 22 }}>
        <h2>Create a key</h2>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 260 }} />
          <button className="btn" onClick={create}>+ Generate key</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.prefix}</td>
                <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td>{k.revokedAt ? <span className="badge off">revoked</span> : <span className="badge on">active</span>}</td>
                <td>{!k.revokedAt && <button className="btn danger small" onClick={() => revoke(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={5} style={{ color: "#bbb" }}>No keys yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
