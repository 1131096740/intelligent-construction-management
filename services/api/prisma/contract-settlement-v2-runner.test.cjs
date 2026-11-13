"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("public V2 runner waits for final PostgreSQL PID1 before its TCP migration preflight", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jg-v2-readiness-public-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  const statePath = path.join(directory, "state.json");
  const fakeDocker = path.join(bin, "docker");
  fs.writeFileSync(fakeDocker, "#!" + process.execPath + "\nconst modelStateFile=" + JSON.stringify(statePath) + ";\n" + String.raw`
const fs=require("node:fs");
const args=process.argv.slice(2), file=modelStateFile;
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{pidProbes:0,ready:false};
function save(){fs.writeFileSync(file,JSON.stringify(state));}
if(args[0]==="context"){process.stdout.write("unix:///public-readiness-model.sock\n");}
else if(args[0]==="run"){
 state.id="a".repeat(64);state.name=args[args.indexOf("--name")+1];
 state.runId=args[args.indexOf("--label")+1].split("=")[1];
 state.port=args[args.indexOf("--publish")+1].split(":")[1];
 save();process.stdout.write(state.id+"\n");
}else if(args[0]==="inspect"){
 process.stdout.write(JSON.stringify({id:state.id,name:"/"+state.name,runId:state.runId,running:true,ports:{"5432/tcp":[{HostIp:"127.0.0.1",HostPort:state.port}]}}));
}else if(args[0]==="exec" && args.includes("cat")){
 state.pidProbes++;state.ready=state.pidProbes>1;save();process.stdout.write(state.ready?"postgres\n":"docker-entrypoint\n");
}else if(args[0]==="exec" && args.includes("pg_isready")){
 state.socketReadySeen=true;save();process.stdout.write("accepting connections\n");
}else if(args[0]==="exec" && args.includes("psql")){
 state.preflight={ready:state.ready,pidProbes:state.pidProbes,tcp:args.includes("127.0.0.1")};save();
 process.stdin.resume();process.stdin.on("end",()=>{process.stderr.write("controlled stop before database execution\n");process.exitCode=51;});
}else if(args[0]==="rm"){state.cleanup=true;save();}
else{process.stderr.write("unexpected external command\n");process.exitCode=52;}
`, { mode: 0o755 });
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, "run-contract-settlement-v2-local.cjs")], {
      cwd: path.resolve(__dirname, "../../.."), encoding: "utf8", timeout: 10000,
      env: { PATH: bin + path.delimiter + path.dirname(process.execPath) + path.delimiter + "/usr/bin:/bin",
        HOME: directory, TMPDIR: directory, READINESS_MODEL_STATE: statePath,
        CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH: path.join(directory, "unused-evidence.json") }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /LOCAL_MIGRATION_SQL_PREFLIGHT/u);
    const observed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(observed.preflight, { ready: true, pidProbes: 2, tcp: true });
    assert.equal(observed.cleanup, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
