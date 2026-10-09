# Backend remoto de prueba para la preview de Netlify — evaluación (2026-10-08)

Requisitos: gratuito, sin contratar servicios, sin exponer el laboratorio local y sin tocar Production.

## Lo que necesita la preview para validar funciones

La web llama a tres cosas:
- Core: Auth, PostgREST y Storage, con las cuentas de prueba;
- el gateway de Torneos (Edge);
- la base de Torneos.

El laboratorio `arma2-promo-rehearsal` corre todo eso en 10 contenedores, con ~1,6 GB de RAM medidos.

## Opciones descartadas

| Opción | Bloqueo concreto |
| --- | --- |
| Proyectos Supabase Free | Límite de 2 proyectos activos. Los dos son Production (Core y Torneos). `arma2-torneos-staging` y «Arma2» están pausados y no se pueden reactivar sin pausar uno de Production |
| Branching de Supabase | Requiere plan pago |
| VM gratuita (GCP e2-micro) | 1 GB de RAM, menos que el laboratorio |
| Otros proveedores con tarjeta (p. ej. Oracle Free) | Exigen crear una cuenta nueva con tarjeta, es decir, contratar |
| Exponer el laboratorio local (túnel) | Prohibido |

## Única alternativa: GitHub Codespaces

Consiste en levantar el mismo laboratorio, con las mismas migraciones y cuentas de prueba, en un Codespace del repositorio. No es la Mac: es una máquina de GitHub que se borra.

**Comprobado (2026-10-08):**
- el repositorio admite Codespaces, con máquinas de 2 núcleos / 8 GB y de 4 núcleos / 16 GB (`GET /repos/nicoavayu/Armado_Equipos/codespaces/machines`);
- el laboratorio entra holgado en la de 2 núcleos.

**Cuota gratuita de una cuenta personal:** 120 núcleo-hora por mes (60 h en 2 núcleos) y 15 GB-mes de disco. El límite de gasto de una cuenta personal es 0 por defecto: al agotarse la cuota el Codespace se detiene y no cobra.

**Sin comprobar:**
- La cuota y el límite de gasto de la cuenta de Nico. El token de `gh` de esta máquina no tiene el permiso `codespace` (`HTTP 403 … needs the "codespace" scope`). Se habilita con `gh auth refresh -h github.com -s codespace`, que es interactivo y lo tiene que correr Nico.
- El deploy preview de #192 en Netlify, que nunca se generó porque el proyecto es privado para el equipo.

**Exposición:**
- La web publicada en Netlify llama al backend desde el navegador, así que los puertos de la API de Core y del gateway del Codespace tienen que ser públicos (`*.app.github.dev`).
- Sólo expone datos y cuentas de prueba, nunca el laboratorio local ni Production.
- El ayudante de ingreso con cuentas de prueba usa la clave de servicio del laboratorio, así que va en un puerto privado (sólo con la sesión de GitHub de Nico).
- El Codespace se apaga a los 30 min sin uso. Al encenderlo de nuevo conserva el mismo nombre y las mismas URLs.

**Trabajo que falta, una vez habilitado el permiso:**
- un `.devcontainer` con Docker y el script de arranque del laboratorio;
- construir la preview de Netlify con las URLs del Codespace (variables del contexto *deploy preview*);
- recorrer el piloto ahí.

## Conclusión

- **Publicación del frontend en Netlify:** se puede verificar sin backend (hosting, rutas, headers, gate de acceso, assets). Depende sólo de que Netlify construya la preview de #192.
- **Validación funcional:** hoy es sólo de laboratorio. Pasa a remota con Codespaces cuando Nico habilite el permiso `codespace` y confirme la cuota; sin eso, no hay alternativa gratuita viable.
