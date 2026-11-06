"""Task11 test-only inspection: semantic extraction alone is never glyph proof.
Dependencies are pinned in scripts/probes/task08-documents/requirements.txt.
"""
import sys, os, json, shutil, hashlib, zipfile, xml.etree.ElementTree as ET, collections, io, re, platform
from pathlib import Path
import pymupdf
import fontTools
from fontTools.ttLib import TTFont

source, pdf_path, output, manifest_path = map(Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text())
if manifest.get("schemaVersion") != 1: raise ValueError("Unsupported explicit runtime manifest")
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
versions = {"python": platform.python_version(), "pymupdf": pymupdf.VersionBind, "fonttools": fontTools.__version__}
if versions != manifest["tools"]: raise ValueError("Explicit inspector versions differ from runtime manifest")
root = Path(__file__).resolve().parents[3]
lock = json.loads((root / "scripts/probes/task08-documents/docx4j/runtime-lock.json").read_text())
approved = {f["sha256"] for f in lock["fonts"]}
workspace = Path(manifest["workspace"]).resolve()
if manifest_path.resolve().parent != workspace: raise ValueError("Manifest must belong to its isolated runtime workspace")
fonts = []
normalize = lambda s: re.sub(r"[\s_+\-]", "", s).lower()
for item in manifest["fonts"]:
 p = Path(item["path"]).resolve()
 if not p.is_relative_to(workspace) or item["sha256"] not in approved or sha(p) != item["sha256"]: raise ValueError("Unpinned or changed runtime font")
 font = TTFont(p)
 fonts.append({"path": str(p), "sha256": item["sha256"], "names": {normalize(n.toUnicode()) for n in font["name"].names if n.nameID in [1,4,6]}})
for item in [manifest["converter"]["wrapper"], manifest["converter"]["native"]]:
 if sha(item["path"]) != item["sha256"]: raise ValueError("Converter runtime hash changed")
resolved_converter = shutil.which("soffice")
if not resolved_converter or Path(resolved_converter).resolve() != Path(manifest["converter"]["wrapper"]["path"]).resolve(): raise ValueError("PATH converter differs from witnessed runtime; no silent fallback")
mode = os.environ.get("TEMPLATE_PDF_RUNTIME_MODE")
config = manifest["fontconfig"]
if mode == "default-control":
 if os.environ.get("FONTCONFIG_FILE") is not None: raise ValueError("Default RED control must not override FONTCONFIG_FILE")
elif mode == "font-profile":
 if os.environ.get("FONTCONFIG_FILE") != config["path"] or sha(config["path"]) != config["sha256"]: raise ValueError("Missing or changed explicit FONTCONFIG_FILE")
 parsed = ET.parse(config["path"]).getroot()
 if parsed.findall("include") or [n.text for n in parsed.findall("dir")] != [manifest["fontDirectory"]] or [n.text for n in parsed.findall("cachedir")] != [manifest["cacheDirectory"]]: raise ValueError("Runtime font/cache directories must be explicit and isolated")
 for directory in [manifest["fontDirectory"],manifest["cacheDirectory"]]:
  if not Path(directory).resolve().is_relative_to(workspace): raise ValueError("Runtime directory outside isolated workspace")
else: raise ValueError("Set TEMPLATE_PDF_RUNTIME_MODE explicitly; no silent runtime fallback")
for name in ["FONTCONFIG_PATH","SAL_FONTPATH","SAL_FONTPATH_PRIVATE","SAL_NON_APPLICATION_FONT_USE","DOC_CONVERTER_COMMAND","DOC_ALLOWED_FONTS"]:
 if name in os.environ: raise ValueError("Unexpected font/converter override: " + name)
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
with zipfile.ZipFile(source) as z:
 doc = ET.fromstring(z.read("word/document.xml"))
 source_text = "".join(n.text or "" for n in doc.iter(W+"t"))
 declarations = [{k.split("}")[-1]:v for k,v in n.attrib.items()} for n in doc.iter(W+"rFonts")]
source_cjk = {c for c in source_text if "\u3400" <= c <= "\u9fff"}

def allowed_names(attribute):
 result = set()
 for name in {d[attribute] for d in declarations if d.get(attribute)}:
  matching = [f for f in fonts if normalize(name) in f["names"]]
  if not matching: raise ValueError("Source declaration absent from locked runtime font families")
  for f in matching: result |= f["names"]
 return result
