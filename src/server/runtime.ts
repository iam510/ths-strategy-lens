import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage<Record<string, unknown>>();
export function withRuntime<T>(env: Record<string, unknown>, run: () => T): T {
  return context.run(env, run);
}
export function runtimeValue(key: string): string {
  const value = context.getStore()?.[key] ?? process.env[key];
  return typeof value === "string" ? value.trim() : "";
}
export function configuration() {
  return {
    dataConfigured: Boolean(runtimeValue("FUYAO_API_KEY")),
    aiConfigured: Boolean(
      runtimeValue("AI_BASE_URL") &&
      runtimeValue("AI_API_KEY") &&
      runtimeValue("AI_MODEL"),
    ),
  };
}
