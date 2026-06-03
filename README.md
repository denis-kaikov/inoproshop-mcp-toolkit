# InoProShop MCP Toolkit

MCP server for InoProShop / CODESYS SP11 automation through the legacy ScriptEngine.

Target setup:

- InoProShop V1.9.1.6
- CODESYS ScriptEngine.plugin 3.5.11.10
- Python 2.7.7 inside InoProShop
- Persistent bridge mode

```text
MCP client -> Node.js MCP server -> JSON files -> Python bridge in InoProShop -> ScriptEngine -> PLC project
```

## Requirements

- Windows
- Node.js 18+
- InoProShop with ScriptEngine enabled
- Repository path without spaces

Recommended path:

```text
C:\Users\kaykov\Desktop\inoproshop-mcp-toolkit
```

## Install

```powershell
cd C:\Users\kaykov\Desktop\inoproshop-mcp-toolkit
npm install
npm run build
```

Copy command files:

```text
cmd/start-inoproshop-mcp.cmd    -> C:\PLC\start-inoproshop-mcp.cmd
cmd/start-inoproshop-bridge.cmd -> C:\PLC\start-inoproshop-bridge.cmd
```

## Paths

```text
InoProShop:  C:\Inovance Control\InoProShop\CODESYS\Common\InoProShop.exe
Profile:     InoProShop(V1.9.1.6)
Bridge:      C:\Temp\inoproshop-mcp-bridge
Bridge log:  C:\Temp\inoproshop-mcp-bridge\bridge.log
MCP logs:    C:\Temp\inoproshop-mcp-logs
```

Optional default project:

```powershell
setx INOPROSHOP_PROJECT "C:\Users\kaykov\Desktop\Avanpost\PLC\PLC.project"
```

## MCP config

```json
{
  "mcpServers": {
    "inoproshop": {
      "command": "cmd",
      "args": ["/c", "C:\\PLC\\start-inoproshop-mcp.cmd"],
      "env": { "CODESYS_TIMEOUT_MS": "180000" },
      "timeout": 180,
      "disabled": false
    }
  }
}
```

## Tools

The MCP API is intentionally compact: 6 tools instead of many one-action tools.

| Tool | Use |
|---|---|
| `inoproshop_bridge` | Bridge status/start/stop |
| `inoproshop_project` | Project list/set/open/info/save |
| `inoproshop_read` | Read programs, object, find, info, tree |
| `inoproshop_edit` | Write/patch/rename/delete object |
| `inoproshop_create` | Create POU, GVL, member, DUT, folder |
| `inoproshop_compile` | Build and read errors/warnings |

## Basic workflow

```text
1. inoproshop_bridge { "action": "status" }
2. inoproshop_bridge { "action": "start" }       # if not active
3. inoproshop_project { "action": "open", "project_path": "...\\PLC.project" }
4. inoproshop_read { "mode": "programs", "include_text": true }
5. inoproshop_edit { ... }
6. inoproshop_compile { "action": "errors" }
7. inoproshop_project { "action": "save" }
```

## Tool reference

All selector fields have `enum` and short `Allowed: ...` descriptions in MCP schema.

### `inoproshop_bridge`

`action`: `status`, `start`, `stop`

```json
{ "action": "status" }
{ "action": "start", "timeout_ms": 30000 }
{ "action": "stop", "timeout_ms": 15000 }
```

### `inoproshop_project`

`action`: `status`, `list`, `set`, `clear`, `open`, `create`, `close`, `info`, `save`, `diagnose`

Examples:

```json
{ "action": "list", "root": "C:\\Users\\kaykov\\Desktop", "recursive": true }
```

```json
{ "action": "open", "project_path": "C:\\Users\\kaykov\\Desktop\\Avanpost\\PLC\\PLC.project" }
```

```json
{ "action": "info" }
```

### `inoproshop_read`

`mode`: `programs`, `object`, `find`, `info`, `tree`

Read all textual PLC objects:

```json
{ "mode": "programs", "include_text": true, "max_nodes": 300 }
```

Read one object:

```json
{ "mode": "object", "object_name": "PLC_PRG", "include_text": true }
```

Find duplicates:

```json
{ "mode": "find", "object_name": "Pump" }
```

Small tree scan:

```json
{ "mode": "tree", "max_depth": 1, "max_nodes": 50 }
```

### `inoproshop_edit`

`mode`: `write`, `patch`, `rename`, `delete`

`target`: `declaration`, `implementation`

