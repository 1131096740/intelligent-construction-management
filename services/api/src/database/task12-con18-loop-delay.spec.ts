import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Server } from "node:http";
import { createRequire } from "node:module";

// A local fictional controller demonstrates the measurement, not a DB case.
@Controller("probe")
class LoopProbeController {
 @Get() async run() {
  await new Promise(resolve=>setTimeout(resolve,40));
  const until=performance.now()+130;while(performance.now()<until) { /* synthetic event-loop stall */ }
  throw new Error("PRIVATE_TEST_ERROR");
 }
}
@Module({controllers:[LoopProbeController]}) class LoopProbeModule {}
const fixtureRequire=createRequire(__filename);
const {beginCon18LoopDelay}=fixtureRequire("../../prisma/task12-con18-loop-delay.cjs") as {beginCon18LoopDelay():()=>Record<string,unknown>};
it("records a bounded event-loop stall around a real local Nest response without revealing the exception",async()=>{
 const app=await NestFactory.create(LoopProbeModule,{logger:false});
 try {await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");
  const finish=beginCon18LoopDelay();const response=await fetch(`http://127.0.0.1:${address.port}/probe`);expect(response.status).toBe(500);const result=finish();
  expect(result.status).toBe("OBSERVED");expect(["100_TO_499_MS","500_TO_999_MS","1000_TO_4999_MS","5000_MS_OR_MORE"]).toContain(result.maxBucket);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|127\.0\.0\.1/u);
 } finally {await app.close();}
});
it("reports an unsampled interval as unknown rather than zero latency",()=>{
 const result=beginCon18LoopDelay()();expect(result).toEqual({status:"UNSAMPLED"});
});
