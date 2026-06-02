# -*- coding: utf-8 -*-
from __future__ import print_function

import sys
import os
import io
import json
import traceback
import datetime
import shutil

COMMAND_JSON_PATH = __COMMAND_JSON_PATH_PY__
RESULT_JSON_PATH = __RESULT_JSON_PATH_PY__

DEBUG_LOG_PATH = r"C:\Temp\inoproshop_mcp_adapter.log"


def to_unicode(value):
    try:
        if isinstance(value, unicode):
            return value
    except NameError:
        pass

    try:
        return unicode(value)
    except Exception:
        try:
            return str(value).decode("utf-8", "replace")
        except Exception:
            return u"<unprintable>"


def safe_str(value):
    return to_unicode(value)


def debug_log(message):
    try:
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = u"[" + to_unicode(ts) + u"] " + to_unicode(message) + u"\n"

        with io.open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def read_json(path):
    debug_log("read_json: " + safe_str(path))

    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    debug_log("write_json: " + safe_str(path))

    data = json.dumps(obj, ensure_ascii=False, indent=2)

    try:
        if not isinstance(data, unicode):
            data = data.decode("utf-8", "replace")
    except NameError:
        pass

    with io.open(path, "w", encoding="utf-8") as f:
        f.write(data)


def safe_name(obj):
    try:
        return to_unicode(obj.get_name())
    except Exception:
        return safe_str(obj)


def safe_get_attr(obj, name):
    try:
        return getattr(obj, name)
    except Exception:
        return None


def safe_call_noargs(obj, name):
    try:
        value = getattr(obj, name)
        if callable(value):
            return value()
        return value
    except Exception:
        return None


def has_attr_safe(obj, name):
    try:
        return hasattr(obj, name)
    except Exception:
        return False


def read_text_document(part):
    try:
        return to_unicode(part.text)
    except Exception:
        pass

    try:
        return to_unicode(part.get_text())
    except Exception:
        pass

    raise Exception("Cannot read text document")


def write_text_document(part, text):
    text = to_unicode(text)

    try:
        part.text = text
        return {
            "method": "part.text assignment"
        }
    except Exception as e1:
        debug_log("write via part.text failed: " + safe_str(e1))

    try:
        part.replace(text)
        return {
            "method": "part.replace(text)"
        }
    except Exception as e2:
        debug_log("write via part.replace(text) failed: " + safe_str(e2))

    raise Exception("Cannot write text document. Tried part.text assignment and part.replace(text).")


def make_backup(project_path):
    if not os.path.isfile(project_path):
        raise Exception("Cannot backup missing project: " + project_path)

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = project_path + ".mcp_backup_" + ts

    shutil.copy2(project_path, backup_path)

    return backup_path


def open_project(path):
    debug_log("open_project START: " + safe_str(path))
    debug_log("file exists: " + safe_str(os.path.isfile(path)))

    if not os.path.isfile(path):
        raise Exception("Project file does not exist: " + path)

    try:
        debug_log("projects.open with update_flags START")
        flags = VersionUpdateFlags.NoUpdates | VersionUpdateFlags.SilentMode
        project = projects.open(path, update_flags=flags)
        debug_log("projects.open with update_flags OK")
        return project
    except Exception as e:
        debug_log("projects.open with update_flags FAILED: " + safe_str(e))
        debug_log("projects.open plain START")
        project = projects.open(path)
        debug_log("projects.open plain OK")
        return project


def project_info(project, project_path):
    debug_log("project_info START")

    info = {
        "project_path_requested": project_path,
        "project_object": safe_str(project),
        "path": None,
        "dirty": None,
        "active_application": None
    }

    try:
        info["path"] = safe_str(project.path)
    except Exception as e:
        info["path_error"] = safe_str(e)

    try:
        info["dirty"] = bool(project.dirty)
    except Exception as e:
        info["dirty_error"] = safe_str(e)

    try:
        app = project.active_application
        info["active_application"] = {
            "name": safe_name(app),
            "object": safe_str(app),
            "has_build": has_attr_safe(app, "build"),
            "has_clean": has_attr_safe(app, "clean"),
            "has_rebuild": has_attr_safe(app, "rebuild"),
            "has_generate_code": has_attr_safe(app, "generate_code")
        }
    except Exception as e:
        info["active_application_error"] = safe_str(e)

    debug_log("project_info END")
    return info


