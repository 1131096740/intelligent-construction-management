// Run the actual official-profile source against its modeled filesystem/Git/hash
// boundary, then exercise the real converter lock/snapshot public seam. No
// converter child process runs and no test grants native runtime authority.
describe("official document qualification lock and snapshot boundary", () => {
  afterEach(() => { jest.dontMock("../../prisma/task12-official-document-profile.cjs"); jest.resetModules(); });

  it("uses the candidate lock only inside its private scope and rejects a foreign snapshot", async () => {
    const { model } = await import("../../prisma/task12-official-document-model.test-support.cjs");
    const { api, packet } = model();
    const input = packet(), proof = api.inspectOfficialDocumentQualification(input.name, input.sha256);
    jest.doMock("../../prisma/task12-official-document-profile.cjs", () => api);
    const converter = await import("./contract-body-pdf-converter");
    const typography = "reviewed-material-primary-secondary-body25-v4";
    const before = await converter.contractBodyPdfRuntimeLockFingerprint(typography);
    expect(before).toBe("6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128");
    await api.withOfficialDocumentQualification(proof, async () => {
      const selected = await converter.contractBodyPdfRuntimeLockFingerprint(typography);
      expect(selected).toBe("cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45");
      await expect(converter.assertContractBodyPdfRuntimeLock(selected, typography)).resolves.toBeUndefined();
      await expect(converter.assertContractBodyPdfRuntimeLock(before, typography)).rejects.toThrow("运行环境未就绪");
    });
    await expect(converter.assertContractBodyPdfRuntimeLock("cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45", typography)).rejects.toThrow("运行环境未就绪");
    expect(await converter.contractBodyPdfRuntimeLockFingerprint(typography)).toBe(before);
  });
});

describe("official scoped LibreOffice subprocess boundary", () => {
  afterEach(() => {
    jest.dontMock("../../prisma/task12-official-document-profile.cjs");
    jest.dontMock("node:fs/promises"); jest.resetModules();
  });
  it("uses the fixed scoped command, clean environment and owned temporary directory", async () => {
    const { model } = await import("../../prisma/task12-official-document-model.test-support.cjs");
    const { api, packet } = model(), input=packet();
    const proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
    const rm=jest.fn(async()=>{});
    const ownStat={dev:1,ino:12,uid:process.getuid!(),mode:0o40700,isSymbolicLink:()=>false,isDirectory:()=>true};
    jest.doMock("../../prisma/task12-official-document-profile.cjs",()=>api);
    jest.doMock("node:fs/promises",()=>({
      mkdir:async()=>{},mkdtemp:async(prefix:string)=>prefix+"owned",writeFile:async()=>{},
      readFile:async()=>Buffer.from("%PDF-model"),rm,lstat:async()=>ownStat,realpath:async(value:string)=>value
    }));
    const { convertDocxToPdf }=await import("./libreoffice-converter");
    const before={...process.env};
    await api.withOfficialDocumentQualification(proof,async()=>{
      await convertDocxToPdf(Buffer.from("DOCX"),[],{platform:"darwin",runner:async(command,_args,options)=>{
        expect(command).toBe("/private/tmp/runtime/dependencies/bin/override/soffice");
        expect(options.env?.PATH).toBe("/usr/bin:/bin");
        expect(options.env?.FONTCONFIG_FILE).toContain("/fonts.conf");
        expect(Object.keys(options.env!).sort()).toEqual(["PATH","HOME","TMPDIR","XDG_CACHE_HOME","FONTCONFIG_FILE","PYTHONDONTWRITEBYTECODE","LANG","LC_ALL"].sort());
        expect(options.cwd).toContain("/temp/contract-doc-");return {};
      }});
    });
    expect(rm).toHaveBeenCalledTimes(1);expect({...process.env}).toEqual(before);
  });
  it("refuses to delete a temporary directory whose ownership identity changed", async () => {
    const { model }=await import("../../prisma/task12-official-document-model.test-support.cjs");
    const {api,packet}=model(),input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
    let calls=0;const rm=jest.fn(async()=>{});
    jest.doMock("../../prisma/task12-official-document-profile.cjs",()=>api);
    jest.doMock("node:fs/promises",()=>({
      mkdir:async()=>{},mkdtemp:async(prefix:string)=>prefix+"owned",writeFile:async()=>{},readFile:async()=>Buffer.from("%PDF-model"),rm,
      lstat:async()=>({dev:1,ino:++calls,uid:process.getuid!(),mode:0o40700,isSymbolicLink:()=>false,isDirectory:()=>true}),realpath:async(value:string)=>value
    }));
    const {convertDocxToPdf}=await import("./libreoffice-converter");
    await expect(api.withOfficialDocumentQualification(proof,()=>convertDocxToPdf(Buffer.from("DOCX"),[],{platform:"darwin",runner:async()=>({})}))).rejects.toHaveProperty("code","TASK12_OFFICIAL_DOCUMENT_CLEANUP_UNKNOWN");
    expect(rm).not.toHaveBeenCalled();
  });
  it("preserves output-read first cause when cleanup also fails", async()=>{
    const {model}=await import("../../prisma/task12-official-document-model.test-support.cjs");
    const {api,packet}=model(),input=packet(),proof=api.inspectOfficialDocumentQualification(input.name,input.sha256);
    const first=Object.assign(new Error("output read denied"),{code:"EACCES"}),cleanup=Object.assign(new Error("owned cleanup failed"),{code:"CLEANUP"});
    const ownStat={dev:1,ino:12,uid:process.getuid!(),mode:0o40700,isSymbolicLink:()=>false,isDirectory:()=>true};
    jest.doMock("../../prisma/task12-official-document-profile.cjs",()=>api);
    jest.doMock("node:fs/promises",()=>({mkdir:async()=>{},mkdtemp:async(prefix:string)=>prefix+"owned",writeFile:async()=>{},
      readFile:async()=>{throw first;},rm:async()=>{throw cleanup;},lstat:async()=>ownStat,realpath:async(value:string)=>value}));
    const {convertDocxToPdf}=await import("./libreoffice-converter");
    await expect(api.withOfficialDocumentQualification(proof,()=>convertDocxToPdf(Buffer.from("DOCX"),[],{platform:"darwin",runner:async()=>({})})))
      .rejects.toMatchObject({cause:first,postcheckFailure:cleanup});
  });

});
