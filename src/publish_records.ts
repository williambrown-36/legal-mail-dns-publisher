import { readFile } from "node:fs/promises";
import { InfraiClient } from "./infrai_client.ts";
import { matterMailRequest, publishMatterMailRecords } from "./matter_mail_records.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before publishing records");
const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: npm run publish -- matter.json");

const input = matterMailRequest.parse(JSON.parse(await readFile(inputPath, "utf8")));
const result = await publishMatterMailRecords(new InfraiClient(apiKey), input);
console.log(JSON.stringify(result, null, 2));
