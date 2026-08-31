using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace YalaPcAgent;

/// <summary>Log แบบไฟล์ง่าย ๆ ที่ C:\YALA\agent.log (หมุนไฟล์เมื่อเกิน 1 MB)</summary>
public static class Log
{
    private static readonly object _gate = new();
    private const long MaxBytes = 1_000_000;

    public static string Path { get; } = ResolvePath();

    private static string ResolvePath()
    {
        try
        {
            var dir = AppContext.BaseDirectory;
            // ทดสอบว่าเขียนได้ไหม ถ้าไม่ได้ใช้ %ProgramData%\YALA
            var probe = System.IO.Path.Combine(dir, ".writetest");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
            return System.IO.Path.Combine(dir, "agent.log");
        }
        catch
        {
            var fallback = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "YALA");
            try { Directory.CreateDirectory(fallback); } catch { }
            return System.IO.Path.Combine(fallback, "agent.log");
        }
    }

    public static void Info(string message) => Write("INFO ", message);
    public static void Warn(string message) => Write("WARN ", message);

    public static void Error(string message, Exception? ex = null)
    {
        var text = ex == null ? message : message + " :: " + ex;
        Write("ERROR", text);
    }

    private static void Write(string level, string message)
    {
        try
        {
            lock (_gate)
            {
                Rotate();
                var line = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0:yyyy-MM-dd HH:mm:ss}Z [{1}] {2}{3}",
                    DateTime.UtcNow, level, message, Environment.NewLine);
                File.AppendAllText(Path, line, Encoding.UTF8);
            }
        }
        catch { /* log ต้องไม่ทำให้แอปพัง */ }
    }

    private static void Rotate()
    {
        try
        {
            var fi = new FileInfo(Path);
            if (!fi.Exists || fi.Length < MaxBytes) return;
            var old = Path + ".1";
            if (File.Exists(old)) File.Delete(old);
            File.Move(Path, old);
        }
        catch { }
    }
}
