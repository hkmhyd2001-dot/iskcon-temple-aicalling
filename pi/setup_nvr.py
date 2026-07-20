"""
Connects the Hikvision NVR to this server.
IT team runs this ONCE using CONFIGURE_NVR.bat
"""
import json, socket, requests
from requests.auth import HTTPDigestAuth
import urllib3
urllib3.disable_warnings()

with open("config.json", encoding="utf-8") as f:
    CONFIG = json.load(f)

print()
print("=" * 55)
print("  ISKCON Alert — Connect Camera NVR to this Server")
print("=" * 55)
print()

nvr_ip   = input("NVR IP address  [192.168.3.100] : ").strip() or "192.168.3.100"
nvr_port = input("NVR Port        [7443]          : ").strip() or "7443"
nvr_user = input("NVR Username    [admin]         : ").strip() or "admin"
nvr_pass = input("NVR Password                    : ").strip()

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80)); detected = s.getsockname()[0]; s.close()
except: detected = "192.168.3.X"

my_ip   = input(f"This PC's IP    [{detected}] : ").strip() or detected
my_port = CONFIG.get("server_port", 5050)

print()
print(f"  Connecting to NVR at {nvr_ip}:{nvr_port} ...")

xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotification>
  <id>1</id>
  <url>/hikvision/event</url>
  <protocolType>HTTP</protocolType>
  <parameterFormatType>XML</parameterFormatType>
  <addressingFormatType>ipaddress</addressingFormatType>
  <ipAddress>{my_ip}</ipAddress>
  <portNo>{my_port}</portNo>
  <httpAuthenticationMethod>none</httpAuthenticationMethod>
</HttpHostNotification>"""

try:
    resp = requests.put(
        f"https://{nvr_ip}:{nvr_port}/ISAPI/Event/notification/httpHosts/1",
        data=xml, auth=HTTPDigestAuth(nvr_user, nvr_pass),
        headers={"Content-Type": "application/xml"},
        verify=False, timeout=15
    )
    if resp.status_code in (200, 201):
        print()
        print("  ✅ SUCCESS! NVR connected to this server.")
        print()
        print("  Now test: Open browser → http://localhost:5050/test")
        print("  All guards should receive a call within 30 seconds.")
    else:
        print(f"  ❌ Error {resp.status_code}: {resp.text[:150]}")
        print("  Check NVR password and network connection.")
except requests.exceptions.ConnectionError:
    print(f"  ❌ Cannot reach NVR at {nvr_ip}:{nvr_port}")
    print("  Make sure this PC and NVR are on the same network.")
except Exception as e:
    print(f"  ❌ Error: {e}")

print()
input("Press Enter to close...")
