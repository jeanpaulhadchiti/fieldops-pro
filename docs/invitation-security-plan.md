# Deferred email invitations and organization verification

This document is a future implementation plan. Day 9.5 does not send invitation emails, issue invitation tokens, verify email ownership, transfer organization ownership, or resolve ownership disputes. None of the proposed endpoints below is implemented.

## Current access mechanisms

The existing authenticated `POST /organizations/{organization_id}/members` endpoint grants immediate active access to an account that is already registered. An active Owner/Admin must authorize the operation; only the Owner may grant Admin. It is direct membership administration, not an invitation, email delivery, or evidence that the account controls an email inbox. The administration UI describes this behavior and requires confirmation.

Day 9.5 also provides discoverable-organization join requests. The requester comes from the JWT session, and an authorized reviewer approves an ordinary Member membership. Pending or rejected requests grant no access. Organization names and public discovery cards do not establish legal identity, affiliation, or ownership.

## Prerequisite: verified account email

The current account model has no verified-email state. A user-supplied signup email alone is insufficient for accepting an email-targeted invitation. Before shipping acceptance, implement and test an email-verification flow, authenticated email changes with reverification, delivery infrastructure, and abuse controls.

An invitation may be accepted only by an authenticated account whose currently verified, normalized email exactly matches the invitation's intended email. Normalize consistently with the existing account system; do not invent provider-specific alias or dot rules. Reject an unverified address or mismatched signed-in account without exposing the target address. Never accept a client-supplied `user_id`, create a membership merely because a name/email matches, or automatically log an invitation holder into another person's account.

## Invitation storage and issuance

Use a new additive migration for an invitation table, preserving existing organizations and membership uniqueness. Suggested fields are `id`, `organization_id`, intended normalized email, requested role, inviter user ID, `token_digest`, `expires_at`, status, creation/acceptance/revocation timestamps, accepting user ID, and revoking user ID. Add foreign keys, status checks, a unique digest, and indexes for organization/status and intended email. Bound pending invitations for a recipient and organization, and define resend behavior explicitly.

Generate each token with at least 256 bits from a cryptographically secure random generator, for example 32 random bytes encoded as base64url. Store only a cryptographic digest such as SHA-256 in the invitation table. UUIDs, sequential IDs, email hashes, passwords, JWT access tokens, and predictable codes are unsuitable invitation secrets. Do not store the raw token in ordinary database columns or logs.

Set a short, explicit server-enforced lifetime, initially 48 hours. Use a configured, trusted HTTPS application origin for delivery links rather than an untrusted request Host header. Keep token material out of analytics, error reports, URL access logs, and referrers. A dedicated acceptance page can read a token from a URL fragment, immediately remove it from browser history, and submit it in the authenticated POST body. It must not load third-party scripts or expose the token through subsequent navigation.

Only an active Owner/Admin may issue ordinary Member invitations. Only an active Owner may issue an Admin invitation, if that role is supported in a later release. Server-side policy selects and validates permitted roles; the client cannot request Owner or elevate its own role. The first safe release may restrict all invitations to Member. Preserve the existing protected Owner membership.

## Single-use transactional acceptance

Acceptance must run in one database transaction using the same organization lock ordering as join approvals and direct membership administration. Recheck the accepting account's identity/verified email, current organization state, and issuing authority under the selected policy. Lock the invitation row, verify its digest, pending state and expiry, then resolve the existing membership under the unique `(user_id, organization_id)` constraint.

- Create an active Member only when no membership exists and the invitation policy permits it.
- Preserve an existing active membership's role; invitation acceptance must not silently elevate, downgrade, or duplicate it.
- Handle an inactive ordinary membership using an explicit tested reactivation policy. Inactive Owner/Admin or other privileged memberships require separate Owner review and must not be silently restored or replaced.
- Record acceptance and the resulting membership together. A failure rolls back both changes.
- Concurrent accept/revoke/expiry/resend attempts must produce a single authoritative outcome. Repeating a completed acceptance by the same authenticated account may return the saved result; another account never gains access from a consumed token.

