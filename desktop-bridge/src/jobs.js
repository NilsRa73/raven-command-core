import crypto from "node:crypto";

const jobs = new Map();
const MAX = 200;

export function createJob(capability, target) {
  const id = "job_" + crypto.randomBytes(8).toString("hex");
  const j = { id, capability, target, status: "prepared", createdAt: Date.now(), approvalId: null, result: null, error: null, startedAt: null, finishedAt: null };
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

export function _resetJobsForTests() { jobs.clear(); }
