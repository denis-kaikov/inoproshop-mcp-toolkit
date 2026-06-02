import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "fs/promises";
import { dirname, join, resolve } from "path";

export type ActiveProject = {
  project_path: string;
  project_folder: string;
  name?: string;
  set_at: string;
  source: "explicit_path" | "folder_resolution" | "environment" | "created";
};

export type ProjectCandidate = {
  name: string;
  project_path: string;
  project_folder: string;
};

export type ResolveProjectInput = {
  project_path?: string;
  project_folder?: string;
  name?: string;
};

function defaultBridgeDir(): string {
  return process.env.INOPROSHOP_BRIDGE_DIR || "C:\\Temp\\inoproshop-mcp-bridge";
}

function activeProjectPath(bridgeDir?: string): string {
  return join(bridgeDir || defaultBridgeDir(), "active_project.json");
}

async function ensureBridgeDir(bridgeDir?: string): Promise<void> {
  await mkdir(bridgeDir || defaultBridgeDir(), { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function normalizeWindowsPath(path: string): string {
  return resolve(path);
}

export async function getActiveProject(
  bridgeDir?: string
): Promise<ActiveProject | null> {
  const path = activeProjectPath(bridgeDir);

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed.project_path === "string") {
      return parsed as ActiveProject;
    }

    return null;
  } catch {
    return null;
  }
}

export async function clearActiveProject(bridgeDir?: string): Promise<unknown> {
  const path = activeProjectPath(bridgeDir);

  try {
    await unlink(path);
  } catch {
    // ignore
  }

  return {
    ok: true,
    cleared: true,
    active_project_path: path,
  };
}

export async function findProjectsInFolder(
  folder: string
): Promise<ProjectCandidate[]> {
  if (!(await dirExists(folder))) {
    throw new Error("Project folder does not exist: " + folder);
  }

  const entries = await readdir(folder, { withFileTypes: true });
  const projects: ProjectCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.toLowerCase().endsWith(".project")) {
      continue;
    }

    const projectPath = normalizeWindowsPath(join(folder, entry.name));

    projects.push({
      name: entry.name,
      project_path: projectPath,
      project_folder: normalizeWindowsPath(folder),
    });
  }

  projects.sort(function (a, b) {
    return a.project_path.localeCompare(b.project_path);
  });

  return projects;
}

export async function listProjects(
  root: string,
  recursive: boolean,
  maxDepth: number,
  maxResults: number
): Promise<ProjectCandidate[]> {
  const results: ProjectCandidate[] = [];
  const rootResolved = normalizeWindowsPath(root);

  async function walk(folder: string, depth: number): Promise<void> {
    if (results.length >= maxResults) {
      return;
    }

    let entries;

    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }

      const fullPath = join(folder, entry.name);

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".project")) {
        results.push({
          name: entry.name,
          project_path: normalizeWindowsPath(fullPath),
          project_folder: normalizeWindowsPath(folder),
        });
      }
    }

    if (!recursive || depth >= maxDepth) {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      await walk(join(folder, entry.name), depth + 1);
    }
  }

  await walk(rootResolved, 0);

  results.sort(function (a, b) {
    return a.project_path.localeCompare(b.project_path);
  });

  return results;
}

export async function resolveProjectInput(
  input: ResolveProjectInput
): Promise<ActiveProject> {
  if (input.project_path && input.project_path.length > 0) {
    const projectPath = normalizeWindowsPath(input.project_path);

    if (!(await fileExists(projectPath))) {
      throw new Error("Project file does not exist: " + projectPath);
    }

    return {
      project_path: projectPath,
      project_folder: dirname(projectPath),
      name: input.name,
      set_at: new Date().toISOString(),
      source: "explicit_path",
    };
  }

  if (input.project_folder && input.project_folder.length > 0) {
    const folder = normalizeWindowsPath(input.project_folder);
    const projects = await findProjectsInFolder(folder);

    if (projects.length === 0) {
      throw new Error("No .project files found in folder: " + folder);
    }

    if (projects.length > 1) {
      throw new Error(
        "Multiple .project files found in folder. Pass project_path explicitly: " +
          JSON.stringify(projects, null, 2)
      );
    }

    return {
      project_path: projects[0].project_path,
      project_folder: projects[0].project_folder,
      name: input.name,
      set_at: new Date().toISOString(),
      source: "folder_resolution",
    };
  }

  throw new Error("Either project_path or project_folder is required.");
}

export async function setActiveProject(
  input: ResolveProjectInput,
  bridgeDir?: string
): Promise<ActiveProject> {
  await ensureBridgeDir(bridgeDir);

  const project = await resolveProjectInput(input);

  await writeFile(
    activeProjectPath(bridgeDir),
    JSON.stringify(project, null, 2),
    "utf8"
  );

  return project;
}

export async function setActiveProjectFromCreatedPath(
  projectPath: string,
  name: string | undefined,
  bridgeDir?: string
): Promise<ActiveProject> {
  await ensureBridgeDir(bridgeDir);

  const normalized = normalizeWindowsPath(projectPath);

  const project: ActiveProject = {
    project_path: normalized,
    project_folder: dirname(normalized),
    name,
    set_at: new Date().toISOString(),
    source: "created",
  };

  await writeFile(
    activeProjectPath(bridgeDir),
    JSON.stringify(project, null, 2),
    "utf8"
  );

  return project;
}

export async function resolveEffectiveProjectPath(
  args: any,
  bridgeDir?: string
): Promise<string> {
  if (args && typeof args.project_path === "string" && args.project_path.length > 0) {
    const project = await resolveProjectInput({
      project_path: args.project_path,
    });

    return project.project_path;
  }

  if (
    args &&
    typeof args.project_folder === "string" &&
    args.project_folder.length > 0
  ) {
    const project = await resolveProjectInput({
      project_folder: args.project_folder,
    });

    return project.project_path;
  }

  const active = await getActiveProject(bridgeDir);

  if (active) {
    return active.project_path;
  }

  if (process.env.INOPROSHOP_PROJECT && process.env.INOPROSHOP_PROJECT.length > 0) {
    const project = await resolveProjectInput({
      project_path: process.env.INOPROSHOP_PROJECT,
    });

    return project.project_path;
  }

  throw new Error(
    "No active InoProShop project selected. Use inoproshop_set_project or pass project_path."
  );
}

export function buildProjectPathFromFolder(
  projectFolder: string,
  project_file_name?: string
): string {
  const fileName =
    project_file_name && project_file_name.length > 0
      ? project_file_name
      : "PLC.project";

  return normalizeWindowsPath(join(projectFolder, fileName));
}
