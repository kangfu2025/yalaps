# คู่มือติดตั้ง YALA PC Agent บนเครื่องลูกค้า

เอกสารนี้อธิบายขั้นตอนติดตั้ง Agent บน PC เครื่อง 1 และเครื่อง 2 แบบละเอียด
ตั้งแต่การเตรียม Windows → build .exe → ติดตั้ง → verify → hardening

---

## 📋 สิ่งที่ต้องเตรียมก่อน

### บนเครื่อง Dev / Admin ของคุณ (สำหรับ build)
- Windows 10/11 x64
- **.NET 8 SDK** — https://dotnet.microsoft.com/download/dotnet/8.0
- Git หรือดาวน์โหลด source ของโปรเจกต์ Lovable นี้มาไว้ในเครื่อง

### บน PC ลูกค้า (เครื่อง 1 และเครื่อง 2)
- Windows 10/11 x64
- สิทธิ์ Administrator (เพื่อรัน install.ps1)
- อินเตอร์เน็ต (WiFi/LAN) เชื่อมต่อได้
- เวลา Windows ต้องตรง (จะตั้ง NTP ในขั้นตอนติดตั้ง)

### บน Web Admin (เบราว์เซอร์)
- Login เข้า YALA dashboard → เปิด "PC Zone Panel"
- เพิ่มเครื่อง `PC #1` และ `PC #2` ในตาราง `machines` (zone = pc)
- **คัดลอก UUID** ของแต่ละเครื่อง จะใช้ตอนติดตั้ง

> วิธีดู UUID: เปิด PC Zone Panel → คลิกเครื่อง → ดูช่อง `machine_id` (หรือเปิด Supabase table editor → `machines` → คัดลอก `id`)

ตัวอย่าง:
```
PC #1 → 8a1b2c3d-4e5f-6789-abcd-ef0123456789
PC #2 → 9b2c3d4e-5f6a-7890-bcde-f01234567890
```

---

## 🏗️ ขั้นตอนที่ 1: Build .exe (ทำครั้งเดียวบนเครื่อง dev)

เปิด PowerShell ในโฟลเดอร์โปรเจกต์:

```powershell
cd pc-agent\YalaPcAgent

dotnet publish -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true
```

ผลลัพธ์: `pc-agent\YalaPcAgent\bin\Release\net8.0-windows\win-x64\publish\YalaPcAgent.exe` (~60 MB)

Copy 2 ไฟล์นี้ไว้ใน **USB flash drive**:
1. `YalaPcAgent.exe` (จาก path ด้านบน)
2. `pc-agent\install.ps1`

---

## 🖥️ ขั้นตอนที่ 2: ติดตั้งบน PC เครื่อง 1

### 2.1 เตรียม Windows

1. **ตั้งเวลา NTP** (สำคัญมาก — countdown ใช้เวลาเครื่อง):
   - เปิด PowerShell as Admin:
   ```powershell
   w32tm /config /manualpeerlist:"time.navy.mi.th,time.windows.com" /syncfromflags:manual /update
   Restart-Service w32time
   w32tm /resync
   ```
   - ตรวจเวลา: `Get-Date` ต้องตรงกับเวลาโทรศัพท์ ±5 วินาที

2. **สร้าง Windows User "ลูกค้า"** (แนะนำ — non-admin):
   - Settings → Accounts → Family & other users → Add user
   - ชื่อ: `Player` — Password: (ตั้ง blank หรือง่ายๆ)
   - Account type: **Standard User** (ไม่ใช่ admin)

3. **ตั้ง Auto-login เป็น Player**:
   ```powershell
   # PowerShell as Admin
   Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "AutoAdminLogon" -Value "1"
   Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultUserName" -Value "Player"
   Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultPassword" -Value ""
   ```

### 2.2 รัน installer

1. เสียบ USB → copy `YalaPcAgent.exe` + `install.ps1` ไว้ที่ **Desktop ของ Admin user** (ไม่ใช่ Player)
2. เปิด PowerShell **as Administrator** (คลิกขวา → Run as administrator)
3. ปลดล็อก execution policy (ครั้งเดียว):
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
4. รัน installer พร้อม UUID ของเครื่อง 1:
   ```powershell
   cd $env:USERPROFILE\Desktop
   .\install.ps1 -MachineId "8a1b2c3d-4e5f-6789-abcd-ef0123456789" -MachineNumber 1
   ```

Installer จะ:
- ✓ Copy `YalaPcAgent.exe` → `C:\YALA\YalaPcAgent.exe`
- ✓ เขียน config ลง `HKLM\SOFTWARE\YALA\Agent`
- ✓ สร้าง scheduled task `YalaPcAgent` (auto-start ตอน logon, restart on crash)
- ✓ สร้าง watchdog task `YalaPcAgentWatchdog` (ทุก 2 นาที)

### 2.3 ทดสอบครั้งแรก

```powershell
Start-Process "C:\YALA\YalaPcAgent.exe"
```

ต้องเห็น:
- 🖥️ หน้าจอเต็มสีเข้ม + ข้อความ "🎮 YALA PLAYSTATION — กรุณาติดต่อพนักงานเพื่อเปิดเครื่อง"
- Web Admin → PC Zone Panel → เครื่อง #1 มี badge **🟢 Online** (heartbeat 15 วิ)

### 2.4 ทดสอบ session