def object_basic_info(obj):
    info = {
        "name": safe_name(obj),
        "object": safe_str(obj),
        "has_declaration": has_attr_safe(obj, "textual_declaration"),
        "has_implementation": has_attr_safe(obj, "textual_implementation"),
        "has_children": has_attr_safe(obj, "get_children"),
        "has_rename": has_attr_safe(obj, "rename"),
        "has_remove": has_attr_safe(obj, "remove"),
        "has_export_xml": has_attr_safe(obj, "export_xml"),
        "has_import_xml": has_attr_safe(obj, "import_xml"),
        "has_create_pou": has_attr_safe(obj, "create_pou"),
        "has_create_gvl": has_attr_safe(obj, "create_gvl"),
        "has_create_method": has_attr_safe(obj, "create_method"),
        "has_create_property": has_attr_safe(obj, "create_property")
    }

    for attr in ["guid", "type", "is_folder"]:
        try:
            value = getattr(obj, attr)
            if callable(value):
                value = value()
            info[attr] = safe_str(value)
        except Exception as e:
            info[attr + "_error"] = safe_str(e)

    try:
        parent = obj.parent
        info["parent_name"] = safe_name(parent)
        info["parent_object"] = safe_str(parent)
    except Exception:
        pass

    return info


def object_info(obj, include_text):
    debug_log("object_info START: " + safe_name(obj))

    info = object_basic_info(obj)

    if has_attr_safe(obj, "textual_declaration"):
        try:
            debug_log("read declaration START: " + safe_name(obj))
            text = read_text_document(obj.textual_declaration)
            debug_log("read declaration OK len=" + safe_str(len(text)))

            info["declaration_len"] = len(text)

            if include_text:
                info["declaration"] = text
            else:
                info["declaration_preview"] = text[:1000]
        except Exception as e:
            debug_log("read declaration FAILED: " + safe_str(e))
            info["declaration_error"] = safe_str(e)

    if has_attr_safe(obj, "textual_implementation"):
        try:
            debug_log("read implementation START: " + safe_name(obj))
            text = read_text_document(obj.textual_implementation)
            debug_log("read implementation OK len=" + safe_str(len(text)))

            info["implementation_len"] = len(text)

            if include_text:
                info["implementation"] = text
            else:
                info["implementation_preview"] = text[:1000]
        except Exception as e:
            debug_log("read implementation FAILED: " + safe_str(e))
            info["implementation_error"] = safe_str(e)

    debug_log("object_info END: " + safe_name(obj))
    return info


def find_objects(project, name):
    debug_log("project.find START: " + safe_str(name))

    try:
        found = project.find(name, True)
        debug_log("project.find OK: " + safe_str(name) + " count=" + safe_str(len(found)))
        return found
    except Exception as e:
        debug_log("project.find FAILED: " + safe_str(name) + " error=" + safe_str(e))
        raise Exception("project.find failed for " + name + ": " + safe_str(e))


def find_best_object(project, name):
    found = find_objects(project, name)

    best = None
    best_score = -1

    for obj in found:
        score = 0

        if has_attr_safe(obj, "textual_declaration"):
            score += 1

        if has_attr_safe(obj, "textual_implementation"):
            score += 2

        if score > best_score:
            best = obj
            best_score = score

    if best is not None:
        debug_log("find_best_object selected: " + safe_name(best) + " score=" + safe_str(best_score))
    else:
        debug_log("find_best_object selected: None")

    return best, found


