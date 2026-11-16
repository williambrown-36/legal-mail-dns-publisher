import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.ts";
import { matterMailRequest, publishMatterMailRecords } from "./matter_mail_records.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const infrai = new InfraiClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/matter-mail/publish") {
    return send(response, 404, { error: "route_not_found" });
  }
  try {
    const input = matterMailRequest.parse(await readJson(request));
    const result = await publishMatterMailRecords(infrai, input);
    return send(response, 200, result);
  } catch (error) {
    if (error instanceof ZodError) return send(response, 400, { error: "invalid_request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, details: error.details });
    }
    return send(response, 500, { error: "request_failed" });
  }
}).listen(port, () => console.log(`Matter mail publisher listening on http://localhost:${port}`));

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
