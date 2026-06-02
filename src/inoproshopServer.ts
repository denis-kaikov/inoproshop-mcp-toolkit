import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runInoProShopCommand, PatchOperation } from "./inoproshopRunner";
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

const DEFAULT_PROJECT_PATH =
  process.env.INOPROSHOP_PROJECT ||
  "C:\\Users\\kaykov\\Desktop\\Avanpost\\PLC\\PLC.project";

const DEFAULT_TIMEOUT_MS = Number(
  process.env.CODESYS_TIMEOUT_MS ||
    process.env.INOPROSHOP_TIMEOUT_MS ||
    "180000"
);

const DEFAULT_BRIDGE_DIR =
  process.env.INOPROSHOP_BRIDGE_DIR || "C:\\Temp\\inoproshop-mcp-bridge";

const server = new Server(
  {
    name: "inoproshop-sp11-mcp",
    version: "0.6.0",
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
        "InoProShop persistent bridge is not active.",
        "Call inoproshop_start_bridge first, or manually run C:\\PLC\\start-inoproshop-bridge.cmd.",
        "Bridge status:",
        JSON.stringify(status, null, 2),
      ].join("\n")
    );
  }

  return status;
}

const patchOperationEnum = [
  "append",
  "prepend",
  "replace_exact",
  "insert_before",
  "insert_after",
  "replace_between_markers",
];

async function projectPath(args: any): Promise<string> {
  return await resolveEffectiveProjectPath(args, DEFAULT_BRIDGE_DIR);
}

function writeOptions(args: any) {
  return {
    save_after: getBooleanArg(args, "save_after", true),
    build_after: getBooleanArg(args, "build_after", false),
  };
}

function backupWriteOptions(args: any) {
  return {
    ...writeOptions(args),
    backup_before_write: getBooleanArg(args, "backup_before_write", true),
  };
}

function backupCreateOptions(args: any) {
  return {
    ...writeOptions(args),
    backup_before_create: getBooleanArg(args, "backup_before_create", true),
  };
}

