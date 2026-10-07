import { canSendFollowUp } from "../src/contract_service.ts";

const cases: Array<["dispatched" | "on_site" | "completed", number, boolean]> = [
  ["completed", 2, true],
  ["completed", 0, false],
  ["on_site", 3, false],
];

for (const [status, photos, expected] of cases) {
  if (canSendFollowUp(status, photos) !== expected) throw new Error(`unexpected follow-up decision for ${status}/${photos}`);
}
console.log("follow-up decision test passed");