`operation`: `append`, `prepend`, `replace_exact`, `insert_before`, `insert_after`, `replace_between_markers`

Patch example:

```json
{
  "mode": "patch",
  "target": "implementation",
  "object_name": "PLC_PRG",
  "operation": "replace_between_markers",
  "start_marker": "(* MCP_BEGIN *)",
  "end_marker": "(* MCP_END *)",
  "text": "xDone := TRUE;",
  "create_if_missing": true,
  "save_after": true,
  "build_after": false,
  "backup_before": true
}
```

Full write example:

```json
{
  "mode": "write",
  "target": "implementation",
  "object_name": "PLC_PRG",
  "text": "xDone := TRUE;",
  "backup_before": true
}
```

Rename/delete:

```json
{ "mode": "rename", "object_name": "OldName", "new_name": "NewName" }
{ "mode": "delete", "object_name": "TempObject" }
```

### `inoproshop_create`

`kind`: `pou`, `gvl`, `method`, `property`, `action`, `transition`, `dut`, `interface`, `folder`

`pou_type`: `program`, `function_block`, `function`

`dut_type`: `structure`, `enum`, `union`, `alias`

Create Function Block:

```json
{
  "kind": "pou",
  "name": "MCP_Test_FB",
  "pou_type": "function_block",
  "declaration": "FUNCTION_BLOCK MCP_Test_FB\r\nVAR_INPUT\r\n xEnable : BOOL;\r\nEND_VAR",
  "implementation": "xDone := xEnable;",
  "save_after": true,
  "build_after": false,
  "backup_before": true
}
```

Create method:

```json
{
  "kind": "method",
  "parent_name": "MCP_Test_FB",
  "name": "Reset",
  "declaration": "METHOD Reset\r\nVAR_INPUT\r\nEND_VAR",
  "implementation": "xDone := FALSE;"
}
```

Create action:

```json
{
  "kind": "action",
  "parent_name": "PLC_PRG",
  "name": "DoInit",
  "implementation": "xReady := TRUE;"
}
```

Create GVL:

```json
{
  "kind": "gvl",
  "name": "GVL_MCP",
  "declaration": "VAR_GLOBAL\r\n g_xMcpEnabled : BOOL;\r\nEND_VAR"
}
```

Create DUT:

```json
{
  "kind": "dut",
  "name": "ST_McpData",
  "dut_type": "structure",
  "declaration": "TYPE ST_McpData :\r\nSTRUCT\r\n xEnable : BOOL;\r\nEND_STRUCT\r\nEND_TYPE"
}
```

### `inoproshop_compile`

`action`: `build`, `errors`, `messages`

Build and return parsed diagnostics:

```json
{ "action": "errors", "build_first": true, "clear_messages_before_build": true }
```

Build with full message payload:

```json
{ "action": "build", "include_messages": true }
```

Read current message buffer only:

```json
{ "action": "messages" }
```

## Common fields

| Field | Meaning |
|---|---|
| `project_path` | Full `.project` path. Optional after `project.open` or `project.set`. |
| `object_name` | Exact CODESYS object name. |
| `object_index` | Index for duplicate names. |
| `parent_name` | Parent object/container. |
| `parent_index` | Index for duplicate parents. |
| `include_text` | Return full declaration/implementation. |
| `save_after` | Save after change. Default: `true`. |
| `build_after` | Build after change. Default: `false`. |
| `backup_before` | Create `.mcp_backup_*` first. Default: `true`. |

## Safety

Write, patch, create, rename, and delete create a timestamped backup by default:

```text
PLC.project.mcp_backup_YYYYMMDD_HHMMSS
```

Safe agent flow:

```text
read -> patch -> compile errors -> fix -> save
```

## Limitations

- Graphical POUs may not expose editable ST implementation.
- `Application.build()` can return `None` even when build ran.
- Message APIs vary by SP11/OEM build.
- Creation overloads vary by SP11/OEM build.
- Large tree scans can be slow; prefer `read.programs` or `read.object`.

## Troubleshooting

Bridge status:

```json
{ "action": "status" }
```

Bridge log:

```powershell
Get-Content "C:\Temp\inoproshop-mcp-bridge\bridge.log" -Tail 100
```

MCP logs:

```powershell
explorer "C:\Temp\inoproshop-mcp-logs"
```

Manual bridge start:

```powershell
C:\PLC\start-inoproshop-bridge.cmd
```

## Development notes

Python bridge code must stay Python 2.7 compatible.

Avoid:

- f-strings
- type hints
- pathlib
- Python 3-only syntax
