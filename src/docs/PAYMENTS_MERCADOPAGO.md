# Pagos post-partido · Mercado Pago

Estado del botón **Pagar** en la pantalla `/pagos/:partidoId` (`src/pages/PaymentsView.js`)
y qué se investigó sobre integrar Mercado Pago (MP).

## Principios (no negociables)

- Arma2 **no toca dinero**.
- Arma2 **no guarda credenciales** de Mercado Pago.
- Arma2 **no procesa pagos**.
- El cobro es siempre **jugador → cobrador** (alias o link que carga el admin).

## ¿Existe un deep link oficial para abrir una transferencia con el alias precargado?

**No.** Al momento de esta implementación Mercado Pago **no publica** un deep link
oficial, estable y documentado que abra la pantalla de transferencia con un alias
(y monto) precargados.

- El esquema `mercadopago://` existe pero **no está documentado** para uso de terceros
  y rompe entre versiones / plataformas (iOS vs Android). Es exactamente el tipo de
  hack frágil que el pedido pide **evitar**.
- La vía oficial y estable para "cobrar con MP" es **Checkout Pro / payment links**
  (preferences API), que requiere **OAuth + credenciales del cobrador** y backend.
  Eso queda **fuera de alcance** de esta rama (ver V2).

## Qué hace hoy el botón "Pagar" (jugador, pago pendiente)

Implementado en `handlePay()`:

1. **Si el cobrador configuró un `payment_link` oficial de MP** → se abre ese link con
   `@capacitor/browser` (`Browser.open`), con fallback a `window.open`. Es lo más
   confiable porque el link lo generó el propio cobrador desde MP.
2. **Si no hay link pero hay `alias`** (fallback seguro):
   - se **copia el alias** automáticamente al portapapeles;
   - se muestra el aviso **"Alias copiado. Abrí Mercado Pago y transferí a este alias."**;
   - se abre **Mercado Pago** mediante la URL oficial `https://www.mercadopago.com.ar/`
     (destino seguro; en equipos con la app + universal links puede abrir la app, si no,
     abre la web). **No** se usan esquemas `mercadopago://` ni deep links de transferencia
     no documentados.
3. Se mantiene además el botón **"Copiar alias"** por separado.
4. El jugador vuelve a Arma2 y toca **"Ya pagué"** para reportar el pago
   (`report_my_payment`), que notifica al admin para que confirme.

## Para V2 (no en esta rama)

- **Checkout Pro** / payment links automáticos por partido.
- **OAuth por cobrador** (vincular su cuenta de MP).
- **Preferences API** para generar el cobro con monto exacto.
- **Webhook** de MP para marcar pagos como `paid` automáticamente (hoy lo confirma el admin).
