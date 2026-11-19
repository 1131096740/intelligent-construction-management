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

  public static void main(String[] args) throws Exception {
    boundary(); // Establish denial before loading any Word bytes.
    if (args.length != 12) throw new IllegalArgumentException("Input, output and ten exact font paths required");
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
    System.out.println("DOCX4J_CONVERSION_BEGIN");
    try (OutputStream target = boundedPdfOutput(Files.newOutputStream(Path.of(args[1]), StandardOpenOption.CREATE_NEW))) {
      Docx4J.toFO(settings, target, Docx4J.FLAG_EXPORT_PREFER_XSL);
    }
    System.out.println("DOCX4J_CONVERSION_END");
  }
}
