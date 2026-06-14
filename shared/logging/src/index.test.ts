import test from "node:test";
import assert from "node:assert/strict";
import { createLogger, logger } from "./index.js";

test("info is emitted at default level", (t) => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  t.after(() => { process.stdout.write = orig; });

  logger.info({ kind: "test.event", value: 42 });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.level, "info");
  assert.equal(entry.kind, "test.event");
  assert.equal(entry.value, 42);
});

test("debug is suppressed at default (info) level", (t) => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  t.after(() => { process.stdout.write = orig; });

  logger.debug({ kind: "test.debug" });
  assert.equal(lines.length, 0);
});

test("warn goes to stderr", (t) => {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  t.after(() => { process.stderr.write = orig; });

  logger.warn({ kind: "test.warn" });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.level, "warn");
});

test("child prefixes kind", (t) => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  t.after(() => { process.stdout.write = orig; });

  const child = createLogger("agent-host");
  child.info({ kind: "startup", port: 4000 });

  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.kind, "agent-host.startup");
});

test("error serialises Error objects", (t) => {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  t.after(() => { process.stderr.write = orig; });

  logger.error({ kind: "test.error", error: new Error("boom") });
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.error.message, "boom");
  assert.equal(entry.error.name, "Error");
});
