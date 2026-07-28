# Arma2 canonical staging cloud runbook

This runbook is limited to a new, disposable Supabase staging project. Production
and paused projects are out of scope.

The obsolete `check_db.js` production diagnostic was removed during repository
sanitization. It remains available in Git history if its historical context is
ever needed.

## Local configuration

Create an ignored `.env.staging.local` file. Never commit or paste its contents.
It must define:

```text
ARMA2_DEPLOY_ENV=staging
ARMA2_TARGET_PROJECT_REF=<STAGING_PROJECT_REF>
ARMA2_TARGET_SUPABASE_URL=https://<STAGING_PROJECT_REF>.supabase.co
ARMA2_PRODUCTION_PROJECT_REF=<PRODUCTION_PROJECT_REF>
ARMA2_PRODUCTION_PROJECT_REF_SHA256=<LOCAL_SHA256>
ARMA2_STAGING_PROJECT_NAME=arma2-torneos-staging
ARMA2_STAGING_ORGANIZATION=nicoavayu's Org
ARMA2_STAGING_REGION=us-east-1
ARMA2_STAGING_PLAN=Free
ARMA2_STAGING_INITIAL_COST_USD=0
REACT_APP_DEPLOY_ENV=preview
REACT_APP_TORNEOS_DATA_ENV=staging
REACT_APP_TORNEOS_STAGING_PROJECT_REF=<STAGING_PROJECT_REF>
REACT_APP_SUPABASE_URL=https://<STAGING_PROJECT_REF>.supabase.co
REACT_APP_TORNEOS_ENABLED=true
REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED=false
REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=false
```

Store database passwords and API keys in macOS Keychain or another local secret
store. Do not put them in command arguments, Git, documentation, logs, issues, or
pull requests.

## Guarded commands

Use only these wrappers:

```bash
npm run staging:create:guard
npm run staging:guard
npm run staging:link
npm run staging:db:dry-run
npm run staging:db:push
npm run staging:functions:deploy -- issue-voting-photo-token upload-voting-photo
npm run staging:verify
npm run staging:unlink
```

The dry-run and push wrappers accept exactly the two canonical migrations. Edge
Functions must be named explicitly and must be present in the allowlist.

Direct manual use of the `supabase` binary bypasses these controls and is
prohibited for this certification. There is no force or bypass option.

Before final project creation in the Dashboard, populate the creation metadata
from the form and run `npm run staging:create:guard`. The target project ref and
URL are generated only after creation; every later operation uses the stricter
target guard. Do not submit if the form shows a paid plan, paid Compute, an
add-on, a payment-method requirement, or any non-zero cost.
