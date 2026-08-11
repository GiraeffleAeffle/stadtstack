#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createPermanentCoordinatorRuntime,
  parsePermanentCoordinatorRuntimeConfig,
  type PermanentCoordinatorRuntime,
  type PermanentCoordinatorRuntimeOptions,
} from "./permanent-coordinator-runtime.ts";

const CONFIG_LIMIT = 256 * 1024;
const TOKENS_LIMIT = 64 * 1024;

export type PermanentRuntimeCliArgs = {
  command: "serve";
  configPath: string;
  actorTokensPath: string;
};

function fail(code: string): never {
  throw new Error(`stadtstack_permanent_cli_${code}`);
}

function jsonPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || !value.endsWith(".json") || value.includes("\u0000")) fail("path_invalid");
  return resolve(value);
}

export function parsePermanentRuntimeCliArgs(argv: readonly string[]): PermanentRuntimeCliArgs {
  if (
    !Array.isArray(argv) || argv.length !== 5 || argv[0] !== "serve" ||
    argv[1] !== "--config" || argv[3] !== "--actor-tokens"
  ) fail("args_invalid");
  const configPath = jsonPath(argv[2]);
  const actorTokensPath = jsonPath(argv[4]);
  if (configPath === actorTokensPath) fail("paths_not_distinct");
  return Object.freeze({ command: "serve", configPath, actorTokensPath });
}

async function readJson(path: string, limit: number): Promise<unknown> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    fail("file_invalid");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > limit) fail("file_invalid");
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    fail("file_invalid");
  }
  if (bytes.byteLength > limit) fail("file_invalid");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    fail("json_invalid");
  }
}

function actorTokens(value: unknown): PermanentCoordinatorRuntimeOptions["actorTokens"] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("actor_tokens_invalid");
  const result: Record<string, string> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("actor_tokens_invalid");
    const token = (value as Record<string, unknown>)[key];
    if (typeof token !== "string") fail("actor_tokens_invalid");
    result[key] = token;
  }
  return Object.freeze(result);
}

export async function readPermanentRuntimeInputs(args: PermanentRuntimeCliArgs): Promise<{
  config: ReturnType<typeof parsePermanentCoordinatorRuntimeConfig>;
  options: PermanentCoordinatorRuntimeOptions;
}> {
  const [configValue, tokenValue] = await Promise.all([
    readJson(args.configPath, CONFIG_LIMIT),
    readJson(args.actorTokensPath, TOKENS_LIMIT),
  ]);
  return {
    config: parsePermanentCoordinatorRuntimeConfig(configValue),
    options: { actorTokens: actorTokens(tokenValue) },
  };
}

export async function startPermanentRuntimeFromFiles(args: PermanentRuntimeCliArgs): Promise<PermanentCoordinatorRuntime> {
  const input = await readPermanentRuntimeInputs(args);
  const runtime = createPermanentCoordinatorRuntime(input.config, input.options);
  await runtime.start();
  return runtime;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let runtime: PermanentCoordinatorRuntime;
  try {
    runtime = await startPermanentRuntimeFromFiles(parsePermanentRuntimeCliArgs(argv));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "stadtstack_permanent_cli_start_failed"}\n`);
    return 2;
  }
  let shuttingDown = false;
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => { finish = resolve; });
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch {
      process.stderr.write("stadtstack_permanent_cli_close_failed\n");
      process.exitCode = 1;
    } finally {
      finish();
    }
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  await stopped;
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) process.exitCode = await main();
