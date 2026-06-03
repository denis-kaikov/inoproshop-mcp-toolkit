# -*- coding: utf-8 -*-
from __future__ import print_function

import sys
import os
import io
import json
import traceback
import datetime
import shutil
import time

BRIDGE_ROOT = r"C:\Temp\inoproshop-mcp-bridge"
REQUEST_DIR = os.path.join(BRIDGE_ROOT, "requests")
PROCESSING_DIR = os.path.join(BRIDGE_ROOT, "processing")
RESULT_DIR = os.path.join(BRIDGE_ROOT, "results")
ARCHIVE_DIR = os.path.join(BRIDGE_ROOT, "archive")
LOG_PATH = os.path.join(BRIDGE_ROOT, "bridge.log")
READY_PATH = os.path.join(BRIDGE_ROOT, "bridge.ready")
POLL_INTERVAL_SEC = 0.25

CURRENT_PROJECT = None
CURRENT_PROJECT_PATH = None


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
            return u""


def safe_str(value):
    return to_unicode(value)


def ensure_dir(path):
    if not os.path.isdir(path):
        os.makedirs(path)


def ensure_bridge_dirs():
    ensure_dir(BRIDGE_ROOT)
    ensure_dir(REQUEST_DIR)
    ensure_dir(PROCESSING_DIR)
    ensure_dir(RESULT_DIR)
    ensure_dir(ARCHIVE_DIR)


def debug_log(message):
    try:
        ensure_bridge_dirs()
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with io.open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(u"[" + to_unicode(ts) + u"] " + to_unicode(message) + u"\n")
    except Exception:
        pass


def read_json(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path, obj):
    tmp_path = path + ".tmp"
    data = json.dumps(obj, ensure_ascii=False, indent=2)
    try:
        if not isinstance(data, unicode):
            data = data.decode("utf-8", "replace")
    except NameError:
        pass
    with io.open(tmp_path, "w", encoding="utf-8") as f:
        f.write(data)
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
    os.rename(tmp_path, path)


