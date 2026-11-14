import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.docx4j.Docx4J;
import org.docx4j.convert.out.FOSettings;
import org.docx4j.fonts.*;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.docx4j.wml.Fonts;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.nio.ByteBuffer;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.xml.sax.InputSource;
import org.w3c.dom.*;
import org.docx4j.XmlUtils;
import org.docx4j.jaxb.Context;
import org.docx4j.wml.P;
import org.docx4j.wml.CTBookmark;
import org.docx4j.wml.CTMarkupRange;
import org.docx4j.convert.out.FORenderer;
import org.docx4j.convert.out.fo.renderers.FORendererApacheFOP;


/** Fixed offline adapter. All paths are provided by the hash-validated parent. */
public final class ContractDocxPdf {
  private static final long PDF_BYTE_LIMIT = 100_000_000L;

  /** Public fixed-budget sink used by production conversion and offline checks. */
  public static OutputStream boundedPdfOutput(OutputStream target) {
    return new BoundedPdfOutputStream(Objects.requireNonNull(target));
  }

  private static final class BoundedPdfOutputStream extends FilterOutputStream {
    private long written;
    BoundedPdfOutputStream(OutputStream target) { super(target); }
    public void write(int value) throws IOException {
      if (written >= PDF_BYTE_LIMIT) throw new IOException("PDF output byte budget exceeded");
      out.write(value);
      written++;
    }
    public void write(byte[] value, int offset, int length) throws IOException {
      Objects.checkFromIndexSize(offset, length, value.length);
      if (length > PDF_BYTE_LIMIT - written) throw new IOException("PDF output byte budget exceeded");
      out.write(value, offset, length);
      written += length;
    }
  }

  private static void boundary() throws Exception {
    if (System.getSecurityManager() == null) throw new IllegalStateException("SecurityManager absent");
    int denied = 0;
    try { new Socket("127.0.0.1", 9); } catch (SecurityException expected) { denied++; }
    try { InetAddress.getByName("jg-docx-no-network.invalid"); } catch (SecurityException expected) { denied++; }
    try { AccessController.checkPermission(new FilePermission("/__jg_docx_outside__", "read,write")); }
    catch (SecurityException expected) { denied++; }
    if (denied != 3) throw new IllegalStateException("Offline boundary not established");
    System.out.println("DOCX4J_BOUNDARY_DENIED=3");
  }

  private static PhysicalFont font(String alias, String file, String familyNeedle) {
    Path expected = Path.of(file).toAbsolutePath().normalize();
    List<PhysicalFont> faces = PhysicalFonts.getPhysicalFont(alias, expected.toUri());
    if (faces == null || faces.isEmpty()) throw new IllegalStateException("Exact font unavailable");
    for (PhysicalFont face : faces) {
      String name = face.getName() + " " + face.getFamilyName();
      if (familyNeedle != null && !name.toLowerCase(Locale.ROOT).contains(familyNeedle.toLowerCase(Locale.ROOT))) continue;
      if (!Path.of(face.getEmbeddedURI()).toAbsolutePath().normalize().equals(expected)) throw new IllegalStateException("Font source changed");
      return face;
    }
    throw new IllegalStateException("Exact font face unavailable");
  }


  // Scoped V4 implementation follows; original offline boundary and PDF sink above are retained.
  private static final String W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  private static final String FO = "http://www.w3.org/1999/XSL/Format";
  private static final String LINE_NS = "http://docx4j.org/fop/word-layout";
  private static final String PROFILE = "reviewed-material-primary-secondary-body25-v4";
  private static final String MOTHER_SHA = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
  private static final String PREFIX = "JG25V4_";
  private static final int XML_LIMIT = 256000;
  private static final Set<String> LINE_ATTRS = Set.of("line-box", "baseline", "line-rule");

