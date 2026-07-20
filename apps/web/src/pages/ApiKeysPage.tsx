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
  const [ok, setOk] = useState("");
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");

  const load = async () => {
    const res = await api.get<{ keys: Key[] }>("/api-keys");
    setKeys(res.keys);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const create = async () => {
    setErr(""); setFresh(""); setOk("");
    try {
      const res = await api.post<{ key: string }>("/api-keys", { name });
      setFresh(res.key);
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? The Pi using it will stop working.")) return;
    try { await api.post(`/api-keys/${id}/revoke`); await load(); setOk("Key revoked."); }
    catch (e) { setErr((e as Error).message); }
  };

  const del = async (id: string) => {
    if (!confirm("Permanently delete this key? This cannot be undone.")) return;
    try { await api.del(`/api-keys/${id}`); await load(); setOk("Key deleted."); }
    catch (e) { setErr((e as Error).message); }
  };

  const saveName = async () => {
    setErr("");
    try { await api.patch(`/api-keys/${editId}`, { name: editName }); setEditId(""); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-title">API Keys</div>
      <div className="page-sub">The Raspberry Pi authenticates with one of these keys — paste it into the Pi's config.json.</div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {fresh && (
        <div className="ok">
          <strong>Copy this key now — it is shown only once:</strong>
          <div className="mono" style={{ marginTop: 6 }}>{fresh}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Create a key</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ minWidth: 260 }}>
            <label style={{ marginTop: 0 }}>Label</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raspberry Pi" />
          </div>
          <button className="btn" onClick={create}>+ Generate key</button>
        </div>
      </div>

      <div className="card">
        <h2>Keys ({keys.length})</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>
                  {editId === k.id ? (
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ maxWidth: 180 }} />
                      <button className="btn small" onClick={saveName}>Save</button>
                      <button className="btn secondary small" onClick={() => setEditId("")}>Cancel</button>
                    </div>
                  ) : k.name}
                </td>
                <td className="mono">{k.prefix}</td>
                <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td>{k.revokedAt ? <span className="badge off">revoked</span> : <span className="badge on">active</span>}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }}>
                    {editId !== k.id && <button className="btn secondary small" onClick={() => { setEditId(k.id); setEditName(k.name); }}>Rename</button>}
                    {!k.revokedAt && <button className="btn secondary small" onClick={() => revoke(k.id)}>Revoke</button>}
                    <button className="btn danger small" onClick={() => del(k.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-3)" }}>No keys yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
