// The only destinations the Plan page may navigate to after a checkout: Mercado Pago
// Checkout Pro over HTTPS on its own hosts (the hosts the legacy guard accepted), with no
// credentials and no explicit port. Validated BEFORE anything touches window.location.
const CHECKOUT_PRO_DOMAINS = Object.freeze(['mercadopago.com', 'mercadopago.com.ar']);
const MAX_CHECKOUT_URL_LENGTH = 4096;

export function isCheckoutProUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_CHECKOUT_URL_LENGTH) return false;
  if (/[\s\\]/.test(value)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const hostname = url.hostname.toLowerCase();
  return CHECKOUT_PRO_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}
