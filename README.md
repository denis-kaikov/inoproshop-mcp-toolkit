# InoProShop MCP Toolkit

Model Context Protocol server for automating InoProShop / CODESYS-based PLC projects through the legacy CODESYS ScriptEngine used by InoProShop V1.9.1.6.

This toolkit is adapted for:

- InoProShop V1.9.1.6
- CODESYS ScriptEngine.plugin 3.5.11.10
- Python 2.7.7 inside InoProShop
- Persistent bridge mode, so InoProShop is opened once and reused for MCP requests

## Architecture

```text
MCP client
  -> Node.js MCP server
    -> JSON request/result files
      -> persistent Python bridge running inside InoProShop
        -> CODESYS ScriptEngine API
          -> PLC project
```

The persistent bridge avoids opening a new InoProShop window for every request.

## Requirements

- Windows
- Node.js 18 or newer
- InoProShop V1.9.1.6
- InoProShop ScriptEngine enabled
- Repository path without spaces

Recommended repository path:

```text
C:\Users\kaykov\Desktop\inoproshop-mcp-toolkit
```

Avoid paths like:

```text
C:\Users\kaykov\Desktop\Mcp innoproshop\inoproshop-mcp-toolkit
```

Legacy CODESYS ScriptEngine versions may fail to run scripts from paths containing spaces.

## Installation

```powershell
cd C:\Users\kaykov\Desktop\inoproshop-mcp-toolkit
npm install
```

