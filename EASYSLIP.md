# EasySlip integration

The `/api/verify-slip` route uses EasySlip v2 (`https://api.easyslip.com/v2/verify/bank`).
QR input uses `payload`; image input uses JSON `base64`. Images are limited to 4 MB
decoded size and JPEG, PNG, GIF or WebP. The browser continues to call the existing
internal API using `imageBase64`.

## Required setup

1. Set the server-only `EASYSLIP_API_KEY` and restart/redeploy the application.
2. Register the shop's receiving bank account in EasySlip and link it to the API
   branch represented by that key. Verification requests use `matchAccount: true`;
   a missing `matchedAccount.bankNumber` never authorizes payment. Register only
   accounts the shop accepts payments into.
3. The existing `slip_verifications` / `slip_scan_requests` tables must be installed.
   No schema changes are required for this patch. Do not rerun `schema.sql` on a
   populated database. Staff must have an existing `admin` or `staff` role.
4. Use the connection check in the slip dialog, then check a real shop payment
   through the complete UI before relying on automatic opening/extension/checkout.

Read-only checks on 2026-09-13 found a working key, an active branch, quota 246/250
remaining, but **zero linked bank accounts**. Account linking is still required.
These values describe the local `.env`, not necessarily the deployed host.

## Verification and retry behavior

- A positive, finite amount, a matched receiving account, valid slip reference/date,
  and successful local insert are required before returning `ok: true`.
- The existing one-satang amount tolerance is retained using integer satang math.
- Amount mismatches are no longer inserted into the transaction consumption table.
  Correcting the expected amount and checking again is therefore possible.
- Accepted references remain protected by the existing database unique constraint,
  including concurrent requests. Provider `checkDuplicate` is intentionally false:
  an attempted verification is not proof that the shop accepted the payment.
- Previously stored `amount_mismatch` records from the old implementation are not
  changed or deleted. Their unique references may still reject retries; review such
  historical records separately before any data correction.
- A database write failure returns `SAVE_FAILED`; it must not authorize an automatic
  business action. Failures with an uncertain write outcome require checking history.
- UI callbacks ignore cancelled/obsolete EasySlip requests; duplicate scanner input
  is blocked while verification is pending.

This patch does not redesign billing or implement a transaction-wide payment ledger.
Existing manual payment controls and database policies are unchanged. In particular,
direct insert access in the original slip RLS should be hardened separately before
using database rows as trusted payment authorization outside this API.

## Regression tests

```powershell
node --test tests/easyslip.test.cjs
npx tsc --noEmit --incremental false
```

Tests transpile the actual TypeScript handlers/components in memory and replace
network/database/browser boundaries with mocks. They do not read `.env`, spend
EasySlip quota, or modify shop data. They cover v2 payloads, uploads, validation,
receiver mismatch, duplicate/concurrent submissions, storage errors, amount retries,
late UI results, customer scanner cancellation.

Official API references:
- https://document.easyslip.com/en/v2/verify/bank/
- https://document.easyslip.com/en/v2/verify/bank/base64
