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

public class Task08Fo {
  static void boundary() throws Exception {
    if (System.getSecurityManager()==null) throw new IllegalStateException("SecurityManager absent");
    int denied=0;
    try { new Socket("127.0.0.1",9); } catch (SecurityException expected) { denied++; }
    try { InetAddress.getByName("task08-no-network.invalid"); } catch (SecurityException expected) { denied++; }
    try { AccessController.checkPermission(new FilePermission("/private/tmp/task08-unowned-sentinel","read,write")); } catch (SecurityException expected) { denied++; }
    if (denied!=3) throw new IllegalStateException("offline/file boundary not established");
    System.out.println("BOUNDARY_NETWORK_CONNECT_DNS_AND_OUTSIDE_FILE_DENIED=3");
  }
  static PhysicalFont font(String alias,String file,String familyNeedle) {
    List<PhysicalFont> fonts=PhysicalFonts.getPhysicalFont(alias,Path.of(file).toUri());
    if (fonts==null || fonts.isEmpty()) throw new IllegalStateException("No exact font: "+alias);
    for (PhysicalFont f:fonts) {
      String name=f.getName()+" "+f.getFamilyName();
      if (familyNeedle==null || name.toLowerCase().contains(familyNeedle.toLowerCase())) {
        if (!Path.of(f.getEmbeddedURI()).toAbsolutePath().normalize().equals(Path.of(file).toAbsolutePath().normalize())) throw new IllegalStateException("font URI changed");
        System.out.println("EXPLICIT_FONT="+alias+";physical="+name+";file="+Path.of(file).getFileName());
        return f;
      }
    }
    throw new IllegalStateException("Exact face missing: "+alias);
  }
  public static void main(String[] args) throws Exception {
    boundary();
    if (args.length==1 && args[0].equals("--boundary-only")) return;
    if (args.length!=2) throw new IllegalArgumentException("input output required");
    PhysicalFonts.setRegex("(?!)");
    Mapper mapper=new Mapper(){
      protected PhysicalFont resolveDocumentFont(String name,Fonts.Font info){
        PhysicalFont f=getFontMappings().get(name);
        if(f==null) throw new IllegalStateException("Unmapped font (no substitutes): "+name);
        return f;
      }
      public void addMetricallyCompatibleSubstitutes(){}
      public void addClassBasedSubstitutes(Set<String> names){}
      public void addWordDefaultSubstitutes(Set<String> names,Fonts fonts){}
      public void addAltNameSubstitutes(Set<String> names,Fonts fonts){}
    };
    mapper.put("仿宋_GB2312",font("仿宋_GB2312","/Users/leoyang/Library/Fonts/仿宋_GB2312.ttf",null));
    mapper.put("方正小标宋简体",font("方正小标宋简体","/Users/leoyang/Library/Fonts/方正小标宋简体.ttf",null));
    mapper.put("楷体_GB2312",font("楷体_GB2312","/Users/leoyang/Library/Fonts/楷体_GB2312_0.TTF",null));
    mapper.put("黑体",font("黑体","/Users/leoyang/Library/Fonts/黑体.ttf","SimHei"));
    mapper.put("Times New Roman",font("Times New Roman","/System/Library/Fonts/Supplemental/Times New Roman.ttf",null));
    mapper.registerBoldForm("Times New Roman",font("Times New Roman Bold","/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",null));
    mapper.registerItalicForm("Times New Roman",font("Times New Roman Italic","/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",null));
    mapper.registerBoldItalicForm("Times New Roman",font("Times New Roman Bold Italic","/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf",null));
    mapper.put("Wingdings",font("Wingdings","/System/Library/Fonts/Supplemental/Wingdings.ttf",null));
    mapper.put("Wingdings 2",font("Wingdings 2","/System/Library/Fonts/Supplemental/Wingdings 2.ttf",null));
    WordprocessingMLPackage document=WordprocessingMLPackage.load(new File(args[0]));
    document.setFontMapper(mapper,false);
    FOSettings settings=Docx4J.createFOSettings();
    settings.setWmlPackage(document);
    settings.setApacheFopMime("application/pdf");
    settings.setFoDumpFile(new File(args[1]+".fo"));
    System.out.println("CONVERSION_CALL_BEGIN");
    try(OutputStream target=Files.newOutputStream(Path.of(args[1]),StandardOpenOption.CREATE_NEW)){
      Docx4J.toFO(settings,target,Docx4J.FLAG_EXPORT_PREFER_XSL);
    }
    System.out.println("CONVERSION_CALL_COMPLETE");
  }
}
