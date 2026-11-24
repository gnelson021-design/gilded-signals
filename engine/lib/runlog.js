// engine/lib/runlog.js
// Structured run log. Every stage records what it did, which provider it
// used, and what it rejected and why. Never records credentials.

'use strict';

class RunLog {
  constructor(job) {
    this.doc = {
      job,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      stages: [],
      warnings: [],
      errors: [],
    };
  }
  stage(name, info) {
    const entry = { name, at: new Date().toISOString(), ...info };
    this.doc.stages.push(entry);
    console.log(`[${name}] ${JSON.stringify(info)}`);
  }
  warn(msg) {
    this.doc.warnings.push({ at: new Date().toISOString(), msg });
    console.warn(`[warn] ${msg}`);
  }
  error(msg) {
    this.doc.errors.push({ at: new Date().toISOString(), msg });
    console.error(`[error] ${msg}`);
  }
  finish(status, extra = {}) {
    this.doc.finishedAt = new Date().toISOString();
    this.doc.status = status;
    Object.assign(this.doc, extra);
    return this.doc;
  }
}

module.exports = { RunLog };