def touch_ready_file():
    try:
        ensure_bridge_dirs()
        with io.open(READY_PATH, "w", encoding="utf-8") as f:
            f.write(u"ready\n")
            f.write(to_unicode(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
            f.write(u"\n")
    except Exception:
        pass


def normalize_path(path):
    return os.path.normcase(os.path.abspath(path))


def safe_name(obj):
    try:
        return to_unicode(obj.get_name())
    except Exception:
        return safe_str(obj)


def has_attr_safe(obj, name):
    try:
        return hasattr(obj, name)
    except Exception:
        return False


def is_string_like(value):
    try:
        return isinstance(value, basestring)
    except NameError:
        return isinstance(value, str)


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
        return {"method": "part.text assignment"}
    except Exception as e1:
        debug_log("write via part.text failed: " + safe_str(e1))
    try:
        part.replace(text)
        return {"method": "part.replace(text)"}
    except Exception as e2:
        debug_log("write via part.replace(text) failed: " + safe_str(e2))
        raise Exception(
            "Cannot write text document. Tried part.text assignment and part.replace(text)."
        )


def normalize_newline_block(text):
    text = to_unicode(text)
    text = text.replace(u"\r\n", u"\n")
    text = text.replace(u"\r", u"\n")
    text = text.replace(u"\n", u"\r\n")
    return text


def patch_text_content(old_text, command):
    operation = command.get("operation")
    old_text = to_unicode(old_text)

    if operation == "append":
        insert_text = normalize_newline_block(command.get("text", u""))
        if not old_text.endswith(u"\r\n"):
            old_text = old_text + u"\r\n"
        return {"text": old_text + insert_text, "operation": operation, "changed": True}

    if operation == "prepend":
        insert_text = normalize_newline_block(command.get("text", u""))
        if not insert_text.endswith(u"\r\n"):
            insert_text = insert_text + u"\r\n"
        return {"text": insert_text + old_text, "operation": operation, "changed": True}

    if operation == "replace_exact":
        search_text = to_unicode(command.get("search_text", u""))
        replace_text = to_unicode(command.get("replace_text", u""))
        replace_all = bool(command.get("replace_all", False))
        if search_text == u"":
            raise Exception("search_text is required for replace_exact")
        if search_text not in old_text:
            raise Exception("search_text not found")
        if replace_all:
            new_text = old_text.replace(search_text, replace_text)
        else:
            new_text = old_text.replace(search_text, replace_text, 1)
        return {"text": new_text, "operation": operation, "changed": new_text != old_text}

    if operation == "insert_before":
        anchor = to_unicode(command.get("anchor", u""))
        insert_text = normalize_newline_block(command.get("text", u""))
        if anchor == u"":
            raise Exception("anchor is required for insert_before")
        index = old_text.find(anchor)
        if index < 0:
            raise Exception("anchor not found")
        return {"text": old_text[:index] + insert_text + old_text[index:], "operation": operation, "changed": True}

    if operation == "insert_after":
        anchor = to_unicode(command.get("anchor", u""))
        insert_text = normalize_newline_block(command.get("text", u""))
        if anchor == u"":
            raise Exception("anchor is required for insert_after")
        index = old_text.find(anchor)
        if index < 0:
            raise Exception("anchor not found")
        insert_at = index + len(anchor)
        return {"text": old_text[:insert_at] + insert_text + old_text[insert_at:], "operation": operation, "changed": True}

    if operation == "replace_between_markers":
        start_marker = to_unicode(command.get("start_marker", u""))
        end_marker = to_unicode(command.get("end_marker", u""))
        new_body = normalize_newline_block(command.get("text", u""))
        create_if_missing = bool(command.get("create_if_missing", False))
        if start_marker == u"":
            raise Exception("start_marker is required for replace_between_markers")
        if end_marker == u"":
            raise Exception("end_marker is required for replace_between_markers")
        start_index = old_text.find(start_marker)
        end_index = old_text.find(end_marker)
        marker_block = start_marker + u"\r\n" + new_body + u"\r\n" + end_marker
        if start_index < 0 or end_index < 0 or end_index < start_index:
            if not create_if_missing:
                raise Exception("marker block not found")
            if not old_text.endswith(u"\r\n"):
                old_text = old_text + u"\r\n"
            return {
                "text": old_text + u"\r\n" + marker_block + u"\r\n",
                "operation": operation,
                "changed": True,
                "created_marker_block": True,
            }
        replace_start = start_index
        replace_end = end_index + len(end_marker)
        new_text = old_text[:replace_start] + marker_block + old_text[replace_end:]
        return {
            "text": new_text,
            "operation": operation,
            "changed": new_text != old_text,
            "created_marker_block": False,
        }

    raise Exception("Unknown patch operation: " + safe_str(operation))


def make_backup(project_path):
    if not os.path.isfile(project_path):
        raise Exception("Cannot backup missing project: " + project_path)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = project_path + ".mcp_backup_" + ts
    shutil.copy2(project_path, backup_path)
    return backup_path


def try_use_primary_project(path):
    global CURRENT_PROJECT
    global CURRENT_PROJECT_PATH
    try:
        primary = projects.primary
    except Exception:
        return None
    if primary is None:
        return None
    try:
        primary_path = primary.path
    except Exception:
        primary_path = None
    if primary_path is not None:
        try:
            if normalize_path(primary_path) == normalize_path(path):
                CURRENT_PROJECT = primary
                CURRENT_PROJECT_PATH = normalize_path(path)
                debug_log("using projects.primary as cached project")
                return primary
        except Exception:
            pass
    return None


def open_project_cached(path):
    global CURRENT_PROJECT
    global CURRENT_PROJECT_PATH
    debug_log("open_project_cached START: " + safe_str(path))
    if not os.path.isfile(path):
        raise Exception("Project file does not exist: " + path)
    normalized = normalize_path(path)
    if CURRENT_PROJECT is not None and CURRENT_PROJECT_PATH == normalized:
        debug_log("using CURRENT_PROJECT cache")
        return CURRENT_PROJECT
    primary = try_use_primary_project(path)
    if primary is not None:
        return primary
    try:
        debug_log("projects.open with update_flags START")
        flags = VersionUpdateFlags.NoUpdates | VersionUpdateFlags.SilentMode
        project = projects.open(path, update_flags=flags)
        debug_log("projects.open with update_flags OK")
    except Exception as e:
        debug_log("projects.open with update_flags FAILED: " + safe_str(e))
        debug_log("projects.open plain START")
        project = projects.open(path)
        debug_log("projects.open plain OK")
    CURRENT_PROJECT = project
    CURRENT_PROJECT_PATH = normalized
    return project


def create_project_compat(project_path, overwrite):
    global CURRENT_PROJECT
    global CURRENT_PROJECT_PATH
    debug_log("create_project_compat START: " + safe_str(project_path))
    if not project_path:
        raise Exception("project_path is required")
    project_dir = os.path.dirname(project_path)
    if project_dir and not os.path.isdir(project_dir):
        os.makedirs(project_dir)
    if os.path.exists(project_path) and not overwrite:
        raise Exception("Project already exists: " + project_path)
    if os.path.exists(project_path) and overwrite:
        backup_path = make_backup(project_path)
        debug_log("existing project backup created: " + backup_path)

    project = None
    create_method = None
    last_error = None
    attempts = [
        ("projects.create(project_path)", lambda: projects.create(project_path)),
        ("projects.create()", lambda: projects.create()),
    ]
    for label, fn in attempts:
        try:
            project = fn()
            create_method = label
            debug_log(label + " OK")
            break
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    if project is None:
        raise Exception("Cannot create project. Last error: " + safe_str(last_error))

    save_method = None
    try:
        project.save_as(project_path)
        save_method = "project.save_as(project_path)"
        debug_log(save_method + " OK")
    except Exception as e1:
        debug_log("project.save_as(project_path) failed: " + safe_str(e1))
        try:
            project.save()
            save_method = "project.save()"
            debug_log(save_method + " OK")
        except Exception as e2:
            debug_log("project.save() failed: " + safe_str(e2))
            raise Exception(
                "Project created but could not be saved to path. save_as error: "
                + safe_str(e1)
                + "; save error: "
                + safe_str(e2)
            )

    CURRENT_PROJECT = project
    CURRENT_PROJECT_PATH = normalize_path(project_path)
    return {
        "created": True,
        "project_path": project_path,
        "create_method": create_method,
        "save_method": save_method,
        "project": project_info(project, project_path),
    }


def close_project_compat(project, project_path, save_before_close):
    global CURRENT_PROJECT
    global CURRENT_PROJECT_PATH
    debug_log("close_project_compat START: " + safe_str(project_path))
    if save_before_close:
        save_project(project)
    close_method = None
    last_error = None
    attempts = [
        ("project.close()", lambda: project.close()),
        ("projects.close(project)", lambda: projects.close(project)),
    ]
    for label, fn in attempts:
        try:
            fn()
            close_method = label
            debug_log(label + " OK")
            break
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    if close_method is None:
        raise Exception("Cannot close project. Last error: " + safe_str(last_error))
    try:
        if CURRENT_PROJECT_PATH == normalize_path(project_path):
            CURRENT_PROJECT = None
            CURRENT_PROJECT_PATH = None
    except Exception:
        CURRENT_PROJECT = None
        CURRENT_PROJECT_PATH = None
    return {
        "closed": True,
        "project_path": project_path,
        "close_method": close_method,
        "saved_before_close": bool(save_before_close),
    }


def project_info(project, project_path):
    info = {
        "project_path_requested": project_path,
        "project_object": safe_str(project),
        "path": None,
        "dirty": None,
        "active_application": None,
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
            "has_generate_code": has_attr_safe(app, "generate_code"),
        }
    except Exception as e:
        info["active_application_error"] = safe_str(e)
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
        "has_create_property": has_attr_safe(obj, "create_property"),
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
    info = object_basic_info(obj)
    if has_attr_safe(obj, "textual_declaration"):
        try:
            text = read_text_document(obj.textual_declaration)
            info["declaration_len"] = len(text)
            if include_text:
                info["declaration"] = text
            else:
                info["declaration_preview"] = text[:1000]
        except Exception as e:
            info["declaration_error"] = safe_str(e)
    if has_attr_safe(obj, "textual_implementation"):
        try:
            text = read_text_document(obj.textual_implementation)
            info["implementation_len"] = len(text)
            if include_text:
                info["implementation"] = text
            else:
                info["implementation_preview"] = text[:1000]
        except Exception as e:
            info["implementation_error"] = safe_str(e)
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
    project.save()
    debug_log("save_project OK")
    return {"saved": True}


MESSAGE_ATTRS = [
    ("text", ["text", "Text", "message", "Message", "description", "Description", "message_text", "MessageText"]),
    ("severity", ["severity", "Severity", "type", "Type", "message_type", "MessageType"]),
    ("category", ["category", "Category"]),
    ("source", ["source", "Source", "object", "Object"]),
    ("file", ["file", "File", "filename", "FileName", "path", "Path"]),
    ("line", ["line", "Line", "line_number", "LineNumber"]),
    ("column", ["column", "Column", "column_number", "ColumnNumber"]),
    ("position", ["position", "Position"]),
    ("number", ["number", "Number"]),
    ("code", ["code", "Code", "error_code", "ErrorCode"]),
]


def compact_message_value(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return bool(value)
    try:
        numeric_types = (int, long, float)
    except NameError:
        numeric_types = (int, float)
    if isinstance(value, numeric_types):
        return value
    return safe_str(value)


def collection_to_list(value):
    if value is None:
        return []
    if is_string_like(value):
        return [value]
    try:
        return list(value)
    except Exception:
        pass
    result = []
    try:
        count = len(value)
        for index in range(count):
            try:
                result.append(value[index])
            except Exception:
                pass
        return result
    except Exception:
        pass
    return [value]


def try_read_message_attr(msg, attr):
    try:
        value = getattr(msg, attr)
        if callable(value):
            try:
                value = value()
            except TypeError:
                return False, None
        return True, value
    except Exception:
        return False, None


def classify_message(item):
    text_parts = []
    for key in item:
        value = item.get(key)
        if value is None:
            continue
        text_parts.append(to_unicode(value))
    text = u" ".join(text_parts).lower()
    for token in [u"error", u"exception", u"failed", u"ошиб", u"fehler"]:
        if token in text:
            return "error"
    for token in [u"warning", u"warn", u"предупреж", u"warnung"]:
        if token in text:
            return "warning"
    return "info"


def message_to_dict(msg, source_method, category_info, index):
    item = {
        "object": safe_str(msg),
        "source_method": safe_str(source_method),
        "index": index,
    }
    if category_info is not None:
        item["category_object"] = category_info.get("object")
        if "description" in category_info:
            item["category_description"] = category_info.get("description")
    for output_key, attr_names in MESSAGE_ATTRS:
        for attr in attr_names:
            ok, value = try_read_message_attr(msg, attr)
            if ok:
                item[output_key] = compact_message_value(value)
                break
    if has_attr_safe(msg, "call_details_handler"):
        item["has_details_handler"] = True
    item["kind"] = classify_message(item)
    return item


def message_identity(item):
    keys = [
        "category_description",
        "severity",
        "text",
        "message",
        "description",
        "source",
        "file",
        "line",
        "column",
        "number",
        "code",
        "object",
    ]
    parts = []
    for key in keys:
        if key in item:
            parts.append(to_unicode(item.get(key)))
    return u"|".join(parts)


def append_message(result, item):
    key = message_identity(item)
    if key in result["_seen"]:
        return False
    result["_seen"].add(key)
    result["messages"].append(item)
    return True


def collect_from_source(result, source_method, raw_messages, category_info=None):
    items = collection_to_list(raw_messages)
    result["diagnostics"][source_method + "_count"] = len(items)
    added = 0
    for index, msg in enumerate(items):
        try:
            if append_message(result, message_to_dict(msg, source_method, category_info, index)):
                added += 1
        except Exception as e:
            result["diagnostics"][source_method + "_item_" + safe_str(index) + "_error"] = safe_str(e)
    result["diagnostics"][source_method + "_added"] = added
    return added


def try_message_source(result, source_method, fn, category_info=None):
    try:
        raw_messages = fn()
        result["diagnostics"][source_method + "_ok"] = True
        return collect_from_source(result, source_method, raw_messages, category_info)
    except Exception as e:
        result["diagnostics"][source_method + "_error"] = safe_str(e)
        return 0


def finalize_messages_result(result):
    result["count"] = len(result["messages"])
    result["errors"] = []
    result["warnings"] = []
    result["infos"] = []
    for msg in result["messages"]:
        kind = msg.get("kind")
        if kind == "error":
            result["errors"].append(msg)
        elif kind == "warning":
            result["warnings"].append(msg)
        else:
            result["infos"].append(msg)
    result["error_count"] = len(result["errors"])
    result["warning_count"] = len(result["warnings"])
    result["info_count"] = len(result["infos"])
    if "_seen" in result:
        del result["_seen"]
    return result


def clear_system_messages():
    result = {"available": False, "cleared": False, "diagnostics": {}}
    try:
        sys_obj = system
        result["available"] = True
    except Exception as e:
        result["diagnostics"]["system_error"] = safe_str(e)
        return result
    if has_attr_safe(sys_obj, "clear_messages"):
        try:
            sys_obj.clear_messages()
            result["cleared"] = True
            result["method"] = "system.clear_messages()"
            return result
        except Exception as e:
            result["diagnostics"]["system.clear_messages()_error"] = safe_str(e)
    return result


def collect_messages():
    result = {
        "available": False,
        "messages": [],
        "errors": [],
        "warnings": [],
        "infos": [],
        "diagnostics": {},
        "_seen": set(),
    }
    try:
        sys_obj = system
        result["available"] = True
        result["diagnostics"]["system_object"] = safe_str(sys_obj)
    except Exception as e:
        result["diagnostics"]["system_error"] = safe_str(e)
        return finalize_messages_result(result)
    try:
        result["diagnostics"]["system_dir"] = [safe_str(x) for x in dir(sys_obj)]
    except Exception as e:
        result["diagnostics"]["system_dir_error"] = safe_str(e)

    if has_attr_safe(sys_obj, "get_messages"):
        try_message_source(result, "system.get_messages()", lambda: sys_obj.get_messages())
    if has_attr_safe(sys_obj, "get_message_objects"):
        try_message_source(result, "system.get_message_objects()", lambda: sys_obj.get_message_objects())
    if has_attr_safe(sys_obj, "messages"):
        try_message_source(result, "system.messages", lambda: sys_obj.messages)

    categories = []
    if has_attr_safe(sys_obj, "get_message_categories"):
        try:
            categories = collection_to_list(sys_obj.get_message_categories())
            result["diagnostics"]["message_categories_count"] = len(categories)
        except Exception as e:
            result["diagnostics"]["get_message_categories_error"] = safe_str(e)

    for category_index, category in enumerate(categories):
        category_info = {"object": safe_str(category), "index": category_index}
        if has_attr_safe(sys_obj, "get_message_category_description"):
            try:
                category_info["description"] = safe_str(sys_obj.get_message_category_description(category))
            except Exception as e:
                category_info["description_error"] = safe_str(e)
        category_label = "category_" + safe_str(category_index)
        if has_attr_safe(sys_obj, "get_message_objects"):
            try_message_source(
                result,
                "system.get_message_objects(" + category_label + ")",
                lambda category=category: sys_obj.get_message_objects(category),
                category_info,
            )
            try_message_source(
                result,
                "system.get_message_objects(" + category_label + ", True)",
                lambda category=category: sys_obj.get_message_objects(category, True),
                category_info,
            )
        if has_attr_safe(sys_obj, "get_messages"):
            try_message_source(
                result,
                "system.get_messages(" + category_label + ")",
                lambda category=category: sys_obj.get_messages(category),
                category_info,
            )

    return finalize_messages_result(result)


def build_project(project, include_messages, clear_messages_before_build=True):
    debug_log("build_project START")
    app = project.active_application
    debug_log("active_application OK: " + safe_name(app))
    result = {"clear_messages_before_build": bool(clear_messages_before_build)}
    if clear_messages_before_build:
        result["clear_messages"] = clear_system_messages()
    debug_log("app.build START")
    try:
        build_result = app.build()
        debug_log("app.build OK: " + safe_str(build_result))
        result["build_result"] = safe_str(build_result)
    except Exception as e:
        result["build_exception"] = safe_str(e)
        result["build_traceback"] = traceback.format_exc()
        debug_log("app.build FAILED: " + safe_str(e))
    if include_messages:
        messages = collect_messages()
        result["messages"] = messages
        result["compile_error_count"] = messages.get("error_count", 0)
        result["compile_warning_count"] = messages.get("warning_count", 0)
        result["compile_errors"] = messages.get("errors", [])
        result["compile_warnings"] = messages.get("warnings", [])
        if "build_exception" in result:
            result["success"] = False
        elif messages.get("available"):
            result["success"] = messages.get("error_count", 0) == 0
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
        return {"name": "", "path": path + "/", "children": []}
    state["count"] += 1
    name = safe_name(obj)
    full_path = path + "/" + name
    node = {"name": name, "path": full_path, "children": []}
    if include_capabilities:
        node["has_declaration"] = has_attr_safe(obj, "textual_declaration")
        node["has_implementation"] = has_attr_safe(obj, "textual_implementation")
    if depth <= 0:
        return node
    children = get_children_compat(obj, full_path)
    for child in children:
        if state["count"] >= max_nodes:
            node["children"].append({"name": "", "path": full_path + "/", "children": []})
            break
        node["children"].append(tree_node(child, full_path, depth - 1, state, max_nodes, include_capabilities))
    return node


def get_project_tree(project, max_depth, max_nodes, include_capabilities):
    debug_log("get_project_tree START")
    app = project.active_application
    state = {"count": 0}
    tree = tree_node(app, "", max_depth, state, max_nodes, include_capabilities)
    debug_log("get_project_tree END visited=" + safe_str(state["count"]))
    return {
        "application_name": safe_name(app),
        "max_depth": max_depth,
        "max_nodes": max_nodes,
        "visited_nodes": state["count"],
        "tree": tree,
    }


def read_current_programs(project, include_text, max_nodes):
    debug_log("read_current_programs START")
    app = project.active_application
    result = {
        "application_name": safe_name(app),
        "max_nodes": max_nodes,
        "visited_nodes": 0,
        "objects": [],
    }

    def visit(obj, path):
        if result["visited_nodes"] >= max_nodes:
            result["truncated"] = True
            return
        result["visited_nodes"] += 1
        name = safe_name(obj)
        full_path = path + "/" + name
        if has_attr_safe(obj, "textual_declaration") or has_attr_safe(obj, "textual_implementation"):
            try:
                info = object_info(obj, include_text)
                info["path"] = full_path
                result["objects"].append(info)
            except Exception as e:
                result["objects"].append({"name": name, "path": full_path, "error": safe_str(e)})
        children = get_children_compat(obj, full_path)
        for child in children:
            if result["visited_nodes"] >= max_nodes:
                result["truncated"] = True
                return
            visit(child, full_path)

    visit(app, "")
    result["count"] = len(result["objects"])
    debug_log(
        "read_current_programs END visited="
        + safe_str(result["visited_nodes"])
        + " textual="
        + safe_str(result["count"])
    )
    return result


def write_object_text(project, project_path, object_name, part_name, new_text, object_index, save_after, build_after, backup_before_write):
    if not object_name:
        raise Exception("object_name is required")
    if new_text is None:
        raise Exception("text is required")
    backup_path = None
    if backup_before_write:
        backup_path = make_backup(project_path)
    target, found = select_object_by_index_or_best(project, object_name, object_index)
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
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def patch_object_text(project, project_path, command, part_name):
    object_name = command.get("object_name")
    object_index = command.get("object_index")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_write = bool(command.get("backup_before_write", True))
    if not object_name:
        raise Exception("object_name is required")
    backup_path = None
    if backup_before_write:
        backup_path = make_backup(project_path)
    target, found = select_object_by_index_or_best(project, object_name, object_index)
    if part_name == "declaration":
        if not has_attr_safe(target, "textual_declaration"):
            raise Exception("Object has no textual_declaration: " + object_name)
        part = target.textual_declaration
    elif part_name == "implementation":
        if not has_attr_safe(target, "textual_implementation"):
            raise Exception("Object has no textual_implementation: " + object_name)
        part = target.textual_implementation
    else:
        raise Exception("Unknown patch part: " + part_name)

    old_text = read_text_document(part)
    patch_result = patch_text_content(old_text, command)
    new_text = patch_result["text"]
    write_result = write_text_document(part, new_text)
    result = {
        "object_name": object_name,
        "selected_object": object_basic_info(target),
        "found_count": len(found),
        "part": part_name,
        "operation": patch_result["operation"],
        "changed": patch_result["changed"],
        "old_len": len(old_text),
        "new_len": len(new_text),
        "write_method": write_result["method"],
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if "created_marker_block" in patch_result:
        result["created_marker_block"] = patch_result["created_marker_block"]
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def get_pou_type(kind):
    kind = to_unicode(kind).lower()
    if kind in [u"program", u"prg"]:
        candidates = ["Program", "PROGRAM"]
    elif kind in [u"function_block", u"functionblock", u"fb"]:
        candidates = ["FunctionBlock", "FUNCTION_BLOCK", "Functionblock"]
    elif kind in [u"function", u"fun"]:
        candidates = ["Function", "FUNCTION"]
    else:
        raise Exception("Unsupported POU type: " + safe_str(kind))
    for candidate in candidates:
        try:
            return getattr(PouType, candidate)
        except Exception:
            pass
    raise Exception("Cannot resolve PouType for: " + safe_str(kind))


def create_pou_compat(parent, name, kind, return_type):
    kind_l = to_unicode(kind).lower()
    name = to_unicode(name)
    if kind_l in [u"program", u"prg"]:
        try:
            if has_attr_safe(parent, "create_program"):
                return parent.create_program(name), "create_program(name)"
        except Exception as e:
            debug_log("create_program failed: " + safe_str(e))
    if kind_l in [u"function_block", u"functionblock", u"fb"]:
        try:
            if has_attr_safe(parent, "create_function_block"):
                return parent.create_function_block(name), "create_function_block(name)"
        except Exception as e:
            debug_log("create_function_block failed: " + safe_str(e))
    if kind_l in [u"function", u"fun"]:
        try:
            if has_attr_safe(parent, "create_function"):
                if return_type:
                    return parent.create_function(name, return_type), "create_function(name, return_type)"
                return parent.create_function(name), "create_function(name)"
        except Exception as e:
            debug_log("create_function failed: " + safe_str(e))
    pou_type = get_pou_type(kind)
    attempts = [
        ("create_pou(name, pou_type)", lambda: parent.create_pou(name, pou_type)),
        ("create_pou(name, pou_type, None)", lambda: parent.create_pou(name, pou_type, None)),
        ("create_pou(name=name, type=pou_type)", lambda: parent.create_pou(name=name, type=pou_type)),
        ("create_pou(name=name, type=pou_type, language=None)", lambda: parent.create_pou(name=name, type=pou_type, language=None)),
    ]
    last_error = None
    for label, fn in attempts:
        try:
            return fn(), label
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    raise Exception("create_pou failed. Last error: " + safe_str(last_error))


def default_pou_declaration(name, kind, return_type):
    name = to_unicode(name)
    kind_l = to_unicode(kind).lower()
    if kind_l in [u"program", u"prg"]:
        return u"PROGRAM " + name + u"\r\nVAR\r\nEND_VAR"
    if kind_l in [u"function_block", u"functionblock", u"fb"]:
        return (
            u"FUNCTION_BLOCK " + name + u"\r\n"
            u"VAR_INPUT\r\n"
            u"END_VAR\r\n"
            u"VAR_OUTPUT\r\n"
            u"END_VAR\r\n"
            u"VAR\r\n"
            u"END_VAR"
        )
    if kind_l in [u"function", u"fun"]:
        rt = to_unicode(return_type or u"BOOL")
        return u"FUNCTION " + name + u" : " + rt + u"\r\nVAR_INPUT\r\nEND_VAR"
    raise Exception("Unsupported POU type: " + safe_str(kind))


def select_parent(project, parent_name):
    parent_name = parent_name or "Application"
    if parent_name == "Application":
        try:
            return project.active_application, 1
        except Exception:
            pass
    parent, found = select_object_by_index_or_best(project, parent_name, None)
    return parent, len(found)


def create_pou_object(project, project_path, command):
    parent_name = command.get("parent_name") or "Application"
    name = command.get("name")
    kind = command.get("pou_type") or "function_block"
    return_type = command.get("return_type")
    declaration = command.get("declaration")
    implementation = command.get("implementation")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not name:
        raise Exception("name is required")
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found_count = select_parent(project, parent_name)
    created, create_method = create_pou_compat(parent, name, kind, return_type)
    if declaration is None:
        declaration = default_pou_declaration(name, kind, return_type)
    if has_attr_safe(created, "textual_declaration"):
        declaration_write = write_text_document(created.textual_declaration, normalize_newline_block(declaration))
    else:
        raise Exception("Created object has no textual_declaration")
    implementation_write = None
    if implementation is not None:
        if not has_attr_safe(created, "textual_implementation"):
            raise Exception("Created object has no textual_implementation")
        implementation_write = write_text_document(created.textual_implementation, normalize_newline_block(implementation))
    result = {
        "name": name,
        "pou_type": kind,
        "parent_name": parent_name,
        "parent_found_count": found_count,
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "declaration_write": declaration_write,
        "implementation_write": implementation_write,
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def create_gvl_object(project, project_path, command):
    parent_name = command.get("parent_name") or "Application"
    name = command.get("name")
    declaration = command.get("declaration")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not name:
        raise Exception("name is required")
    if declaration is None:
        declaration = u"VAR_GLOBAL\r\nEND_VAR"
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found_count = select_parent(project, parent_name)
    created = None
    create_method = None
    last_error = None
    try:
        created = parent.create_gvl(name)
        create_method = "create_gvl(name)"
    except Exception as e1:
        last_error = e1
        debug_log("create_gvl(name) failed: " + safe_str(e1))
    if created is None:
        try:
            created = parent.create_global_var_list(name)
            create_method = "create_global_var_list(name)"
        except Exception as e2:
            last_error = e2
            debug_log("create_global_var_list(name) failed: " + safe_str(e2))
    if created is None:
        raise Exception("Cannot create GVL. Last error: " + safe_str(last_error))
    if has_attr_safe(created, "textual_declaration"):
        declaration_write = write_text_document(created.textual_declaration, normalize_newline_block(declaration))
    else:
        raise Exception("Created GVL has no textual_declaration")
    result = {
        "name": name,
        "parent_name": parent_name,
        "parent_found_count": found_count,
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "declaration_write": declaration_write,
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def create_member_compat(parent, member_kind, name, return_type, property_type):
    member_kind = to_unicode(member_kind).lower()
    name = to_unicode(name)
    last_error = None
    attempts = []
    if member_kind == u"method":
        if return_type:
            attempts.append(("create_method(name, return_type)", lambda: parent.create_method(name, return_type)))
        attempts.append(("create_method(name)", lambda: parent.create_method(name)))
        if return_type:
            attempts.append(("create_method(name=name, return_type=return_type)", lambda: parent.create_method(name=name, return_type=return_type)))
        attempts.append(("create_method(name=name)", lambda: parent.create_method(name=name)))
    elif member_kind == u"property":
        ptype = property_type or return_type or u"BOOL"
        attempts.append(("create_property(name, ptype)", lambda: parent.create_property(name, ptype)))
        attempts.append(("create_property(name)", lambda: parent.create_property(name)))
        attempts.append(("create_property(name=name, type=ptype)", lambda: parent.create_property(name=name, type=ptype)))
        attempts.append(("create_property(name=name)", lambda: parent.create_property(name=name)))
    elif member_kind == u"action":
        attempts.append(("create_action(name)", lambda: parent.create_action(name)))
        attempts.append(("create_action(name=name)", lambda: parent.create_action(name=name)))
    elif member_kind == u"transition":
        attempts.append(("create_transition(name)", lambda: parent.create_transition(name)))
        attempts.append(("create_transition(name=name)", lambda: parent.create_transition(name=name)))
    else:
        raise Exception("Unsupported member kind: " + safe_str(member_kind))
    for label, fn in attempts:
        try:
            return fn(), label
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    raise Exception("Cannot create " + safe_str(member_kind) + ". Last error: " + safe_str(last_error))


def default_member_declaration(name, member_kind, return_type, property_type):
    name = to_unicode(name)
    member_kind = to_unicode(member_kind).lower()
    if member_kind == u"method":
        if return_type:
            return u"METHOD " + name + u" : " + to_unicode(return_type) + u"\r\nVAR_INPUT\r\nEND_VAR"
        return u"METHOD " + name + u"\r\nVAR_INPUT\r\nEND_VAR"
    if member_kind == u"property":
        ptype = to_unicode(property_type or return_type or u"BOOL")
        return u"PROPERTY " + name + u" : " + ptype
    if member_kind == u"action":
        return u"ACTION " + name
    if member_kind == u"transition":
        return u"TRANSITION " + name
    raise Exception("Unsupported member kind: " + safe_str(member_kind))


def create_member_object(project, project_path, command, member_kind):
    parent_name = command.get("parent_name")
    name = command.get("name")
    return_type = command.get("return_type")
    property_type = command.get("property_type")
    declaration = command.get("declaration")
    implementation = command.get("implementation")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not parent_name:
        raise Exception("parent_name is required for creating " + safe_str(member_kind))
    if not name:
        raise Exception("name is required")
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found = select_object_by_index_or_best(project, parent_name, command.get("parent_index"))
    created, create_method = create_member_compat(parent, member_kind, name, return_type, property_type)
    declaration_write = None
    implementation_write = None
    if declaration is None:
        declaration = default_member_declaration(name, member_kind, return_type, property_type)
    if has_attr_safe(created, "textual_declaration"):
        declaration_write = write_text_document(created.textual_declaration, normalize_newline_block(declaration))
    if implementation is not None:
        if not has_attr_safe(created, "textual_implementation"):
            raise Exception("Created object has no textual_implementation")
        implementation_write = write_text_document(created.textual_implementation, normalize_newline_block(implementation))
    result = {
        "name": name,
        "member_kind": member_kind,
        "parent_name": parent_name,
        "parent_found_count": len(found),
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "declaration_write": declaration_write,
        "implementation_write": implementation_write,
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def get_dut_type(kind):
    kind = to_unicode(kind or u"structure").lower()
    if kind in [u"structure", u"struct"]:
        candidates = ["Structure", "STRUCTURE", "Struct"]
    elif kind in [u"enum", u"enumeration"]:
        candidates = ["Enumeration", "ENUM", "Enum"]
    elif kind in [u"union"]:
        candidates = ["Union", "UNION"]
    elif kind in [u"alias"]:
        candidates = ["Alias", "ALIAS"]
    else:
        candidates = []
    try:
        dut_type_obj = DutType
    except Exception:
        return None
    for candidate in candidates:
        try:
            return getattr(dut_type_obj, candidate)
        except Exception:
            pass
    return None


def create_dut_compat(parent, name, dut_type):
    name = to_unicode(name)
    dut_type_value = get_dut_type(dut_type)
    attempts = []
    if dut_type_value is not None:
        attempts.append(("create_dut(name, dut_type)", lambda: parent.create_dut(name, dut_type_value)))
        attempts.append(("create_dut(name=name, type=dut_type)", lambda: parent.create_dut(name=name, type=dut_type_value)))
    attempts.append(("create_dut(name)", lambda: parent.create_dut(name)))
    attempts.append(("create_dut(name=name)", lambda: parent.create_dut(name=name)))
    last_error = None
    for label, fn in attempts:
        try:
            return fn(), label
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    raise Exception("Cannot create DUT. Last error: " + safe_str(last_error))


def default_dut_declaration(name, dut_type, base_type):
    name = to_unicode(name)
    dut_type = to_unicode(dut_type or u"structure").lower()
    if dut_type in [u"structure", u"struct"]:
        return u"TYPE " + name + u" :\r\nSTRUCT\r\nEND_STRUCT\r\nEND_TYPE"
    if dut_type in [u"enum", u"enumeration"]:
        return u"TYPE " + name + u" :\r\n(\r\n Value1\r\n);\r\nEND_TYPE"
    if dut_type == u"union":
        return u"TYPE " + name + u" :\r\nUNION\r\nEND_UNION\r\nEND_TYPE"
    if dut_type == u"alias":
        return u"TYPE " + name + u" : " + to_unicode(base_type or u"BOOL") + u";\r\nEND_TYPE"
    raise Exception("Unsupported DUT type: " + safe_str(dut_type))


def create_dut_object(project, project_path, command):
    parent_name = command.get("parent_name") or "Application"
    name = command.get("name")
    dut_type = command.get("dut_type") or "structure"
    base_type = command.get("base_type")
    declaration = command.get("declaration")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not name:
        raise Exception("name is required")
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found_count = select_parent(project, parent_name)
    created, create_method = create_dut_compat(parent, name, dut_type)
    if declaration is None:
        declaration = default_dut_declaration(name, dut_type, base_type)
    if has_attr_safe(created, "textual_declaration"):
        declaration_write = write_text_document(created.textual_declaration, normalize_newline_block(declaration))
    else:
        raise Exception("Created DUT has no textual_declaration")
    result = {
        "name": name,
        "dut_type": dut_type,
        "parent_name": parent_name,
        "parent_found_count": found_count,
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "declaration_write": declaration_write,
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def create_interface_object(project, project_path, command):
    parent_name = command.get("parent_name") or "Application"
    name = command.get("name")
    declaration = command.get("declaration")
    save_after = bool(command.get("save_after", True))
    build_after = bool(command.get("build_after", False))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not name:
        raise Exception("name is required")
    if declaration is None:
        declaration = u"INTERFACE " + to_unicode(name) + u"\r\nEND_INTERFACE"
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found_count = select_parent(project, parent_name)
    last_error = None
    created = None
    create_method = None
    attempts = [
        ("create_interface(name)", lambda: parent.create_interface(name)),
        ("create_interface(name=name)", lambda: parent.create_interface(name=name)),
    ]
    for label, fn in attempts:
        try:
            created = fn()
            create_method = label
            break
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    if created is None:
        raise Exception("Cannot create interface. Last error: " + safe_str(last_error))
    declaration_write = None
    if has_attr_safe(created, "textual_declaration"):
        declaration_write = write_text_document(created.textual_declaration, normalize_newline_block(declaration))
    result = {
        "name": name,
        "parent_name": parent_name,
        "parent_found_count": found_count,
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "declaration_write": declaration_write,
        "backup_path": backup_path,
        "saved": False,
        "build": None,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    if build_after:
        result["build"] = build_project(project, True)
    return result


def create_folder_object(project, project_path, command):
    parent_name = command.get("parent_name") or "Application"
    name = command.get("name")
    save_after = bool(command.get("save_after", True))
    backup_before_create = bool(command.get("backup_before_create", True))
    if not name:
        raise Exception("name is required")
    backup_path = None
    if backup_before_create:
        backup_path = make_backup(project_path)
    parent, found_count = select_parent(project, parent_name)
    last_error = None
    created = None
    create_method = None
    attempts = [
        ("create_folder(name)", lambda: parent.create_folder(name)),
        ("create_folder(name=name)", lambda: parent.create_folder(name=name)),
    ]
    for label, fn in attempts:
        try:
            created = fn()
            create_method = label
            break
        except Exception as e:
            last_error = e
            debug_log(label + " failed: " + safe_str(e))
    if created is None:
        raise Exception("Cannot create folder. Last error: " + safe_str(last_error))
    result = {
        "name": name,
        "parent_name": parent_name,
        "parent_found_count": found_count,
        "create_method": create_method,
        "created_object": object_basic_info(created),
        "backup_path": backup_path,
        "saved": False,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    return result


def rename_object(project, project_path, command):
    object_name = command.get("object_name")
    new_name = command.get("new_name")
    object_index = command.get("object_index")
    save_after = bool(command.get("save_after", True))
    backup_before_rename = bool(command.get("backup_before_rename", True))
    if not object_name:
        raise Exception("object_name is required")
    if not new_name:
        raise Exception("new_name is required")
    backup_path = None
    if backup_before_rename:
        backup_path = make_backup(project_path)
    target, found = select_object_by_index_or_best(project, object_name, object_index)
    old_basic = object_basic_info(target)
    target.rename(new_name)
    result = {
        "old_name": object_name,
        "new_name": new_name,
        "found_count": len(found),
        "old_object": old_basic,
        "renamed_object": object_basic_info(target),
        "backup_path": backup_path,
        "saved": False,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    return result


def delete_object(project, project_path, command):
    object_name = command.get("object_name")
    object_index = command.get("object_index")
    save_after = bool(command.get("save_after", True))
    backup_before_delete = bool(command.get("backup_before_delete", True))
    if not object_name:
        raise Exception("object_name is required")
    backup_path = None
    if backup_before_delete:
        backup_path = make_backup(project_path)
    target, found = select_object_by_index_or_best(project, object_name, object_index)
    old_basic = object_basic_info(target)
    target.remove()
    result = {
        "deleted_name": object_name,
        "found_count": len(found),
        "deleted_object": old_basic,
        "backup_path": backup_path,
        "saved": False,
    }
    if save_after:
        result["save"] = save_project(project)
        result["saved"] = True
    return result


def diagnose_system():
    result = {"python_version": safe_str(sys.version), "globals": {}}
    for name in ["projects", "system", "VersionUpdateFlags", "PouType", "DutType", "Guid"]:
        try:
            obj = globals()[name]
            result["globals"][name] = {"available": True, "object": safe_str(obj)}
            try:
                result["globals"][name]["dir"] = [safe_str(x) for x in dir(obj)]
            except Exception as e:
                result["globals"][name]["dir_error"] = safe_str(e)
        except Exception as e:
            result["globals"][name] = {"available": False, "error": safe_str(e)}
    return result


def handle(command):
    action = command.get("action")
    project_path = command.get("project_path")
    debug_log("")
    debug_log("========== COMMAND START ==========")
    debug_log("command_id: " + safe_str(command.get("command_id")))
    debug_log("action: " + safe_str(action))
    debug_log("project_path: " + safe_str(project_path))

    if action == "stop_bridge":
        return {"ok": True, "action": action, "stop_bridge": True}

    if action == "diagnose_system":
        return {"ok": True, "action": action, "diagnostics": diagnose_system()}

    if not project_path:
        raise Exception("project_path is required")

    if action == "create_project":
        result = create_project_compat(
            project_path=project_path,
            overwrite=bool(command.get("overwrite", False)),
        )
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    project = open_project_cached(project_path)

    if action == "open_project":
        return {"ok": True, "action": action, "project_path": project_path, "project": project_info(project, project_path)}

    if action == "close_project":
        result = close_project_compat(
            project=project,
            project_path=project_path,
            save_before_close=bool(command.get("save_before_close", False)),
        )
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "get_project_info":
        return {"ok": True, "action": action, "project_path": project_path, "project": project_info(project, project_path)}

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
            "objects": items,
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
            "selected_object": object_basic_info(target),
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
            "selected_object": object_info(target, include_text),
        }

    if action == "read_current_programs":
        include_text = bool(command.get("include_text", True))
        max_nodes = int(command.get("max_nodes", 300))
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "programs": read_current_programs(project, include_text, max_nodes),
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
            backup_before_write=bool(command.get("backup_before_write", True)),
        )
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

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
            backup_before_write=bool(command.get("backup_before_write", True)),
        )
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "patch_declaration":
        result = patch_object_text(project, project_path, command, "declaration")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "patch_implementation":
        result = patch_object_text(project, project_path, command, "implementation")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_pou":
        result = create_pou_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_gvl":
        result = create_gvl_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_method":
        result = create_member_object(project, project_path, command, "method")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_property":
        result = create_member_object(project, project_path, command, "property")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_action":
        result = create_member_object(project, project_path, command, "action")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_transition":
        result = create_member_object(project, project_path, command, "transition")
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_dut":
        result = create_dut_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_interface":
        result = create_interface_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "create_folder":
        result = create_folder_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "rename_object":
        result = rename_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "delete_object":
        result = delete_object(project, project_path, command)
        return {"ok": True, "action": action, "project_path": project_path, "result": result}

    if action == "save_project":
        return {"ok": True, "action": action, "project_path": project_path, "save": save_project(project)}

    if action == "build_project":
        include_messages = bool(command.get("include_messages", True))
        clear_messages_before_build = bool(command.get("clear_messages_before_build", True))
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "build": build_project(project, include_messages, clear_messages_before_build),
        }

    if action == "get_messages":
        return {"ok": True, "action": action, "project_path": project_path, "messages": collect_messages()}

    if action == "get_project_tree":
        max_depth = int(command.get("max_depth", 1))
        max_nodes = int(command.get("max_nodes", 50))
        include_capabilities = bool(command.get("include_capabilities", False))
        return {
            "ok": True,
            "action": action,
            "project_path": project_path,
            "tree_result": get_project_tree(project, max_depth, max_nodes, include_capabilities),
        }

    raise Exception("Unknown action: " + safe_str(action))


def get_request_files():
    try:
        names = os.listdir(REQUEST_DIR)
    except Exception:
        return []
    result = []
    for name in names:
        if name.lower().endswith(".json"):
            result.append(os.path.join(REQUEST_DIR, name))
    result.sort()
    return result


def process_request_file(request_path):
    command_id = os.path.splitext(os.path.basename(request_path))[0]
    processing_path = os.path.join(PROCESSING_DIR, os.path.basename(request_path))
    archive_path = os.path.join(ARCHIVE_DIR, os.path.basename(request_path))
    result_path = os.path.join(RESULT_DIR, command_id + ".json")
    try:
        if os.path.exists(processing_path):
            os.remove(processing_path)
        os.rename(request_path, processing_path)
    except Exception as e:
        debug_log("cannot move request to processing: " + safe_str(e))
        return False
    try:
        debug_log("processing request: " + processing_path)
        command = read_json(processing_path)
        if "command_id" not in command:
            command["command_id"] = command_id
        result = handle(command)
        if "ok" not in result:
            result["ok"] = True
        write_json_atomic(result_path, result)
        if os.path.exists(archive_path):
            try:
                os.remove(archive_path)
            except Exception:
                pass
        os.rename(processing_path, archive_path)
        debug_log("request processed OK: " + command_id)
        return bool(result.get("stop_bridge", False))
    except Exception as e:
        debug_log("request ERROR: " + safe_str(e))
        debug_log(traceback.format_exc())
        error_result = {
            "ok": False,
            "command_id": command_id,
            "error": safe_str(e),
            "traceback": traceback.format_exc(),
        }
        try:
            write_json_atomic(result_path, error_result)
        except Exception:
            pass
        try:
            error_archive_path = archive_path + ".error"
            if os.path.exists(error_archive_path):
                os.remove(error_archive_path)
            os.rename(processing_path, error_archive_path)
        except Exception:
            pass
        return False


def get_request_files_safe():
    ensure_bridge_dirs()
    return get_request_files()


def main_loop():
    ensure_bridge_dirs()
    touch_ready_file()
    debug_log("")
    debug_log("========================================")
    debug_log("InoProShop MCP persistent bridge START")
    debug_log("Python version: " + safe_str(sys.version))
    debug_log("BRIDGE_ROOT: " + BRIDGE_ROOT)
    debug_log("========================================")
    print("INOPROSHOP_MCP_BRIDGE_READY")
    while True:
        touch_ready_file()
        request_files = get_request_files_safe()
        if len(request_files) == 0:
            time.sleep(POLL_INTERVAL_SEC)
            continue
        for request_path in request_files:
            stop = process_request_file(request_path)
            if stop:
                debug_log("stop_bridge requested")
                debug_log("InoProShop MCP persistent bridge STOP")
                return
        time.sleep(POLL_INTERVAL_SEC)


try:
    main_loop()
except Exception as e:
    debug_log("BRIDGE FATAL ERROR: " + safe_str(e))
    debug_log(traceback.format_exc())
    print("INOPROSHOP_MCP_BRIDGE_FATAL_ERROR")
    print(safe_str(e))
    traceback.print_exc()
