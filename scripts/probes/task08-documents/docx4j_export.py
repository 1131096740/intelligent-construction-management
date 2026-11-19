"""Fixed, task-local offline adapter. No installer, shell or fallback engine."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
from zipfile import ZipFile

from lxml import etree as E

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_digest(root):
    rows = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            if not path.resolve().is_relative_to(root):
                raise ValueError("runtime link escapes pinned JDK")
            rows.append([relative, "link", str(path.readlink())])
        elif path.is_file():
            rows.append([relative, "file", sha(path), stat.S_IMODE(path.stat().st_mode)])
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest(), len(rows)


def validate_runtime(manifest):
    lock = json.loads((HERE / "docx4j/runtime-lock.json").read_text())
    if json.loads(manifest.read_text()) != lock:
        raise ValueError("runtime manifest differs from pinned task lock")
    if sha(HERE / "docx4j/Task08Fo.java") != lock["adapterSourceSha256"]:
        raise ValueError("adapter source hash mismatch")
    jdk = Path(lock["jdkHome"])
    if tree_digest(jdk) != (lock["jdkTreeSha256"], lock["jdkTreeEntries"]):
        raise ValueError("pinned JDK tree mismatch")
    for item in lock["jars"] + lock["classes"] + lock["fonts"]:
        path = Path(item["path"])
        if path.is_symlink() or sha(path) != item["sha256"]:
            raise ValueError("pinned runtime or font file mismatch")
    return lock


def validate_docx(source):
    with ZipFile(source) as archive:
        if sum(item.file_size for item in archive.infolist()) > 20_000_000:
            raise ValueError("probe document exceeds size bound")
        for name in archive.namelist():
            if not name.endswith((".xml", ".rels")):
                continue
            data = archive.read(name)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError("document XML entity declarations rejected")
            root = E.fromstring(data, E.XMLParser(resolve_entities=False, no_network=True))
            if name.endswith(".rels"):
                for relation in root:
                    target = relation.get("Target", "")
                    if relation.get("TargetMode") == "External" or ":" in target or target.startswith("//"):
                        raise ValueError("document external relationships rejected")
            for value in root.xpath('//*[local-name()="instrText"]/text()'):
                if any(token in value.upper() for token in ["INCLUDETEXT", "INCLUDEPICTURE", "DDE", "HYPERLINK", "DATABASE", " LINK "]):
                    raise ValueError("document external field instruction rejected")


def policy_text(lock, scratch):
    paths = [(str(scratch), "read"), (str(scratch) + "/-", "read,write,delete"), (lock["jdkHome"] + "/-", "read")]
    paths += [(item["path"], "read") for item in lock["jars"] + lock["fonts"]]
    lines = ['  permission java.io.FilePermission ' + json.dumps(path, ensure_ascii=False) + ', "' + actions + '";' for path, actions in paths]
    lines += ['  permission java.util.PropertyPermission "*", "read,write";', '  permission java.lang.reflect.ReflectPermission "suppressAccessChecks";']
    lines += ['  permission java.lang.RuntimePermission "' + permission + '";' for permission in ["getClassLoader", "setContextClassLoader", "createClassLoader", "accessDeclaredMembers", "getProtectionDomain", "loadLibrary.fontmanager", "loadLibrary.awt", "loadLibrary.awt_headless"]]
    return "grant {\n" + "\n".join(lines) + "\n};\n"


def export_pdf(source, output, manifest):
    receipt_path = output.with_suffix(".export.json")
    if output.exists() or output.is_symlink() or receipt_path.exists():
        raise ValueError("new PDF and receipt paths required")
    lock = validate_runtime(manifest)
    validate_docx(source)
    input_sha = sha(source)
    runs = Path(lock["toolRoot"]) / "public-cli-runs"
    runs.mkdir(exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="export-", dir=runs))
    for folder in ["classes", "home", "tmp"]:
        (scratch / folder).mkdir()
    shutil.copyfile(source, scratch / "input.docx")
    for item in lock["classes"]:
        shutil.copyfile(item["path"], scratch / "classes" / Path(item["path"]).name)
    policy = scratch / "offline.policy"
    policy.write_text(policy_text(lock, scratch))
    receipt = {"status": "STARTED", "engine": lock["engine"], "scratch": str(scratch), "sourceSha256": input_sha, "runtimeManifestSha256": sha(manifest), "runtimeLockSha256": sha(HERE / "docx4j/runtime-lock.json"), "jdkTreeSha256": lock["jdkTreeSha256"], "policySha256": sha(policy), "adapterSourceSha256": lock["adapterSourceSha256"], "conversionCalls": 0}
    with receipt_path.open("x") as stream:
        json.dump(receipt, stream, indent=2)
    args = [str(Path(lock["jdkHome"]) / "bin/java"), "-Djava.security.manager", "-Djava.security.policy==" + str(policy), "-Duser.home=" + str(scratch / "home"), "-Djava.io.tmpdir=" + str(scratch / "tmp"), "-Djava.awt.headless=true", "-Djavax.xml.accessExternalDTD=", "-Djavax.xml.accessExternalSchema=", "-Djavax.xml.accessExternalStylesheet=file,jar", "-cp", ":".join([str(scratch / "classes")] + [item["path"] for item in lock["jars"]]), "Task08Fo", str(scratch / "input.docx"), str(scratch / "output.pdf")]
    # Never inherit JVM options, agents, classpaths or dynamic-loader injection.
    # This changes only the new child environment, not global HOME/environment.
    environment = {"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8", "TMPDIR": str(scratch / "tmp")}
    receipt["childEnvironmentKeys"] = sorted(environment)
    try:
        result = subprocess.run(args, cwd=scratch, capture_output=True, timeout=120, env=environment)
        (scratch / "stdout.log").write_bytes(result.stdout)
        (scratch / "stderr.log").write_bytes(result.stderr)
        receipt["exitCode"] = result.returncode
        receipt["networkAndOutsideFileDenied"] = b"BOUNDARY_NETWORK_CONNECT_DNS_AND_OUTSIDE_FILE_DENIED=3" in result.stdout
        receipt["conversionCalls"] = result.stdout.count(b"CONVERSION_CALL_BEGIN")
        if result.returncode or not receipt["networkAndOutsideFileDenied"] or receipt["conversionCalls"] != 1 or b"CONVERSION_CALL_COMPLETE" not in result.stdout:
            raise ValueError("offline adapter stopped; inspect retained receipt and logs")
        if sha(source) != input_sha:
            raise ValueError("source document changed during export")
        for item in lock["jars"] + lock["fonts"]:
            if sha(Path(item["path"])) != item["sha256"]:
                raise ValueError("pinned file changed during export")
        # No embedded or base-14 substitute can silently become an accepted
        # result. Full content/layout verification remains independent.
        import pymupdf
        allowed = {name for item in lock["fonts"] for face in item["faces"] for name in face["names"]}
        used = set()
        with pymupdf.open(scratch / "output.pdf") as document:
            for page in document:
                for font in page.get_fonts(full=True):
                    name, _, _, data = document.extract_font(font[0])
                    family = re.sub(r"^[A-Z]{6}\+", "", name)
                    if not data or family not in allowed:
                        raise ValueError("unembedded or unapproved output font rejected")
                    used.add(family)
        with output.open("xb") as stream:
            stream.write((scratch / "output.pdf").read_bytes())
        receipt.update({"status": "EXPORTED_REQUIRES_INDEPENDENT_FIDELITY_CHECKS", "pdfSha256": sha(output), "usedFontNames": sorted(used), "sourceAndPinnedFilesUnchanged": True})
    except Exception as error:
        if isinstance(error, subprocess.TimeoutExpired):
            stdout, stderr = error.stdout or b"", error.stderr or b""
            (scratch / "stdout.log").write_bytes(stdout)
            (scratch / "stderr.log").write_bytes(stderr)
            receipt["conversionCalls"] = stdout.count(b"CONVERSION_CALL_BEGIN")
            receipt["networkAndOutsideFileDenied"] = b"BOUNDARY_NETWORK_CONNECT_DNS_AND_OUTSIDE_FILE_DENIED=3" in stdout
        receipt.update({"status": "FAILED_NO_FALLBACK_NO_RETRY", "failureClass": type(error).__name__})
        raise
    finally:
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
