/**
 * Server-only failure diagnostics for ProjectHub write operations.
 *
 * Boundary rules (enforced by tests):
 * - the browser only ever receives a generic message plus the correlation id;
 * - stored metadata carries a safe classification and error code only;
 * - no secrets, headers, tokens, payloads, customer data or stack traces are
 *   ever stored;
 * - a diagnostic write failure never masks or replaces the original failure.
 */
import { writeAudit } from "./n3-session.server";

export type EnquiryFailureClassification =
  | "rpc_transport_failure"
  | "database_failure"
  | "idempotency_conflict"
  | "invalid_rpc_result"
  | "unexpected_failure";

export const CREATE_ENQUIRY_OPERATION = "projecthub.create_enquiry";

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/** PostgREST codes that mean the RPC could not be reached or discovered. */
const TRANSPORT_CODES = new Set(["PGRST100", "PGRST202", "PGRST203", "PGRST301", "PGRST302"]);

export function classifyEnquiryFailure(error: SupabaseLikeError | null): {
  classification: EnquiryFailureClassification;
  errorCode: string | null;
} {
  if (!error) return { classification: "invalid_rpc_result", errorCode: null };
  const code = error.code ?? null;
  const message = error.message ?? "";

  if (message.includes("projecthub_idempotency_conflict")) {
    return { classification: "idempotency_conflict", errorCode: code ?? "P0001" };
  }
  if (code && TRANSPORT_CODES.has(code)) {
    return { classification: "rpc_transport_failure", errorCode: code };
  }
  if (!code && /fetch|network|timed out|timeout|ECONN/i.test(message)) {
    return { classification: "rpc_transport_failure", errorCode: null };
  }
  if (code && /^[0-9A-Z]{5}$/.test(code)) {
    return { classification: "database_failure", errorCode: code };
  }
  return { classification: "unexpected_failure", errorCode: code };
}

/**
 * Records one bounded append-only failure event and emits server-only detail to
 * the runtime log. Never throws.
 */
export async function recordEnquiryFailure(input: {
  correlationId: string;
  tenantRowId: string | null;
  actor: string | null;
  classification: EnquiryFailureClassification;
  errorCode: string | null;
  error: SupabaseLikeError | null;
}): Promise<void> {
  // Server-only log: safe to include database message/detail/hint for support.
  console.error("[projecthub.create_enquiry] failure", {
    correlationId: input.correlationId,
    operation: CREATE_ENQUIRY_OPERATION,
    classification: input.classification,
    errorCode: input.errorCode,
    dbMessage: input.error?.message ?? null,
    dbDetail: input.error?.details ?? null,
    dbHint: input.error?.hint ?? null,
  });

  try {
    await writeAudit(input.correlationId, {
      tenantRowId: input.tenantRowId,
      actor: input.actor,
      eventType: "projecthub.create_enquiry.failed",
      action: CREATE_ENQUIRY_OPERATION,
      outcome: "failure",
      targetType: "project",
      targetIdentity: null,
      // Bounded, non-identifying metadata only.
      metadata: {
        classification: input.classification,
        error_code: input.errorCode,
      },
    });
  } catch {
    // A diagnostics failure must never mask the original enquiry failure.
  }
}
