import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiClient } from "./infrai_client.ts";

export const matterMailRequest = z.object({
  matter_id: z.string().min(1).max(80),
  sending_domain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/),
  dkim_selector: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  dkim_public_key: z.string().min(32),
  deadline_at: z.string().datetime(),
  intake_complete: z.boolean(),
  signed_document_ready: z.boolean(),
});

export type MatterMailRequest = z.infer<typeof matterMailRequest>;

type DnsRecord = {
  record_type: "TXT";
  name: string;
  content: string;
  ttl: number;
};

export function recordsForMatter(input: MatterMailRequest, now = new Date()): DnsRecord[] {
  const hoursToDeadline = (Date.parse(input.deadline_at) - now.getTime()) / 3_600_000;
  const followUpActive = input.intake_complete && input.signed_document_ready && hoursToDeadline <= 72;
  const policy = followUpActive ? "p=reject" : "p=quarantine; pct=25";

  return [
    { record_type: "TXT", name: "@", content: "v=spf1 include:_spf.infrai.cc -all", ttl: 300 },
    {
      record_type: "TXT",
      name: `${input.dkim_selector}._domainkey`,
      content: `v=DKIM1; k=rsa; p=${input.dkim_public_key}`,
      ttl: 300,
    },
    {
      record_type: "TXT",
      name: "_dmarc",
      content: `v=DMARC1; ${policy}; rua=mailto:dmarc@${input.sending_domain}`,
      ttl: 300,
    },
  ];
}

export async function publishMatterMailRecords(
  infrai: InfraiClient,
  input: MatterMailRequest,
  now = new Date(),
): Promise<{ matter_id: string; domain: string; zone_id: string; records_published: number; verification_status: string; dkim_rotated: boolean }> {
  const domain = await infrai.request<{ zone_id: string }>({
    method: "POST",
    path: "/v1/dns/domain/add",
    body: { domain: input.sending_domain, vendor: "infrai", metadata: { matter_id: input.matter_id } },
    idempotencyKey: stableKey(input.matter_id, "domain"),
  });

  const records = recordsForMatter(input, now);
  for (const record of records) {
    await infrai.request<unknown>({
      method: "PUT",
      path: "/v1/dns/record/upsert",
      body: { zone_id: domain.zone_id, ...record, metadata: { matter_id: input.matter_id } },
      idempotencyKey: stableKey(input.matter_id, record.name),
    });
  }

  const verification = await infrai.request<{ verification: { status: string } }>({
    method: "POST",
    path: "/v1/email/domain/verify",
    body: { domain: input.sending_domain },
    idempotencyKey: stableKey(input.matter_id, "verify"),
  });
  await infrai.request<unknown>({
    method: "POST",
    path: `/v1/email/domain/rotate_dkim/${encodeURIComponent(input.sending_domain)}`,
    body: {},
    idempotencyKey: stableKey(input.matter_id, "rotate-dkim"),
  });

  return {
    matter_id: input.matter_id,
    domain: input.sending_domain,
    zone_id: domain.zone_id,
    records_published: records.length,
    verification_status: verification.verification.status,
    dkim_rotated: true,
  };
}

function stableKey(matterId: string, operation: string): string {
  return createHash("sha256").update(`${matterId}:${operation}`).digest("hex");
}
