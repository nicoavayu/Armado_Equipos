// Authenticated plan reads only. Does not load or configure commerce/payments.
// Exact certified RPC names; never infer safety from a get_* prefix.
export const PLAN_READ_RPCS: readonly string[] = Object.freeze([
  "get_effective_tournament_season_entitlements",
  "get_effective_tournament_entitlements",
])
export class PlanReadConfigError extends Error {}
export function withPlanRead(base: ReadonlySet<string>, env: Record<string, string | undefined>): ReadonlySet<string> {
  const mode = env.TORNEOS_PLAN_READ_MODE ?? "off"
  if (mode === "" || mode === "off") return new Set(base)
  if (mode !== "on") throw new PlanReadConfigError("TORNEOS_PLAN_READ_MODE must be on or off")
  return new Set([...base, ...PLAN_READ_RPCS])
}
