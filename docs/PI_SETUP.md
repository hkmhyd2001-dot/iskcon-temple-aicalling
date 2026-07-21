# Raspberry Pi + NVR Setup

The Pi is the **local bridge**: the NVR can only POST on the temple LAN, so a
small always-on machine on that LAN catches the event and forwards it to the
backend over the internet.

## Hardware
- **Raspberry Pi 4 Model B, 2GB** (starter kit ~₹5,000–6,000) + 32GB microSD +
  official 5V/3A USB-C power + Ethernet cable.
- Must have **internet access** (to reach the Fly backend) and be on the **same
  LAN as the NVR** (192.168.3.x).

## 1. Fill in config
Edit [`../pi/config.json`](../pi/config.json):
```json
{
  "veytrix_api_key":  "acai_…  (from the dashboard → API Keys, or npm run seed)",
  "veytrix_agent_id": "…       (from the dashboard → Alert Message, or seed)",
  "veytrix_base_url": "https://iskcon-temple-aicalling.fly.dev",
  "from_number":      "+9180XXXXXXXX  (your Plivo number)",
  "active_hours_enabled": true,
  "active_start": "09:00",
  "active_end":   "19:00",
  "cooldown_seconds": 0,
  "security_numbers": [
    { "name": "Guard 1", "phone": "+919876543210" }
  ]
}
```

## 2. Install on the Pi
```bash
sudo apt update && sudo apt install -y python3 python3-pip
pip3 install -r requirements.txt        # Flask + requests
python3 app.py                          # test run — opens dashboard on :5050
```
Open `http://<pi-ip>:5050` → click **Send Test Call** → all guards should ring.

## 3. Run 24/7 as a service
```bash
bash pi_setup.sh        # registers a systemd service: auto-start on boot,
                        # auto-restart on crash
```

## 4. Point the NVR at the Pi
```bash
python3 setup_nvr.py    # sends an ISAPI HttpHostNotification telling the NVR to
                        # POST line-crossing events to <pi-ip>:5050/hikvision/event
```
In the NVR, enable **Line Crossing Detection ONLY on the entrance camera**
(events currently arrive on **Channel 50**).

## 5. Go live
Walk the real camera line → every guard is called automatically. ✅

## How the Pi calls the backend
`app.py` sends exactly one request per crossing:
```
POST {veytrix_base_url}/api/alert
Authorization: Bearer {veytrix_api_key}
{ "agentId": "{veytrix_agent_id}", "fromNumber": "{from_number}",
  "phones": [ {"name","phone"}, … ] }
```
It retries up to 3× (fresh TLS connection) so a single network blip never loses
an alert. Active-hours and cooldown are enforced Pi-side before the call is sent.

## Settings you can change without redeploying
- Guards, caller number, active hours, cooldown → the Pi's `/settings` web page
  (or edit `config.json`; changes are live, no restart).
- The spoken message + voice → the **dashboard** (Alert Message page). The next
  call renders the new audio automatically.
