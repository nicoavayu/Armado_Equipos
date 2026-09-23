// torneos-payments/lab-fetch.ts — the only network path of the reused provider.
//
// The provider (byte-identical copy of the legacy one) has a fixed API origin, https://api.mercadopago.com,
// and accepts an injected fetcher. This wrapper refuses every other origin, so the service can talk to
// Mercado Pago and nothing else. In the local lab (TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN, validated by
// config.ts as http://mp-stub:<port> only) it rewrites that single origin to the lab mp-stub, keeping path
// and query; the provider itself is never modified or relaxed (it still refuses localhost app URLs and
// non-Mercado-Pago checkout URLs).
export const MERCADO_PAGO_API_ORIGIN = "https://api.mercadopago.com"

export function createProviderFetch(base: typeof fetch, labOrigin: string | null): typeof fetch {
  const target = labOrigin ? new URL(labOrigin) : null
  return ((input: Request | URL | string, init?: RequestInit) => {
    let url: URL
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    } catch {
      return Promise.reject(new TypeError("provider_fetch_url_invalid"))
    }
    if (url.origin !== MERCADO_PAGO_API_ORIGIN || url.username || url.password) {
      return Promise.reject(new TypeError("provider_fetch_origin_refused"))
    }
    const destination = target ? new URL(`${url.pathname}${url.search}`, target).href : url.href
    return base(destination, init)
  }) as typeof fetch
}
