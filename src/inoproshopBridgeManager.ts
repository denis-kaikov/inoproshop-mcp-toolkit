import { spawn } from "child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
} from "fs/promises";
import { basename, join, resolve } from "path";
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
  restart?: boolean;
  killExisting?: boolean;
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

function defaultRepoRoot(): string {
  return process.env.INOPROSHOP_REPO_ROOT || resolve(__dirname, "..");
}

function defaultBridgeScriptPath(): string {
  return (
    process.env.INOPROSHOP_BRIDGE_SCRIPT ||
    join(defaultRepoRoot(), "scripts", "sp11_persistent_bridge.py")
  );
}

function defaultStaleThresholdMs(): number {
  return Number(process.env.INOPROSHOP_BRIDGE_STALE_MS || "10000");
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolveFn) {
    setTimeout(resolveFn, ms);
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

async function deleteQueueFiles(dir: string): Promise<number> {
  let deleted = 0;
  try {
    const names = await readdir(dir);
    for (const name of names) {
      if (!name.endsWith(".json") && !name.endsWith(".tmp")) {
        continue;
      }
      try {
        await unlink(join(dir, name));
        deleted += 1;
      } catch {
        // ignore one bad file
      }
    }
  } catch {
    // ignore missing dir
  }
  return deleted;
}

async function cleanBridgeQueue(bridgeDir: string): Promise<{ requests: number; processing: number }> {
  return {
    requests: await deleteQueueFiles(join(bridgeDir, "requests")),
    processing: await deleteQueueFiles(join(bridgeDir, "processing")),
  };
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise(function (resolveFn) {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const child = spawn(command, args, { windowsHide: true });
    const timer = setTimeout(function () {
      if (!finished) {
        finished = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolveFn({ ok: false, exitCode: null, stdout, stderr: stderr + "\ntimeout" });
      }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", function (data) {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", function (data) {
        stderr += data.toString();
      });
    }
    child.on("error", function (err) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolveFn({ ok: false, exitCode: null, stdout, stderr: String(err) });
      }
    });
    child.on("close", function (code) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolveFn({ ok: code === 0, exitCode: code, stdout, stderr });
      }
    });
  });
}

async function killInoProShopWindows(inoproshopExe: string): Promise<any> {
  const imageName = basename(inoproshopExe || "InoProShop.exe") || "InoProShop.exe";
  await appendManagerLog("kill existing InoProShop windows image=" + imageName);
  const result = await runProcess("taskkill", ["/IM", imageName, "/T", "/F"], 15000);
  await appendManagerLog(
    "taskkill exitCode=" + String(result.exitCode) +
      " stdout=" + result.stdout.replace(/\s+/g, " ").slice(0, 500) +
      " stderr=" + result.stderr.replace(/\s+/g, " ").slice(0, 500)
  );
  return {
    image: imageName,
    ok: true,
    taskkill_ok: result.ok,
    exit_code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    note: result.ok ? "Old InoProShop windows closed." : "No old window found, or taskkill returned a non-zero code.",
  };
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
): Promise<any> {
  const bridgeDir = options.bridgeDir || defaultBridgeDir();
  const inoproshopExe = options.inoproshopExe || defaultInoProShopExe();
  const profile = options.profile || defaultProfile();
  const bridgeScriptPath = options.bridgeScriptPath || defaultBridgeScriptPath();
  const timeoutMs = options.timeoutMs || 30000;
  const restart = options.restart === true;
  const killExisting = options.killExisting !== false;

  await ensureBridgeDirs(bridgeDir);
  const before = await getBridgeStatus(options);

  await appendManagerLog("startBridge beforeActive=" + String(before.active));
  await appendManagerLog("startBridge restart=" + String(restart));
  await appendManagerLog("startBridge killExisting=" + String(killExisting));

  if (before.active && !restart) {
    return {
      ok: true,
      started: false,
      reason: "Bridge is already active. New bridge was not started.",
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

  const killed = killExisting ? await killInoProShopWindows(inoproshopExe) : null;
  if (killExisting) {
    await sleep(1500);
  }

  await deleteFileIfExists(before.readyPath);
  const cleaned = await cleanBridgeQueue(bridgeDir);
  await appendManagerLog("cleaned queue requests=" + cleaned.requests + " processing=" + cleaned.processing);

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
    killed_existing: killed,
    cleaned_queue: cleaned,
    status: after,
    hint: after.active
      ? "Bridge is active."
      : "InoProShop opened but bridge.ready was not updated. Check C:\\Temp\\inoproshop-mcp-bridge\\bridge.log.",
  };
}

export async function stopBridge(
  options: BridgeManagerOptions = {}
): Promise<any> {
  const bridgeDir = options.bridgeDir || defaultBridgeDir();
  const timeoutMs = options.timeoutMs || 15000;
  const before = await getBridgeStatus(options);

  await appendManagerLog("stopBridge request active=" + String(before.active));
  await appendManagerLog("stopBridge does not kill InoProShop processes");

  let stopResult: any = null;
  if (before.active) {
    try {
      stopResult = await runInoProShopCommand(
        { action: "stop_bridge" },
        { bridgeDir, timeoutMs }
      );
    } catch (err) {
      stopResult = { ok: false, error: String(err) };
    }
  }

  await deleteFileIfExists(before.readyPath);
  const after = await getBridgeStatus(options);

  return {
    ok: true,
    stopped: true,
    process_kill_used: false,
    note: "Bridge stop requested; InoProShop processes were not killed.",
    stopResult,
    status_before: before,
    status_after: after,
  };
}
