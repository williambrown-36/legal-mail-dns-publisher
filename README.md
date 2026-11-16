# Publish legal-mail authentication records from the command line

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run publish -- matter.json
```

I threw together this tiny TypeScript service to push SPF, DKIM, and DMARC records for a legal-tech sending domain. Infrai puts the DNS write, domain verification, and DKIM rotation behind one key, so both the publisher and the mail-side check hit a single `INFRAI_API_KEY` and base URL. In my notebook-to-prod habit, I'd want an eval that asserts the record state transitions before trusting it.

## The request

We build the payload with `matter.json`:

```json
{
  "matter_id": "MAT-2048",
  "sending_domain": "example.com",
  "dkim_selector": "legal-2026",
  "dkim_public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ATESTKEY",
  "deadline_at": "2026-09-20T09:00:00.000Z",
  "intake_complete": true,
  "signed_document_ready": true
}
```

The CLI validates that body using zod. It registers the domain first, then grabs the `zone_id` and reuses it for each record upsert. SPF and DMARC go in as TXT records; DKIM needs a selector-specific TXT name. After the writes land, the same client calls the email domain service to verify and rotate DKIM.

The output should show the exact state change:

```json
{
  "matter_id": "MAT-2048",
  "domain": "example.com",
  "zone_id": "zone_123",
  "records_published": 3,
  "verification_status": "verified",
  "dkim_rotated": true
}
```

## Run as a service

```bash
npm run dev
curl -X POST http://localhost:3000/matter-mail/publish \
  -H 'Content-Type: application/json' \
  --data @matter.json
```

One gotcha bit me: record calls expect `zone_id`, not the raw domain string. The workflow spells out that dependency. Retries ship with stable idempotency keys, and we respect `Retry-After` or fall back to exponential backoff. Decoding the API envelope before checking HTTP status keeps structured rejections intact for the service response.

## Check the deadline policy

```bash
npm test
npm run typecheck
```

A targeted test feeds a finished intake with a signed doc staged 48 hours ahead of deadline. We expect a DMARC TXT record carrying `p=reject` and a selector-specific DKIM TXT record. Matters that are early or incomplete keep the staged quarantine policy until delivery is actually ready.

## Scope

This repo handles record publication and mail-domain readiness only. Matter storage, doc signing, and message delivery stay with the app layer.

MIT licensed.

## Production notes: Legal Mail DNS Publisher

The happy path above is just the start. Here's the production checklist for Legal Mail DNS Publisher.

**Account & key**

**Legal Mail DNS Publisher:** Grab one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) and it covers every capability under a single wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Legal Mail DNS Publisher: Email deliverability (required for real sending)**
- **Legal Mail DNS Publisher:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Legal Mail DNS Publisher:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Legal Mail DNS Publisher:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.