import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_STATUSES, normalizeVersion, normalizeDecision,
  makeInitialVersion, makeNextVersion, groupVersions, latestVersions,
  diffVersions, findDuplicateCandidates, isVersionDirty,
  exportChangelogJson, exportChangelogMarkdown, NO_SILENT_SAVE,
} from "../../src/lib/rah/decisions.js";

const now = 1_700_000_000_000;

test("makeInitialVersion produces v1 with defaults", () => {
  const v = makeInitialVersion({ decisionId: "d1", title: "Adopt Raven", now });
  assert.equal(v.versionNumber, 1);
  assert.equal(v.status, "proposed");
  assert.equal(v.decisionId, "d1");
  assert.equal(v.createdAt, now);
});

test("makeNextVersion increments monotonically and does not mutate prior", () => {
  const v1 = makeInitialVersion({ decisionId: "d1", title: "Original", now });
  const v2 = makeNextVersion(v1, { title: "Revised", status: "accepted" }, { now: now + 1000 });
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.title, "Revised");
  assert.equal(v2.status, "accepted");
  assert.equal(v1.title, "Original", "prior version must be immutable");
  assert.equal(v1.status, "proposed");
  assert.ok(v2.createdAt > v1.createdAt);
});

test("makeNextVersion preserves supersede/reverse links when patched", () => {
  const v1 = makeInitialVersion({ decisionId: "d2", title: "New choice", now });
  const v2 = makeNextVersion(v1, { supersedesDecisionId: "d1", status: "accepted" }, { now: now + 10 });
  assert.equal(v2.supersedesDecisionId, "d1");
  const v3 = makeNextVersion(v2, { reversesDecisionId: "d1", status: "reversed" }, { now: now + 20 });
  assert.equal(v3.reversesDecisionId, "d1");
  assert.equal(v3.supersedesDecisionId, "d1", "unpatched links persist");
});

test("groupVersions and latestVersions sort by version number", () => {
  const list = [
    { id: "d1:v2", decisionId: "d1", versionNumber: 2, createdAt: now + 5, title: "B", status: "accepted" },
    { id: "d1:v1", decisionId: "d1", versionNumber: 1, createdAt: now, title: "A", status: "proposed" },
    { id: "d2:v1", decisionId: "d2", versionNumber: 1, createdAt: now, title: "C" },
  ];
  const g = groupVersions(list);
  assert.equal(g.get("d1").length, 2);
  assert.equal(g.get("d1")[0].versionNumber, 1);
  assert.equal(g.get("d1")[1].versionNumber, 2);
  const latest = latestVersions(list);
  assert.equal(latest.get("d1").title, "B");
});

test("diffVersions marks changed fields only", () => {
  const v1 = makeInitialVersion({ decisionId: "d1", title: "A", content: "hello", now });
  const v2 = makeNextVersion(v1, { title: "B", status: "accepted" }, { now: now + 5 });
  const rows = diffVersions(v1, v2);
  const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(byField.title.changed, true);
  assert.equal(byField.status.changed, true);
  assert.equal(byField.content.changed, false);
});

test("findDuplicateCandidates warns on similar title/content", () => {
  const decisions = [{ id: "d1", projectId: "p1" }, { id: "d2", projectId: "p1" }];
  const versions = [
    makeInitialVersion({ decisionId: "d1", title: "Adopt Raven local AI", content: "Use local models", now }),
    makeInitialVersion({ decisionId: "d2", title: "Something entirely different", content: "Other topic", now }),
  ];
  const dupes = findDuplicateCandidates({
    draft: { title: "Adopt Raven local AI", content: "Use local models" },
    decisions, versions, projectId: "p1", threshold: 0.6,
  });
  assert.ok(dupes.length >= 1);
  assert.equal(dupes[0].decisionId, "d1");
  assert.ok(dupes[0].similarity >= 0.6);
});

test("findDuplicateCandidates excludes own decisionId", () => {
  const decisions = [{ id: "d1", projectId: "p1" }];
  const versions = [makeInitialVersion({ decisionId: "d1", title: "Same title", content: "same body", now })];
  const dupes = findDuplicateCandidates({
    draft: { decisionId: "d1", title: "Same title", content: "same body" },
    decisions, versions, projectId: "p1", threshold: 0.5,
  });
  assert.equal(dupes.length, 0);
});

test("isVersionDirty flags any field difference", () => {
  const v1 = makeInitialVersion({ decisionId: "d1", title: "A", now });
  assert.equal(isVersionDirty(v1, { title: "A" }), false);
  assert.equal(isVersionDirty(v1, { title: "B" }), true);
  assert.equal(isVersionDirty(null, { title: "A" }), true);
  assert.equal(isVersionDirty(null, {}), false);
});

test("exportChangelogJson/Markdown include project + version history", () => {
  const decisions = [{ id: "d1", projectId: "p1", createdAt: now, updatedAt: now + 5 }];
  const v1 = makeInitialVersion({ decisionId: "d1", title: "Adopt X", now });
  const v2 = makeNextVersion(v1, { status: "accepted" }, { now: now + 5 });
  const project = { id: "p1", name: "RAH OS" };
  const j = exportChangelogJson({ project, decisions, versions: [v1, v2], exportedAt: now });
  assert.equal(j.kind, "raven-decisions/v1");
  assert.equal(j.decisions[0].versions.length, 2);
  const md = exportChangelogMarkdown({ project, decisions, versions: [v1, v2], exportedAt: now });
  assert.ok(md.includes("# Decisions Changelog — RAH OS"));
  assert.ok(md.includes("v1"));
  assert.ok(md.includes("v2"));
});

test("DECISION_STATUSES includes proposed/accepted/superseded/reversed", () => {
  for (const s of ["proposed", "accepted", "superseded", "reversed"]) {
    assert.ok(DECISION_STATUSES.includes(s));
  }
});

test("NO_SILENT_SAVE is frozen and truthful", () => {
  assert.equal(NO_SILENT_SAVE.editCreatesNewVersion, true);
  assert.equal(NO_SILENT_SAVE.historyIsImmutable, true);
  assert.equal(NO_SILENT_SAVE.duplicateWarningIsNotAutoMerge, true);
  assert.equal(NO_SILENT_SAVE.archivePreferredOverDelete, true);
  assert.throws(() => { NO_SILENT_SAVE.editCreatesNewVersion = false; });
});

test("normalizeDecision defaults archived to false and preserves projectId null", () => {
  const d = normalizeDecision({ id: "d1" });
  assert.equal(d.archived, false);
  assert.equal(d.projectId, null);
});

test("normalizeVersion clamps unknown status to proposed", () => {
  const v = normalizeVersion({ id: "d1:v1", decisionId: "d1", status: "whatever" });
  assert.equal(v.status, "proposed");
});