import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "path";
import { runInoProShopCommand } from "./inoproshopRunner";

const INOPROSHOP_EXE =
  process.env.INOPROSHOP_EXE ||
  "C:\\Inovance Control\\InoProShop\\CODESYS\\Common\\InoProShop.exe";

const INOPROSHOP_PROFILE =
  process.env.INOPROSHOP_PROFILE || "InoProShop(V1.9.1.6)";

const DEFAULT_PROJECT_PATH =
  process.env.INOPROSHOP_PROJECT ||
  "C:\\Users\\kaykov\\Desktop\\Avanpost\\PLC\\PLC.project";

const DEFAULT_TIMEOUT_MS = Number(
  process.env.CODESYS_TIMEOUT_MS ||
    process.env.INOPROSHOP_TIMEOUT_MS ||
    "180000"
);

const ADAPTER_TEMPLATE = resolve("scripts/sp11_adapter_template.py");

const server = new Server(
  {
    name: "inoproshop-sp11-mcp",
    version: "0.2.0",
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
    inoproshopExe: INOPROSHOP_EXE,
    profile: INOPROSHOP_PROFILE,
    adapterTemplatePath: ADAPTER_TEMPLATE,
    timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

server.setRequestHandler(ListToolsRequestSchema, async function () {
  return {
    tools: [
      {
        name: "inoproshop_diagnose_system",
        description:
          "Diagnose available CODESYS/InoProShop SP11 scripting globals and system API. Does not open a project.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "inoproshop_get_project_info",
        description:
          "Open the InoProShop project and return basic project/application information.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
              description:
                "Full path to .project file. If omitted, INOPROSHOP_PROJECT is used.",
            },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_find_object",
        description:
          "Find InoProShop/CODESYS SP11 objects by exact name using project.find(name, True). Safe alternative to full tree scan.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
              description:
                "Full path to .project file. If omitted, INOPROSHOP_PROJECT is used.",
            },
            object_name: {
              type: "string",
              description:
                "Object name to find, for example Pump, HTC, PLC_PRG, GVL.",
            },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_get_object_info",
        description:
          "Return capabilities and metadata for an object by name, without returning full source code.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            object_name: {
              type: "string",
            },
            object_index: {
              type: "number",
              description:
                "Optional index if project.find returns multiple objects with the same name.",
            },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_read_object",
        description:
          "Read declaration and/or implementation of an InoProShop/CODESYS SP11 object by name.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            object_name: {
              type: "string",
              description:
                "Object name to read, for example Pump, HTC, PLC_PRG, GVL.",
            },
            object_index: {
              type: "number",
              description:
                "Optional index if project.find returns multiple objects with the same name.",
            },
            include_text: {
              type: "boolean",
              description:
                "If true, return full declaration and implementation text. If false, return previews only.",
              default: true,
            },
          },
          required: ["object_name"],
        },
      },
      {
        name: "inoproshop_write_declaration",
        description:
          "Replace textual_declaration of an object. Creates a .mcp_backup timestamped copy by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            object_name: {
              type: "string",
            },
            object_index: {
              type: "number",
            },
            text: {
              type: "string",
              description: "Full new declaration text.",
            },
            save_after: {
              type: "boolean",
              default: true,
            },
            build_after: {
              type: "boolean",
              default: false,
            },
            backup_before_write: {
              type: "boolean",
              default: true,
            },
          },
          required: ["object_name", "text"],
        },
      },
      {
        name: "inoproshop_write_implementation",
        description:
          "Replace textual_implementation of an ST object. Creates a .mcp_backup timestamped copy by default.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            object_name: {
              type: "string",
            },
            object_index: {
              type: "number",
            },
            text: {
              type: "string",
              description: "Full new implementation text.",
            },
            save_after: {
              type: "boolean",
              default: true,
            },
            build_after: {
              type: "boolean",
              default: false,
            },
            backup_before_write: {
              type: "boolean",
              default: true,
            },
          },
          required: ["object_name", "text"],
        },
      },
      {
        name: "inoproshop_save_project",
        description: "Save currently opened project after scripted modifications.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_build_project",
        description:
          "Build active Application in InoProShop/CODESYS SP11 and optionally try to collect messages.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            include_messages: {
              type: "boolean",
              default: true,
            },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_get_messages",
        description:
          "Try to collect CODESYS/InoProShop system messages. This is diagnostic because SP11/OEM message APIs may vary.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
          },
          required: [],
        },
      },
      {
        name: "inoproshop_get_project_tree",
        description:
          "Experimental project tree scan. Warning: InoProShop SP11 get_children() may hang on some projects. Use low max_depth/max_nodes.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: {
              type: "string",
            },
            max_depth: {
              type: "number",
              default: 1,
            },
            max_nodes: {
              type: "number",
              default: 50,
            },
            include_capabilities: {
              type: "boolean",
              default: false,
            },
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

  if (toolName === "inoproshop_diagnose_system") {
    const result = await runInoProShopCommand(
      {
        action: "diagnose_system",
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_get_project_info") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);

    const result = await runInoProShopCommand(
      {
        action: "get_project_info",
        project_path: projectPath,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_find_object") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);
    const objectName = getStringArg(args, "object_name");

    const result = await runInoProShopCommand(
      {
        action: "find_object",
        project_path: projectPath,
        object_name: objectName,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_get_object_info") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);
    const objectName = getStringArg(args, "object_name");
    const objectIndex = getOptionalNumberArg(args, "object_index");

    const result = await runInoProShopCommand(
      {
        action: "get_object_info",
        project_path: projectPath,
        object_name: objectName,
        object_index: objectIndex,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_read_object") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);
    const objectName = getStringArg(args, "object_name");
    const objectIndex = getOptionalNumberArg(args, "object_index");
    const includeText = getBooleanArg(args, "include_text", true);

    const result = await runInoProShopCommand(
      {
        action: "read_object",
        project_path: projectPath,
        object_name: objectName,
        object_index: objectIndex,
        include_text: includeText,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_write_declaration") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);
    const objectName = getStringArg(args, "object_name");
    const text = getStringArg(args, "text");
    const objectIndex = getOptionalNumberArg(args, "object_index");

    const result = await runInoProShopCommand(
      {
        action: "write_declaration",
        project_path: projectPath,
        object_name: objectName,
        object_index: objectIndex,
        text: text,
        save_after: getBooleanArg(args, "save_after", true),
        build_after: getBooleanArg(args, "build_after", false),
        backup_before_write: getBooleanArg(args, "backup_before_write", true),
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_write_implementation") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);
    const objectName = getStringArg(args, "object_name");
    const text = getStringArg(args, "text");
    const objectIndex = getOptionalNumberArg(args, "object_index");

    const result = await runInoProShopCommand(
      {
        action: "write_implementation",
        project_path: projectPath,
        object_name: objectName,
        object_index: objectIndex,
        text: text,
        save_after: getBooleanArg(args, "save_after", true),
        build_after: getBooleanArg(args, "build_after", false),
        backup_before_write: getBooleanArg(args, "backup_before_write", true),
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_save_project") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);

    const result = await runInoProShopCommand(
      {
        action: "save_project",
        project_path: projectPath,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_build_project") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);

    const result = await runInoProShopCommand(
      {
        action: "build_project",
        project_path: projectPath,
        include_messages: getBooleanArg(args, "include_messages", true),
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_get_messages") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);

    const result = await runInoProShopCommand(
      {
        action: "get_messages",
        project_path: projectPath,
      },
      commonOptions()
    );

    return jsonText(result);
  }

  if (toolName === "inoproshop_get_project_tree") {
    const projectPath = getStringArg(args, "project_path", DEFAULT_PROJECT_PATH);

    const result = await runInoProShopCommand(
      {
        action: "get_project_tree",
        project_path: projectPath,
        max_depth: getOptionalNumberArg(args, "max_depth") || 1,
        max_nodes: getOptionalNumberArg(args, "max_nodes") || 50,
        include_capabilities: getBooleanArg(args, "include_capabilities", false),
      },
      commonOptions()
    );

    return jsonText(result);
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