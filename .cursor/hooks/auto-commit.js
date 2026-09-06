#!/usr/bin/env node
/**
 * Auto-commit and push accepted agent edits:
 * - afterFileEdit: stage the edited file
 * - stop / sessionEnd: commit staged changes, then push to origin
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SKIP_PATTERNS = [
  /\.env(\.|$)/i,
  /credentials/i,
  /\.pem$/i,
  /node_modules[/\\]/,
  /\.git[/\\]/,
];

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
  });
}

function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return SKIP_PATTERNS.some((re) => re.test(normalized));
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getGitRoot(startPath) {
  try {
    let cwd = process.cwd();
    if (startPath) {
      cwd =
        fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
          ? startPath
          : path.dirname(startPath);
    }
    return git(["rev-parse", "--show-toplevel"], cwd);
  } catch {
    return null;
  }
}

function stageFile(filePath) {
  if (!filePath || shouldSkip(filePath)) return;

  const gitRoot = getGitRoot(filePath);
  if (!gitRoot) return;

  try {
    git(["add", "--", filePath], gitRoot);
    const rel = path.relative(gitRoot, filePath).replace(/\\/g, "/");
    console.error(`[auto-commit] staged ${rel}`);
  } catch (err) {
    console.error(`[auto-commit] stage failed: ${err.stderr || err.message}`);
  }
}

function pushRemote(gitRoot) {
  try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot);
    try {
      git(["push"], gitRoot);
    } catch (err) {
      const msg = String(err.stderr || err.message || err);
      if (/no upstream|set-upstream|has no upstream/i.test(msg)) {
        git(["push", "-u", "origin", branch], gitRoot);
      } else {
        throw err;
      }
    }
    console.error(`[auto-commit] pushed ${branch} to origin`);
  } catch (err) {
    console.error(`[auto-commit] push failed: ${err.stderr || err.message || err}`);
  }
}

function commitStaged(gitRoot) {
  try {
    const staged = git(["diff", "--cached", "--name-only"], gitRoot);
    if (!staged) return false;

    const files = staged
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    const label =
      files.length === 1
        ? files[0]
        : `${files.slice(0, 3).join(", ")}${files.length > 3 ? ` (+${files.length - 3} more)` : ""}`;
    const message = `chore: accept agent changes (${label})`;

    git(["commit", "-m", message], gitRoot);
    console.error(`[auto-commit] committed ${files.length} file(s)`);
    pushRemote(gitRoot);
    return true;
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    if (/nothing to commit|no changes added/i.test(msg)) return false;
    console.error(`[auto-commit] commit failed: ${msg}`);
    return false;
  }
}

function shouldFinalize(payload) {
  if (typeof payload.status === "string") {
    return payload.status === "completed";
  }
  if (typeof payload.reason === "string") {
    return payload.reason === "completed";
  }
  return false;
}

function finalizeCommit(payload) {
  if (!shouldFinalize(payload)) return;

  const roots = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots
    : [process.cwd()];

  const seen = new Set();
  for (const root of roots) {
    const gitRoot = getGitRoot(root);
    if (!gitRoot || seen.has(gitRoot)) continue;
    seen.add(gitRoot);
    commitStaged(gitRoot);
  }

  if (!seen.size) {
    const gitRoot = getGitRoot(process.cwd());
    if (gitRoot) commitStaged(gitRoot);
  }
}

readStdin()
  .then((raw) => {
    let payload = {};
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      payload = {};
    }

    if (payload.file_path) {
      stageFile(payload.file_path);
      return;
    }

    finalizeCommit(payload);
  })
  .catch((err) => {
    console.error(`[auto-commit] hook error: ${err.message || err}`);
  });
