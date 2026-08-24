import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

const PREFIX = "STADTSTACK_CASE_";
const MAX_CONFIG_BYTES = 1_048_576;

function fail() {
  throw new Error("case_runtime_configuration_invalid");
}

function exactConfigurationPath(name) {
  const caseEnvironment = Object.keys(process.env).filter((key) => key.startsWith(PREFIX));
  if (caseEnvironment.length !== 1 || caseEnvironment[0] !== name) fail();
  const path = process.env[name];
  if (typeof path !== "string" || path.length === 0 || path.trim() !== path || !path.startsWith("/")) fail();
  return path;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readBoundedRegularFile(path) {
  let descriptor;
  let bytes;
  let failed = false;
  try {
    const beforeOpen = lstatSync(path, { bigint: true });
    if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile() ||
      beforeOpen.size < 1n || beforeOpen.size > BigInt(MAX_CONFIG_BYTES)) fail();
    if (typeof fsConstants.O_NOFOLLOW !== "number" ||
      typeof fsConstants.O_NONBLOCK !== "number") fail();
    descriptor = openSync(path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    const beforeRead = fstatSync(descriptor, { bigint: true });
    if (!beforeRead.isFile() || !sameFile(beforeOpen, beforeRead) ||
      beforeRead.size < 1n || beforeRead.size > BigInt(MAX_CONFIG_BYTES)) fail();

    bytes = Buffer.alloc(Number(beforeRead.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (!Number.isSafeInteger(count) || count < 1) fail();
      offset += count;
    }

    // A regular file that grows after fstat must not silently truncate into a
    // seemingly valid configuration. The final descriptor and path checks
    // detect shrinkage, in-place mutation, and atomic replacement during the
    // bounded read. O_NONBLOCK above makes a regular-file-to-FIFO/device race
    // fail at fstat instead of waiting for a peer forever.
    const growthProbe = Buffer.alloc(1);
    if (readSync(descriptor, growthProbe, 0, 1, bytes.byteLength) !== 0) fail();
    const afterRead = fstatSync(descriptor, { bigint: true });
    if (!afterRead.isFile() || !sameFile(beforeRead, afterRead) ||
      afterRead.size !== beforeRead.size || afterRead.mtimeNs !== beforeRead.mtimeNs ||
      afterRead.ctimeNs !== beforeRead.ctimeNs) fail();
    const afterPath = lstatSync(path, { bigint: true });
    if (afterPath.isSymbolicLink() || !afterPath.isFile() ||
      !sameFile(afterRead, afterPath) || afterPath.size !== afterRead.size ||
      afterPath.mtimeNs !== afterRead.mtimeNs || afterPath.ctimeNs !== afterRead.ctimeNs) fail();
  } catch {
    failed = true;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); }
      catch { failed = true; }
    }
  }
  if (failed || !(bytes instanceof Buffer)) fail();
  return bytes;
}

function readConfiguration(name) {
  const bytes = readBoundedRegularFile(exactConfigurationPath(name));
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(); }
}

/**
 * Starts exactly one loopback reference runtime from one mounted JSON file.
 * It intentionally never prints a path, config value, exception, or health
 * object: credentials and storage facts may be present in control config.
 */
export async function startLoopbackCaseRuntime({ component, configurationEnvironment, create }) {
  let runtime;
  let terminationRequested = false;
  let closeFailed = false;
  let closePromise;
  const requestClose = (code) => {
    terminationRequested = true;
    if (closePromise === undefined) {
      closePromise = (async () => {
        try { await runtime.close(); }
        catch { closeFailed = true; }
        process.exitCode = closeFailed ? 78 : code;
      })();
    }
    return closePromise;
  };
  try {
    runtime = await create(readConfiguration(configurationEnvironment));
    process.once("SIGTERM", () => { void requestClose(0); });
    process.once("SIGINT", () => { void requestClose(0); });
    try { await runtime.start(); }
    catch (error) {
      if (!terminationRequested) throw error;
    }
    if (terminationRequested) {
      await closePromise;
      return;
    }
    process.stdout.write(`stadtstack_case_${component}_loopback_ready\n`);
  } catch {
    process.stderr.write(`stadtstack_case_${component}_start_failed\n`);
    process.exitCode = 78;
  }
}
