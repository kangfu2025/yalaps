# YALA PC Agent (Phase 2.5)

Windows agent สำหรับ PC ลูกค้า — แสดงหน้า lock ของร้าน, รอคำสั่งจาก Web Admin ผ่าน Supabase Realtime, แสดง countdown เมื่อมี session, ล็อกจอเมื่อหมดเวลา

**ไม่มีระบบคูปอง / login / redeem ในตัว agent** — พนักงานควบคุมทั้งหมดจาก Web Admin

## Stack
- .NET 8 WPF (single-file .exe, self-contained)
- supabase-csharp (REST + Realtime)
- Windows 10/11 (x64)

## Flow

```
บูต → LockScreen เต็มจอ (Topmost, ปิดปุ่มปิด, ซ่อน taskbar)
       "🎮 YALA PLAYSTATION — กรุณาติดต่อพนักงานเพื่อเปิดเครื่อง"
       ↓ subscribe pc_sessions realtime (filter machine_id ของตัวเอง)
       ↓ พนักงานกดเริ่ม session ที่ Web Admin → insert row เข้า pc_sessions
       ↓ realtime notify → agent sync
       → ซ่อน LockScreen → CountdownOverlay มุมซ้ายบน
       ↓ พนักงานเติมเวลา → UPDATE ends_at → agent อัปเดต overlay ทันที
       ↓ หมดเวลา → LockScreen อีกครั้ง + LockWorkStation()
       ↓ พนักงานเปิด session ใหม่ → ซ่อน LockScreen → เริ่ม countdown ใหม่
```

- ไม่ต้องให้ลูกค้ากรอกอะไรบนเครื่อง
- ทุกอย่างสั่งจาก Web Admin เท่านั้น
- Agent รับเฉพาะ event ที่ `machine_id` ตรงกับตัวเอง

## โครงสร้างไฟล์
```
pc-agent/YalaPcAgent/
├── YalaPcAgent.csproj
├── App.xaml / App.xaml.cs        # bootstrap + sync loop
├── Config.cs                     # อ่าน config จาก registry
├── SupabaseService.cs            # REST + Realtime
├── LockScreen.xaml / .cs         # หน้าจอร้าน (fullscreen)
├── CountdownOverlay.xaml / .cs   # เวลาถอยหลัง + เตือน 10/5/1 นาที
├── WinLock.cs                    # Win32: LockWorkStation, Shutdown, topmost
└── Models.cs                     # DTOs
```

## Build

บน Windows dev machine (ติดตั้ง .NET 8 SDK):
```powershell
cd pc-agent\YalaPcAgent
dotnet publish -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```
ได้ `bin\Release\net8.0-windows\win-x64\publish\YalaPcAgent.exe` (~60 MB)

## ติดตั้งบน PC ลูกค้า

1. Copy `YalaPcAgent.exe` + `install.ps1` ไป PC เครื่องนั้น
2. เปิด PowerShell as **Administrator**:
   ```powershell
   .\install.ps1 -MachineId "<UUID จากตาราง machines>" -MachineNumber 1
   ```
3. Reboot → agent ขึ้น LockScreen อัตโนมัติ

Installer จะ:
- Copy .exe ไป `C:\YALA\`
- เขียน config ลง `HKLM\SOFTWARE\YALA\Agent`
- สร้าง scheduled task `YalaPcAgent` (ONLOGON, RunLevel Highest, restart on crash)
- สร้าง watchdog task ทำงานทุก 2 นาที ตรวจว่า process ยังรันอยู่ ถ้าไม่ให้เปิดใหม่

## ความเสถียร

- **ตายแล้วเปิดใหม่**: scheduled task `-RestartCount 999 -RestartInterval 1 นาที` + watchdog ทุก 2 นาที
- **เน็ตหลุด**: agent นับเวลาจาก `ends_at` ที่โหลดมาแล้ว → หมดเวลา = lock ทันที; ตอนต่อเน็ตได้ resync กับ server (loop 30 วิ) → ถ้าพนักงานเติมเวลาระหว่างเน็ตหลุด agent จะรับทีเดียว
- **Realtime หลุด**: มี periodic resync fallback ทุก 30 วิ

## Config (registry `HKLM\SOFTWARE\YALA\Agent`)
- `SupabaseUrl`
- `SupabaseAnonKey`
- `MachineId` — UUID จากตาราง `machines`
- `MachineNumber` — เลขที่แสดงบนหน้าจอ (1, 2, ...)
- `MachineToken` — สำรองไว้ Phase 3 (RLS แบบ per-machine)

## หมายเหตุด้านความปลอดภัย

- ปัจจุบันใช้ anon key ตรง ๆ — ok สำหรับร้าน 1 สาขา
- แนะนำ Windows user แยก (non-admin) ให้ agent auto-login เป็น user นั้น
- ปิด Windows Update popup / Edge first-run เพื่อไม่บดบัง LockScreen
- Group policy: ปิด Task Manager / Registry Editor สำหรับ user ลูกค้า
- Phase 3 จะเพิ่ม `machine_token` ใน RLS policy