def select_object_by_index_or_best(project, name, object_index):
    best, found = find_best_object(project, name)

    if len(found) == 0:
        raise Exception("Object not found: " + name)

    if object_index is not None:
        idx = int(object_index)

        if idx < 0 or idx >= len(found):
            raise Exception("object_index out of range: " + safe_str(idx))

        return found[idx], found

    return best, found


def save_project(project):
    debug_log("save_project START")

    try:
        project.save()
        debug_log("save_project OK")
        return {
            "saved": True
        }
    except Exception as e:
        debug_log("save_project FAILED: " + safe_str(e))
        raise


def collect_messages():
    debug_log("collect_messages START")

    result = {
        "available": False,
        "messages": [],
        "diagnostics": {}
    }

    try:
        sys_obj = system
        result["available"] = True
        result["diagnostics"]["system_object"] = safe_str(sys_obj)
    except Exception as e:
        result["diagnostics"]["system_error"] = safe_str(e)
        debug_log("collect_messages: no system object")
        return result

    try:
        result["diagnostics"]["system_dir"] = [safe_str(x) for x in dir(sys_obj)]
    except Exception as e:
        result["diagnostics"]["system_dir_error"] = safe_str(e)

    raw_messages = None

    try:
        if has_attr_safe(sys_obj, "get_messages"):
            raw_messages = sys_obj.get_messages()
            result["diagnostics"]["get_messages_noargs_ok"] = True
    except Exception as e:
        result["diagnostics"]["get_messages_noargs_error"] = safe_str(e)

    if raw_messages is None:
        try:
            if has_attr_safe(sys_obj, "messages"):
                raw_messages = sys_obj.messages
                result["diagnostics"]["messages_attr_ok"] = True
        except Exception as e:
            result["diagnostics"]["messages_attr_error"] = safe_str(e)

    if raw_messages is None:
        debug_log("collect_messages END no raw_messages")
        return result

    try:
        count = len(raw_messages)
    except Exception:
        count = -1

    result["diagnostics"]["raw_messages_count"] = count

    try:
        for msg in raw_messages:
            item = {
                "object": safe_str(msg)
            }

            for attr in [
                "text",
                "message",
                "description",
                "severity",
                "category",
                "source",
                "file",
                "line",
                "column",
                "position",
                "number",
                "code"
            ]:
                try:
                    value = getattr(msg, attr)
                    if callable(value):
                        value = value()
                    item[attr] = safe_str(value)
                except Exception:
                    pass

            result["messages"].append(item)
    except Exception as e:
        result["diagnostics"]["iterate_messages_error"] = safe_str(e)

    debug_log("collect_messages END count=" + safe_str(len(result["messages"])))
    return result


def build_project(project, include_messages):
    debug_log("build_project START")

    app = project.active_application
    debug_log("active_application OK: " + safe_name(app))

    debug_log("app.build START")
    build_result = app.build()
    debug_log("app.build OK: " + safe_str(build_result))

    result = {
        "build_result": safe_str(build_result)
    }

    if include_messages:
        result["messages"] = collect_messages()

    return result


def get_children_compat(obj, full_path):
    debug_log("get_children_compat START: " + full_path)

    try:
        children = obj.get_children(False)
        debug_log("get_children(False) OK: " + full_path + " count=" + safe_str(len(children)))
        return children
    except Exception as e1:
        debug_log("get_children(False) FAILED: " + full_path + " error=" + safe_str(e1))

    try:
        children = obj.get_children()
        debug_log("get_children() OK: " + full_path + " count=" + safe_str(len(children)))
        return children
    except Exception as e2:
        debug_log("get_children() FAILED: " + full_path + " error=" + safe_str(e2))
        return []


