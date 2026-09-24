"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("./business-zeroing-core.cjs");

// Preparation is not execution. A partial preparation remains reserved and
// must be investigated, never overwritten or silently retried.
function prepareJournal(root, batchId, plan, authorization, summary) {
  const reject = () => { throw new Error("EXECUTION_JOURNAL_REJECTED"); };
  if (!path.isAbsolute(root) || path.resolve(root) !== root || fs.realpathSync(root) !== root ||
      !/^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(batchId)) reject();
  const metadata = fs.lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid() ||
      (metadata.mode & 0o777) !== 0o700) reject();
  const rootFd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let directoryFd;
  try {
    const opened = fs.fstatSync(rootFd);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) reject();
    const directory = path.join(root, batchId);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("EXECUTION_JOURNAL_EXISTS");
      throw error;
    }
    fs.fsyncSync(rootFd);
    directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const write = (name, value) => {
      const fd = fs.openSync(path.join(directory, name),
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try {
        const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
          if (!count) throw new Error("JOURNAL_WRITE_FAILED");
          offset += count;
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.fsyncSync(directoryFd);
    };
    write("plan.json", plan);
    write("apply-authorization.json", authorization);
    const event = { schemaVersion: 1, sequence: 0, previousEventSha256: null, state: "prepared",
      executed: false, batchId, planSha256: plan.reportSha256, applyAuthorizationSha256: summary.envelopeSha256,
      completedOperations: [], createdAt: new Date().toISOString() };
    write("000000-prepared.json", { ...event, eventSha256: sha256(event) });
  } finally {
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
    fs.closeSync(rootFd);
  }
}
function readJournal(root, batchId, readInput) {
  const reject = () => { throw new Error("EXECUTION_JOURNAL_INVALID"); };
  if (!path.isAbsolute(root) || path.resolve(root) !== root || fs.realpathSync(root) !== root ||
      !/^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(batchId)) reject();
  const directory = path.join(root, batchId);
  for (const target of [root, directory]) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) reject();
  }
  const names = fs.readdirSync(directory);
  if (names.length < 3 || names.length > 1024 || names.some(name =>
    !["plan.json", "apply-authorization.json"].includes(name) && !/^\d{6}-[a-z_]+\.json$/u.test(name))) reject();
  const read = name => {
    const target = path.join(directory, name), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) reject();
    return readInput(target);
  };
  const plan = read("plan.json"), authorization = read("apply-authorization.json");
  const { reportSha256, ...body } = plan;
  if (sha256(body) !== reportSha256 || plan.batchId !== batchId) reject();
  const events = names.filter(name => /^\d{6}-/u.test(name)).sort().map(read);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index], { eventSha256, ...eventBody } = event;
    if (sha256(eventBody) !== eventSha256 || event.sequence !== index || event.batchId !== batchId ||
        event.planSha256 !== reportSha256 || event.applyAuthorizationSha256 !== sha256(authorization) ||
        event.previousEventSha256 !== (index ? events[index - 1].eventSha256 : null) ||
        !names.includes(`${String(index).padStart(6, "0")}-${event.state}.json`)) reject();
    const previous = index ? events[index - 1].state : null;
    const allowed = previous === null ? ["prepared"] : {
      prepared: ["database_intent", "failed"], database_intent: ["database_deleted", "failed"],
      database_deleted: ["object_intent", "failed"], object_intent: ["object_deleted", "failed"],
      object_deleted: ["object_intent", "postcheck_required", "failed"],
      postcheck_required: ["completed", "failed"], completed: [], failed: []
    }[previous];
    if (!allowed?.includes(event.state)) reject();
  }
  return { plan, authorization, events, directory };
}

function appendJournal(root, batchId, readInput, state, details) {
  const journal = readJournal(root, batchId, readInput);
  const previous = journal.events.at(-1);
  const transitions = { prepared: ["database_intent", "failed"], database_intent: ["database_deleted", "failed"],
    database_deleted: ["object_intent", "failed"], object_intent: ["object_deleted", "failed"],
    object_deleted: ["object_intent", "postcheck_required", "failed"],
    postcheck_required: ["completed", "failed"] };
  if (!transitions[previous.state]?.includes(state)) throw new Error("EXECUTION_JOURNAL_TRANSITION_INVALID");
  const body = { schemaVersion: 1, sequence: journal.events.length, previousEventSha256: previous.eventSha256,
    state, batchId, planSha256: journal.plan.reportSha256, applyAuthorizationSha256: sha256(journal.authorization),
    createdAt: new Date().toISOString(), details };
  const event = { ...body, eventSha256: sha256(body) };
  const directoryFd = fs.openSync(journal.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let fd;
  try {
    fd = fs.openSync(path.join(journal.directory, `${String(body.sequence).padStart(6, "0")}-${state}.json`),
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify(event, null, 2)}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (!written) throw new Error("JOURNAL_WRITE_FAILED");
      offset += written;
    }
    fs.fsyncSync(fd);
    fs.fsyncSync(directoryFd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.closeSync(directoryFd);
  }
  return event;
}

module.exports = { prepareJournal, readJournal, appendJournal };
