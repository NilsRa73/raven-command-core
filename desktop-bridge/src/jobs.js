import crypto from "node:crypto";
import { JOB_APPROVAL_TTL_MS } from "./protocol.js";

const jobs = new Map();
const MAX = 200;

/**
 * Create a job with locked-in, normalized parameters and a one-time
 * confirmation token. Execute later validates the token and MUST use
 * only these stored params — no override fields from the execute call.
 */
export function createJob(capability, params) {
  const id = "job_" + crypto.randomBytes(8).toString("hex");
  const confirmationToken = crypto.randomBytes(24).toString("base64url");
  const j = {
    id,
    capability,
    params: params ?? {},
    status: "prepared",
    createdAt: Date.now(),
    expiresAt: Date.now() + JOB_APPROVAL_TTL_MS,
    approvalId: null,
    confirmationToken,   // returned once; consumed on execute
    tokenConsumed: false,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(id, j);
  if (jobs.size > MAX) {
    const oldest = [...jobs.keys()][0];
    jobs.delete(oldest);
  }
  return j;
}

export function getJob(id) { return jobs.get(id) || null; }

export function updateJob(id, patch) {
  const j = jobs.get(id); if (!j) return null;
  Object.assign(j, patch); return j;
}

export function approveJob(id, approvalId) {
  return updateJob(id, { status: "approved", approvalId });
}

/** Public projection — never leaks the confirmationToken. */
export function publicJob(j) {
  if (!j) return null;
  // eslint-disable-next-line no-unused-vars
  const { confirmationToken, tokenConsumed, ...rest } = j;
  return rest;
}

export function _resetJobsForTests() { jobs.clear(); }
