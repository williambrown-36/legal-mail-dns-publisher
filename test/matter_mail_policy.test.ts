import assert from "node:assert/strict";
import test from "node:test";
import { matterMailRequest, recordsForMatter } from "../src/matter_mail_records.ts";

test("tightens DMARC when signed delivery is ready within 72 hours of the deadline", () => {
  const matter = matterMailRequest.parse({
    matter_id: "MAT-2048",
    sending_domain: "notices.example.com",
    dkim_selector: "legal-2026",
    dkim_public_key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ATESTKEY",
    deadline_at: "2026-09-20T09:00:00.000Z",
    intake_complete: true,
    signed_document_ready: true,
  });
  const records = recordsForMatter(matter, new Date("2026-09-18T09:00:00.000Z"));
  const dmarc = records.find((record) => record.name === "_dmarc");

  assert.equal(dmarc?.record_type, "TXT");
  assert.match(dmarc?.content ?? "", /p=reject/);
  assert.equal(records.find((record) => record.name === "legal-2026._domainkey")?.record_type, "TXT");
});
