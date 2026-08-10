# Arma2 Torneos: FREE/PRO entitlements foundation

## Foundation now

The plan belongs to `tournament_organizations`, not to individual users. A
valid organization PRO lifecycle is inherited by its tournaments; an
organization member receives enabled organizer entitlements, while a roster
participant receives only catalog entries marked as participant-applicable for
that tournament. Role capabilities remain a separate authorization layer.

The database is the source of truth. `get_effective_tournament_entitlements`
returns a stable projection and `has_tournament_entitlement` is the canonical
boolean guard. Missing rows, unknown states, expired periods and inconsistent
temporal data resolve to FREE. Only `service_role` can call the manual
subscription and override transition functions; authenticated owners cannot
write plan state or call those functions.

The subscription lifecycle models `active`, `grace_period`, `past_due`,
`cancelled` and `expired`. Active PRO, cancelled PRO before its paid period end,
and grace period before `grace_until` retain PRO. `past_due` is explicitly FREE
in this phase. Grace expiry, subscription expiry, missing rows and invalid data
are FREE. Provider source values are modeled, but the only transition exposed
now is `manual`.

Organization and tournament override tables use tenant-bound foreign keys.
The public resolver already accepts an optional tournament ID, so future
tournament overrides require no API redesign. There is deliberately no UI for
them yet.

Multimedia remains split into galleries, logical assets, gallery relations,
physical object paths/variants and append-only audit. Logical assets now carry
a Storage lifecycle; future purge can mark `storage_purged` without deleting
the logical row, gallery relationship or audit evidence.

The sports date is the canonical published `tournament_rounds` sequence,
grouped by category, fixture, phase and `round_number`. A gallery is eligible
only when its direct `round_id`, or its match's `round_id`, resolves
unambiguously. Unlinked or contradictory galleries are excluded rather than
guessed. Photo `created_at` is used only to determine when three later sports
dates first had media; it never defines sports ordering.

FREE policy is 20 photos per canonical matchday, the latest three matchdays,
and seven days of grace. PRO has no commercial photo count configured, keeps
all matchdays while entitled, and snapshots 90 days of protection after PRO
access ends. Operational security quotas in the existing media pipeline still
apply independently. The upload-session trigger is the first vertical
integration and enforces the FREE per-matchday limit across galleries.

`list_tournament_media_retention_candidates` is service-only and read-only. It
returns assets outside the three-date window after grace and includes the exact
Storage paths a future trusted cleanup worker would need. It returns no rows
for active PRO, during post-PRO protection, for inconsistent subscription data,
or when the sports date cannot be proven. No purge, cron or Storage mutation is
implemented.

Structured sporting data is permanent under these policies. Tournaments,
seasons, fixtures, matches, results, standings, scorers, sanctions, teams,
rosters, players, awards, final positions, champions and audit trail are not
updated, archived or deleted by retention.

## Integrate later

- Multimedia: mark candidates, write `media.retention_marked`, implement a
  separately reviewed service worker that deletes only listed Storage objects,
  mark logical assets as purged and append `media.storage_purged`.
- Social Studio: combine the existing deployment feature flag with
  `social_studio.basic` or `social_studio.full`. This foundation does not enable
  the current remote flag or change Social RPC behavior.
- Statistics: guard premium projections with `advanced_stats` while retaining
  participant applicability.
- Tournament administration and limits: consume `higher_limits` plus explicit
  server policy values once commercial limits are decided.
- Billing: a trusted Apple, Google or web backend may later validate purchases
  and call a controlled transition path. Receipts, purchase tokens, checkout,
  prices and provider secrets remain outside this foundation.