  private static void check(boolean value, String message) {
    if (!value) throw new IllegalStateException(message);
  }
  private static boolean hash(String value) { return value.matches("[a-f0-9]{64}"); }
  private static String hex(byte[] value) { return HexFormat.of().formatHex(value); }
  private static String textSha(String text) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
  }
  private static String fileSha(Path path) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(path)) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = in.read(buffer)) != -1) digest.update(buffer, 0, count);
    }
    return hex(digest.digest());
  }
  private static Path regular(String value) throws Exception {
    Path path = Path.of(value);
    check(path.isAbsolute() && path.equals(path.normalize()) && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
        && !Files.isSymbolicLink(path) && path.toRealPath().equals(path), "Canonical regular input required");
    return path;
  }
  private static DocumentBuilderFactory xmlFactory() throws Exception {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newDefaultInstance();
    factory.setNamespaceAware(true); factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, ""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
    return factory;
  }
  private static Document xml(String value) throws Exception {
    return xmlFactory().newDocumentBuilder().parse(new InputSource(new StringReader(value)));
  }
  private static String ns(Node node) { return node.getNamespaceURI() == null ? "" : node.getNamespaceURI(); }
  private static String local(Node node) { return node.getLocalName() == null ? node.getNodeName() : node.getLocalName(); }
  private static boolean named(Node node, String namespace, String name) {
    return node.getNodeType() == Node.ELEMENT_NODE && ns(node).equals(namespace) && local(node).equals(name);
  }
  private static List<Element> elements(Node parent) {
    List<Element> result = new ArrayList<>();
    for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
      if (node instanceof Element) result.add((Element) node);
      else check(node.getNodeType() == Node.TEXT_NODE && node.getNodeValue().matches("[ \\t\\r\\n]*"), "Unexpected scope XML content");
    }
    return result;
  }
  private static void attributes(Element element, Set<String> expected) {
    NamedNodeMap attrs = element.getAttributes(); Set<String> actual = new HashSet<>();
    for (int i = 0; i < attrs.getLength(); i++) {
      Node attr = attrs.item(i); check(ns(attr).isEmpty(), "Scope attributes must not be namespaced"); actual.add(attr.getNodeName());
    }
    check(actual.equals(expected), "Scope attribute schema differs");
  }
  private static int ordinal(String value) {
    check(value.matches("0|[1-9][0-9]{0,9}"), "Nonnegative canonical integer required");
    return Integer.parseInt(value);
  }
  private static final class Row {
    final int ordinal; final String positionId, textSha; String marker;
    int foBlockOrdinal, fontIndex; String metricFamily, ascent, descent, baseline;
    Row(int ordinal, String positionId, String textSha) { this.ordinal = ordinal; this.positionId = positionId; this.textSha = textSha; }
  }
  private static final class Scope {
    final Path input, scopeFile, proof; final String docxSha, scopeSha; final List<Row> rows;
    final Map<Path,String> fontHashes = new LinkedHashMap<>(); final List<Path> fontPaths = new ArrayList<>();
    Scope(Path input, Path scopeFile, String docxSha, String scopeSha, List<Row> rows) {
      this.input=input; this.scopeFile=scopeFile; this.proof=scopeFile.resolveSibling("body25-scope-proof.xml"); this.docxSha=docxSha; this.scopeSha=scopeSha; this.rows=rows;
    }
  }
  private static Scope readScope(String[] args) throws Exception {
    Path input=regular(args[0]), scopeFile=regular(args[13]), output=Path.of(args[1]);
    check(scopeFile.getParent().equals(input.getParent()) && output.isAbsolute() && output.equals(output.normalize())
        && output.getParent().equals(input.getParent()) && !Files.exists(output, LinkOption.NOFOLLOW_LINKS), "Owned sibling paths required");
    check(Files.size(scopeFile)<=XML_LIMIT, "Scope XML byte cap"); byte[] bytes;
    try (InputStream in=Files.newInputStream(scopeFile)) { bytes=in.readNBytes(XML_LIMIT+1); }
    check(bytes.length<=XML_LIMIT, "Scope XML bounded read cap");
    String value=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    Document dom=xml(value); Element root=dom.getDocumentElement();
    check(elements(dom).size()==1, "Single strict scope document root required");
    check(named(root,"","bodyLineBoxScope"), "Exact scope root required");
    attributes(root, Set.of("version","typographyVersion","sourceSha256","docxSha256","count"));
    check(root.getAttribute("version").equals("1") && root.getAttribute("typographyVersion").equals(PROFILE)
        && root.getAttribute("sourceSha256").equals(MOTHER_SHA), "Closed V4 source/profile required");
    String docxSha=root.getAttribute("docxSha256"); check(hash(docxSha) && fileSha(input).equals(docxSha), "Actual uploaded Word SHA mismatch");
    int count=ordinal(root.getAttribute("count")); check(count<=654, "Existing source154 plus500 additions scope cap");
    List<Row> rows=new ArrayList<>(); Set<Integer> ordinals=new HashSet<>(); Set<String> ids=new HashSet<>();
    for (Element child: elements(root)) {
      check(rows.size()<count, "Scope entries exceed declared bounded count");
      check(named(child,"","paragraph"), "Scope paragraph required"); attributes(child,Set.of("ordinal","positionId","textSha256"));
      check(elements(child).isEmpty(), "Scope entry must be empty");
      int index=ordinal(child.getAttribute("ordinal")); String id=child.getAttribute("positionId"), literalSha=child.getAttribute("textSha256");
      check(id.length()>0 && id.length()<=70 && id.matches("[A-Za-z0-9_:\\-]+") && hash(literalSha), "Bounded opaque identity or SHA invalid");
      check(ordinals.add(index) && ids.add(id), "Duplicate scope ownership"); rows.add(new Row(index,id,literalSha));
    }
    check(rows.size()==count, "Scope count mismatch"); Scope result=new Scope(input,scopeFile,docxSha,hex(MessageDigest.getInstance("SHA-256").digest(bytes)),rows);
    check(!Files.exists(result.proof,LinkOption.NOFOLLOW_LINKS), "Proof path already exists");
    for (int i=2;i<12;i++) { Path font=regular(args[i]); result.fontPaths.add(font); result.fontHashes.put(font,fileSha(font)); }
    check(result.fontHashes.size()==10, "Ten distinct locked font files required"); return result;
  }
  private static String paragraphLiteral(P paragraph) throws Exception {
    // The server's digest is exactly join(w:t), not paragraph-mark or field instruction text.
    Document dom=xml(XmlUtils.marshaltoString(paragraph,true,true)); NodeList texts=dom.getElementsByTagNameNS(W,"t"); StringBuilder result=new StringBuilder();
    for (int i=0;i<texts.getLength();i++) result.append(texts.item(i).getTextContent()); return result.toString();
  }
  private static void installMarkers(WordprocessingMLPackage document, Scope scope) throws Exception {
    Document original=xml(XmlUtils.marshaltoString(document.getMainDocumentPart().getJaxbElement(),true,true));
    Set<String> names=new HashSet<>(); Set<BigInteger> ids=new HashSet<>(); BigInteger next=BigInteger.ZERO;
    for (String kind:List.of("bookmarkStart","bookmarkEnd")) {
      NodeList nodes=original.getElementsByTagNameNS(W,kind);
      for (int i=0;i<nodes.getLength();i++) {
        Element node=(Element)nodes.item(i); String id=node.getAttributeNS(W,"id");
        check(id.matches("[0-9]{1,12}"), "Existing bookmark numeric identity unsupported"); BigInteger number=new BigInteger(id); ids.add(number); next=next.max(number.add(BigInteger.ONE));
        if (kind.equals("bookmarkStart")) { String name=node.getAttributeNS(W,"name"); check(!name.startsWith(PREFIX),"Sentinel prefix collision"); names.add(name); }
      }
    }
    List<P> paragraphs=new ArrayList<>();
    for (Object child:document.getMainDocumentPart().getContent()) { Object item=XmlUtils.unwrap(child); if (item instanceof P) paragraphs.add((P)item); }
    for (Row row:scope.rows) {
      check(row.ordinal<paragraphs.size(), "Target is not a direct body paragraph"); P paragraph=paragraphs.get(row.ordinal);
      check(textSha(paragraphLiteral(paragraph)).equals(row.textSha), "Exact target paragraph text ownership differs");
      row.marker=PREFIX+row.ordinal+"_"+textSha(row.positionId).substring(0,16);
      check(row.marker.length()<=40 && names.add(row.marker) && ids.add(next), "Sentinel identity collision");
      CTBookmark begin=Context.getWmlObjectFactory().createCTBookmark(); begin.setId(next); begin.setName(row.marker);
      CTMarkupRange end=Context.getWmlObjectFactory().createCTMarkupRange(); end.setId(next); next=next.add(BigInteger.ONE);
      paragraph.getContent().add(0,Context.getWmlObjectFactory().createPBookmarkEnd(end));
      paragraph.getContent().add(0,Context.getWmlObjectFactory().createPBookmarkStart(begin));
    }
  }
  private static String inherited(Element element, String name) {
    for (Node node=element;node instanceof Element;node=node.getParentNode()) {
      Element current=(Element)node; if (current.hasAttribute(name)) return current.getAttribute(name);
    }
    throw new IllegalStateException("Effective FO property absent: "+name);
  }
  private static BigDecimal pt(String value) {
    check(value.endsWith("pt"), "Effective FO size must be absolute pt");
    BigDecimal result=new BigDecimal(value.substring(0,value.length()-2)); check(result.signum()>0,"Positive effective FO size required"); return result;
  }
  private static String decimal(BigDecimal value) { return value.stripTrailingZeros().toPlainString(); }
  private static Element nearestBlock(Element marker) {
    for (Node node=marker.getParentNode();node instanceof Element;node=node.getParentNode()) {
      check(ns(node).equals(FO),"Target entered foreign namespace");
      if (local(node).equals("block")) return (Element)node;
      check(!Set.of("table","table-cell","block-container","flow","root").contains(local(node)), "Target lacks a unique paragraph block");
    }
    throw new IllegalStateException("Target paragraph block absent");
  }
  private static Map<String,Element> markers(Document dom, Scope scope) {
    Map<String,Element> result=new LinkedHashMap<>(); Set<String> wanted=new HashSet<>(); for (Row row:scope.rows) wanted.add(row.marker);
    NodeList all=dom.getElementsByTagNameNS("*","*");
    for (int i=0;i<all.getLength();i++) {
      Element element=(Element)all.item(i); String id=element.getAttribute("id");
      if (!wanted.contains(id)) { check(!id.startsWith(PREFIX),"Unexpected own-prefix FO identity"); continue; }
      check(named(element,FO,"inline") && semanticAttributes(element,false).size()==1 && !element.hasChildNodes(), "Sentinel is not the exact empty inline");
      check(result.put(id,element)==null,"FO sentinel missing or duplicated");
    }
    check(result.size()==scope.rows.size(),"FO sentinel inventory incomplete");
    for (int i=0;i<all.getLength();i++) {
      Element element=(Element)all.item(i); NamedNodeMap attrs=element.getAttributes();
      for(int j=0;j<attrs.getLength();j++) { Node attr=attrs.item(j); if (wanted.contains(attr.getNodeValue())) check(result.get(attr.getNodeValue())==element && attr.getNodeName().equals("id"),"Sentinel acquired an FO reference"); }
    }
    return result;
  }
  private static SortedMap<String,String> semanticAttributes(Element element, boolean target) {
    SortedMap<String,String> result=new TreeMap<>(); NamedNodeMap attrs=element.getAttributes();
    for(int i=0;i<attrs.getLength();i++) {
      Node attr=attrs.item(i); if(ns(attr).equals(XMLConstants.XMLNS_ATTRIBUTE_NS_URI)) continue;
      if(target && ns(attr).equals(LINE_NS) && LINE_ATTRS.contains(local(attr))) continue;
      result.put(ns(attr)+"\u0000"+local(attr),attr.getNodeValue());
    }
    return result;
  }
  private static boolean sameSemantics(Node before,Node after,Set<Element> beforeTargets,Set<Element> afterTargets) {
    if(before.getNodeType()!=after.getNodeType()) return false;
    if(before instanceof Element) {
      boolean bt=beforeTargets.contains(before),at=afterTargets.contains(after);
      if(bt!=at || !ns(before).equals(ns(after)) || !local(before).equals(local(after))
          || !semanticAttributes((Element)before,bt).equals(semanticAttributes((Element)after,at))) return false;
    } else if(!Objects.equals(before.getNodeValue(),after.getNodeValue())) return false;
    Node a=before.getFirstChild(),b=after.getFirstChild();
    while(a!=null && b!=null) { if(!sameSemantics(a,b,beforeTargets,afterTargets)) return false; a=a.getNextSibling();b=b.getNextSibling(); }
    return a==null && b==null;
  }
  private static String serialize(Document dom) throws Exception {
    TransformerFactory factory=TransformerFactory.newDefaultInstance(); factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET,"");
    javax.xml.transform.Transformer transformer=factory.newTransformer(); transformer.setOutputProperty(OutputKeys.ENCODING,"UTF-8");
    transformer.setOutputProperty(OutputKeys.INDENT,"no"); StringWriter value=new StringWriter(); transformer.transform(new DOMSource(dom),new StreamResult(value)); return value.toString();
  }
  private static PhysicalFont metricFont(Mapper mapper,Scope scope,Element block,String family) {
    String lookup=family;
    if ((lookup.startsWith("\"") && lookup.endsWith("\"")) || (lookup.startsWith("'") && lookup.endsWith("'"))) lookup=lookup.substring(1,lookup.length()-1);
    check(!lookup.contains(",") && !lookup.isBlank(),"Single effective FO physical family required");
    PhysicalFont face=mapper.physicalFontNamed(lookup); check(face!=null,"Effective FO family not document-owned");
    Path path=Path.of(face.getEmbeddedURI()).toAbsolutePath().normalize(); check(scope.fontHashes.containsKey(path),"Metric face outside locked font inventory");
    // Stock Word EXACT uses the dominant block family's base-PF metrics, not a leaf-weight election.
    return face;
  }
  private static final class ScopedFoRenderer implements FORenderer {
    private final Mapper mapper; private final Scope scope; private boolean rendered;
    ScopedFoRenderer(Mapper mapper,Scope scope) { this.mapper=mapper;this.scope=scope; }
    public void render(String foDocument,FOSettings settings,boolean twoPass,List<SectionPageInformation> pages,OutputStream output) throws org.docx4j.openpackaging.exceptions.Docx4JException {
      try {
        check(!rendered,"One scoped renderer delegation required"); rendered=true;
        Document dom=xml(foDocument),baseline=(Document)dom.cloneNode(true);
        Map<String,Element> actualMarkers=markers(dom,scope),originalMarkers=markers(baseline,scope);
        Map<Element,Integer> blockOrdinals=new IdentityHashMap<>();NodeList blocks=dom.getElementsByTagNameNS(FO,"block");
        for(int i=0;i<blocks.getLength();i++) blockOrdinals.put((Element)blocks.item(i),i);
        Set<Element> targets=Collections.newSetFromMap(new IdentityHashMap<>()),oldTargets=Collections.newSetFromMap(new IdentityHashMap<>());
        for(Row row:scope.rows) {
          Element block=nearestBlock(actualMarkers.get(row.marker)),original=nearestBlock(originalMarkers.get(row.marker));
          check(targets.add(block) && oldTargets.add(original),"Two source paragraphs share an FO block");
          check(block.getElementsByTagNameNS(FO,"block").getLength()==0,"One paragraph split into nested FO blocks");
          check(pt(inherited(block,"line-height")).compareTo(new BigDecimal("25"))==0,"Actual Word exact25 FO line-height absent");
          String family=inherited(block,"font-family");row.foBlockOrdinal=blockOrdinals.get(block);
          PhysicalFont face=metricFont(mapper,scope,block,family); Path path=regular(Path.of(face.getEmbeddedURI()).toString());
          WordLineMetrics.Metrics metrics=WordLineMetrics.get(face);
          check(!metrics.fallback && Double.isFinite(metrics.winAscent) && Double.isFinite(metrics.winDescent)
              && metrics.winAscent>0 && metrics.winDescent>=0,"Real physical-file metrics unavailable");
          String value=WordLineMetrics.format(25*metrics.winAscent/(metrics.winAscent+metrics.winDescent));
          row.baseline=decimal(pt(value));check(new BigDecimal(row.baseline).compareTo(new BigDecimal("25"))<=0,"Exact baseline outside line box");
          row.fontIndex=scope.fontPaths.indexOf(path);row.metricFamily=face.getName();
          check(row.fontIndex>=0 && row.metricFamily.getBytes(StandardCharsets.UTF_8).length<=128
              && fileSha(path).equals(scope.fontHashes.get(path)),"Locked metric file or name-domain changed");
          row.ascent=BigDecimal.valueOf(metrics.winAscent).toPlainString();row.descent=BigDecimal.valueOf(metrics.winDescent).toPlainString();
          String prefix=dom.getDocumentElement().lookupPrefix(LINE_NS);
          if(prefix==null || prefix.isEmpty()) { prefix="jgbody25"; String bound=dom.getDocumentElement().lookupNamespaceURI(prefix);check(bound==null || bound.equals(LINE_NS),"Namespace prefix conflict");dom.getDocumentElement().setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI,"xmlns:"+prefix,LINE_NS); }
          block.setAttributeNS(LINE_NS,prefix+":line-box","25pt");block.setAttributeNS(LINE_NS,prefix+":baseline",value);block.setAttributeNS(LINE_NS,prefix+":line-rule","exact");
        }
        for(Element marker:actualMarkers.values()) marker.getParentNode().removeChild(marker);
        for(Element marker:originalMarkers.values()) marker.getParentNode().removeChild(marker);
        boolean semanticsUnchanged=sameSemantics(baseline,dom,oldTargets,targets);
        check(semanticsUnchanged,"Non-target FO namespace semantics changed");
        NodeList all=dom.getElementsByTagNameNS("*","*");int remaining=0;
        for(int i=0;i<all.getLength();i++) if(((Element)all.item(i)).getAttribute("id").startsWith(PREFIX)) remaining++;
        check(remaining==0,"Scoped sentinel not exhausted");
        writeProof(scope,remaining,semanticsUnchanged);
        FORendererApacheFOP.getInstance().render(serialize(dom),settings,twoPass,pages,output);
      } catch(Exception cause) { throw new org.docx4j.openpackaging.exceptions.Docx4JException("Scoped material body line box could not be qualified",cause); }
    }
  }
  private static void set(Element element, String name, Object value) { element.setAttribute(name,String.valueOf(value)); }
  private static void writeProof(Scope scope, int remaining, boolean semanticsUnchanged) throws Exception {
    check(fileSha(scope.input).equals(scope.docxSha) && fileSha(scope.scopeFile).equals(scope.scopeSha),"Scope/input changed before private proof");
    Document proof=xmlFactory().newDocumentBuilder().newDocument(); Element root=proof.createElement("bodyLineBoxProof");proof.appendChild(root);
    set(root,"version","1");set(root,"typographyVersion",PROFILE);set(root,"sourceSha256",MOTHER_SHA);
    set(root,"scopeSha256",scope.scopeSha);set(root,"docxSha256",scope.docxSha);set(root,"count",scope.rows.size());
    set(root,"lineBoxPt","25");set(root,"lineRule","exact");set(root,"baselineMetricKind","WORD_BLOCK_FAMILY_BASE");set(root,"sentinelRemaining",remaining);
    set(root,"nonTargetFoSemanticsUnchanged",semanticsUnchanged);set(root,"comparisonStage","post-word-layout-fixups-pre-delegate");
    set(root,"instrumentationEffects","NOT_INDEPENDENTLY_PROVEN");
    Element programs=proof.createElement("metrics"),paragraphs=proof.createElement("paragraphs");root.appendChild(programs);root.appendChild(paragraphs);
    Map<Integer,String> metricIds=new LinkedHashMap<>();Map<Integer,Row> metricRows=new HashMap<>();
    for(int index=0;index<scope.rows.size();index++) {
      Row row=scope.rows.get(index);String id=metricIds.get(row.fontIndex);
      if(id==null) {
        id="m"+metricIds.size();metricIds.put(row.fontIndex,id);metricRows.put(row.fontIndex,row);
        Element metric=proof.createElement("metric");programs.appendChild(metric);set(metric,"id",id);set(metric,"metricFontIndex",row.fontIndex);
        set(metric,"family",row.metricFamily);set(metric,"winAscent",row.ascent);set(metric,"winDescent",row.descent);
        set(metric,"baselinePt",row.baseline);set(metric,"metricOrigin","locked-physical-ttf");
      } else {
        Row original=metricRows.get(row.fontIndex);
        check(original.metricFamily.equals(row.metricFamily) && original.ascent.equals(row.ascent)
            && original.descent.equals(row.descent) && original.baseline.equals(row.baseline),"Same locked program produced inconsistent exact metrics");
      }
      Element entry=proof.createElement("paragraph");paragraphs.appendChild(entry);set(entry,"index",index);set(entry,"ordinal",row.ordinal);
      set(entry,"foBlockOrdinal",row.foBlockOrdinal);set(entry,"metricId",id);
    }
    check(metricIds.size()<=10,"Metric program inventory outside locked ten fonts");
    // Size follows the closed source fields: <=654 compact entries + <=10 program records, independent of font size.
    byte[] bytes=serialize(proof).getBytes(StandardCharsets.UTF_8);check(bytes.length<=XML_LIMIT,"Bounded private proof encoding exceeded");
    try(OutputStream out=Files.newOutputStream(scope.proof,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) { out.write(bytes); }
  }

  public static void main(String[] args) throws Exception {
    boundary(); // Establish denial before loading any Word bytes.
    if (args.length != 14 || !"body25-scope-v1".equals(args[12])) throw new IllegalArgumentException("Exact V4 scoped arguments required");
    Scope scope = readScope(args);
    PhysicalFonts.setRegex("(?!)");
    Mapper mapper = new Mapper() {
      protected PhysicalFont resolveDocumentFont(String name, Fonts.Font info) {
        PhysicalFont result = getFontMappings().get(name);
        if (result == null) throw new IllegalStateException("Unmapped font; substitution forbidden");
        return result;
      }
      public void addMetricallyCompatibleSubstitutes() {}
      public void addClassBasedSubstitutes(Set<String> names) {}
      public void addWordDefaultSubstitutes(Set<String> names, Fonts fonts) {}
      public void addAltNameSubstitutes(Set<String> names, Fonts fonts) {}
    };
    mapper.put("仿宋_GB2312", font("仿宋_GB2312", args[2], null));
    mapper.put("方正小标宋简体", font("方正小标宋简体", args[3], null));
    mapper.put("楷体_GB2312", font("楷体_GB2312", args[4], null));
    mapper.put("黑体", font("黑体", args[5], "SimHei"));
    mapper.put("Times New Roman", font("Times New Roman", args[6], null));
    mapper.registerBoldForm("Times New Roman", font("Times New Roman Bold", args[7], null));
    mapper.registerItalicForm("Times New Roman", font("Times New Roman Italic", args[8], null));
    mapper.registerBoldItalicForm("Times New Roman", font("Times New Roman Bold Italic", args[9], null));
    mapper.put("Wingdings", font("Wingdings", args[10], null));
    mapper.put("Wingdings 2", font("Wingdings 2", args[11], null));
    WordprocessingMLPackage document = WordprocessingMLPackage.load(new File(args[0]));
    document.setFontMapper(mapper, false);
    FOSettings settings = Docx4J.createFOSettings();
    settings.setWmlPackage(document);
    settings.setApacheFopMime("application/pdf");
    installMarkers(document, scope);
    settings.setCustomFoRenderer(new ScopedFoRenderer(mapper, scope));
    System.out.println("DOCX4J_CONVERSION_BEGIN");
    try (OutputStream target = boundedPdfOutput(Files.newOutputStream(Path.of(args[1]), StandardOpenOption.CREATE_NEW))) {
      Docx4J.toFO(settings, target, Docx4J.FLAG_EXPORT_PREFER_XSL);
    }
    check(fileSha(scope.input).equals(scope.docxSha) && fileSha(scope.scopeFile).equals(scope.scopeSha), "Word/scope changed during conversion");
    System.out.println("DOCX4J_CONVERSION_END");
  }
}
