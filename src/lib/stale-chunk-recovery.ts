// After a redeploy/rebuild, an already-open tab can request a hashed chunk that
// no longer exists -> "Failed to fetch dynamically imported module" + blank screen.
// Reload once (guarded) to pick up the fresh asset manifest.
const KEY = "__stale_chunk_reloaded_at";

function isStaleChunkError(value: unknown): boolean {
  const message =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "message" in value
        ? String((value as { message?: unknown }).message ?? "")
        : "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed")
  );
}

function recover() {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return; // avoid reload loops
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — still attempt a single reload
  }
  window.location.reload();
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError(event.reason)) recover();
  });
  window.addEventListener("error", (event) => {
    if (isStaleChunkError((event as ErrorEvent).error ?? (event as ErrorEvent).message)) recover();
  });
}

export {};