allowed_cjk, allowed_ascii = allowed_names("eastAsia"), allowed_names("ascii")
pdf = pymupdf.open(pdf_path)
semantic = "\n".join(page.get_text() for page in pdf)
semantic_cjk = {c for c in semantic if "\u3400" <= c <= "\u9fff"}
programs = []; physical = set(); empty = []; zero = []; cjk_families = set(); ascii_families = set(); failures = []
for number, page in enumerate(pdf):
 used = collections.defaultdict(set); cjk_fonts = set(); ascii_fonts = set()
 for span in page.get_texttrace():
  for c in span["chars"]:
   if 0x3400 <= c[0] <= 0x9fff:
    used[span["font"]].add(c[1]); cjk_fonts.add(span["font"])
    if c[1] == 0: zero.append({"page":number+1,"font":span["font"],"glyph":0})
    else: physical.add((span["font"],c[1]))
   elif chr(c[0]).isascii() and chr(c[0]).isalnum(): ascii_fonts.add(span["font"])
 for f in page.get_fonts(full=True):
  if not f[0]: continue
  _,_,_,data = pdf.extract_font(f[0])
  if not data: failures.append("UNEMBEDDED_FONT"); continue
  t = TTFont(io.BytesIO(data)); name = f[3].split("+")[-1]
  names = {normalize(v.toUnicode()) for v in t["name"].names if v.nameID in [1,4,6]}
  if name in cjk_fonts: cjk_families |= names
  if name in ascii_fonts: ascii_families |= names
  if name in used:
   if "glyf" not in t: raise ValueError("Physical outline inspection requires the fixture's TrueType fonts")
   for gid in used[name]:
    glyph = t["glyf"][t.getGlyphOrder()[gid]]
    if glyph.numberOfContours == 0 and not glyph.isComposite(): empty.append({"page":number+1,"font":name,"glyph":gid})
  programs.append({"page":number+1,"baseFont":f[3],"familyNames":sorted(names),"glyphCount":t["maxp"].numGlyphs,"sha256":hashlib.sha256(data).hexdigest()})
 if abs(page.rect.width-595.3)>2 or abs(page.rect.height-841.9)>2: failures.append("NOT_A4_PORTRAIT")
 page.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(output.parent / ("page-%d.png" % (number+1)))
# Semantic text supplies a coverage target, not physical proof; existing public tests
# independently assert all business literals. Empty outlines and substitution cannot pass.
if source_cjk and not semantic_cjk: failures.append("MISSING_CHINESE_TEXT")
if len(physical) < len(semantic_cjk) or source_cjk and not physical: failures.append("DISTINCT_CHINESE_GLYPH_COLLAPSE")
if zero: failures.append("NOTDEF_GLYPH_ZERO")
if empty: failures.append("EMPTY_CHINESE_GLYPH_OUTLINE")
if source_cjk and (not cjk_families or not cjk_families <= allowed_cjk): failures.append("DECLARED_CHINESE_FONT_SUBSTITUTED")
if ascii_families and not ascii_families <= allowed_ascii: failures.append("DECLARED_ASCII_FONT_SUBSTITUTED")
receipt={"verdict":"RED" if failures else "GREEN","failures":sorted(set(failures)),"runtimeMode":mode,"resolvedConverter":resolved_converter,"fontconfigApplied":mode=="font-profile","tools":versions,"runtimeManifestSha256":sha(manifest_path),"fontconfigSha256":config["sha256"],"sourceSha256":sha(source),"pdfSha256":sha(pdf_path),"semanticDistinctChinese":len(semantic_cjk),"physicalDistinctChineseGlyphs":len(physical),"emptyOutlines":empty,"notdef":zero,"programs":programs,"declaredFonts":declarations,"pageCount":len(pdf)}
for item in manifest["fonts"]:
 if sha(item["path"]) != item["sha256"]: raise ValueError("Runtime font changed during inspection")
output.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({k:receipt[k] for k in ["verdict","failures","semanticDistinctChinese","physicalDistinctChineseGlyphs","pdfSha256"]},ensure_ascii=False))
if failures: sys.exit(1)
print("---SEMANTIC-TEXT---")
print(semantic)
