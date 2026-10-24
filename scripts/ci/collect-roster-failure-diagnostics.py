"""Project only bounded roster trace metadata; never open resource payloads."""
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile

TRACE_ROOT = Path("apps/web-admin/test-results/project-roster-real")
MAX_BYTES = 16 * 1024 * 1024
MAX_TRACES = 64
MAX_MEMBERS = 4096
MAX_ROWS = 2000
PROJECTS = ("desktop", "mobile", "unknown")
ACTIONS = {"navigate", "fill", "click", "expect", "create", "close"}
PATHS = {prefix + name for prefix in ("/organization/project-roster/", "/api/organization/project-roster/")
         for name in ("options", "preview", "apply")}
NETWORK_MEMBER = re.compile(r"(?:[0-9]+-)?trace\.network\Z")


def empty_result():
    return {"schemaVersion": 1, "status": "unavailable", "traces": 0,
            "timing": {"actionsOrigin": "firstTestTraceStep",
                       "networkTimeBasis": "playwrightMonotonicTime", "finishedSemantics": "unknown"},
            "projects": {name: {"traces": 0, "actions": [],
                                "network": {"status": "unknown", "requests": []}}
                         for name in PROJECTS}}


def numeric(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def trace_files(root):
    # The only input root is below cwd; do not follow any directory or file link.
    cursor = Path.cwd()
    for part in TRACE_ROOT.parts:
        cursor /= part
        if cursor.is_symlink():
            return [], True
    if not root.is_dir():
        return [], False
    found = []
    visited = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        visited += 1
        if visited > MAX_MEMBERS:
            return found, True
        dirs[:] = sorted(name for name in dirs if not (Path(directory) / name).is_symlink())
        if "trace.zip" in files:
            file = Path(directory) / "trace.zip"
            if file.is_symlink() or not file.is_file():
                continue
            if len(found) == MAX_TRACES:
                return found, True
            found.append(file)
    return found, False


def project_for(file, root):
    candidates = set()
    for part in file.relative_to(root).parts[:-1]:
        match = re.search(r"(?:\A|[-_])(desktop|mobile)\Z", part)
        if match:
            candidates.add(match[1])
    return candidates.pop() if len(candidates) == 1 else "unknown"


def rows(data):
    for line in data.splitlines():
        if line.strip():
            value = json.loads(line)
            if isinstance(value, dict):
                yield value


def actions_from(events):
    starts = {}
    for event in events:
        call = event.get("callId")
        if (event.get("type") == "before" and event.get("class") == "Test"
                and isinstance(call, str) and numeric(event.get("startTime"))):
            starts[call] = event
    origin = min((event["startTime"] for event in starts.values()), default=0)
    result = []
    for event in events:
        before = starts.get(event.get("callId")) if isinstance(event.get("callId"), str) else None
        if (event.get("type") != "after" or before is None or not numeric(event.get("endTime"))
                or event["endTime"] < before["startTime"]):
            continue
        stack = before.get("stack")
        frames = [frame for frame in stack if isinstance(frame, dict)
                  and isinstance(frame.get("file"), str)
                  and frame["file"].endswith("project-roster-real.e2e.ts")] if isinstance(stack, list) else []
        if not frames:
            continue
        title = before.get("title")
        word = title.split(" ", 1)[0].lower() if isinstance(title, str) else ""
        line = frames[0].get("line")
        result.append({"action": word if word in ACTIONS else "other",
                       "sourceLine": line if type(line) is int and 0 < line <= 1000000 else None,
                       "testElapsedAtStartMs": round(before["startTime"] - origin),
                       "durationMs": round(event["endTime"] - before["startTime"]),
                       "failed": "error" in event})
        if len(result) >= MAX_ROWS:
            break
    return result


def requests_from(events):
    result = []
    for event in events:
        snapshot = event.get("snapshot")
        if event.get("type") != "resource-snapshot" or not isinstance(snapshot, dict):
            continue
        request, response = snapshot.get("request"), snapshot.get("response")
        if not isinstance(request, dict) or not isinstance(response, dict):
            continue
        try:
            pathname = urlsplit(request.get("url", "")).path
        except (ValueError, TypeError, AttributeError):
            continue
        method = request.get("method")
        if pathname not in PATHS or method not in ("GET", "POST", "OPTIONS"):
            continue
        status = response.get("status")
        timing = snapshot.get("timings")
        receive = timing.get("receive") if isinstance(timing, dict) else None
        content = response.get("content")
        body = content.get("_file") if isinstance(content, dict) else None
        request_time = snapshot.get("_monotonicTime")
        result.append({"method": method, "path": pathname,
                       "status": status if type(status) is int and 100 <= status <= 599 else None,
                       "requestTime": request_time if numeric(request_time) else None,
                       "receiveTimingKnown": numeric(receive) and receive >= 0,
                       "bodyArtifactPresent": isinstance(body, str) and bool(body),
                       # A 201, HAR time, receive timing or artifact reference is not requestfinished.
                       "finished": None})
        if len(result) >= MAX_ROWS:
            break
    return result


def collect():
    result = empty_result()
    root = Path.cwd() / TRACE_ROOT
    files, incomplete = trace_files(root)
    remaining = MAX_BYTES
    network_complete = {name: True for name in PROJECTS}
    for file in files:
        project = project_for(file, root)
        group = result["projects"][project]
        group["traces"] += 1
        result["traces"] += 1
        try:
            if file.stat().st_size > MAX_BYTES:
                raise ValueError("limit")
            with zipfile.ZipFile(file) as archive:
                members = archive.infolist()
                if len(members) > MAX_MEMBERS:
                    raise ValueError("limit")
                selected = []
                for member in members:
                    name = member.filename
                    path = PurePosixPath(name)
                    if (path.is_absolute() or ".." in path.parts or "\\" in name
                            or re.match(r"[A-Za-z]:", name)):
                        raise ValueError("path")
                    if name == "test.trace" or NETWORK_MEMBER.fullmatch(name):
                        if stat.S_ISLNK(member.external_attr >> 16):
                            raise ValueError("link")
                        selected.append(member)
                if len({member.filename for member in selected}) != len(selected):
                    raise ValueError("duplicate")
                size = sum(member.file_size for member in selected)
                if size > remaining or any(member.file_size > MAX_BYTES for member in selected):
                    raise ValueError("limit")
                remaining -= size
                actions, requests, network_seen = [], [], False
                for member in selected:
                    # No resources, page snapshots, headers or body files are opened.
                    data = archive.read(member)
                    if member.filename == "test.trace":
                        actions = actions_from(list(rows(data)))
                    else:
                        network_seen = True
                        requests.extend(requests_from(rows(data)))
                if (len(actions) >= MAX_ROWS or len(requests) >= MAX_ROWS
                        or len(group["actions"]) + len(actions) > MAX_ROWS
                        or len(group["network"]["requests"]) + len(requests) > MAX_ROWS):
                    incomplete = True
                group["actions"].extend(actions[:MAX_ROWS - len(group["actions"])])
                group["network"]["requests"].extend(requests[:MAX_ROWS - len(group["network"]["requests"])])
                network_complete[project] = network_complete[project] and network_seen
        except Exception:
            # Corrupt/encrypted/unsupported ZIPs must not print exception data.
            incomplete = True
            network_complete[project] = False
    collected = False
    for name, group in result["projects"].items():
        if group["traces"] and network_complete[name] and not incomplete:
            group["network"]["status"] = "collected"
        collected = collected or bool(group["actions"] or group["network"]["requests"])
    result["status"] = "partial" if incomplete and collected else "collected" if collected else "unavailable"
    return result


def atomic_output(file, content):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".roster-diagnostics-", dir=file.parent)
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), stat.S_IRUSR | stat.S_IWUSR)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def main(argv):
    os.umask(0o077)
    output = None
    if argv:
        if len(argv) != 2 or argv[0] != "--output" or not Path(argv[1]).is_absolute():
            print(json.dumps(empty_result()))
            return 2
        output = Path(argv[1])
    try:
        result = collect()
        content = json.dumps(result, allow_nan=False) + "\n"
        if output is not None:
            atomic_output(output, content)
    except Exception:
        print(json.dumps(empty_result()))
        return 1
    print(content, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
