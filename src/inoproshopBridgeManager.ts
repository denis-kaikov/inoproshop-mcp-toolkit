import { spawn } from "child_process";
import {
  appendFile,
  mkdir,
  readFile,
  stat,
  unlink,
} from "fs/promises";
import { join, resolve } from "path";
import { runInoProShopCommand } from "./inoproshopRunner";

export type BridgeStatus = {
  bridgeDir: string;
  readyPath: string;
  readyExists: boolean;
  active: boolean;
  readyAgeMs: number | null;
  readyModifiedAt: string | null;
  readyText: string | null;
  staleThresholdMs: number;
};

export type BridgeManagerOptions = {
  bridgeDir?: string;
  inoproshopExe?: string;
  profile?: string;
  bridgeScriptPath?: string;
  timeoutMs?: number;
  staleThresholdMs?: number;
};

function defaultBridgeDir(): string {
  return process.env.INOPROSHOP_BRIDGE_DIR || "C:\\Temp\\inoproshop-mcp-bridge";
}

function defaultInoProShopExe(): string {
  return (
    process.env.INOPROSHOP_EXE ||
    "C:\\Inovance Control\\InoProShop\\CODESYS\\Common\\InoProShop.exe"
  );
}

function defaultProfile(): string {
  return process.env.INOPROSHOP_PROFILE || "InoProShop(V1.9.1.6)";
}

function defaultBridgeScriptPath(): string {
  return (
    process.env.INOPROSHOP_BRIDGE_SCRIPT ||
    resolve("scripts/sp11_persistent_bridge.py")
  );
}

function defaultStaleThresholdMs(): number {
  return Number(process.env.INOPROSHOP_BRIDGE_STALE_MS || "10000");
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function ensureBridgeDirs(bridgeDir: string): Promise<void> {
  await mkdir(bridgeDir, { recursive: true });
  await mkdir(join(bridgeDir, "requests"), { recursive: true });
  await mkdir(join(bridgeDir, "results"), { recursive: true });
  await mkdir(join(bridgeDir, "processing"), { recursive: true });
  await mkdir(join(bridgeDir, "archive"), { recursive: true });
}

async function appendManagerLog(text: string): Promise<void> {
  const logDir = "C:\\Temp\\inoproshop-mcp-logs";
  await mkdir(logDir, { recursive: true });
  await appendFile(
    join(logDir, "bridge-manager.log"),
    "[" + new Date().toISOString() + "] " + text + "\n",
    "utf8"
  );
}

async function deleteFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore
  }
}

export async function getBridgeStatus(
  options: BridgeManagerOptions = {}
): Promise<BridgeStatus> {
  const bridgeDir = options.bridgeDir || defaultBridgeDir();
  const staleThresholdMs = options.staleThresholdMs || defaultStaleThresholdMs();
  const readyPath = join(bridgeDir, "bridge.ready");

  try {
    const info = await stat(readyPath);
    const readyAgeMs = Date.now() - info.mtimeMs;

    let readyText: string | null = null;

    try {
      readyText = await readFile(readyPath, "utf8");
    } catch {
      readyText = null;
    }

    return {
      bridgeDir,
      readyPath,
      readyExists: true,
      active: readyAgeMs <= staleThresholdMs,
      readyAgeMs,
      readyModifiedAt: info.mtime.toISOString(),
      readyText,
      staleThresholdMs,
    };
  } catch {
    return {
      bridgeDir,
      readyPath,
      readyExists: false,
      active: false,
      readyAgeMs: null,
      readyModifiedAt: null,
      readyText: null,
      staleThresholdMs,
    };
  }
}

export async function waitForBridgeActive(
  timeoutMs: number,
  options: BridgeManagerOptions = {}
): Promise<BridgeStatus> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getBridgeStatus(options);

    if (status.active) {
      return status;
    }

    await sleep(500);
  }

  return await getBridgeStatus(options);
}

function spawnInoProShopDetached(
  inoproshopExe: string,
  profile: string,
  scriptPath: string
): number | undefined {
  const args = ["--profile=" + profile, "--runscript=" + scriptPath];

  const child = spawn(inoproshopExe, args, {
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });

  child.unref();

  return child.pid;
}

export async function startBridge(
  options: BridgeManagerOptions = {}
): Promise<unknown> {
  const bridgeDir = options.bridgeDir || defaultBridgeDir();
  const inoproshopExe = options.inoproshopExe || defaultInoProShopExe();
  const profile = options.profile || defaultProfile();
  const bridgeScriptPath = options.bridgeScriptPath || defaultBridgeScriptPath();
  const timeoutMs = options.timeoutMs || 30000;

  await ensureBridgeDirs(bridgeDir);

  const before = await getBridgeStatus(options);

  if (before.active) {
    return {
      ok: true,
      started: false,
      reason: "Bridge is already active.",
      status: before,
    };
  }

  const exeExists = await fileExists(inoproshopExe);
  const scriptExists = await fileExists(bridgeScriptPath);

  await appendManagerLog("startBridge exe=" + inoproshopExe);
  await appendManagerLog("startBridge exeExists=" + String(exeExists));
  await appendManagerLog("startBridge profile=" + profile);
  await appendManagerLog("startBridge script=" + bridgeScriptPath);
  await appendManagerLog("startBridge scriptExists=" + String(scriptExists));

  if (!exeExists) {
    return {
      ok: false,
      started: false,
      error: "InoProShop exe not found: " + inoproshopExe,
      status: before,
    };
  }

  if (!scriptExists) {
    return {
      ok: false,
      started: false,
      error: "Bridge script not found: " + bridgeScriptPath,
      status: before,
    };
  }

  await deleteFileIfExists(before.readyPath);

  const pid = spawnInoProShopDetached(inoproshopExe, profile, bridgeScriptPath);

  await appendManagerLog("startBridge spawned pid=" + String(pid));

  const after = await waitForBridgeActive(timeoutMs, options);

  await appendManagerLog("startBridge active=" + String(after.active));
  await appendManagerLog("startBridge readyAgeMs=" + String(after.readyAgeMs));

  return {
    ok: after.active,
    started: after.active,
    pid,
    exe: inoproshopExe,
    exeExists,
    profile,
    bridgeScriptPath,
    bridgeScriptExists: scriptExists,
    status: after,
    hint: after.active
      ? "Bridge is active."
      : "InoProShop opened but bridge.ready was not updated. Check C:\\Temp\\inoproshop-mcp-bridge\\bridge.log.",
  };
}

export async function stopBridge(
  options: BridgeManagerOptions = {}
): Promise<unknown> {
  const bridgeDir = options.bridgeDir || defaultBridgeDir();
  const timeoutMs = options.timeoutMs || 15000;

  const before = await getBridgeStatus(options);

  if (!before.active) {
    return {
      ok: true,
      stopped: false,
      reason: "Bridge is not active.",
      status: before,
    };
  }

  await appendManagerLog("stopBridge request");

  const stopResult = await runInoProShopCommand(
    {
      action: "stop_bridge",
    },
    {
      bridgeDir,
      timeoutMs,
    }
  );

  await deleteFileIfExists(before.readyPath);

  const after = await getBridgeStatus(options);

  return {
    ok: true,
    stopped: true,
    stopResult,
    status_before: before,
    status_after: after,
  };
}
