Legacy inventory membership audit and proposed correction

The application uses the exact role values `Owner`, `Admin`, `Treasurer`,
`Logistics`, `Member` and `Viewer`. Lowercase or unknown roles do not receive
Owner/Admin privileges. The membership seed creates new `Owner` rows and leaves
existing memberships unchanged.

Run the explicit read-only audit from the project root:

```powershell
.\backend\.venv\Scripts\python.exe -B backend/tests/inventory_data_audit.py --development-read-only
```

The audit enforces a PostgreSQL read-only transaction. It reports revision,
row counts/fingerprints, role counts and identifiers of noncanonical memberships.
It performs no update, seed, migration or cleanup. Do not publish these account
identifiers outside the team managing the database.

The November 4 repair preflight found one active lowercase `owner`. Its exact
membership, user and organization identifiers are in the local audit output;
they are intentionally not embedded in source or fixtures. No persisted role
has been changed. This correction remains pending explicit user authorization.

Proposed procedure, only after separate approval:

1. Confirm the account and organization with the responsible person, and verify
   that this membership is intended to have Owner privileges. Check all current
   Owner memberships in the organization; do not infer ownership from spelling.
2. Take a database backup and save the read-only audit output. Use the approved
   exact membership, user and organization UUIDs for the correction, not a bulk
   case-normalization statement.
3. In one transaction, lock and inspect that exact membership, recheck that its
   current role is `owner` and status is `active`, then update only that row to
   `Owner`. Require exactly one returned row. Roll back on any mismatch.
4. Review the returned row before committing. Record the operator, authorization
   and original/new values in the team's change record. Verify the account's
   normal login and organization permissions afterward.

This dry-run SQL template ends in ROLLBACK. Replace all three placeholders with
the reviewed UUIDs before an approved operator uses it. The repair task does not
execute this SQL. An eventual COMMIT is a separately authorized action.

```sql
BEGIN;
SELECT id, user_id, organization_id, role, status
FROM memberships
WHERE id = '<approved-membership-uuid>'::uuid
  AND user_id = '<approved-user-uuid>'::uuid
  AND organization_id = '<approved-organization-uuid>'::uuid
FOR UPDATE;

UPDATE memberships
SET role = 'Owner'
WHERE id = '<approved-membership-uuid>'::uuid
  AND user_id = '<approved-user-uuid>'::uuid
  AND organization_id = '<approved-organization-uuid>'::uuid
  AND role = 'owner'
  AND status = 'active'
RETURNING id, user_id, organization_id, role, status;

ROLLBACK;
```

Do not loosen RBAC, normalize every stored role automatically, or run the seed
to repair an existing membership.
