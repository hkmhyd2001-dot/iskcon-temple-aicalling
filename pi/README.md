# Raspberry Pi relay

Runs on an always-on Pi on the temple LAN. Catches the NVR line-crossing event
and calls the backend's `POST /api/alert` to ring every guard.

- `app.py` — Flask listener (`:5050`) + local dashboard + settings page
- `config.json` — fill in API key, agent id, base url, guards (see below)
- `setup_nvr.py` — points the Hikvision NVR at this Pi
- `pi_setup.sh` — registers `app.py` as a systemd service (auto-start/restart)
- `requirements.txt` — Python deps (Flask, requests)

Full instructions: [`../docs/PI_SETUP.md`](../docs/PI_SETUP.md).

> `config.json` here is a **template** with placeholders. Get the real API key
> and agent id from the dashboard (or `npm run seed`) and paste them in.