1. Web Admin → เครื่อง #1 → กด **"เริ่ม 30 นาที"**
2. ที่ PC: LockScreen หายไป → มี countdown timer มุมซ้ายบน "30:00"
3. Web Admin → กด **"เติมเวลา 30 นาที"** → countdown อัปเดตเป็น "60:00" ทันที
4. เพื่อทดสอบหมดเวลาเร็ว: ตั้ง session 1 นาที → รอ → LockScreen ต้องกลับมา ✓

### 2.5 Reboot ทดสอบ persistence

```powershell
Restart-Computer
```

หลัง reboot → auto-login → LockScreen ต้องขึ้นเองภายใน 10 วินาที (จาก scheduled task ONLOGON)

### 2.6 Hardening (ทำหลัง verify ผ่าน)

รันใน PowerShell as Admin — **ปิดช่องทางลูกค้าปิด agent**:

```powershell
# 1) ปิด Task Manager สำหรับทุก user (agent ปิดไม่ได้)
New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Force | Out-Null
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableTaskMgr" -Value 1

# 2) ปิด Alt+F4 ไม่ให้ปิด LockScreen (Optional — ต้อง edit gpedit)
# User Config → Admin Templates → System → Turn off Windows+X hotkeys = Enabled

# 3) ซ่อน Taskbar (LockScreen fullscreen อยู่แล้ว แต่ป้องกัน flash ตอน boot)
Set-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3" -Name "Settings" -Value ([byte[]](0x30,0x00,0x00,0x00,0xFE,0xFF,0xFF,0xFF,0x03,0x00,0x00,0x00,0x03,0x00,0x00,0x00))
```

หมายเหตุ: ขั้นตอน hardening ทำผ่าน admin user เท่านั้น — Player user จะไม่มีสิทธิ์แก้กลับ

---

## 🖥️ ขั้นตอนที่ 3: ติดตั้งบน PC เครื่อง 2

**ทำเหมือนเครื่อง 1 ทุกอย่าง** ยกเว้นตอนรัน installer — ใช้ UUID และเลขเครื่องของ #2:

```powershell
.\install.ps1 -MachineId "9b2c3d4e-5f6a-7890-bcde-f01234567890" -MachineNumber 2
```

> ⚠️ **ห้ามใช้ UUID เดียวกัน 2 เครื่อง** — จะทำให้ heartbeat ทับกันและ session สลับสับสน

---

## ✅ Verification Checklist (หลังติดตั้งเสร็จทั้ง 2 เครื่อง)

- [ ] Web Admin → PC Zone Panel เห็น **🟢 Online** ทั้ง 2 เครื่อง
- [ ] เริ่ม session เครื่อง 1 → LockScreen เครื่อง 1 หาย, เครื่อง 2 **ไม่กระทบ**
- [ ] เติมเวลา → countdown อัปเดตทันที (<3 วิ)
- [ ] หมดเวลา → LockScreen กลับมาอัตโนมัติ
- [ ] Kill process `YalaPcAgent.exe` ผ่าน Task Manager (จาก admin) → รอ 2 นาที → watchdog เปิดใหม่
- [ ] ถอดสาย LAN → เสียบกลับ → agent resync ภายใน 30 วิ
- [ ] Reboot PC → LockScreen ขึ้นเองก่อนเห็น desktop

---

## 🛠️ Troubleshooting

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| LockScreen ไม่ขึ้นหลัง reboot | Scheduled task ไม่ทำงาน | `schtasks /Query /TN YalaPcAgent /V` ตรวจ Last Result ควรเป็น `0x0` |
| Web Admin แสดง **🔴 Offline** | Heartbeat หลุด / config ผิด | เปิด Event Viewer → Application → filter `YalaPcAgent` |
| Countdown ผิดเวลา | นาฬิกา PC เพี้ยน | `w32tm /resync` |
| Agent ไม่ตอบสนอง realtime | Firewall block wss:// | อนุญาต outbound port 443 → `*.supabase.co` |
| ลูกค้าปิด agent ได้ | ไม่ได้ปิด Task Manager | รัน hardening step ในข้อ 2.6 |
| Config ผิด (ต้องแก้ UUID) | | ```powershell<br>Set-ItemProperty "HKLM:\SOFTWARE\YALA\Agent" -Name MachineId -Value "<new-uuid>"<br>Restart-Computer``` |

### ดู log ของ agent
Agent ยังไม่มี log file แต่ error แสดงบน LockScreen เอง — ถ้าเห็นข้อความ "ระบบขัดข้อง..." คือ config ผิดหรือเน็ตขาด

### ถอนการติดตั้ง
```powershell
schtasks /Delete /TN YalaPcAgent /F
schtasks /Delete /TN YalaPcAgentWatchdog /F
taskkill /IM YalaPcAgent.exe /F
Remove-Item -Path "HKLM:\SOFTWARE\YALA" -Recurse -Force
Remove-Item -Path "C:\YALA" -Recurse -Force
```

---

## 📞 Support Path

1. ตรวจ heartbeat ที่ Web Admin → เห็น online ไหม?
2. ถ้า offline → RDP/AnyDesk เข้าเครื่อง → เปิด Task Scheduler ดู task `YalaPcAgent`
3. ถ้า task ทำงานแต่หน้าจอไม่ขึ้น → รันด้วยมือ `C:\YALA\YalaPcAgent.exe` เพื่อดู error dialog
4. ถ้ายังไม่ได้ → ส่ง screenshot ข้อความ error + `Get-ItemProperty HKLM:\SOFTWARE\YALA\Agent`
