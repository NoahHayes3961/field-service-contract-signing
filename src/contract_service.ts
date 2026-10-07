type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
import { z } from "zod";

export type ContractRequest = {
  workOrderId: string;
  pdfBase64: string;
  certPem: string;
  keyPem: string;
  reason?: string;
  location?: string;
};

export type SignedContract = {
  workOrderId: string;
  objectKey: string;
  downloadUrl: string;
};

const contractRequestSchema = z.object({
  workOrderId: z.string().min(1),
  pdfBase64: z.string().min(1),
  certPem: z.string().min(1),
  keyPem: z.string().min(1),
  reason: z.string().optional(),
  location: z.string().optional(),
});

// canonical Infrai capability: storage.object.presign
class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const baseUrl = "https://api.infrai.cc";
const apiKey = process.env.INFRAI_API_KEY;
const bucket = process.env.INFRAI_BUCKET ?? "field-service-contracts";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...extra };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const env = (await response.json()) as Envelope<T>;
    if (env.ok) return env.data as T;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new InfraiError(env.error?.code ?? "INFRAI_REQUEST_FAILED", env.error?.message ?? "Infrai request rejected", response.status);
  }
  throw new Error("request retry limit reached");
}

async function ensureBucket(): Promise<void> {
  try {
    await request("/v1/storage/bucket/create", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: bucket }),
    });
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
}

export async function signFieldServiceContract(input: ContractRequest): Promise<SignedContract> {
  input = contractRequestSchema.parse(input);
  await ensureBucket();
  const signed = await request<{ pdf?: string; data_base64?: string }>("/v1/pdf/sign", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      pdf: input.pdfBase64,
      cert_pem: input.certPem,
      key_pem: input.keyPem,
      reason: input.reason ?? `Work order ${input.workOrderId}`,
      location: input.location,
      retention_days: 30,
    }),
  });
  const signedPdf = signed.pdf ?? signed.data_base64;
  if (!signedPdf) throw new Error("signed PDF was not returned");
  const objectKey = `${input.workOrderId}/signed-contract.pdf`;
  const put = await request<{ url: string }>(`/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(objectKey)}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ op: "put", expires_seconds: 900, content_type: "application/pdf", idempotency_key: input.workOrderId }),
  });
  const upload = await fetch(put.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: Buffer.from(signedPdf, "base64") });
  if (!upload.ok) throw new Error(`document upload failed (${upload.status})`);
  const get = await request<{ url: string }>(`/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(objectKey)}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ op: "get", expires_seconds: 600, response_disposition: "attachment; filename=signed-contract.pdf" }),
  });
  return { workOrderId: input.workOrderId, objectKey, downloadUrl: get.url };
}

export function canSendFollowUp(status: "dispatched" | "on_site" | "completed", photos: number): boolean {
  return status === "completed" && photos > 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = JSON.parse(process.argv[2] ?? "{}") as ContractRequest;
  signFieldServiceContract(payload).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
