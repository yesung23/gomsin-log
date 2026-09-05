# Public operator settings

- User explicitly supplied public operator `한예성` and public support/privacy email `gomsinlog@gmail.com` after being asked for these missing deployment values.
- Exact remote target: Vercel `nabbvn/gomsin-log`, Project Environment Variables, Production only.
- Added Config entries: `VITE_LEGAL_OPERATOR_NAME=한예성`; `VITE_PRIVACY_CONTACT_EMAIL=gomsinlog@gmail.com`.
- Verification: both names appeared as Config / Production / Added just now. UI toast: “Added Environment Variable successfully. A new deployment is needed for changes to take effect.”
- Remote setting action: APPLIED. Redeploy: NOT APPLIED. Current served app has not been verified to contain these values; they take effect in a future successful deployment.
- No secret value was revealed, copied or changed. Supabase settings, keys, migrations, Apple flags and Git/master were not changed.
- Existing System Environment Variables checkbox remained unchecked. Source review indicates strict production-target validation depends on explicit release/Vercel target signals; missing detection is not a release approval or acceptable bypass.
- Rollback: remove only these two newly added Production Config entries through the Vercel UI if explicitly requested. Existing values were not overwritten.
- Remaining: code correction/reviews, production build target validation, backend compatibility, controlled master integration. Email deliverability not tested.
