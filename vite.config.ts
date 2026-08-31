// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { resolve as resolveNative } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

/**
 * แก้บั๊ก path ของ @lovable.dev/mcp-js บน Windows
 *
 * ปลั๊กอินตรวจว่า routesDir อยู่ใต้ project root ด้วย
 *   child.startsWith(parent + path.sep)
 * แต่ Vite ทำให้ config.root เป็น "D:/play-station-main" (สแลชปกติ)
 * ขณะที่ path.resolve() คืน "D:\play-station-main\src\routes" (แบ็กสแลช)
 * เงื่อนไขจึงไม่มีทางผ่านบน Windows และ dev server ไม่ยอมสตาร์ต:
 *   routesDir "src/routes" must resolve under D:/play-station-main
 *
 * ตรงนี้ส่ง root ที่ใช้ตัวคั่นของระบบปฏิบัติการนั้น ๆ เข้าไปแทน
 * บน macOS/Linux path.resolve() คืนค่าเดิม โค้ดจึงลัดผ่านไปเลย ไม่มีผลอะไร
 * (แก้ที่นี่แทนการไปแก้ node_modules เพื่อให้รอด npm install ครั้งต่อไป)
 */
function mcpPluginCrossPlatform(): Plugin {
  const plugin = mcpPlugin() as unknown as {
    configResolved?: (this: unknown, config: ResolvedConfig) => void | Promise<void>;
  };
  const original = plugin.configResolved;

  if (typeof original === "function") {
    plugin.configResolved = function (this: unknown, config: ResolvedConfig) {
      const nativeRoot = resolveNative(config.root);
      if (nativeRoot === config.root) return original.call(this, config);
      const patched = Object.create(config, {
        root: { value: nativeRoot, enumerable: true, configurable: true },
      }) as ResolvedConfig;
      return original.call(this, patched);
    };
  }

  return plugin as unknown as Plugin;
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPluginCrossPlatform()],
  },
});
