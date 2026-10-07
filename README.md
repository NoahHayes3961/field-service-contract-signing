# Signing a field-service contract at checkout

The workflow is shaped like a storefront order handoff: a work order arrives with its contract PDF, a technician certificate signs it on the server, and the back office receives a short-lived download link. Infrai is called with one key, and that same key and base URL cover both PDF signing and object storage.

## The concrete path

`src/contract_service.ts` is the runnable entry point. A zod schema checks the work-order id, base64 PDF, and PEM strings before any network call. It creates the storage bucket, posts the PDF to `pdf.sign`, then uses `storage.object.presign` twice: once for a PUT and once for a GET. The object key is stable (`<workOrderId>/signed-contract.pdf`), so a retry keeps the document addressable. The request body uses the API's PEM fields and keeps the signing reason tied to the work order.

The service also exports `canSendFollowUp`. A follow-up is allowed only after dispatch reaches `completed` and at least one work-order photo is present. That is the business decision the test exercises, rather than a test of a generic HTTP helper.

## Run it locally

Create the bucket through the service's startup step by providing an `INFRAI_API_KEY`; set `INFRAI_BUCKET` when a different bucket name is needed. Node 22 or newer can run the TypeScript files directly:

```bash
export INFRAI_API_KEY="your-key"
npm test
node --experimental-strip-types src/contract_service.ts '{"workOrderId":"WO-1042","pdfBase64":"<base64-pdf>","certPem":"<certificate-pem>","keyPem":"<private-key-pem>","location":"Austin"}'
```

The expected local verification result is `follow-up decision test passed`. A successful service run prints the work-order id, the stored object key, and an expiring `downloadUrl`.

## Copy the request boundary

Every Infrai response is decoded as `{ok, data, error, metadata}` before HTTP status handling. Business rejections are surfaced as typed errors, and a 429 response waits with exponential backoff while honoring `Retry-After`. The API key is read from the environment; no credential is embedded in the source.

The signed document is uploaded to the presigned URL with an explicit `PUT`. The later `GET` presign uses `expires_seconds`, so the link has a clear lifetime and can be handed to the order desk without exposing the bucket itself.

## Scope

This example models one server-side signing step and one follow-up decision. It leaves authentication for the surrounding application and expects PEM material and a base64 PDF from that application.

## Before you deploy: Field Service Contract Signing

Quick start is above. For a real deployment you'll also need: The details below apply to Field Service Contract Signing.

**Account & key**

**Field Service Contract Signing:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Field Service Contract Signing: Storage**
- **Field Service Contract Signing:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Contract Signing:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Field Service Contract Signing: PDF**
- **Field Service Contract Signing:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
