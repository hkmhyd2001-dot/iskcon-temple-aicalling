"""
ISKCON Temple Security Alert System
When camera detects line crossing → calls all security guards
"""
import json, time, logging, threading, re, socket
from datetime import datetime
from flask import Flask, request, render_template_string, redirect, url_for
import requests

app = Flask(__name__)

with open("config.json", encoding="utf-8") as f:
    CONFIG = json.load(f)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[
        logging.FileHandler("alerts.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

last_alert_time = 0
alert_count     = 0
recent_events   = []
lock            = threading.Lock()

def within_active_hours():
    """
    True if the current LOCAL time is inside the allowed calling window
    (e.g. 09:00–19:00 IST). The NVR keeps detecting 24/7, but calls only fire
    inside this window — outside it, line crossings are logged and ignored.

    NOTE: uses this machine's clock. Run app.py on a PC set to India time (IST)
    so the window matches Indian timings. Handles overnight windows too
    (e.g. 22:00–06:00) where end is "before" start on the clock.
    """
    if not CONFIG.get("active_hours_enabled", False):
        return True  # feature off → always allowed (24/7)

    try:
        start_h, start_m = map(int, CONFIG.get("active_start", "09:00").split(":"))
        end_h,   end_m   = map(int, CONFIG.get("active_end",   "19:00").split(":"))
    except Exception:
        return True  # bad config → fail safe: allow the call rather than block it

    now      = datetime.now()
    now_min  = now.hour * 60 + now.minute
    start    = start_h * 60 + start_m
    end      = end_h   * 60 + end_m

    if start <= end:
        return start <= now_min < end        # same-day window, e.g. 09:00–19:00
    return now_min >= start or now_min < end  # overnight window, e.g. 22:00–06:00


# One reused HTTPS session → the TLS handshake to Veytrix is done ONCE and kept
# warm, so every alert after the first saves ~0.5-1s of connection setup.
SESSION = requests.Session()


def fresh_session():
    """Replace the shared session after a connection failure. A kept-alive
    connection can go stale (server/idle timeout) and then die mid-request with
    SSLEOFError — a brand-new session forces a clean TCP+TLS handshake."""
    global SESSION
    try:
        SESSION.close()
    except Exception:
        pass
    SESSION = requests.Session()


def call_all_guards():
    """
    Dials every configured guard via Veytrix in ONE fast request.

    Uses the dedicated alert endpoint:
      POST /api/alert  { agentId, fromNumber, phones: [{name, phone}, ...] }

    This single call creates a call row per guard AND queues every dial at once —
    all guards ring near-simultaneously. It replaces the old two-step batch flow
    (create batch → start batch), cutting a full HTTPS round trip (~2-3s faster)
    and avoiding the paused-batch problem entirely (there is no batch at all).

    RETRY: a security alert must never be lost to one network blip, so the
    request is attempted up to 3 times (fresh connection each retry). Seen in
    production: SSLEOFError from a stale keep-alive connection killed an alert.
    """
    try:
        # Only real, filled-in numbers (skip the +91XXXXXXXXXX placeholder slots).
        phones = [
            {"name": m.get("name", "Guard"), "phone": m["phone"]}
            for m in CONFIG["security_numbers"]
            if "XXXX" not in m["phone"]
        ]
        if not phones:
            log.error("❌ No valid guard numbers configured (all still +91XXXXXXXXXX).")
            return

        base = CONFIG.get("veytrix_base_url", "https://iskcon-aicalls.fly.dev")

        # Up to 3 attempts. Network/SSL failures get a brand-new connection and
        # a short pause before retrying — one blip must not lose the alert.
        for attempt in range(1, 4):
            try:
                resp = SESSION.post(
                    f"{base}/api/alert",
                    json={
                        "agentId":    CONFIG["veytrix_agent_id"],
                        "fromNumber": CONFIG.get("from_number", ""),
                        "phones":     phones
                    },
                    headers={
                        "Authorization": f"Bearer {CONFIG['veytrix_api_key']}",
                        "Content-Type":  "application/json"
                    },
                    timeout=15
                )
            except requests.exceptions.RequestException as e:
                log.warning(f"⚠️ Attempt {attempt}/3 failed: {e}")
                fresh_session()
                if attempt < 3:
                    time.sleep(1.5)
                    continue
                log.error("❌ ALERT LOST after 3 attempts — check internet connection!")
                return

            if resp.status_code == 200:
                data = resp.json()
                log.info(f"✅ {data.get('message', 'dialing')} "
                         f"(dialed {data.get('dialed', len(phones))}, skipped {data.get('skipped', 0)})"
                         + (f" [attempt {attempt}]" if attempt > 1 else ""))
            else:
                # Server answered but rejected (bad key, quota, etc.) — retrying
                # the same request won't change that, so report and stop.
                log.error(f"❌ Alert dial failed {resp.status_code}: {resp.text[:300]}")
            return

    except Exception as e:
        log.error(f"❌ Error calling guards: {e}")


def handle_line_crossing(channel):
    global last_alert_time, alert_count, recent_events

    # OUTSIDE ACTIVE HOURS → NVR still detected it, but we do NOT call anyone.
    if not within_active_hours():
        log.info(f"🌙 Outside active hours ({CONFIG.get('active_start','09:00')}–"
                 f"{CONFIG.get('active_end','19:00')}) — line crossing ignored, no call.")
        return

    now = time.time()
    with lock:
        # Cooldown 0 (or missing) = call on EVERY crossing, no skipping. A
        # positive value would suppress repeat crossings within that many
        # seconds. Temple wants every crossing called, so this is 0.
        cooldown = CONFIG.get("cooldown_seconds", 0)
        if cooldown > 0 and now - last_alert_time < cooldown:
            log.info("⏳ Cooldown active — skipping duplicate")
            return
        last_alert_time = now
        alert_count += 1
        count = alert_count
        recent_events.insert(0, {
            "time":    datetime.now().strftime("%d %b %Y  %H:%M:%S"),
            "channel": channel,
            "count":   count
        })
        recent_events[:] = recent_events[:20]
    log.info(f"🚨 LINE CROSSING — Channel {channel} — Alert #{count}")
    threading.Thread(target=call_all_guards, daemon=True).start()


@app.route("/hikvision/event", methods=["POST"])
def hikvision_event():
    raw = request.get_data(as_text=True)
    if "EventNotificationAlert" not in raw:
        return "OK", 200
    t = re.search(r"<eventType>(.*?)</eventType>", raw, re.I)
    c = re.search(r"<channelID>(.*?)</channelID>",  raw, re.I)
    if t and t.group(1).strip().lower() == "linedetection":
        handle_line_crossing(c.group(1).strip() if c else "?")
    return "OK", 200


@app.route("/test")
def test_alert():
    handle_line_crossing("TEST")
    return "<h2 style='font-family:Arial;color:green'>✅ Test sent! All guards will receive a call in 30 seconds.</h2><br><a href='/'>← Back to dashboard</a>"


def normalize_phone(raw):
    """
    Clean a phone number into E.164 (+<digits>) so calls never fail on format.
    - strips spaces, dashes, brackets
    - if it starts with '+' keep it; else if 10 digits assume India → +91;
      else just prefix '+'. Empty/placeholder → "" (skipped).
    """
    raw = (raw or "").strip()
    if not raw or "XXXX" in raw.upper():
        return ""
    has_plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    if has_plus:
        return "+" + digits
    if len(digits) == 10:            # bare Indian mobile → add country code
        return "+91" + digits
    return "+" + digits


def save_config(new_cfg):
    """Write the config back to disk AND update the live in-memory CONFIG."""
    global CONFIG
    with open("config.json", "w", encoding="utf-8") as f:
        json.dump(new_cfg, f, indent=2, ensure_ascii=False)
    CONFIG = new_cfg


@app.route("/settings/save", methods=["POST"])
def settings_save():
    """Read the submitted form, validate lightly, and persist to config.json."""
    f = request.form

    # Build a fresh config from the existing one so we never drop unknown keys.
    cfg = dict(CONFIG)

    cfg["veytrix_api_key"]   = f.get("veytrix_api_key", "").strip()
    cfg["veytrix_agent_id"]  = f.get("veytrix_agent_id", "").strip()
    cfg["veytrix_base_url"]  = f.get("veytrix_base_url", "").strip() or "https://iskcon-aicalls.fly.dev"
    cfg["telephony_provider"] = f.get("telephony_provider", "plivo").strip()
    cfg["from_number"]       = normalize_phone(f.get("from_number", ""))

    try:
        cfg["server_port"]      = int(f.get("server_port", "5050").strip() or 5050)
    except ValueError:
        cfg["server_port"] = 5050
    try:
        cfg["cooldown_seconds"] = int(f.get("cooldown_seconds", "60").strip() or 60)
    except ValueError:
        cfg["cooldown_seconds"] = 60

    cfg["active_hours_enabled"] = f.get("active_hours_enabled") == "on"
    cfg["active_start"] = f.get("active_start", "09:00").strip() or "09:00"
    cfg["active_end"]   = f.get("active_end", "19:00").strip() or "19:00"

    # Guards: parallel name[] / phone[] lists from the form. Keep rows that have
    # at least a phone; drop fully-empty rows the user cleared.
    names  = f.getlist("guard_name")
    phones = f.getlist("guard_phone")
    guards = []
    for i in range(max(len(names), len(phones))):
        name  = (names[i]  if i < len(names)  else "").strip()
        phone = normalize_phone(phones[i] if i < len(phones) else "")
        if not phone:
            continue
        guards.append({"name": name or f"Guard {len(guards)+1}", "phone": phone})
    if guards:
        cfg["security_numbers"] = guards

    save_config(cfg)
    log.info("⚙️ Settings updated via web UI.")
    return redirect(url_for("settings_page", saved=1))


SETTINGS_PAGE = """<!DOCTYPE html><html><head><meta charset=UTF-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Settings — ISKCON Security Alert</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;background:#f0f2f5;color:#222}
.top{background:#1a237e;color:#fff;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
.top h1{font-size:18px}
.top a{color:#c5cae9;font-size:13px;text-decoration:none}
.wrap{max-width:880px;margin:0 auto;padding:22px 20px 60px}
.saved{background:#e8f5e9;border:1px solid #a5d6a7;color:#2e7d32;padding:11px 16px;border-radius:6px;font-size:14px;margin-bottom:18px}
.card{background:#fff;border-radius:8px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:18px}
.card h2{font-size:14px;color:#1a237e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.card .hint{font-size:12px;color:#999;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
.field{display:flex;flex-direction:column}
.field.full{grid-column:1/-1}
label{font-size:12px;color:#555;font-weight:700;margin-bottom:5px}
input,select{padding:9px 11px;border:1px solid #d0d0d0;border-radius:5px;font-size:14px;font-family:inherit}
input:focus,select:focus{outline:none;border-color:#1a237e}
.chk{display:flex;align-items:center;gap:9px;grid-column:1/-1}
.chk input{width:17px;height:17px}
.chk label{margin:0;font-weight:400;font-size:13px;color:#333}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding:6px 8px;border-bottom:2px solid #eee}
td{padding:5px 8px}
td input{width:100%}
.rownum{color:#aaa;font-size:13px;width:34px;text-align:center}
.remove{background:#fff;border:1px solid #e0b4b4;color:#c62828;border-radius:5px;padding:7px 12px;cursor:pointer;font-size:13px}
.addbtn{margin-top:12px;background:#fff;border:1px solid #a5b4d8;color:#1a237e;border-radius:5px;padding:9px 16px;cursor:pointer;font-size:13px;font-weight:700}
.bar{position:sticky;bottom:0;background:#fff;border-top:1px solid #e6e6e6;padding:14px 24px;display:flex;gap:12px;justify-content:flex-end;margin:0 -24px -22px;border-radius:0 0 8px 8px}
.save{background:#1a237e;color:#fff;border:none;border-radius:6px;padding:11px 28px;cursor:pointer;font-size:14px;font-weight:700}
.cancel{background:#f0f0f0;color:#555;border:none;border-radius:6px;padding:11px 22px;cursor:pointer;font-size:14px;text-decoration:none;display:inline-flex;align-items:center}
</style></head><body>
<div class="top">
  <h1>⚙️ Settings — ISKCON Security Alert</h1>
  <a href="/">← Back to Dashboard</a>
</div>
<div class="wrap">
  {% if request.args.get('saved') %}<div class="saved">✅ Settings saved. Changes are live immediately — no restart needed.</div>{% endif %}
  <form method="POST" action="/settings/save">

    <div class="card">
      <h2>AI Calling — Veytrix</h2>
      <div class="hint">Credentials for the AI voice-calling service that dials the guards.</div>
      <div class="grid">
        <div class="field full"><label>API Key</label>
          <input name="veytrix_api_key" value="{{ c.veytrix_api_key }}" placeholder="acai_..."></div>
        <div class="field full"><label>Agent ID</label>
          <input name="veytrix_agent_id" value="{{ c.veytrix_agent_id }}" placeholder="d2845c62-..."></div>
        <div class="field"><label>Telephony Provider</label>
          <input name="telephony_provider" value="{{ c.telephony_provider }}" placeholder="plivo"></div>
        <div class="field"><label>Caller Number (From)</label>
          <input name="from_number" value="{{ c.from_number }}" placeholder="+918031149337"></div>
        <div class="field full"><label>Server URL</label>
          <input name="veytrix_base_url" value="{{ c.veytrix_base_url }}" placeholder="https://iskcon-aicalls.fly.dev"></div>
      </div>
    </div>

    <div class="card">
      <h2>Calling Hours</h2>
      <div class="hint">Calls fire only inside this window (India time). Outside it, the camera still detects but no call is made.</div>
      <div class="grid">
        <div class="chk">
          <input type="checkbox" id="ah" name="active_hours_enabled" {{ 'checked' if c.active_hours_enabled else '' }}>
          <label for="ah">Restrict calls to the hours below (uncheck for 24/7)</label>
        </div>
        <div class="field"><label>Start Time (24-hour)</label>
          <input type="time" name="active_start" value="{{ c.active_start }}"></div>
        <div class="field"><label>End Time (24-hour)</label>
          <input type="time" name="active_end" value="{{ c.active_end }}"></div>
        <div class="field"><label>Cooldown Between Alerts (seconds) — 0 = call every crossing</label>
          <input name="cooldown_seconds" value="{{ c.cooldown_seconds }}" placeholder="0"></div>
        <div class="field"><label>Server Port</label>
          <input name="server_port" value="{{ c.server_port }}" placeholder="5050"></div>
      </div>
    </div>

    <div class="card">
      <h2>Security Guards</h2>
      <div class="hint">Everyone here is called when the camera detects a line crossing. Use full format +91XXXXXXXXXX.</div>
      <table id="guards">
        <tr><th class="rownum">#</th><th>Name</th><th>Phone Number</th><th></th></tr>
        {% for g in guards %}
        <tr>
          <td class="rownum idx"></td>
          <td><input name="guard_name" value="{{ g.get('name','') }}" placeholder="Guard name"></td>
          <td><input name="guard_phone" value="{{ g.get('phone','') }}" placeholder="+919876543210"></td>
          <td><button type="button" class="remove" onclick="rm(this)">Remove</button></td>
        </tr>
        {% endfor %}
      </table>
      <button type="button" class="addbtn" onclick="addRow()">+ Add Guard</button>
    </div>

    <div class="card" style="padding-bottom:0">
      <div class="bar">
        <a class="cancel" href="/">Cancel</a>
        <button type="submit" class="save">💾 Save Settings</button>
      </div>
    </div>
  </form>
</div>
<script>
function renum(){document.querySelectorAll('#guards tr .idx').forEach((e,i)=>e.textContent=i+1);}
function rm(b){b.closest('tr').remove();renum();}
function addRow(){
  var t=document.getElementById('guards');
  var tr=document.createElement('tr');
  tr.innerHTML='<td class="rownum idx"></td>'+
    '<td><input name="guard_name" placeholder="Guard name"></td>'+
    '<td><input name="guard_phone" placeholder="+919876543210"></td>'+
    '<td><button type="button" class="remove" onclick="rm(this)">Remove</button></td>';
  t.appendChild(tr);renum();
}
renum();
</script>
</body></html>"""


@app.route("/settings")
def settings_page():
    return render_template_string(SETTINGS_PAGE, c=CONFIG, guards=CONFIG.get("security_numbers", []))


PAGE = """<!DOCTYPE html><html><head><meta charset=UTF-8>
<meta http-equiv="refresh" content="15">
<title>ISKCON Security Alert</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#f0f2f5}
.top{background:#1a237e;color:#fff;padding:18px 28px}
.top h1{font-size:20px}
.top p{font-size:12px;opacity:.75;margin-top:3px}
.wrap{padding:20px 28px;max-width:860px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.card{background:#fff;border-radius:8px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.big{font-size:34px;font-weight:700;color:#1a237e}
.sub{font-size:12px;color:#aaa;margin-top:3px}
.green{color:#2e7d32}
a.btn{display:inline-block;margin-top:12px;padding:9px 22px;background:#c62828;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f7f7f7;padding:8px 10px;text-align:left;font-size:11px;color:#888;border-bottom:2px solid #eee}
td{padding:8px 10px;border-bottom:1px solid #f2f2f2}
.pill{background:#e8f5e9;color:#2e7d32;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:700}
.top{display:flex;justify-content:space-between;align-items:center}
.gear{color:#c5cae9;font-size:13px;text-decoration:none;font-weight:700;white-space:nowrap}
</style></head><body>
<div class="top">
  <div>
    <h1>🛡️ ISKCON Temple — Security Alert System</h1>
    <p>Page refreshes every 15 seconds &nbsp;·&nbsp; {{ now }}</p>
  </div>
  <a class="gear" href="/settings">⚙️ Settings</a>
</div>
<div class="wrap">
  <div class="row">
    <div class="card">
      <div class="label">System Status</div>
      <div class="big green">🟢 Online</div>
      <div class="sub">{{ hours_note }}</div>
      <a class="btn" href="/test">🔔 Send Test Call to All Guards</a>
    </div>
    <div class="card">
      <div class="label">Total Alerts Sent</div>
      <div class="big">{{ count }}</div>
      <div class="sub">{{ total }} guards called each time</div>
    </div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="label">Security Guards — All receive a call when camera detects crossing</div>
    <table>
      <tr><th>#</th><th>Name</th><th>Phone</th></tr>
      {% for g in guards %}
      <tr><td>{{ loop.index }}</td><td>{{ g.get('name','Guard') }}</td>
      <td>{{ g['phone'] if 'XXXX' not in g['phone'] else '⚠️ Not added yet' }}</td></tr>
      {% endfor %}
    </table>
  </div>
  <div class="card">
    <div class="label">Line Crossing Event History</div>
    {% if events %}
    <table>
      <tr><th>Alert #</th><th>Date &amp; Time</th><th>Camera Channel</th></tr>
      {% for e in events %}
      <tr><td><span class="pill">#{{ e.count }}</span></td><td>{{ e.time }}</td><td>Channel {{ e.channel }}</td></tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#bbb;padding:10px 0;font-size:13px">No events yet. Waiting for camera...</p>
    {% endif %}
  </div>
</div></body></html>"""


@app.route("/")
def dashboard():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
    except: ip = "localhost"
    active = [g for g in CONFIG["security_numbers"] if "XXXX" not in g["phone"]]
    if CONFIG.get("active_hours_enabled"):
        hours_note = f"Calls active {CONFIG.get('active_start','09:00')}–{CONFIG.get('active_end','19:00')} (India time)"
    else:
        hours_note = "Running 24/7 automatically"
    return render_template_string(PAGE,
        count=alert_count, total=len(active),
        guards=CONFIG["security_numbers"],
        events=recent_events,
        hours_note=hours_note,
        now=datetime.now().strftime("%d %b %Y  %H:%M:%S"))


if __name__ == "__main__":
    port = CONFIG.get("server_port", 5050)
    active = [g for g in CONFIG["security_numbers"] if "XXXX" not in g["phone"]]
    log.info("=" * 50)
    log.info("  ISKCON TEMPLE SECURITY ALERT — STARTED")
    log.info(f"  Dashboard : http://localhost:{port}")
    log.info(f"  Guards    : {len(active)} active numbers configured")
    log.info("=" * 50)
    app.run(host="0.0.0.0", port=port, debug=False)
