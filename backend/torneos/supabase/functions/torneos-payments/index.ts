// torneos-payments — Mercado Pago Checkout Pro TEST payments service of the Torneos project (MP-A3).
// verify_jwt = false (config.toml): its two callers (the Torneos gateway, Mercado Pago) carry no Torneos
// Auth JWT; each route authenticates itself (handler.ts) and everything else is 404.
import { createPaymentsDb } from "./db.ts"
import { createPaymentsService } from "./handler.ts"

Deno.serve(createPaymentsService({ env: Deno.env.toObject(), connectDb: createPaymentsDb }))
