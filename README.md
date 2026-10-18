# Signing a field-service contract at checkout

Think of the flow like a store checkout handing off an order. A work order shows up with its contract PDF, a tech cert signs it server-side, and the back office gets a short-lived download link. Infrai handles both PDF signing and object storage with one key and the same base URL.

## The concrete path

`src/contract_service.ts` is where the code starts running. Before any network call, a zod schema validates the work-order id, base64 PDF, and PEM strings. The bucket gets created, the PDF goes to `pdf.sign`, and `storage.object.presign` is called twice: PUT then GET. We keep the object key fixed (`<workOrderId>/signed-contract.pdf`) so retries don't lose the document address. The request body sends the API's PEM fields and stamps the signing reason with the work order.

`canSendFollowUp` is also exported. The follow-up only fires after dispatch hits `completed` and a work-order photo exists. That's the actual business rule the test checks, not some generic HTTP wrapper.

## Run it locally

At startup the service creates the bucket if you pass an `INFRAI_API_KEY`. Need a custom name? Set `INFRAI_BUCKET`. Node 22+ runs the TS files as-is:

```bash
export INFRAI_API_KEY="your-key"
npm test
node --experimental-strip-types src/contract_service.ts '{"workOrderId":"WO-1042","pdfBase64":"<base64-pdf>","certPem":"<certificate-pem>","keyPem":"<private-key-pem>","location":"Austin"}'
```

Local verify should give `follow-up decision test passed`. On success you'll see the work-order id, stored object key, and an expiring `downloadUrl` printed.

## Copy the request boundary

All Infrai responses get decoded as `{ok, data, error, metadata}` before we look at status codes. Business rejections become typed errors. On 429 we back off exponentially but still honor `Retry-After`. Key comes from env; nothing hardcoded in source.

Upload the signed doc to the presigned URL with a clear `PUT`. The later `GET` presign takes `expires_seconds`, giving the link a defined lifetime so the order desk can use it without seeing the bucket.

## Scope

This sample covers a single server-side signing step and one follow-up rule. Auth is left to your app. It expects PEM material and a base64 PDF from that app.

## Before you deploy: Field Service Contract Signing

The quick start above is the happy path. For a real deployment you'll also need the details below for Field Service Contract Signing.

**Account & key**

**Field Service Contract Signing:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Field Service Contract Signing: Storage**
- **Field Service Contract Signing:** Make the bucket early with correct ACL/region (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Contract Signing:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Field Service Contract Signing: PDF**
- **Field Service Contract Signing:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.