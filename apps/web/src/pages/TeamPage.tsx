import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../stores/authStore";

interface Member {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  lastLoginAt?: string | null;
  createdAt: string;
}

export default function TeamPage() {
  const me = useAuth((s) => s.user);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("admin");

  // inline edit
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("admin");
  const [editPw, setEditPw] = useState("");

  const load = async () => {
    const res = await api.get<{ users: Member[] }>("/users");
    setMembers(res.users);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, []);

  const create = async () => {
    setErr(""); setOk("");
    try {
      await api.post("/users", { email, name, password, role });
      setEmail(""); setName(""); setPassword(""); setRole("admin");
      setOk("Team member added.");
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const startEdit = (m: Member) => {
    setEditId(m.id); setEditName(m.name ?? ""); setEditRole(m.role); setEditPw("");
    setErr(""); setOk("");
  };

  const saveEdit = async () => {
    setErr(""); setOk("");
    try {
      const body: Record<string, unknown> = { name: editName, role: editRole };
      if (editPw) body.password = editPw;
      await api.patch(`/users/${editId}`, body);
      setEditId("");
      setOk("Saved.");
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email} from the team?`)) return;
    setErr(""); setOk("");
    try { await api.del(`/users/${m.id}`); await load(); setOk("Team member removed."); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="page-title">Team</div>
      <div className="page-sub">Manage who can sign in to this console and what they can do.</div>
      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Add a team member</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ marginTop: 0 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="person@iskcon.local" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ marginTop: 0 }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="Full name" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ marginTop: 0 }}>Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="min 6 chars" />
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={{ marginTop: 0 }}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button className="btn" onClick={create}>+ Add member</button>
        </div>
        <div className="page-sub" style={{ margin: "10px 0 0" }}>
          <b>Admin</b> can change everything. <b>Viewer</b> can see the dashboard but not edit settings, keys, or the team.
        </div>
      </div>

      <div className="card">
        <h2>Members ({members.length})</h2>
        <table>
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>Last login</th><th></th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              editId === m.id ? (
                <tr key={m.id}>
                  <td className="mono">{m.email}</td>
                  <td><input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" /></td>
                  <td>
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)} disabled={m.id === me?.id}>
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td><input value={editPw} onChange={(e) => setEditPw(e.target.value)} type="password" placeholder="New password (optional)" /></td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button className="btn small" onClick={saveEdit}>Save</button>
                      <button className="btn secondary small" onClick={() => setEditId("")}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={m.id}>
                  <td className="mono">{m.email}{m.id === me?.id && <span className="badge on" style={{ marginLeft: 8 }}>you</span>}</td>
                  <td>{m.name ?? "—"}</td>
                  <td><span className="badge on" style={{ background: m.role === "admin" ? "var(--green-bg)" : "var(--amber-bg)", color: m.role === "admin" ? "var(--green)" : "var(--amber)" }}>{m.role}</span></td>
                  <td>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "never"}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button className="btn secondary small" onClick={() => startEdit(m)}>Edit</button>
                      {m.id !== me?.id && <button className="btn danger small" onClick={() => remove(m)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              )
            ))}
            {members.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-3)" }}>No members.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
