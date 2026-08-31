using System;
using System.IO;
using System.Media;
using System.Threading;
using System.Threading.Tasks;

namespace YalaPcAgent;

/// <summary>
/// เตือนเวลาด้วยเสียง — ไม่สร้างหน้าต่าง ไม่แตะ z-order ไม่ผ่าน DWM
/// จึงใช้ได้ระหว่างลูกค้าเล่นเกม fullscreen โดยเกมไม่เด้งออก
///
/// ถ้ามีไฟล์ warn.wav วางไว้ข้าง ๆ YalaPcAgent.exe (เช่น C:\YALA\warn.wav)
/// จะเล่นไฟล์นั้นแทน — ใส่เสียงพูดไทยได้ เช่น "เหลือเวลาอีก 10 นาที"
/// </summary>
public static class Sound
{
    private static readonly string CustomWav =
        Path.Combine(AppContext.BaseDirectory, "warn.wav");

    public static void PlayWarn()
    {
        _ = Task.Run(() =>
        {
            try
            {
                if (File.Exists(CustomWav))
                {
                    using var player = new SoundPlayer(CustomWav);
                    player.PlaySync();
                    return;
                }
            }
            catch (Exception ex) { Log.Error("play warn.wav failed", ex); }

            try
            {
                for (var i = 0; i < 3; i++)
                {
                    SystemSounds.Exclamation.Play();
                    Thread.Sleep(700);
                }
            }
            catch (Exception ex) { Log.Error("play system sound failed", ex); }
        });
    }
}