def tree_node(obj, path, depth, state, max_nodes, include_capabilities):
    if state["count"] >= max_nodes:
        return {
            "name": "<limit reached>",
            "path": path + "/<limit reached>",
            "children": []
        }

    state["count"] += 1

    name = safe_name(obj)
    full_path = path + "/" + name

    debug_log("tree_node: " + full_path + " depth=" + safe_str(depth))

    node = {
        "name": name,
        "path": full_path,
        "children": []
    }

    if include_capabilities:
        node["has_declaration"] = has_attr_safe(obj, "textual_declaration")
        node["has_implementation"] = has_attr_safe(obj, "textual_implementation")

    if depth <= 0:
        return node

    children = get_children_compat(obj, full_path)

    for child in children:
        if state["count"] >= max_nodes:
            node["children"].append({
                "name": "<limit reached>",
                "path": full_path + "/<limit reached>",
                "children": []
            })
            break

        node["children"].append(
            tree_node(child, full_path, depth - 1, state, max_nodes, include_capabilities)
        )

    return node


def get_project_tree(project, max_depth, max_nodes, include_capabilities):
    debug_log("get_project_tree START")

    app = project.active_application
    debug_log("active_application OK: " + safe_name(app))

    state = {
        "count": 0
    }

    tree = tree_node(app, "", max_depth, state, max_nodes, include_capabilities)

    debug_log("get_project_tree END visited=" + safe_str(state["count"]))

    return {
        "application_name": safe_name(app),
        "max_depth": max_depth,
        "max_nodes": max_nodes,
        "visited_nodes": state["count"],
        "tree": tree
    }


def write_object_text(project, project_path, object_name, part_name, new_text, object_index, save_after, build_after, backup_before_write):
    backup_path = None

    if backup_before_write:
        debug_log("backup_before_write START")
        backup_path = make_backup(project_path)
        debug_log("backup_before_write OK: " + backup_path)

    target, found = select_object_by_index_or_best(project, object_name, object_index)

    debug_log("write_object_text target: " + safe_name(target) + " part=" + part_name)

    if part_name == "declaration":
        if not has_attr_safe(target, "textual_declaration"):
            raise Exception("Object has no textual_declaration: " + object_name)

        part = target.textual_declaration
    elif part_name == "implementation":
        if not has_attr_safe(target, "textual_implementation"):
            raise Exception("Object has no textual_implementation: " + object_name)

        part = target.textual_implementation
    else:
        raise Exception("Unknown text part: " + part_name)

    old_text = read_text_document(part)
    write_result = write_text_document(part, new_text)

    result = {
        "object_name": object_name,
        "selected_object": object_basic_info(target),
        "found_count": len(found),
        "part": part_name,
        "old_len": len(old_text),
        "new_len": len(to_unicode(new_text)),
        "write_method": write_result["method"],
        "backup_path": backup_path,
        "saved": False,
        "build": None
    }

    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True

    if build_after:
        result["build"] = build_project(project, True)

    return result


def diagnose_system():
    debug_log("diagnose_system START")

    result = {
        "python_version": safe_str(sys.version),
        "globals": {},
        "system": {},
        "projects": {}
    }

    for name in ["projects", "system", "VersionUpdateFlags", "PouType", "Guid"]:
        try:
            obj = globals()[name]
            result["globals"][name] = {
                "available": True,
                "object": safe_str(obj)
            }

            try:
                result["globals"][name]["dir"] = [safe_str(x) for x in dir(obj)]
            except Exception as e:
                result["globals"][name]["dir_error"] = safe_str(e)
        except Exception as e:
            result["globals"][name] = {
                "available": False,
                "error": safe_str(e)
            }

    debug_log("diagnose_system END")
    return result