server.setRequestHandler(ListToolsRequestSchema, async function () {
  return {
    tools: [
      {
        name: "inoproshop_bridge_status",
        description: "Check whether the persistent InoProShop MCP bridge is running.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "inoproshop_start_bridge",
        description: "Start one persistent InoProShop window with the MCP bridge script.",
        inputSchema: {
          type: "object",
          properties: {
            timeout_ms: { type: "number", default: 30000 },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_stop_bridge",
        description: "Stop the persistent InoProShop bridge by sending stop_bridge command.",
        inputSchema: {
          type: "object",
          properties: {
            timeout_ms: { type: "number", default: 15000 },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_project_status",
        description: "Return the currently selected active project context stored by the MCP server.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "inoproshop_set_project",
        description: "Set the active project context. Pass either project_path or project_folder.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string", description: "Full path to a .project file." },
            project_folder: { type: "string", description: "Folder containing exactly one .project file." },
            name: { type: "string", description: "Optional human-readable project name." }
          },
          required: [],
        },
      },
      {
        name: "inoproshop_clear_project",
        description: "Clear the stored active project context.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "inoproshop_list_projects",
        description: "Search for .project files under a root folder.",
        inputSchema: {
          type: "object",
          properties: {
            root: { type: "string", description: "Root folder to search. Defaults to current user's Desktop." },
            recursive: { type: "boolean", default: true },
            max_depth: { type: "number", default: 4 },
            max_results: { type: "number", default: 100 }
          },
          required: [],
        },
      },
      {
        name: "inoproshop_open_project",
        description: "Open the selected project in the persistent InoProShop bridge and store it as the active project.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string", description: "Full path to a .project file." },
            project_folder: { type: "string", description: "Folder containing exactly one .project file." },
            name: { type: "string", description: "Optional human-readable project name." }
          },
          required: [],
        },
      },
      {
        name: "inoproshop_create_project",
        description: "Create a new InoProShop/CODESYS project file and store it as the active project. This is best-effort for SP11/OEM APIs.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string", description: "Full target .project path." },
            project_folder: { type: "string", description: "Target folder. Used with project_file_name when project_path is omitted." },
            project_file_name: { type: "string", default: "PLC.project" },
            name: { type: "string", description: "Optional human-readable project name." },
            overwrite: { type: "boolean", default: false }
          },
          required: [],
        },
      },
      {
        name: "inoproshop_close_project",
        description: "Close the active or specified project in the persistent bridge. Clears active project context when closing the active project.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            project_folder: { type: "string" },
            save_before_close: { type: "boolean", default: false }
          },
          required: [],
        },
      },
      {
        name: "inoproshop_diagnose_system",
        description: "Diagnose available CODESYS/InoProShop SP11 scripting globals and system API. Requires bridge.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "inoproshop_get_project_info",
        description: "Open or reuse the InoProShop project and return basic project/application information.",
        inputSchema: {
          type: "object",
          properties: { project_path: { type: "string" } },
          required: [],
        },
      },
      {
        name: "inoproshop_find_object",
        description: "Find InoProShop/CODESYS SP11 objects by exact name using project.find(name, True).",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_get_object_info",
        description: "Return capabilities and metadata for an object by name, without returning full source code.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_read_object",
        description: "Read declaration and/or implementation of an InoProShop/CODESYS SP11 object by name.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            include_text: { type: "boolean", default: true },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_write_declaration",
        description: "Replace textual_declaration of an object. Creates a timestamped backup by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            text: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_write: { type: "boolean", default: true },
          },
          required: ["object_name", "text"],
        },
      },
      {
        name: "inoproshop_write_implementation",
        description: "Replace textual_implementation of an ST object. Creates a timestamped backup by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            text: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_write: { type: "boolean", default: true },
          },
          required: ["object_name", "text"],
        },
      },
      {
        name: "inoproshop_patch_declaration",
        description: "Patch textual_declaration of an object without replacing the whole declaration.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            operation: { type: "string", enum: patchOperationEnum },
            text: { type: "string" },
            search_text: { type: "string" },
            replace_text: { type: "string" },
            replace_all: { type: "boolean", default: false },
            anchor: { type: "string" },
            start_marker: { type: "string" },
            end_marker: { type: "string" },
            create_if_missing: { type: "boolean", default: false },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_write: { type: "boolean", default: true },
          },
          required: ["object_name", "operation"],
        },
      },
      {
        name: "inoproshop_patch_implementation",
        description: "Patch textual_implementation of an ST object without replacing the whole implementation.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            operation: { type: "string", enum: patchOperationEnum },
            text: { type: "string" },
            search_text: { type: "string" },
            replace_text: { type: "string" },
            replace_all: { type: "boolean", default: false },
            anchor: { type: "string" },
            start_marker: { type: "string" },
            end_marker: { type: "string" },
            create_if_missing: { type: "boolean", default: false },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_write: { type: "boolean", default: true },
          },
          required: ["object_name", "operation"],
        },
      },
      {
        name: "inoproshop_create_pou",
        description: "Create a Program, Function Block, or Function in the selected parent object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string", default: "Application" },
            name: { type: "string" },
            pou_type: { type: "string", enum: ["program", "function_block", "function"], default: "function_block" },
            return_type: { type: "string" },
            declaration: { type: "string" },
            implementation: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["name", "pou_type"],
        },
      },
      {
        name: "inoproshop_create_gvl",
        description: "Create a Global Variable List in the selected parent object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string", default: "Application" },
            name: { type: "string" },
            declaration: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["name"],
        },
      },
      {
        name: "inoproshop_create_method",
        description: "Create a Method under an existing POU/FB/interface object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string" },
            parent_index: { type: "number" },
            name: { type: "string" },
            return_type: { type: "string" },
            declaration: { type: "string" },
            implementation: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["parent_name", "name"],
        },
      },
      {
        name: "inoproshop_create_property",
        description: "Create a Property under an existing POU/FB/interface object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string" },
            parent_index: { type: "number" },
            name: { type: "string" },
            property_type: { type: "string", default: "BOOL" },
            declaration: { type: "string" },
            implementation: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["parent_name", "name"],
        },
      },
      {
        name: "inoproshop_create_action",
        description: "Create an Action under an existing POU object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string" },
            parent_index: { type: "number" },
            name: { type: "string" },
            declaration: { type: "string" },
            implementation: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["parent_name", "name"],
        },
      },
      {
        name: "inoproshop_create_transition",
        description: "Create a Transition under an existing SFC/POU object when supported by the project object.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string" },
            parent_index: { type: "number" },
            name: { type: "string" },
            declaration: { type: "string" },
            implementation: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["parent_name", "name"],
        },
      },
      {
        name: "inoproshop_create_dut",
        description: "Create a DUT: structure, enum, union, or alias, then write its declaration.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string", default: "Application" },
            name: { type: "string" },
            dut_type: { type: "string", enum: ["structure", "enum", "union", "alias"], default: "structure" },
            base_type: { type: "string" },
            declaration: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["name"],
        },
      },
      {
        name: "inoproshop_create_interface",
        description: "Create an Interface object when supported by the parent container.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string", default: "Application" },
            name: { type: "string" },
            declaration: { type: "string" },
            save_after: { type: "boolean", default: true },
            build_after: { type: "boolean", default: false },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["name"],
        },
      },
      {
        name: "inoproshop_create_folder",
        description: "Create a folder under Application or another folder/container when supported.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            parent_name: { type: "string", default: "Application" },
            name: { type: "string" },
            save_after: { type: "boolean", default: true },
            backup_before_create: { type: "boolean", default: true },
          },
          required: ["name"],
        },
      },
      {
        name: "inoproshop_rename_object",
        description: "Rename an object. Creates a timestamped backup by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            new_name: { type: "string" },
            save_after: { type: "boolean", default: true },
            backup_before_rename: { type: "boolean", default: true },
          },
          required: ["object_name", "new_name"],
        },
      },
      {
        name: "inoproshop_delete_object",
        description: "Delete/remove an object. Creates a timestamped backup by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            object_name: { type: "string" },
            object_index: { type: "number" },
            save_after: { type: "boolean", default: true },
            backup_before_delete: { type: "boolean", default: true },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_save_project",
        description: "Save currently opened project after scripted modifications.",
        inputSchema: { type: "object", properties: { project_path: { type: "string" } }, required: [] },
      },
      {
        name: "inoproshop_build_project",
        description: "Build active Application in InoProShop/CODESYS SP11 and optionally try to collect messages.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            include_messages: { type: "boolean", default: true },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_get_messages",
        description: "Try to collect CODESYS/InoProShop system messages.",
        inputSchema: { type: "object", properties: { project_path: { type: "string" } }, required: [] },
      },
      {
        name: "inoproshop_get_project_tree",
        description: "Project tree scan. Use low max_depth/max_nodes on SP11 projects.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            max_depth: { type: "number", default: 1 },
            max_nodes: { type: "number", default: 50 },
            include_capabilities: { type: "boolean", default: false },
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

  if (toolName === "inoproshop_bridge_status") {
    const result = await getBridgeStatus({ bridgeDir: DEFAULT_BRIDGE_DIR });
    return jsonText({ ok: true, action: "bridge_status", status: result });
  }

  if (toolName === "inoproshop_start_bridge") {
    return jsonText(
      await startBridge({
        bridgeDir: DEFAULT_BRIDGE_DIR,
        timeoutMs: getOptionalNumberArg(args, "timeout_ms") || 30000,
      })
    );
  }

  if (toolName === "inoproshop_stop_bridge") {
    return jsonText(
      await stopBridge({
        bridgeDir: DEFAULT_BRIDGE_DIR,
        timeoutMs: getOptionalNumberArg(args, "timeout_ms") || 15000,
      })
    );
  }

  if (toolName === "inoproshop_project_status") {
    return jsonText({
      ok: true,
      action: "project_status",
      active_project: await getActiveProject(DEFAULT_BRIDGE_DIR),
      env_project: process.env.INOPROSHOP_PROJECT || null,
      bridge_dir: DEFAULT_BRIDGE_DIR,
    });
  }

  if (toolName === "inoproshop_set_project") {
    const activeProject = await setActiveProject(
      {
        project_path: getOptionalStringArg(args, "project_path"),
        project_folder: getOptionalStringArg(args, "project_folder"),
        name: getOptionalStringArg(args, "name"),
      },
      DEFAULT_BRIDGE_DIR
    );

    return jsonText({
      ok: true,
      action: "set_project",
      active_project: activeProject,
    });
  }

  if (toolName === "inoproshop_clear_project") {
    return jsonText(await clearActiveProject(DEFAULT_BRIDGE_DIR));
  }

  if (toolName === "inoproshop_list_projects") {
    const root =
      getOptionalStringArg(args, "root") ||
      process.env.USERPROFILE + "\\Desktop";

    const projects = await listProjects(
      root,
      getBooleanArg(args, "recursive", true),
      getOptionalNumberArg(args, "max_depth") || 4,
      getOptionalNumberArg(args, "max_results") || 100
    );

    return jsonText({
      ok: true,
      action: "list_projects",
      root,
      count: projects.length,
      projects,
    });
  }

  await requireBridgeActive();

  if (toolName === "inoproshop_open_project") {
    const activeProject = await setActiveProject(
      {
        project_path: getOptionalStringArg(args, "project_path"),
        project_folder: getOptionalStringArg(args, "project_folder"),
        name: getOptionalStringArg(args, "name"),
      },
      DEFAULT_BRIDGE_DIR
    );

    const result = await runInoProShopCommand(
      {
        action: "open_project",
        project_path: activeProject.project_path,
      },
      commonOptions()
    );

    return jsonText({
      ok: true,
      action: "open_project",
      active_project: activeProject,
      result,
    });
  }

  if (toolName === "inoproshop_create_project") {
    const explicitPath = getOptionalStringArg(args, "project_path");
    const projectFolder = getOptionalStringArg(args, "project_folder");
    const projectPath = explicitPath || (
      projectFolder
        ? buildProjectPathFromFolder(projectFolder, getOptionalStringArg(args, "project_file_name"))
        : undefined
    );

    if (!projectPath) {
      throw new Error("Either project_path or project_folder is required.");
    }

    const result = await runInoProShopCommand(
      {
        action: "create_project",
        project_path: projectPath,
        overwrite: getBooleanArg(args, "overwrite", false),
      },
      commonOptions()
    );

    const activeProject = await setActiveProjectFromCreatedPath(
      projectPath,
      getOptionalStringArg(args, "name"),
      DEFAULT_BRIDGE_DIR
    );

    return jsonText({
      ok: true,
      action: "create_project",
      active_project: activeProject,
      result,
    });
  }

  if (toolName === "inoproshop_close_project") {
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

    return jsonText({
      ok: true,
      action: "close_project",
      cleared_active_project: cleared,
      result,
    });
  }

  if (toolName === "inoproshop_diagnose_system") {
    return jsonText(await runInoProShopCommand({ action: "diagnose_system" }, commonOptions()));
  }

  if (toolName === "inoproshop_get_project_info") {
    return jsonText(await runInoProShopCommand({ action: "get_project_info", project_path: await projectPath(args) }, commonOptions()));
  }

  if (toolName === "inoproshop_find_object") {
    return jsonText(await runInoProShopCommand({ action: "find_object", project_path: await projectPath(args), object_name: getStringArg(args, "object_name") }, commonOptions()));
  }

  if (toolName === "inoproshop_get_object_info") {
    return jsonText(await runInoProShopCommand({ action: "get_object_info", project_path: await projectPath(args), object_name: getStringArg(args, "object_name"), object_index: getOptionalNumberArg(args, "object_index") }, commonOptions()));
  }

  if (toolName === "inoproshop_read_object") {
    return jsonText(await runInoProShopCommand({ action: "read_object", project_path: await projectPath(args), object_name: getStringArg(args, "object_name"), object_index: getOptionalNumberArg(args, "object_index"), include_text: getBooleanArg(args, "include_text", true) }, commonOptions()));
  }

  if (toolName === "inoproshop_write_declaration" || toolName === "inoproshop_write_implementation") {
    return jsonText(await runInoProShopCommand({
      action: toolName === "inoproshop_write_declaration" ? "write_declaration" : "write_implementation",
      project_path: await projectPath(args),
      object_name: getStringArg(args, "object_name"),
      object_index: getOptionalNumberArg(args, "object_index"),
      text: getStringArg(args, "text"),
      ...backupWriteOptions(args),
    } as any, commonOptions()));
  }

  if (toolName === "inoproshop_patch_declaration" || toolName === "inoproshop_patch_implementation") {
    return jsonText(await runInoProShopCommand({
      action: toolName === "inoproshop_patch_declaration" ? "patch_declaration" : "patch_implementation",
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
      ...backupWriteOptions(args),
    } as any, commonOptions()));
  }

  if (toolName === "inoproshop_create_pou") {
    return jsonText(await runInoProShopCommand({
      action: "create_pou",
      project_path: await projectPath(args),
      parent_name: getOptionalStringArg(args, "parent_name"),
      name: getStringArg(args, "name"),
      pou_type: getStringArg(args, "pou_type", "function_block") as "program" | "function_block" | "function",
      return_type: getOptionalStringArg(args, "return_type"),
      declaration: getOptionalStringArg(args, "declaration"),
      implementation: getOptionalStringArg(args, "implementation"),
      ...backupCreateOptions(args),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_create_gvl") {
    return jsonText(await runInoProShopCommand({
      action: "create_gvl",
      project_path: await projectPath(args),
      parent_name: getOptionalStringArg(args, "parent_name"),
      name: getStringArg(args, "name"),
      declaration: getOptionalStringArg(args, "declaration"),
      ...backupCreateOptions(args),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_create_method" || toolName === "inoproshop_create_property" || toolName === "inoproshop_create_action" || toolName === "inoproshop_create_transition") {
    const actionMap: Record<string, "create_method" | "create_property" | "create_action" | "create_transition"> = {
      inoproshop_create_method: "create_method",
      inoproshop_create_property: "create_property",
      inoproshop_create_action: "create_action",
      inoproshop_create_transition: "create_transition",
    };

    return jsonText(await runInoProShopCommand({
      action: actionMap[toolName],
      project_path: await projectPath(args),
      parent_name: getStringArg(args, "parent_name"),
      parent_index: getOptionalNumberArg(args, "parent_index"),
      name: getStringArg(args, "name"),
      return_type: getOptionalStringArg(args, "return_type"),
      property_type: getOptionalStringArg(args, "property_type"),
      declaration: getOptionalStringArg(args, "declaration"),
      implementation: getOptionalStringArg(args, "implementation"),
      ...backupCreateOptions(args),
    } as any, commonOptions()));
  }

  if (toolName === "inoproshop_create_dut") {
    return jsonText(await runInoProShopCommand({
      action: "create_dut",
      project_path: await projectPath(args),
      parent_name: getOptionalStringArg(args, "parent_name"),
      name: getStringArg(args, "name"),
      dut_type: getOptionalStringArg(args, "dut_type") as any,
      base_type: getOptionalStringArg(args, "base_type"),
      declaration: getOptionalStringArg(args, "declaration"),
      ...backupCreateOptions(args),
    } as any, commonOptions()));
  }

  if (toolName === "inoproshop_create_interface") {
    return jsonText(await runInoProShopCommand({
      action: "create_interface",
      project_path: await projectPath(args),
      parent_name: getOptionalStringArg(args, "parent_name"),
      name: getStringArg(args, "name"),
      declaration: getOptionalStringArg(args, "declaration"),
      ...backupCreateOptions(args),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_create_folder") {
    return jsonText(await runInoProShopCommand({
      action: "create_folder",
      project_path: await projectPath(args),
      parent_name: getOptionalStringArg(args, "parent_name"),
      name: getStringArg(args, "name"),
      save_after: getBooleanArg(args, "save_after", true),
      backup_before_create: getBooleanArg(args, "backup_before_create", true),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_rename_object") {
    return jsonText(await runInoProShopCommand({
      action: "rename_object",
      project_path: await projectPath(args),
      object_name: getStringArg(args, "object_name"),
      object_index: getOptionalNumberArg(args, "object_index"),
      new_name: getStringArg(args, "new_name"),
      save_after: getBooleanArg(args, "save_after", true),
      backup_before_rename: getBooleanArg(args, "backup_before_rename", true),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_delete_object") {
    return jsonText(await runInoProShopCommand({
      action: "delete_object",
      project_path: await projectPath(args),
      object_name: getStringArg(args, "object_name"),
      object_index: getOptionalNumberArg(args, "object_index"),
      save_after: getBooleanArg(args, "save_after", true),
      backup_before_delete: getBooleanArg(args, "backup_before_delete", true),
    }, commonOptions()));
  }

  if (toolName === "inoproshop_save_project") {
    return jsonText(await runInoProShopCommand({ action: "save_project", project_path: await projectPath(args) }, commonOptions()));
  }

  if (toolName === "inoproshop_build_project") {
    return jsonText(await runInoProShopCommand({ action: "build_project", project_path: await projectPath(args), include_messages: getBooleanArg(args, "include_messages", true) }, commonOptions()));
  }

  if (toolName === "inoproshop_get_messages") {
    return jsonText(await runInoProShopCommand({ action: "get_messages", project_path: await projectPath(args) }, commonOptions()));
  }

  if (toolName === "inoproshop_get_project_tree") {
    return jsonText(await runInoProShopCommand({ action: "get_project_tree", project_path: await projectPath(args), max_depth: getOptionalNumberArg(args, "max_depth") || 1, max_nodes: getOptionalNumberArg(args, "max_nodes") || 50, include_capabilities: getBooleanArg(args, "include_capabilities", false) }, commonOptions()));
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
