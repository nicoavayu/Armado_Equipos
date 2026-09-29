# Android 1.1.22 (43) — internal-test hotfix

Play Internal 1.1.22 (42) was tested on a real Android device and must not be
promoted. This hotfix ships the fixes below as versionCode **43**. 42 is already
in Play and cannot be reused.

## 1. Safe area / page titles (Android 15+ edge-to-edge, iOS)

**Root cause:** `targetSdk` 35/36 makes the app edge-to-edge on Android 15+ (the
opt-out is ignored on 16). The WebView then reports a real
`env(safe-area-inset-top)`, and Home's `GlobalHeader` already consumes it. The
other `MainLayout` routes relied on `<main>` being padded with `--safe-top`.
Their fixed `PageTitle` sits inside a transformed ancestor: `PageTransition`, or
`translateZ(0)` in `TemplateDetailsPage`/`TemplateHistoryPage`, whose comments
state this contract. `2625a8c4` (Arma2/Torneos spaces, 2026-08-13) set that
padding to `pt-0` for every route so that Home would not get a double inset
under the new GlobalHeader. As a result, every internal title went under the
status bar and cutout.

**Fix:** `src/components/MainLayout.js` gives each route exactly one owner of the top inset:

| Route | Owner of the top inset |
|---|---|
| `/`, `/home` | `GlobalHeader` (`<main>` stays `pt-0`) |
| voting shell (`/?codigo`, `/?partidoId`), `/nuevo-partido` | their own immersive views (`<main>` stays `pt-0`) |
| every other `MainLayout` route | `<main>`: `pt-[var(--safe-top,0px)]`, i.e. the real `env(safe-area-inset-top)` |

- No magic numbers are involved. Web and desktop resolve the inset to `0px`.
- The fix restores the pre-`2625a8c4` behavior outside Home.
- Test: `src/__tests__/mainLayoutSafeArea.test.jsx`.

## 2. Torneos in the Android release

**Root cause A (config):**
- The 8 Torneos Production keys exist only as Vercel Production env: the 7
  `REACT_APP_TORNEOS_*` keys plus `REACT_APP_PRODUCTION_PROJECT_REF`.
- The 42 bundle was built locally from `.env.local` and
  `.env.production.local`, which hold only the Core keys.
- `REACT_APP_*` values are compile-time, so the AAB compiled Torneos as closed.

**Injection:** `npm run build:android:release` runs `scripts/build-android-release.mjs`.

1. It reads the 8 values from the live certified Production web bundle
   (`https://app.arma2.com.ar`, the compiled `process.env` literal).
   - Offline alternative: `--env-file <git-ignored dotenv>`.
2. It validates them:
   - flags must be `true`;
   - `DATA_ENV` must be `production`;
   - the ref must be a 20-letter project ref;
   - the gateway must be plain https and must not name the Core project.
3. It refuses to run in these cases:
   - the shell or a `.env` file already sets a different value;
   - `REACT_APP_SUPABASE_URL` is not `https://<PRODUCTION_PROJECT_REF>.supabase.co`.
4. It runs `npm run build` with the 8 values injected.
5. It verifies `build/static/js/main.*.js`:
   - it carries the 8 values;
   - it carries no billing, media, social or commerce key;
   - it contains no `APP_USR-` and no `api.mercadopago.com`.

Other rules:
- Nothing is committed: no values, no `.env` file, no secret. The frontend guard
  forbids committed targets.
- Debug/local builds keep using plain `npm run build` and stay closed.
- Tests: `scripts/build-android-release.test.mjs`.

**Root cause B (runtime, resolved by the gateway, PR #165):**
- The Production gateway allowed exactly one browser origin,
  `https://app.arma2.com.ar`. The Capacitor Android WebView sends
  `Origin: https://localhost` (measured on the wire on Android 16). It got
  **403**, and so did `capacitor://localhost`.
- `f7efe18f` sets `PRODUCTION.nativeAppOrigin = "https://localhost"` in
  `backend/torneos/supabase/functions/torneos-gateway/topology.ts`. The Production
  allowlist is now exactly `[https://app.arma2.com.ar, https://localhost]`:
  - exact match only, no wildcard;
  - ACAO echoes the matched origin;
  - auth unchanged.
- Deployed 2026-09-29 as gateway revision `tmxxr5taty23` (digest
  `59573b50…`), env 13/13 unchanged. Rollback to `0f049ef5` / `6c252863…` is
  prepared. Merged into main as `acd87aaa`.
- Read-only probes after the merge:

  | Origin | Result |
  |---|---|
  | `https://app.arma2.com.ar` | 200 / 204, exact ACAO |
  | `https://localhost` | 200 / 204, exact ACAO; RPC reaches Core auth (401) |
  | `http://localhost`, `capacitor://localhost`, `https://localhost:8443`, `https://evil.example` | 403, no ACAO |

- iOS (`capacitor://localhost`) stays refused. It is not part of this hotfix.

## 3. Amigos → Comunidad search

**Root cause:**
- Every keystroke ran a remote `usuarios` `ilike` query, with no debounce.
- The minimum was 2 characters.
- Nothing ordered the responses. A late "Th"/"Tho" response repainted a broad
  list after the input had gone back to "T".
- A single letter showed "No se encontraron usuarios".

**Fix:** `src/utils/communitySearch.js` and `src/components/AmigosView.js`.

- The query is trimmed and whitespace is collapsed.
- Only non-space characters count.

| Input | Behavior |
|---|---|
| 0 characters | Nothing is shown. |
| 1–2 characters | A discreet hint "Escribí al menos 3 letras para buscar". No request, no results. |
| 3+ characters | 250 ms debounce, then one request. |

- Every change invalidates in-flight responses through a request id, clears old
  results and shows "Buscando..." until the current response arrives.
- The same query, table, columns, `limit(10)` and `neq(self)` are kept, so the
  searchable universe, privacy and RLS are unchanged.
- Tests:
  - `src/__tests__/communitySearch.test.js`
  - `src/__tests__/AmigosView.communitySearch.test.jsx`

## 4. Quiero jugar → Partidos filters

**Root cause:**
- Three `flex-1` chips (Todos, Buscan jugadores, Buscan arquero), each with an
  icon, had to share about 288px at 360px.
- The labels ran through `truncate`.

**Fix:**
- The semantics stay `all | players | goalkeeper`, persisted as before.
- Only two chips render, "Busca jugador" and "Busca arquero", with no icons and
  no truncation.
- No chip selected means ALL. Tapping the active chip returns to ALL.
- Measured on one line at 320–720px, with no page overflow:
  - at 320px, each label is about 80px wide inside 115px of space;
  - the chip height is 36px.
- Tests: `src/__tests__/matchSearchFilters.test.js`.

## Build (release)

```bash
npm ci
npm run build:android:release
npx cap sync android
cd android && ./gradlew clean assembleRelease bundleRelease
```