Copy startup scripts from `cmd/` to `C:\PLC\`:

```text
cmd/start-inoproshop-mcp.cmd      -> C:\PLC\start-inoproshop-mcp.cmd
cmd/start-inoproshop-bridge.cmd   -> C:\PLC\start-inoproshop-bridge.cmd
```

## Important paths

Default InoProShop executable:

```text
C:\Inovance Control\InoProShop\CODESYS\Common\InoProShop.exe
```

Default profile:

```text
InoProShop(V1.9.1.6)
```

Default project:

```text
C:\Users\kaykov\Desktop\Avanpost\PLC\PLC.project
```

Bridge directory:

```text
C:\Temp\inoproshop-mcp-bridge
```

Bridge log:

```text
C:\Temp\inoproshop-mcp-bridge\bridge.log
```

MCP request logs:

```text
C:\Temp\inoproshop-mcp-logs
```

## MCP configuration

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "cmd",
      "args": [
        "/c",
        "C:\\PLC\\start-inoproshop-mcp.cmd"
      ],
      "env": {
        "CODESYS_TIMEOUT_MS": "180000"
      },
      "timeout": 180,
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

## Basic workflow

1. Start the MCP client.
2. Call `inoproshop_bridge_status`.
3. If the bridge is not active, call `inoproshop_start_bridge`.
4. Call `inoproshop_get_project_info`.
5. Use read, patch, create, build, or save tools.
6. Stop the bridge with `inoproshop_stop_bridge` when finished.

## Available tools

### Bridge management

- `inoproshop_bridge_status`
- `inoproshop_start_bridge`
- `inoproshop_stop_bridge`

### Project and diagnostics

- `inoproshop_diagnose_system`
- `inoproshop_get_project_info`
- `inoproshop_get_project_tree`
- `inoproshop_build_project`
- `inoproshop_save_project`
- `inoproshop_get_messages`

### Object search and read

- `inoproshop_find_object`
- `inoproshop_get_object_info`
- `inoproshop_read_object`

### Full write tools

- `inoproshop_write_declaration`
- `inoproshop_write_implementation`

These replace the full declaration or implementation. Prefer patch tools for small edits.

### Patch tools

- `inoproshop_patch_declaration`
- `inoproshop_patch_implementation`

Supported operations:

- `append`
- `prepend`
- `replace_exact`
- `insert_before`
- `insert_after`
- `replace_between_markers`

Recommended marker patch example:

```json
{
  "object_name": "Pump",
  "operation": "replace_between_markers",
  "start_marker": "(* MCP_BEGIN *)",
  "end_marker": "(* MCP_END *)",
  "text": "(* generated code here *)",
  "create_if_missing": true,
  "save_after": true,
  "build_after": false,
  "backup_before_write": true
}
```

### Creation tools

- `inoproshop_create_pou`
- `inoproshop_create_gvl`
- `inoproshop_create_method`
- `inoproshop_create_property`
- `inoproshop_create_action`
- `inoproshop_create_transition`
- `inoproshop_create_dut`
- `inoproshop_create_interface`
- `inoproshop_create_folder`

### Object maintenance tools

- `inoproshop_rename_object`
- `inoproshop_delete_object`

Both tools create a project backup by default.


## Tool input field reference

Most tools share the same field names. Use this reference when constructing MCP calls.

### Common fields

| Field | Used by | Description |
|---|---|---|
| `project_path` | Most project/object tools | Full path to the `.project` file. If omitted, the server uses `INOPROSHOP_PROJECT`. |
| `object_name` | Find, read, write, patch, rename, delete | Exact object name searched with `project.find(name, True)`. |
| `object_index` | Read/write/patch/rename/delete | Optional zero-based index when multiple objects have the same name. Omit to auto-select the best textual object. |
| `parent_name` | Create tools | Name of the parent container where the new object/member should be created. Defaults to `Application` for top-level objects. |
| `parent_index` | Member create tools | Optional zero-based index when multiple parent objects have the same name. |
| `name` | Create tools | Name of the new object/member. |
| `save_after` | Write/create/patch/maintenance tools | Save the project after the operation. Defaults to `true`. |
| `build_after` | Write/create/patch tools | Build the active application after the operation. Defaults to `false`. |
| `backup_before_write` | Write/patch tools | Create a timestamped `.mcp_backup` before changing text. Defaults to `true`. |
| `backup_before_create` | Create tools | Create a timestamped `.mcp_backup` before creating an object. Defaults to `true`. |

### Text fields

| Field | Description |
|---|---|
| `declaration` | Full textual declaration to write after creating an object. If omitted, the bridge tries to generate a minimal declaration. |
| `implementation` | Full textual implementation/body to write after creating an object. Only applies when the created object supports `textual_implementation`. |
| `text` | Text payload for write/patch tools. For full write tools it is the whole new text; for patch tools it is the inserted/replaced body. |

### Patch fields

| Field | Description |
|---|---|
| `operation` | One of `append`, `prepend`, `replace_exact`, `insert_before`, `insert_after`, `replace_between_markers`. |
| `search_text` | Exact text to find for `replace_exact`. |
| `replace_text` | Replacement text for `replace_exact`. |
| `replace_all` | Replace all matches for `replace_exact` when `true`; otherwise replace the first match. |
| `anchor` | Anchor text for `insert_before` and `insert_after`. |
| `start_marker` | Start marker for `replace_between_markers`, for example `(* MCP_BEGIN *)`. |
| `end_marker` | End marker for `replace_between_markers`, for example `(* MCP_END *)`. |
| `create_if_missing` | For `replace_between_markers`: create the marker block at the end if it does not exist. |

### POU/member creation fields

| Field | Tool(s) | Description |
|---|---|---|
| `pou_type` | `inoproshop_create_pou` | `program`, `function_block`, or `function`. |
| `return_type` | `inoproshop_create_pou`, `inoproshop_create_method` | Return type for Function or Method objects, for example `BOOL`, `INT`, `DINT`, `REAL`, or a user-defined type. |
| `property_type` | `inoproshop_create_property` | Property data type, for example `BOOL`, `INT`, `REAL`, `STRING`, or a DUT name. |
| `dut_type` | `inoproshop_create_dut` | `structure`, `enum`, `union`, or `alias`. |
| `base_type` | `inoproshop_create_dut` | Base type for alias DUTs, for example `INT`, `DINT`, `REAL`, `BOOL`, `STRING`, or another user type. |

### Project tree/build fields

| Field | Description |
|---|---|
| `max_depth` | Maximum project tree recursion depth. Keep low on SP11/OEM projects. |
| `max_nodes` | Maximum number of project tree nodes returned. |
| `include_capabilities` | Include `has_declaration` / `has_implementation` flags in tree output. Slower than names-only tree. |
| `include_messages` | Try to collect system/build messages after build. Best-effort on SP11/OEM builds. |

## Examples

### Create a Function Block

```json
{
  "name": "MCP_Test_FB",
  "pou_type": "function_block",
  "declaration": "FUNCTION_BLOCK MCP_Test_FB\r\nVAR_INPUT\r\n    xEnable : BOOL;\r\nEND_VAR\r\nVAR_OUTPUT\r\n    xDone : BOOL;\r\nEND_VAR",
  "implementation": "xDone := xEnable;",
  "save_after": true,
  "build_after": true,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_pou`

### Create a Method under a Function Block

```json
{
  "parent_name": "MCP_Test_FB",
  "name": "Reset",
  "declaration": "METHOD Reset\r\nVAR_INPUT\r\nEND_VAR",
  "implementation": "xDone := FALSE;",
  "save_after": true,
  "build_after": false,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_method`

### Create a Property

```json
{
  "parent_name": "MCP_Test_FB",
  "name": "Enabled",
  "property_type": "BOOL",
  "declaration": "PROPERTY Enabled : BOOL",
  "save_after": true,
  "build_after": false,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_property`

### Create an Action

```json
{
  "parent_name": "MCP_Test_FB",
  "name": "DoWork",
  "implementation": "xDone := xEnable;",
  "save_after": true,
  "build_after": false,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_action`

### Create a Structure DUT

```json
{
  "name": "ST_McpData",
  "dut_type": "structure",
  "declaration": "TYPE ST_McpData :\r\nSTRUCT\r\n    xEnable : BOOL;\r\n    iValue : INT;\r\nEND_STRUCT\r\nEND_TYPE",
  "save_after": true,
  "build_after": true,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_dut`

### Create a GVL

```json
{
  "name": "GVL_MCP",
  "declaration": "VAR_GLOBAL\r\n    g_xMcpEnabled : BOOL;\r\nEND_VAR",
  "save_after": true,
  "build_after": true,
  "backup_before_create": true
}
```

Tool: `inoproshop_create_gvl`

## Safety model

By default, write, patch, create, rename, and delete operations create a timestamped backup next to the project file:

```text
PLC.project.mcp_backup_YYYYMMDD_HHMMSS
```

Recommended safe workflow:

1. Read the object first.
2. Prefer patch tools over full write tools.
3. Save.
4. Build.
5. Review build result and messages.

## Known limitations

### Graphical POUs

Some graphical or OEM objects may have `textual_declaration` but no `textual_implementation`. Their declarations may be readable/editable, but their bodies cannot be edited as ST text.

### Build result

In InoProShop SP11, `Application.build()` may return `None` even when the build command executed successfully. Build messages are collected through best-effort system APIs and may vary by OEM build.

### Create API compatibility

Creation APIs vary across CODESYS SP versions and OEM builds. The bridge tries multiple overloads for `create_pou`, `create_method`, `create_property`, `create_dut`, and related APIs. If a tool fails, check:

```text
C:\Temp\inoproshop-mcp-bridge\bridge.log
```

### Project tree

`get_children()` may be slow on large SP11/OEM projects. Use low limits:

```json
{
  "max_depth": 1,
  "max_nodes": 50,
  "include_capabilities": false
}
```

For precise work, prefer `inoproshop_find_object` and `inoproshop_read_object`.

## Troubleshooting

### Check bridge status

```text
inoproshop_bridge_status
```

### Check bridge log

```powershell
Get-Content "C:\Temp\inoproshop-mcp-bridge\bridge.log" -Tail 100
```

### Check MCP logs

```powershell
explorer "C:\Temp\inoproshop-mcp-logs"
```

### Run bridge manually

```powershell
C:\PLC\start-inoproshop-bridge.cmd
```

## Development notes

All Python scripts must remain compatible with Python 2.7.

Avoid:

- f-strings
- type hints
- `pathlib`
- Python 3-only syntax
- non-ASCII source text without `# -*- coding: utf-8 -*-`

Prefer paths without spaces for Python scripts executed by InoProShop.