Expiration is checked against server time on every attempt, even if no cleanup job has run. Revocation is immediate. Resending should revoke/supersede the old pending token and generate a new token rather than extending or reusing a leaked secret. Recheck reviewer/issuer authority before any new invitation, resend, role change, or revoke. Define whether loss of the inviter's authority automatically invalidates outstanding invitations; the conservative initial policy is to revalidate it at acceptance.

## Delivery, abuse prevention, and auditing

Use a transactional delivery outbox or an equivalent reliable queue. If an outbox needs token-bearing email content, encrypt that short-lived delivery payload with a narrowly scoped key, restrict worker access, redact it from logs, and remove it after delivery/expiry. The invitation's durable record still stores only the digest. Do not mark an email as delivered merely because the invitation row was created.

Apply durable rate limits by organization, inviter, intended recipient and, where trustworthy, network source. Bound issue/resend/accept attempts, return `Retry-After` where appropriate, and use non-enumerating failure messages. Invalid, expired, revoked, consumed, and inaccessible tokens must not disclose private organization or account details. Avoid public invitation-list or directory endpoints.

Record restricted audit events for issue, delivery result, resend, revoke, failed/successful acceptance and membership changes. Include actor, organization, invitation ID, time and outcome, but never raw tokens, password material or bearer credentials. Protect applicant/recipient emails as personal data. Alerts and UI notifications must reflect persisted outcomes.

Keep the existing JWT bearer authentication and organization authorization checks. With the current bearer-only, cookie-omitting requests, authenticated mutations must require the explicit Authorization header. If cookie authentication is introduced later, add appropriate CSRF tokens, Origin checks and cookie policy before enabling invitation mutations through cookies. Do not weaken current CORS or tenant isolation to simplify acceptance.

## Proposed future API surface

The following paths are proposals only and must be reviewed against the actual API before implementation:

| Proposed endpoint | Required behavior |
| --- | --- |
| `POST /organizations/{id}/invitations` | Authorized issuance to a normalized intended email and server-permitted role; return non-secret invitation metadata. |
| `GET /organizations/{id}/invitations` | Owner/Admin-only bounded list with status and delivery metadata; never return a token or digest. |
| `POST /organizations/{id}/invitations/{invitation_id}/resend` | Authorized, rate-limited replacement delivery with old-token invalidation. |
| `POST /organizations/{id}/invitations/{invitation_id}/revoke` | Authorized transactional revocation. |
| `POST /organization-invitations/accept` | JWT-authenticated body containing the invitation token; verified exact account/email match and atomic single-use membership resolution. |

Do not introduce a public endpoint that grants membership by email, returns private-organization details for guessed identifiers, or trusts a client-provided role or account identity.

## Ownership disputes and verification

Discovery and duplicate-name suggestions are guidance for choosing a workspace. Identical names may legitimately belong to distinct organizations. Do not merge workspaces, transfer an Owner role, or treat a matching email domain, display name, request message or invitation token as proof of organizational ownership.

A future ownership-verification process needs documented evidence requirements, trusted contact verification, restricted support access, an audit trail, notice to existing owners, a dispute/appeal process, and explicit approval before any ownership transfer. Domain or email verification alone does not establish legal control of a scouting group, club, or NGO. No ownership-dispute shortcut is included in Day 9.5.

## Release verification required before implementation is considered complete

Test the future flow in a disposable PostgreSQL database with real transactions and representative delivery tooling: verified and unverified accounts, case-normalized and mismatched emails, expired/revoked/reused/unknown tokens, concurrent accept/revoke/resend, duplicate memberships, inactive privileged memberships, issuer revocation, role injection, tenant isolation, rate limits, database rollback and delivery failure. Verify that browser refresh displays saved status, private information and secrets do not appear in responses/logs/referrers, and existing Days 1–9.5 functionality remains intact.