def handle(command):
    debug_log("")
    debug_log("========== MCP COMMAND START ==========")
    debug_log("python_version: " + safe_str(sys.version))
    debug_log("command_json_path: " + safe_str(COMMAND_JSON_PATH))
    debug_log("result_json_path: " + safe_str(RESULT_JSON_PATH))
    debug_log("command: " + safe_str(command))

    action = command.get("action")
    project_path = command.get("project_path")

    debug_log("action: " + safe_str(action))
    debug_log("project_path: " + safe_str(project_path))

    if action == "diagnose_system":
        return {
            "ok": True,
            "action": action,
            "diagnostics": diagnose_system()
        }

    if not project_path:
        raise Exception("project_path is required")

    project = open_project(project_path)
    debug_log("project opened OK")

    if action == "get_project_info":
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "project": project_info(project, project_path)
        }

    if action == "find_object":
        object_name = command.get("object_name")

        if not object_name:
            raise Exception("object_name is required")

        found = find_objects(project, object_name)

        items = []
        for obj in found:
            items.append(object_info(obj, False))

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "object_name": object_name,
            "found_count": len(found),
            "objects": items
        }

    if action == "get_object_info":
        object_name = command.get("object_name")
        object_index = command.get("object_index")

        if not object_name:
            raise Exception("object_name is required")

        target, found = select_object_by_index_or_best(project, object_name, object_index)

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "object_name": object_name,
            "found_count": len(found),
            "selected_object": object_basic_info(target)
        }

    if action == "read_object":
        object_name = command.get("object_name")
        include_text = bool(command.get("include_text", True))
        object_index = command.get("object_index")

        if not object_name:
            raise Exception("object_name is required")

        target, found = select_object_by_index_or_best(project, object_name, object_index)

        found_items = []
        for obj in found:
            found_items.append(object_info(obj, False))

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "object_name": object_name,
            "found_count": len(found),
            "found_objects": found_items,
            "selected_object": object_info(target, include_text)
        }

    if action == "write_declaration":
        result = write_object_text(
            project=project,
            project_path=project_path,
            object_name=command.get("object_name"),
            part_name="declaration",
            new_text=command.get("text"),
            object_index=command.get("object_index"),
            save_after=bool(command.get("save_after", True)),
            build_after=bool(command.get("build_after", False)),
            backup_before_write=bool(command.get("backup_before_write", True))
        )

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "result": result
        }

    if action == "write_implementation":
        result = write_object_text(
            project=project,
            project_path=project_path,
            object_name=command.get("object_name"),
            part_name="implementation",
            new_text=command.get("text"),
            object_index=command.get("object_index"),
            save_after=bool(command.get("save_after", True)),
            build_after=bool(command.get("build_after", False)),
            backup_before_write=bool(command.get("backup_before_write", True))
        )

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "result": result
        }

    if action == "save_project":
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "save": save_project(project)
        }

    if action == "build_project":
        include_messages = bool(command.get("include_messages", True))

        build = build_project(project, include_messages)

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "build": build
        }

    if action == "get_messages":
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "messages": collect_messages()
        }

    if action == "get_project_tree":
        max_depth = int(command.get("max_depth", 1))
        max_nodes = int(command.get("max_nodes", 50))
        include_capabilities = bool(command.get("include_capabilities", False))

        tree = get_project_tree(project, max_depth, max_nodes, include_capabilities)

        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "warning": "This action is experimental in InoProShop SP11. get_children() may hang on some projects.",
            "tree_result": tree
        }

    raise Exception("Unknown action: " + safe_str(action))


try:
    debug_log("adapter script START")

    command = read_json(COMMAND_JSON_PATH)
    result = handle(command)

    debug_log("command handled OK")
    write_json(RESULT_JSON_PATH, result)

    debug_log("adapter script END OK")
    print("__MCP_RESULT_OK__")

except Exception as e:
    debug_log("adapter script ERROR: " + safe_str(e))
    debug_log(traceback.format_exc())

    error_result = {
        "ok": False,
        "error": safe_str(e),
        "traceback": traceback.format_exc()
    }

    try:
        write_json(RESULT_JSON_PATH, error_result)
    except Exception:
        pass

    print("__MCP_RESULT_ERROR__")
    print(safe_str(e))
    traceback.print_exc()