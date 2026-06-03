# InoProShop library help for AI agents

Use this file as a short context guide for `inoproshop_library`.

## Tool

`inoproshop_library`

## Actions

| Action | Use |
|---|---|
| `help` | Return this guide from MCP. |
| `list` | List libraries already added to the project Library Manager. |
| `find` | Search project libraries and optionally installed repository libraries. |
| `repositories` | List/search installed repository libraries. Use diagnostics if empty. |
| `add` | Add an installed library to the project Library Manager. |
| `add_placeholder` | Add a placeholder reference. |
| `remove` | Remove a project library reference. |
| `install` | Install a `.library` / `.compiled-library` file into the local repository. |
| `uninstall` | Remove a library from the local repository. |

## Rules for AI agents

- Open or set a project before project-library operations.
- Use `list` before `remove`.
- Use `find` or `repositories` before `add`.
- Prefer exact `library_name`, `version`, and `company` when adding/removing.
- If several project references have the same name, use `library_index` from `list`.
- Set `save_after=true` after `add`, `remove`, or `add_placeholder` unless the user says not to save.
- Keep `include_file_path=false` unless local repository paths are needed.
- Do not assume repository libraries are already added to the project.

## Examples

Show this guide:

```json
{ "action": "help" }
```

Show project libraries:

```json
{ "action": "list" }
```

Search installed libraries:

```json
{ "action": "repositories", "query": "Standard", "max_results": 20 }
```

Search both project and repository libraries:

```json
{ "action": "find", "query": "Standard", "include_repository": true }
```

Add a library:

```json
{
  "action": "add",
  "library_name": "Standard",
  "version": "3.5.11.0",
  "company": "3S - Smart Software Solutions GmbH",
  "save_after": true
}
```

Remove a library:

```json
{
  "action": "remove",
  "library_name": "Standard",
  "library_index": 0,
  "save_after": true
}
```

Diagnose empty repository results:

```json
{ "action": "repositories", "max_results": 20, "include_categories": true }
```

## Diagnostics

If `repositories` returns no libraries, inspect:

```text
diagnostics.managers
```

The bridge tries multiple SP11/OEM paths, including global `librarymanager`, `project.library`, repository/category properties, and `get_all_libraries` overloads. Empty results can mean the OEM SP11 build exposes repositories differently or requires a project/profile context.

## Limitations

- Installed repository libraries are not the same as project-added libraries.
- `add` may fail if `version` or `company` does not match repository metadata.
- Library Manager overloads vary by SP11/OEM build.
- Compiled libraries usually do not expose source code or lists of functions.
