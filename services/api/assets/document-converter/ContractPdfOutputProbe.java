import java.io.*;

/** Safe standalone caller of the production public sink; writes no document file. */
public final class ContractPdfOutputProbe {
  public static void main(String[] args) throws Exception {
    final long[] delegated = { 0 };
    OutputStream sink = new FilterOutputStream(OutputStream.nullOutputStream()) {
      public void write(int value) throws IOException { out.write(value); delegated[0]++; }
      public void write(byte[] value, int offset, int length) throws IOException { out.write(value, offset, length); delegated[0] += length; }
    };
    byte[] block = new byte[65_536];
    try (OutputStream bounded = ContractDocxPdf.boundedPdfOutput(sink)) {
      while (delegated[0] + block.length <= 100_000_000L) bounded.write(block);
      bounded.write(block, 0, (int)(100_000_000L - delegated[0]));
      if (delegated[0] != 100_000_000L) throw new AssertionError("Budget boundary write changed");
      boolean refused = false;
      try { bounded.write(0); } catch (IOException expected) { refused = true; }
      if (!refused || delegated[0] != 100_000_000L) throw new AssertionError("Over-budget byte reached delegate");
      refused = false;
      try { bounded.write(block, 0, 1); } catch (IOException expected) { refused = true; }
      if (!refused || delegated[0] != 100_000_000L) throw new AssertionError("Over-budget block reached delegate");
    }
    System.out.println("PDF_OUTPUT_LIMIT_PASS=100000000;BUFFER=65536;FILES=0");
  }
}
