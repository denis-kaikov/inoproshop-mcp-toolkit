import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";

export type PatchOperation =
  | "append"
  | "prepend"
  | "replace_exact"
  | "insert_before"
  | "insert_after"
  | "replace_between_markers";

export type InoProShopCommand =
  | { action: "diagnose_system" }
  | { action: "open_project"; project_path: string }
  | { action: "create_project"; project_path: string; overwrite?: boolean }
  | { action: "close_project"; project_path: string; save_before_close?: boolean }
  | { action: "get_project_info"; project_path: string }
  | { action: "find_object"; project_path: string; object_name: string }
  | {
      action: "get_object_info";
      project_path: string;
      object_name: string;
      object_index?: number;
    }
  | {
      action: "read_object";
      project_path: string;
      object_name: string;
      include_text?: boolean;
      object_index?: number;
    }
  | {
      action: "read_current_programs";
      project_path: string;
      include_text?: boolean;
      max_nodes?: number;
    }
  | {
      action: "write_declaration";
      project_path: string;
      object_name: string;
      text: string;
      object_index?: number;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_write?: boolean;
    }
  | {
      action: "write_implementation";
      project_path: string;
      object_name: string;
      text: string;
      object_index?: number;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_write?: boolean;
    }
  | {
      action: "patch_declaration";
      project_path: string;
      object_name: string;
      object_index?: number;
      operation: PatchOperation;
      text?: string;
      search_text?: string;
      replace_text?: string;
      replace_all?: boolean;
      anchor?: string;
      start_marker?: string;
      end_marker?: string;
      create_if_missing?: boolean;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_write?: boolean;
    }
  | {
      action: "patch_implementation";
      project_path: string;
      object_name: string;
      object_index?: number;
      operation: PatchOperation;
      text?: string;
      search_text?: string;
      replace_text?: string;
      replace_all?: boolean;
      anchor?: string;
      start_marker?: string;
      end_marker?: string;
      create_if_missing?: boolean;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_write?: boolean;
    }
  | {
      action: "create_pou";
      project_path: string;
      parent_name?: string;
      name: string;
      pou_type: "program" | "function_block" | "function";
      return_type?: string;
      declaration?: string;
      implementation?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_gvl";
      project_path: string;
      parent_name?: string;
      name: string;
      declaration?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_method";
      project_path: string;
      parent_name: string;
      parent_index?: number;
      name: string;
      return_type?: string;
      declaration?: string;
      implementation?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_property";
      project_path: string;
      parent_name: string;
      parent_index?: number;
      name: string;
      property_type?: string;
      declaration?: string;
      implementation?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_action";
      project_path: string;
      parent_name: string;
      parent_index?: number;
      name: string;
      declaration?: string;
      implementation?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_transition";
      project_path: string;
      parent_name: string;
      parent_index?: number;
      name: string;
      declaration?: string;
      implementation?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_dut";
      project_path: string;
      parent_name?: string;
      name: string;
      dut_type?: "structure" | "enum" | "union" | "alias";
      base_type?: string;
      declaration?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_interface";
      project_path: string;
      parent_name?: string;
      name: string;
      declaration?: string;
      save_after?: boolean;
      build_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "create_folder";
      project_path: string;
      parent_name?: string;
      name: string;
      save_after?: boolean;
      backup_before_create?: boolean;
    }
  | {
      action: "rename_object";
      project_path: string;
      object_name: string;
      object_index?: number;
      new_name: string;
      save_after?: boolean;
      backup_before_rename?: boolean;
    }
  | {
      action: "delete_object";
      project_path: string;
      object_name: string;
      object_index?: number;
      save_after?: boolean;
      backup_before_delete?: boolean;
    }
  | { action: "save_project"; project_path: string }
  | {
      action: "build_project";
      project_path: string;
      include_messages?: boolean;
      clear_messages_before_build?: boolean;
    }
  | { action: "get_messages"; project_path: string }
  | {
      action: "get_project_tree";
      project_path: string;
      max_depth?: number;
      max_nodes?: number;
      include_capabilities?: boolean;
    }
  | { action: "stop_bridge" };

export type InoProShopRunnerOptions = {
  timeoutMs?: number;
  bridgeDir?: string;
};

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function appendLog(logPath: string, text: string): Promise<void> {
  await appendFile(logPath, text + "\n", "utf8");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function waitForResult(
  resultPath: string,
  timeoutMs: number,
  processLogPath: string
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fileExists(resultPath)) {
      await appendLog(processLogPath, "result file detected: " + resultPath);
      return await readFile(resultPath, "utf8");
    }
    await sleep(250);
  }

  throw new Error(
    "Bridge timeout after " + timeoutMs + " ms waiting for " + resultPath
  );
}

export async function runInoProShopCommand(
  command: InoProShopCommand,
  options: InoProShopRunnerOptions
): Promise<any> {
  const timeoutMs = options.timeoutMs || 180000;
  const bridgeDir =
    options.bridgeDir ||
    process.env.INOPROSHOP_BRIDGE_DIR ||
    "C:\\Temp\\inoproshop-mcp-bridge";

  const requestsDir = join(bridgeDir, "requests");
  const resultsDir = join(bridgeDir, "results");
  const logRoot = "C:\\Temp\\inoproshop-mcp-logs";
  const action = sanitizeForPath((command as any).action || "unknown");
  const logDir = join(logRoot, timestampForPath() + "-" + action);
  const processLogPath = join(logDir, "process.log");

  await ensureDir(requestsDir);
  await ensureDir(resultsDir);
  await ensureDir(logDir);

  const commandId = timestampForPath() + "-" + randomUUID();
  const requestTmpPath = join(requestsDir, commandId + ".tmp");
  const requestPath = join(requestsDir, commandId + ".json");
  const resultPath = join(resultsDir, commandId + ".json");

  const commandWithId = {
    ...(command as any),
    command_id: commandId,
  };

  try {
    await appendLog(processLogPath, "=== InoProShop MCP bridge request START ===");
    await appendLog(processLogPath, "bridgeDir: " + bridgeDir);
    await appendLog(processLogPath, "commandId: " + commandId);
    await appendLog(processLogPath, "timeoutMs: " + String(timeoutMs));
    await appendLog(
      processLogPath,
      "command: " + JSON.stringify(commandWithId, null, 2)
    );

    await writeFile(
      requestTmpPath,
      JSON.stringify(commandWithId, null, 2),
      "utf8"
    );
    await rename(requestTmpPath, requestPath);
    await appendLog(processLogPath, "request written: " + requestPath);
    await appendLog(processLogPath, "waiting result: " + resultPath);

    const resultRaw = await waitForResult(resultPath, timeoutMs, processLogPath);
    await writeFile(
      join(logDir, "command.json"),
      JSON.stringify(commandWithId, null, 2),
      "utf8"
    );
    await writeFile(join(logDir, "result.json"), resultRaw, "utf8");

    const result = JSON.parse(resultRaw);
    await appendLog(processLogPath, "result OK");
    await appendLog(processLogPath, "=== InoProShop MCP bridge request END OK ===");
    return result;
  } catch (err) {
    await appendLog(processLogPath, "=== InoProShop MCP bridge request END ERROR ===");
    await appendLog(processLogPath, String(err));
    throw err;
  }
}
