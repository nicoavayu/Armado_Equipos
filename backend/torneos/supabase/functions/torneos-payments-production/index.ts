// torneos-payments-production — Mercado Pago Checkout Pro PRODUCTION payments service of the Torneos project.
// Its callers (the Torneos gateway, Mercado Pago) carry no Torneos Auth JWT: each route authenticates itself
// (handler.ts) and everything else is 404. Deployed as its own app, never next to the TEST runtime's secrets.
//
// Reconciliation runs every 15 minutes through the platform cron. Deno Deploy discovers Deno.cron by evaluating the
// module's top level at deployment time (never inside an `if`, a handler or after Deno.serve), so the registration is
// one top-level expression before the server starts; runtimes without Deno.cron (the local edge-runtime) skip it and
// keep serving the routes (the buyer's "update" and the webhook work there too).
import { createProductionPaymentsDb } from "./db.ts"
import { createProductionPaymentsService } from "./handler.ts"

const service = createProductionPaymentsService({ env: Deno.env.toObject(), connectDb: createProductionPaymentsDb })

Deno.cron?.("torneos-payments-production-reconcile", "*/15 * * * *", async () => {
  await service.reconcileDue()
})

Deno.serve(service.fetch)
