import { withCashLedgerSecret } from "./registered-payment-public-cash-secret";

describe("isolated cash ledger secret lifetime (simulated owner)",()=>{
 const identity={database:"jg_task01_0123456789abcdef0123456789abcdef",databaseOid:"123",systemIdentifier:"987",ownerPid:1234};
 let before:boolean;
 beforeEach(()=>{before=Object.hasOwn(process.env,"OPERATING_LEDGER_DB_WRITE_SECRET"); if(before) throw new Error("test requires clean environment");});
 it("exposes a random secret only within the case and removes it after completion",async()=>{
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:true,writer:true}]), $executeRaw:jest.fn().mockResolvedValue(1) };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};
  const action=jest.fn(async()=>{expect(process.env.OPERATING_LEDGER_DB_WRITE_SECRET).toMatch(/^[a-f0-9]{64}$/); return "ok";});
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},action)).resolves.toBe("ok");
  expect(action).toHaveBeenCalledTimes(1);expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  expect(Object.hasOwn(process.env,"OPERATING_LEDGER_DB_WRITE_SECRET")).toBe(false);
 });
 it("rejects a concurrent scope while preparation is pending and releases the guard after exit",async()=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:true,writer:true}]), $executeRaw:jest.fn().mockResolvedValue(1) };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>{await pending;return fn(tx);})};
  const first=withCashLedgerSecret(owner as never,identity,()=>{},async()=>"ok");
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>"bad")).rejects.toThrow("PUBLIC_CASH_SECRET_SCOPE");
  expect(owner.$transaction).toHaveBeenCalledTimes(1);release();await expect(first).resolves.toBe("ok");
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>"again")).resolves.toBe("again");
  expect(Object.hasOwn(process.env,"OPERATING_LEDGER_DB_WRITE_SECRET")).toBe(false);
 });
 it("rejects wrong privilege and never calls case or installs a secret",async()=>{
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:false,writer:true}]), $executeRaw:jest.fn() };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};const action=jest.fn();
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},action)).rejects.toThrow("PUBLIC_CASH_SECRET_SCOPE");
  expect(tx.$executeRaw).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled();
  expect(Object.hasOwn(process.env,"OPERATING_LEDGER_DB_WRITE_SECRET")).toBe(false);
 });
 it("does not overwrite or remove an existing environment entry",async()=>{
  process.env.OPERATING_LEDGER_DB_WRITE_SECRET="synthetic-preexisting";
  try {
   const owner={$transaction:jest.fn()};
   await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>"unexpected")).rejects.toThrow("PUBLIC_CASH_SECRET_SCOPE");
   expect(owner.$transaction).not.toHaveBeenCalled();
   expect(process.env.OPERATING_LEDGER_DB_WRITE_SECRET).toBe("synthetic-preexisting");
  } finally { delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; }
 });
 it("preserves the case failure if secret cleanup also fails",async()=>{
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:true,writer:true}]), $executeRaw:jest.fn().mockResolvedValue(1) };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};
  const original=Object.assign(new Error("synthetic"),{code:"PG_CASH_AFTER"});
  const remove=jest.spyOn(Reflect,"deleteProperty").mockImplementation((target,key)=>target===process.env && key==="OPERATING_LEDGER_DB_WRITE_SECRET" ? false : delete (target as Record<PropertyKey,unknown>)[key]);
  try {
   await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>{throw original;})).rejects.toBe(original);
   expect(original).toHaveProperty("secretCleanup","UNKNOWN");
  } finally { remove.mockRestore(); delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; }
 });
 it.each([Object.freeze(new Error("frozen")), "primitive"]) ("records cleanup failure independently of immutable thrown value",async original=>{
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:true,writer:true}]), $executeRaw:jest.fn().mockResolvedValue(1) };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};
  const state:{cleanup:"NOT_STARTED"|"PENDING"|"CLEARED"|"UNKNOWN"}={cleanup:"NOT_STARTED"};
  const remove=jest.spyOn(Reflect,"deleteProperty").mockImplementation((target,key)=>target===process.env && key==="OPERATING_LEDGER_DB_WRITE_SECRET" ? false : delete (target as Record<PropertyKey,unknown>)[key]);
  try {
   await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>{throw original;},state)).rejects.toBe(original);
   expect(state.cleanup).toBe("UNKNOWN");
  } finally { remove.mockRestore(); delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; }
 });
 it("clears the case secret when the case throws",async()=>{
  const tx={ $queryRaw:jest.fn().mockResolvedValue([{owner:true,tls:true,empty:true,protected:true,writer:true}]), $executeRaw:jest.fn().mockResolvedValue(1) };
  const owner={$transaction:jest.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};
  const original=Object.assign(new Error("synthetic"),{code:"PG_CASH_AFTER"});
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>{throw original;})).rejects.toBe(original);
  expect(Object.hasOwn(process.env,"OPERATING_LEDGER_DB_WRITE_SECRET")).toBe(false);
  await expect(withCashLedgerSecret(owner as never,identity,()=>{},async()=>"after failure")).resolves.toBe("after failure");
 });
});
