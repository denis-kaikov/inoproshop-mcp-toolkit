import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runInoProShopCommand, type PatchOperation } from "./inoproshopRunner";
import {
  getBridgeStatus,
  startBridge,
  stopBridge,
} from "./inoproshopBridgeManager";
import {
  buildProjectPathFromFolder,
  clearActiveProject,
  getActiveProject,
  listProjects,
  resolveEffectiveProjectPath,
  setActiveProject,
  setActiveProjectFromCreatedPath,
} from "./inoproshopProjectManager";

const DEFAULT_TIMEOUT_MS = Number(
  process.env.CODESYS_TIMEOUT_MS || process.env.INOPROSHOP_TIMEOUT_MS || "180000"
);
const DEFAULT_BRIDGE_DIR =
  process.env.INOPROSHOP_BRIDGE_DIR || "C:\\Temp\\inoproshop-mcp-bridge";

const server = new Server(
  {
    name: "inoproshop-sp11-mcp",
    version: "0.7.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function getStringArg(args: any, name: string, fallback?: string): string {
  const value = args && args[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error("Missing required string argument: " + name);
}

function getOptionalStringArg(args: any, name: string): string | undefined {
  const value = args && args[name];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function getOptionalNumberArg(args: any, name: string): number | undefined {
  const value = args && args[name];
  if (typeof value === "number") {
    return value;
  }
  return undefined;
}

function getBooleanArg(args: any, name: string, fallback: boolean): boolean {
  const value = args && args[name];
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function commonOptions(timeoutMs?: number) {
  return {
    bridgeDir: DEFAULT_BRIDGE_DIR,
    timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

async function requireBridgeActive() {
  const status = await getBridgeStatus({ bridgeDir: DEFAULT_BRIDGE_DIR });
  if (!status.active) {
    throw new Error(
      [
        "InoProShop bridge is not active.",
        "Call inoproshop_bridge with action=start first.",
        JSON.stringify(status, null, 2),
      ].join("\n")
    );
  }
  return status;
}

const bridgeActionEnum = ["status", "start", "stop"];
const projectActionEnum = ["status", "list", "set", "clear", "open", "create", "close", "info", "save", "diagnose"];
const readModeEnum = ["programs", "object", "find", "info", "tree"];
const editModeEnum = ["write", "patch", "rename", "delete"];
const editTargetEnum = ["declaration", "implementation"];
const patchOperationEnum = ["append", "prepend", "replace_exact", "insert_before", "insert_after", "replace_between_markers"];
const createKindEnum = ["pou", "gvl", "method", "property", "action", "transition", "dut", "interface", "folder"];
const pouTypeEnum = ["program", "function_block", "function"];
const dutTypeEnum = ["structure", "enum", "union", "alias"];
const compileActionEnum = ["build", "errors", "messages"];

function allowed(values: readonly string[]) {
  return "Allowed: " + values.join(", ") + ".";
}

async function projectPath(args: any): Promise<string> {
  return await resolveEffectiveProjectPath(args, DEFAULT_BRIDGE_DIR);
}

function saveBuildOptions(args: any) {
  return {
    save_after: getBooleanArg(args, "save_after", true),
    build_after: getBooleanArg(args, "build_after", false),
  };
}

function writeOptions(args: any) {
  return {
    ...saveBuildOptions(args),
    backup_before_write: getBooleanArg(
      args,
      "backup_before",
      getBooleanArg(args, "backup_before_write", true)
    ),
  };
}

function createOptions(args: any) {
  return {
    ...saveBuildOptions(args),
    backup_before_create: getBooleanArg(
      args,
      "backup_before",
      getBooleanArg(args, "backup_before_create", true)
    ),
  };
}

function extractCompileMessages(bridgeResult: any) {
  const build = bridgeResult && bridgeResult.build ? bridgeResult.build : undefined;
  const messages =
    build && build.messages
      ? build.messages
      : bridgeResult && bridgeResult.messages
        ? bridgeResult.messages
        : {};
  const errors = messages && Array.isArray(messages.errors) ? messages.errors : [];
  const warnings = messages && Array.isArray(messages.warnings) ? messages.warnings : [];
  return {
    compile_error_count:
      typeof messages.error_count === "number"
        ? messages.error_count
        : typeof build?.compile_error_count === "number"
          ? build.compile_error_count
          : errors.length,
    compile_warning_count:
      typeof messages.warning_count === "number"
        ? messages.warning_count
        : typeof build?.compile_warning_count === "number"
          ? build.compile_warning_count
          : warnings.length,
    compile_errors: errors,
    compile_warnings: warnings,
    all_messages_count: typeof messages.count === "number" ? messages.count : undefined,
    message_diagnostics: messages ? messages.diagnostics : undefined,
  };
}

const commonProjectField = {
  type: "string",
  description: ".project path; optional after set/open.",
};

server.setRequestHandler(ListToolsRequestSchema, async function () {
  return {
    tools: [
      {
        name: "inoproshop_bridge",
        description: "Bridge: status, start, stop.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: bridgeActionEnum, default: "status", description: allowed(bridgeActionEnum) },
            timeout_ms: { type: "number", description: "Start/stop timeout." },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_project",
        description: "Project: list, set, open, info, save.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: projectActionEnum,
              default: "status",
              description: allowed(projectActionEnum),
            },
            project_path: commonProjectField,
            project_folder: { type: "string", description: "Folder with one project." },
            project_file_name: { type: "string", default: "PLC.project", description: "For action=create." },
            name: { type: "string", description: "Saved active-project label." },
            overwrite: { type: "boolean", default: false, description: "For action=create." },
            save_before_close: { type: "boolean", default: false, description: "For action=close." },
            root: { type: "string", description: "For action=list." },
            recursive: { type: "boolean", default: true, description: "For action=list." },
            max_depth: { type: "number", default: 4, description: "For action=list." },
            max_results: { type: "number", default: 100, description: "For action=list." },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_read",
        description: "Read: programs, object, find, info, tree.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: readModeEnum, default: "programs", description: allowed(readModeEnum) },
            project_path: commonProjectField,
            object_name: { type: "string", description: "Target object name." },
            object_index: { type: "number", description: "Index if names repeat." },
            include_text: { type: "boolean", default: true, description: "Full ST text." },
            max_depth: { type: "number", default: 1, description: "For mode=tree." },
            max_nodes: { type: "number", default: 300, description: "Scan node limit." },
            include_capabilities: { type: "boolean", default: false, description: "For mode=tree." },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_edit",
        description: "Edit object text, rename, delete.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: editModeEnum, description: allowed(editModeEnum) },
            target: { type: "string", enum: editTargetEnum, default: "implementation", description: allowed(editTargetEnum) },
            project_path: commonProjectField,
            object_name: { type: "string", description: "Target object name." },
            object_index: { type: "number", description: "Index if names repeat." },
            new_name: { type: "string", description: "For mode=rename." },
            text: { type: "string", description: "Text to write/insert." },
            operation: { type: "string", enum: patchOperationEnum, description: allowed(patchOperationEnum) },
            search_text: { type: "string", description: "For replace_exact." },
            replace_text: { type: "string", description: "For replace_exact." },
            replace_all: { type: "boolean", default: false, description: "For replace_exact." },
            anchor: { type: "string", description: "For insert_before/after." },
            start_marker: { type: "string", description: "For replace_between_markers." },
            end_marker: { type: "string", description: "For replace_between_markers." },
            create_if_missing: { type: "boolean", default: false, description: "For replace_between_markers." },
            save_after: { type: "boolean", default: true, description: "Default: true." },
            build_after: { type: "boolean", default: false, description: "Default: false." },
            backup_before: { type: "boolean", default: true, description: "Default: true." },
          },
          required: ["mode", "object_name"],
        },
      },
      {
        name: "inoproshop_create",
        description: "Create POU, GVL, member, DUT, folder.",
        inputSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: createKindEnum,
              description: allowed(createKindEnum),
            },
            project_path: commonProjectField,
            parent_name: { type: "string", default: "Application", description: "Parent/container name." },
            parent_index: { type: "number", description: "Index if parent repeats." },
            name: { type: "string", description: "Object to create." },
            pou_type: { type: "string", enum: pouTypeEnum, default: "function_block", description: allowed(pouTypeEnum) },
            dut_type: { type: "string", enum: dutTypeEnum, default: "structure", description: allowed(dutTypeEnum) },
            return_type: { type: "string", description: "For function/method." },
            property_type: { type: "string", default: "BOOL", description: "For kind=property." },
            base_type: { type: "string", description: "For dut_type=alias." },
            declaration: { type: "string", description: "ST declaration." },
            implementation: { type: "string", description: "ST implementation." },
            save_after: { type: "boolean", default: true, description: "Default: true." },
            build_after: { type: "boolean", default: false, description: "Default: false." },
            backup_before: { type: "boolean", default: true, description: "Default: true." },
          },
          required: ["kind", "name"],
        },
      },
      {
        name: "inoproshop_compile",
        description: "Build and read errors/warnings.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: compileActionEnum, default: "errors", description: allowed(compileActionEnum) },
            project_path: commonProjectField,
            include_messages: { type: "boolean", default: true, description: "For action=build." },
            build_first: { type: "boolean", default: true, description: "For action=errors." },
            clear_messages_before_build: { type: "boolean", default: true, description: "Before build." },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async function (request) {
  const toolName = request.params.name;
  const args = (request.params.arguments || {}) as any;

  if (toolName === "inoproshop_bridge") {
    const action = getStringArg(args, "action", "status");
    if (action === "status") {
      const result = await getBridgeStatus({ bridgeDir: DEFAULT_BRIDGE_DIR });
      return jsonText({ ok: true, action: "bridge_status", status: result });
    }
    if (action === "start") {
      return jsonText(
        await startBridge({
          bridgeDir: DEFAULT_BRIDGE_DIR,
          timeoutMs: getOptionalNumberArg(args, "timeout_ms") || 30000,
        })
      );
    }
    if (action === "stop") {
      return jsonText(
        await stopBridge({
          bridgeDir: DEFAULT_BRIDGE_DIR,
          timeoutMs: getOptionalNumberArg(args, "timeout_ms") || 15000,
        })
      );
    }
    throw new Error("Unknown bridge action: " + action);
  }

  if (toolName === "inoproshop_project") {
    const action = getStringArg(args, "action", "status");

    if (action === "status") {
      return jsonText({
        ok: true,
        action: "project_status",
        active_project: await getActiveProject(DEFAULT_BRIDGE_DIR),
        env_project: process.env.INOPROSHOP_PROJECT || null,
        bridge_dir: DEFAULT_BRIDGE_DIR,
      });
    }

    if (action === "set") {
      const activeProject = await setActiveProject(
        {
          project_path: getOptionalStringArg(args, "project_path"),
          project_folder: getOptionalStringArg(args, "project_folder"),
          name: getOptionalStringArg(args, "name"),
        },
        DEFAULT_BRIDGE_DIR
      );
      return jsonText({ ok: true, action: "set_project", active_project: activeProject });
    }

    if (action === "clear") {
      return jsonText(await clearActiveProject(DEFAULT_BRIDGE_DIR));
    }

    if (action === "list") {
      const root = getOptionalStringArg(args, "root") || process.env.USERPROFILE + "\\Desktop";
      const projects = await listProjects(
        root,
        getBooleanArg(args, "recursive", true),
        getOptionalNumberArg(args, "max_depth") || 4,
        getOptionalNumberArg(args, "max_results") || 100
      );
      return jsonText({ ok: true, action: "list_projects", root, count: projects.length, projects });
    }

    await requireBridgeActive();

    if (action === "open") {
      const activeProject = await setActiveProject(
        {
          project_path: getOptionalStringArg(args, "project_path"),
          project_folder: getOptionalStringArg(args, "project_folder"),
          name: getOptionalStringArg(args, "name"),
        },
        DEFAULT_BRIDGE_DIR
      );
      const result = await runInoProShopCommand(
        { action: "open_project", project_path: activeProject.project_path },
        commonOptions()
      );
      return jsonText({ ok: true, action: "open_project", active_project: activeProject, result });
    }

    if (action === "create") {
      const explicitPath = getOptionalStringArg(args, "project_path");
      const projectFolder = getOptionalStringArg(args, "project_folder");
      const newProjectPath =
        explicitPath ||
        (projectFolder
          ? buildProjectPathFromFolder(projectFolder, getOptionalStringArg(args, "project_file_name"))
          : undefined);
      if (!newProjectPath) {
        throw new Error("Either project_path or project_folder is required.");
      }
      const result = await runInoProShopCommand(
        {
          action: "create_project",
          project_path: newProjectPath,
          overwrite: getBooleanArg(args, "overwrite", false),
        },
        commonOptions()
      );
      const activeProject = await setActiveProjectFromCreatedPath(
        newProjectPath,
        getOptionalStringArg(args, "name"),
        DEFAULT_BRIDGE_DIR
      );
      return jsonText({ ok: true, action: "create_project", active_project: activeProject, result });
    }

    if (action === "close") {
      const effectiveProjectPath = await projectPath(args);
      const result = await runInoProShopCommand(
        {
          action: "close_project",
          project_path: effectiveProjectPath,
          save_before_close: getBooleanArg(args, "save_before_close", false),
        },
        commonOptions()
      );
      const active = await getActiveProject(DEFAULT_BRIDGE_DIR);
      let cleared = false;
      if (active && active.project_path.toLowerCase() === effectiveProjectPath.toLowerCase()) {
        await clearActiveProject(DEFAULT_BRIDGE_DIR);
        cleared = true;
      }
      return jsonText({ ok: true, action: "close_project", cleared_active_project: cleared, result });
    }

    if (action === "info") {
      return jsonText(
        await runInoProShopCommand(
          { action: "get_project_info", project_path: await projectPath(args) },
          commonOptions()
        )
      );
    }

    if (action === "save") {
      return jsonText(
        await runInoProShopCommand(
          { action: "save_project", project_path: await projectPath(args) },
          commonOptions()
        )
      );
    }

    if (action === "diagnose") {
      return jsonText(await runInoProShopCommand({ action: "diagnose_system" }, commonOptions()));
    }

    throw new Error("Unknown project action: " + action);
  }

  await requireBridgeActive();

  if (toolName === "inoproshop_read") {
    const mode = getStringArg(args, "mode", "programs");

    if (mode === "programs") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "read_current_programs",
            project_path: await projectPath(args),
            include_text: getBooleanArg(args, "include_text", true),
            max_nodes: getOptionalNumberArg(args, "max_nodes") || 300,
          },
          commonOptions()
        )
      );
    }

    if (mode === "object") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "read_object",
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
            object_index: getOptionalNumberArg(args, "object_index"),
            include_text: getBooleanArg(args, "include_text", true),
          },
          commonOptions()
        )
      );
    }

    if (mode === "find") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "find_object",
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
          },
          commonOptions()
        )
      );
    }

    if (mode === "info") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "get_object_info",
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
            object_index: getOptionalNumberArg(args, "object_index"),
          },
          commonOptions()
        )
      );
    }

    if (mode === "tree") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "get_project_tree",
            project_path: await projectPath(args),
            max_depth: getOptionalNumberArg(args, "max_depth") || 1,
            max_nodes: getOptionalNumberArg(args, "max_nodes") || 50,
            include_capabilities: getBooleanArg(args, "include_capabilities", false),
          },
          commonOptions()
        )
      );
    }

    throw new Error("Unknown read mode: " + mode);
  }

  if (toolName === "inoproshop_edit") {
    const mode = getStringArg(args, "mode");

    if (mode === "write" || mode === "patch") {
      const target = getStringArg(args, "target", "implementation");
      if (target !== "declaration" && target !== "implementation") {
        throw new Error("target must be declaration or implementation.");
      }
      const action =
        mode === "write"
          ? target === "declaration"
            ? "write_declaration"
            : "write_implementation"
          : target === "declaration"
            ? "patch_declaration"
            : "patch_implementation";

      if (mode === "write") {
        return jsonText(
          await runInoProShopCommand(
            {
              action,
              project_path: await projectPath(args),
              object_name: getStringArg(args, "object_name"),
              object_index: getOptionalNumberArg(args, "object_index"),
              text: getStringArg(args, "text"),
              ...writeOptions(args),
            } as any,
            commonOptions()
          )
        );
      }

      return jsonText(
        await runInoProShopCommand(
          {
            action,
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
            object_index: getOptionalNumberArg(args, "object_index"),
            operation: getStringArg(args, "operation") as PatchOperation,
            text: getOptionalStringArg(args, "text"),
            search_text: getOptionalStringArg(args, "search_text"),
            replace_text: getOptionalStringArg(args, "replace_text"),
            replace_all: getBooleanArg(args, "replace_all", false),
            anchor: getOptionalStringArg(args, "anchor"),
            start_marker: getOptionalStringArg(args, "start_marker"),
            end_marker: getOptionalStringArg(args, "end_marker"),
            create_if_missing: getBooleanArg(args, "create_if_missing", false),
            ...writeOptions(args),
          } as any,
          commonOptions()
        )
      );
    }

    if (mode === "rename") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "rename_object",
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
            object_index: getOptionalNumberArg(args, "object_index"),
            new_name: getStringArg(args, "new_name"),
            save_after: getBooleanArg(args, "save_after", true),
            backup_before_rename: getBooleanArg(args, "backup_before", true),
          },
          commonOptions()
        )
      );
    }

    if (mode === "delete") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "delete_object",
            project_path: await projectPath(args),
            object_name: getStringArg(args, "object_name"),
            object_index: getOptionalNumberArg(args, "object_index"),
            save_after: getBooleanArg(args, "save_after", true),
            backup_before_delete: getBooleanArg(args, "backup_before", true),
          },
          commonOptions()
        )
      );
    }

    throw new Error("Unknown edit mode: " + mode);
  }

  if (toolName === "inoproshop_create") {
    const kind = getStringArg(args, "kind");

    if (kind === "pou") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "create_pou",
            project_path: await projectPath(args),
            parent_name: getOptionalStringArg(args, "parent_name"),
            name: getStringArg(args, "name"),
            pou_type: getStringArg(args, "pou_type", "function_block") as "program" | "function_block" | "function",
            return_type: getOptionalStringArg(args, "return_type"),
            declaration: getOptionalStringArg(args, "declaration"),
            implementation: getOptionalStringArg(args, "implementation"),
            ...createOptions(args),
          },
          commonOptions()
        )
      );
    }

    if (kind === "gvl") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "create_gvl",
            project_path: await projectPath(args),
            parent_name: getOptionalStringArg(args, "parent_name"),
            name: getStringArg(args, "name"),
            declaration: getOptionalStringArg(args, "declaration"),
            ...createOptions(args),
          },
          commonOptions()
        )
      );
    }

    if (kind === "method" || kind === "property" || kind === "action" || kind === "transition") {
      const actionMap: Record<string, string> = {
        method: "create_method",
        property: "create_property",
        action: "create_action",
        transition: "create_transition",
      };
      return jsonText(
        await runInoProShopCommand(
          {
            action: actionMap[kind],
            project_path: await projectPath(args),
            parent_name: getStringArg(args, "parent_name"),
            parent_index: getOptionalNumberArg(args, "parent_index"),
            name: getStringArg(args, "name"),
            return_type: getOptionalStringArg(args, "return_type"),
            property_type: getOptionalStringArg(args, "property_type"),
            declaration: getOptionalStringArg(args, "declaration"),
            implementation: getOptionalStringArg(args, "implementation"),
            ...createOptions(args),
          } as any,
          commonOptions()
        )
      );
    }

    if (kind === "dut") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "create_dut",
            project_path: await projectPath(args),
            parent_name: getOptionalStringArg(args, "parent_name"),
            name: getStringArg(args, "name"),
            dut_type: getOptionalStringArg(args, "dut_type") as any,
            base_type: getOptionalStringArg(args, "base_type"),
            declaration: getOptionalStringArg(args, "declaration"),
            ...createOptions(args),
          } as any,
          commonOptions()
        )
      );
    }

    if (kind === "interface") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "create_interface",
            project_path: await projectPath(args),
            parent_name: getOptionalStringArg(args, "parent_name"),
            name: getStringArg(args, "name"),
            declaration: getOptionalStringArg(args, "declaration"),
            ...createOptions(args),
          },
          commonOptions()
        )
      );
    }

    if (kind === "folder") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "create_folder",
            project_path: await projectPath(args),
            parent_name: getOptionalStringArg(args, "parent_name"),
            name: getStringArg(args, "name"),
            save_after: getBooleanArg(args, "save_after", true),
            backup_before_create: getBooleanArg(args, "backup_before", true),
          },
          commonOptions()
        )
      );
    }

    throw new Error("Unknown create kind: " + kind);
  }

  if (toolName === "inoproshop_compile") {
    const action = getStringArg(args, "action", "errors");

    if (action === "build") {
      return jsonText(
        await runInoProShopCommand(
          {
            action: "build_project",
            project_path: await projectPath(args),
            include_messages: getBooleanArg(args, "include_messages", true),
            clear_messages_before_build: getBooleanArg(args, "clear_messages_before_build", true),
          },
          commonOptions()
        )
      );
    }

    if (action === "messages") {
      return jsonText(
        await runInoProShopCommand(
          { action: "get_messages", project_path: await projectPath(args) },
          commonOptions()
        )
      );
    }

    if (action === "errors") {
      const effectiveProjectPath = await projectPath(args);
      const buildFirst = getBooleanArg(args, "build_first", true);
      const bridgeResult = buildFirst
        ? await runInoProShopCommand(
            {
              action: "build_project",
              project_path: effectiveProjectPath,
              include_messages: true,
              clear_messages_before_build: getBooleanArg(args, "clear_messages_before_build", true),
            },
            commonOptions()
          )
        : await runInoProShopCommand(
            {
              action: "get_messages",
              project_path: effectiveProjectPath,
            },
            commonOptions()
          );
      return jsonText({
        ok: true,
        action: "compile_errors",
        project_path: effectiveProjectPath,
        build_first: buildFirst,
        ...extractCompileMessages(bridgeResult),
      });
    }

    throw new Error("Unknown compile action: " + action);
  }

  throw new Error("Unknown tool: " + toolName);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
