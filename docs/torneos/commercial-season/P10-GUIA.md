# P10: guía para Nico (sandbox de Mercado Pago, unos 20 minutos)

Esto prueba la compra de Premium de punta a punta contra el **sandbox** de Mercado Pago. Lo de Arma2 corre en un laboratorio local de tu Mac. **No se toca Producción, no hay dinero real y nada se publica.**

Nunca pegues el token en un chat. Va sólo en la terminal, donde no se ve al pegarlo.

## 1. Antes (5 minutos)

1. **Comprobaciones.** En la Terminal:

   ```bash
   ~/Arma2Backups/p10-run.sh check
   ```

   Tiene que terminar en `COMPROBACIONES OK`. Si dice `STOP`, mandá esa línea a Codex o a Claude; no contiene secretos.

2. **El token.** En tu navegador normal, con tu cuenta real de Mercado Pago:
   - entrá a <https://www.mercadopago.com.ar/developers/panel/app>;
   - abrí la app de Arma2 (la de la certificación TEST del 26/09);
   - entrá a **Credenciales de prueba** y tené a mano el **Access Token** (`APP_USR-…`). Esas credenciales son del **vendedor de prueba** que Mercado Pago crea con la app.

3. **Las cuentas de prueba.** En la misma app, entrá a **Pruebas → Cuentas de prueba** y anotá, del **Comprador** y del **Vendedor**:
   - Usuario;
   - Contraseña;
   - Código de verificación (lo pide al iniciar sesión).

4. **Ventana del comprador.** Abrí una ventana privada de **Chrome** en <https://www.mercadopago.com.ar> y entrá con el usuario **Comprador** de prueba.

5. **Ventana del vendedor.** Abrí una ventana privada de **Safari** en <https://www.mercadopago.com.ar> y entrá con el usuario **Vendedor** de prueba.

   Tiene que ser otro navegador: dos ventanas privadas de Chrome comparten la sesión. Esta ventana sólo se usa para la devolución del caso C.

## 2. La corrida

```bash
~/Arma2Backups/p10-run.sh
```

1. Pegá el Access Token cuando lo pida. No se ve al pegarlo, y es lo esperado.

2. La terminal muestra **qué vendedor de prueba confirmó Mercado Pago** (nombre e id). Tiene que ser el mismo usuario de la ventana de Safari. Si coincide, apretá Enter.
   - Si el token no es de un usuario de prueba, la corrida para sola antes de crear nada.

3. Para cada link que imprime la terminal:
   - pegalo en la ventana privada de Chrome (comprador);
   - elegí pagar con **tarjeta**, no con dinero en cuenta;
   - tarjeta Mastercard **5031 7557 3453 0604**, CVV **123**, vencimiento **11/30**, DNI **12345678**;
   - el **titular** decide el resultado (tabla de abajo).

   Al terminar, Mercado Pago te manda a `torneos-payments-test…deno.net` y ves un **404**: es lo esperado. Volvé a la terminal y apretá Enter.

| Caso | Qué pasa en Arma2 | Titular |
|---|---|---|
| A | Temporada abierta | **APRO** |
| B | Primero un rechazo y después un pendiente, **en el mismo link** | **OTHE**, después **CONT** |
| C | La temporada ya está cerrada cuando pagás | **APRO** |
| D | Un **segundo** pago sobre el link del caso A (la terminal lo vuelve a mostrar) | **APRO** |

4. **Devolución del caso C.** La terminal da un número de pago y el monto ($ 20.000).
   - En Safari (vendedor): **Tu actividad** → ese pago → **Devolver dinero** → devolución **total** → confirmar.
   - Volvé a la terminal y apretá Enter.

5. **Si Mercado Pago no te deja hacer algo** (por ejemplo, el segundo pago del caso D): en la terminal escribí `n` seguido del motivo, por ejemplo `n no deja pagar dos veces`, y Enter.
   - Ese caso queda **pendiente**, con tu motivo, y no cuenta como aprobado.

6. **Al final** la terminal dice uno de estos resultados, y dónde quedó la evidencia (`~/Arma2Backups/p10-evidence/`, sin token):
   - `P10_PASS`: los cuatro casos completos y bien;
   - `P10_PARTIAL`: faltan casos, que se nombran;
   - `P10_FAIL`.

   Avisale a Codex «P10 terminado».

## Si algo sale mal

- **Ctrl+C** corta la corrida. No queda nada en Producción, y la próxima vez el laboratorio se recrea desde cero.
- Los pagos de prueba quedan sólo en las cuentas de prueba, sin dinero real.
- **Correr sólo algunos casos** (por ejemplo `~/Arma2Backups/p10-run.sh A,C`) es una corrida **parcial**: no certifica P10, y los casos que faltan quedan pendientes.

## Qué no hacer

- Pagar con tu cuenta real.
- Usar credenciales de **producción** de la app real.
- Pegar el token o las contraseñas de prueba en un chat.
