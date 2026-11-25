from pathlib import Path
from hashlib import sha256
import gzip
import json
import subprocess
import sys

plan = Path(__file__).resolve().parent
lane, repo_name, workspace_name, out_name, *opts = sys.argv[1:]
text_direct = len(opts) == 2 and opts[0] == '--text-direct-330'
if not text_direct and opts not in ([], ['--current-320']):
    sys.exit('PROCUREMENT_MODE')
forward = bool(opts)
count = 330 if text_direct else 329 if forward else 295
if lane not in ('general16', 'project11'):
    sys.exit('PROCUREMENT_295_MODE')
repo, workspace, out = map(Path, (repo_name, workspace_name, out_name))
prior = repo / '.github/task12-install-290/procurement'
common = repo / '.github/task12-install-295/contract-finance/common'
port = json.loads((plan / 'port-pins.json').read_bytes())
original = json.loads((prior / 'pins.json').read_bytes())[lane]
delta_file = 'candidate-delta320.json' if forward else 'candidate-delta.json'
delta = {row['path']: row for row in json.loads((plan / delta_file).read_bytes())}
if text_direct:
    delta.update({row['path']: row for row in json.loads((plan / 'candidate-delta330.json').read_bytes())})
digest = lambda data: sha256(data).hexdigest()
out.mkdir()


def read(file):
    if not file.is_file() or file.is_symlink():
        raise ValueError(f'PROCUREMENT_295_INPUT {file.name}')
    return file.read_bytes()


def write(file, content):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(content)
    file.chmod(0o644)


def patch(source, target, expected, patch_name):
    before = read(source)
    if digest(before) != expected['base']:
        raise ValueError(f'PROCUREMENT_295_PATCH_PREIMAGE {source.name}')
    write(target, before)
    subprocess.run(['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', str(target)],
                   input=read(plan / patch_name), stdout=subprocess.DEVNULL, check=True)
    if digest(read(target)) != expected['after']:
        raise ValueError(f'PROCUREMENT_295_PATCH_POSTIMAGE {source.name}')


def stage_approval_fixture(relative, expected, current, anchors):
    if original['overlays'].get(relative, {}).get('after') != expected:
        raise ValueError(f'PROCUREMENT_329_SEALED_FIXTURE_PIN {relative}')
    sealed = read(prior / 'overlays' / expected)
    if digest(sealed) != expected:
        raise ValueError(f'PROCUREMENT_329_SEALED_FIXTURE_BYTES {relative}')

    def approval_range(content):
        start, end = (anchor.encode() for anchor in anchors)
        if content.count(start) != 1 or content.count(end) != 1:
            raise ValueError(f'PROCUREMENT_329_APPROVAL_FIXTURE_ANCHOR {relative}')
        first = content.index(start) + len(start)
        last = content.index(end)
        if first >= last:
            raise ValueError(f'PROCUREMENT_329_APPROVAL_FIXTURE_ORDER {relative}')
        return first, last

    first, last = approval_range(sealed)
    candidate = read(current)
    candidate_first, candidate_last = approval_range(candidate)
    write(out / 'workspace' / relative, sealed[:first] + candidate[candidate_first:candidate_last] + sealed[last:])


runtime = prior / 'plans' / lane
manifest = gzip.decompress(read(runtime / 'source-inputs.json.gz'))
if digest(manifest) != original['runtime']['source-inputs.json']:
    raise ValueError('PROCUREMENT_295_ORIGINAL_INVENTORY')
seen = set()
role_material = {
    'services/api/prisma/general-procurement-owned-ci.cjs',
    'services/api/prisma/general-procurement-runtime-grants.sql',
    'services/api/prisma/local-staged-migration-qualification.json',
    'services/api/prisma/task398-owned-280-business-read-baseline.json',
}
# Preserve named database admission, archive/expense witnesses and browser staging.
# Only the linked-expense approval requests and assertions follow current 329.
current_test_fixtures = {
    'services/api/src/database/general-procurement-http-postgres.spec.ts': (
        '    expect((await request(`${claimPath}/submission`, "POST", {}, director.token)).status).toBe(201);\n',
        '    const uploadVoucher = async (token: string) => {',
    ),
    'services/api/src/database/project-business-scope-http-postgres.spec.ts': (
        '    expect((await request(`${claimRoute}/submission`, director, {})).status).toBe(201);\n',
        '    expect((await request(claimRoute, director)).body).toMatchObject({ projectId: second, status: "approved_pending_payment",',
    ),
} if forward else {}
staged_role = set()
for row in json.loads(manifest)['files']:
    relative, expected = row['file'], row['sha256']
    current = workspace / relative
    tested = digest(read(current)) if current.is_file() else None
    if tested == expected:
        if relative in role_material:
            write(out / 'workspace' / relative, read(current))
            staged_role.add(relative)
        continue
    if relative in delta:
        proof = delta[relative]
        if proof['candidate'] is None and (current.exists() or current.is_symlink()):
            raise ValueError(f'PROCUREMENT_329_CANDIDATE_EXPECTED_ABSENT {relative}')
        archived = proof['expected']
        if isinstance(archived, dict):
            archived = archived[lane]
        if archived != expected or proof['candidate'] != tested:
            raise ValueError(f'PROCUREMENT_295_CANDIDATE_PIN {relative}')
        seen.add(relative)
        # 角色材料同时是候选增量时，仍须把候选字节送进容器；否则容器会用旧镜像副本，
        # 既丢失新授权又让 staged_role 闭合失败。
        if relative in role_material:
            write(out / 'workspace' / relative, read(current))
            staged_role.add(relative)
        elif relative in current_test_fixtures:
            stage_approval_fixture(relative, expected, current, current_test_fixtures[relative])
        continue
    if original['overlays'].get(relative) != {'candidate': tested, 'after': expected}:
        raise ValueError(f'PROCUREMENT_295_ORIGINAL_OVERLAY_PIN {relative}')
    bytes_ = read(prior / 'overlays' / expected)
    if digest(bytes_) != expected:
        raise ValueError(f'PROCUREMENT_295_ORIGINAL_OVERLAY_BYTES {relative}')
    write(out / 'workspace' / relative, bytes_)
    if relative in role_material:
        staged_role.add(relative)
if staged_role != role_material:
    raise ValueError('PROCUREMENT_295_ROLE_MATERIAL_CLOSURE')
if seen != set(delta):
    raise ValueError('PROCUREMENT_295_DELTA_CLOSURE')

if text_direct:
    source = json.loads(read(Path(opts[1])))
    installer = out / 'installer.cjs'
    before = read(common / 'installer.cjs')
    relative = (common / 'installer.cjs').relative_to(repo)
    if before != subprocess.check_output(['git', '-C', str(repo), 'show', source['sourceSha'] + ':' + str(relative)]):
        raise ValueError('PROCUREMENT_330_INSTALLER_SOURCE_PIN')
    write(installer, before)
    subprocess.run(['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', str(installer)],
                   input=read(plan / 'installer-procurement.patch'), stdout=subprocess.DEVNULL, check=True)
    text = installer.read_text()
    old = "const material=source.mode==='current-320' ? readForward320({"
    end = "}) : undefined;\n  return withCombinedOrdinaryLoan"
    if text.count(old) != 1 or text.count(end) != 1:
        raise ValueError('PROCUREMENT_330_INSTALLER_ENTRY_ANCHOR')
    text = text.replace(old, """const profile=require('./text-direct-330-profile.cjs');
  profile.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  const material=readForward320({""")
    text = text.replace(end, "},true);\n  return withCombinedOrdinaryLoan")
    consume = "return withCombinedOrdinaryLoan(receipt,consume,exactMultiWitness295,false,material,undefined,lane);"
    if text.count(consume) != 1:
        raise ValueError('PROCUREMENT_330_INSTALLER_CONSUME_ANCHOR')
    text = text.replace(consume, """return withCombinedOrdinaryLoan(receipt,async context=>{
    profile.assertInstallation(receipt,source);
    await consume(context);
  },exactMultiWitness295,false,material,undefined,lane);""")
    write(installer, text.encode())
    subprocess.run(['node', '--check', str(installer)], check=True)
else:
    patch(common / 'installer.cjs', out / 'installer.cjs', port['installer'], 'installer-procurement.patch')
for name, pin in port[lane].items():
    patch(runtime / name, out / name, pin, pin['patch'])
if forward:
    consumer = out/'consumer.cjs'
    text = consumer.read_text()
    replacements = {
        'context.candidateTree===require("./scope.json").tree':
            'context.candidateTree===require("./contract-finance-source.json").sourceTree',
        'receipt.combinedAfterBusiness?.ledgerSha256===terminal.final':
            "receipt.combinedAfterBusiness?.ledgerSha256===require('./contract-finance-source.json').ledgerSha256 && "
            f"receipt.forward320?.count==={count} && "
            "receipt.forward320?.sourceTree===require('./contract-finance-source.json').sourceTree && "
            f"receipt.forward320?.sameBaseB7===true && receipt.combinedAfterBusiness?.count==={count}",
    }
    status = ('GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1' if lane=='general16' else 'PROJECT_SCOPE_ORIGINAL_11')
    replacements[status+'_295_PASSED'] = status+f'_{count}_PASSED'
    for old, new in replacements.items():
        if text.count(old)!=1:
            raise ValueError('PROCUREMENT_320_CONSUMER_ANCHOR')
        text = text.replace(old,new)
    if lane == 'project11':
        failure_anchor = r'''function firstFailure(report){
  const evidence=fs.existsSync(report)?JSON.parse(fs.readFileSync(report,"utf8")):null;
  const failed=evidence?.testResults.flatMap(suite=>suite.assertionResults).find(test=>test.status==="failed");
  const assertion=failed?.failureMessages.join("\n")??"";'''
        failure_probe = r'''function firstFailure(report, stderrKinds, signal){
  let reportState="missing", evidence=null;
  try {
    const stat=fs.lstatSync(report,{throwIfNoEntry:false});
    if(stat&&!stat.isFile())reportState="non_file";
    else if(stat&&stat.size>1024*1024)reportState="over_limit";
    else if(stat){
      const result=JSON.parse(fs.readFileSync(report,"utf8"));
      reportState=Array.isArray(result?.testResults)?"present":"invalid";
      if(reportState==="present")evidence=result;
    }
  }catch{reportState="invalid";}
  const suites=evidence?.testResults??[];
  const failed=suites.flatMap(suite=>suite.assertionResults??[]).find(test=>test.status==="failed");
  const assertion=failed?.failureMessages?.join("\n")??suites.find(suite=>suite.status==="failed")?.message??"";
  const counts=Object.fromEntries(["numTotalTests","numFailedTests","numFailedTestSuites"].flatMap(key=>
    Number.isSafeInteger(evidence?.[key])&&evidence[key]>=0?[[key,evidence[key]]]:[]));
'''
        stderr_anchor = '    child.stdout.resume();child.stderr.resume();'
        stderr_probe = '''    child.stdout.resume();
    const stderrKinds=new Set();
    let stderrBoundary="";
    child.stderr.on("data",chunk=>{
      const text=stderrBoundary+chunk.toString("utf8");
      const hints={
        disk_full:/\\bENOSPC\\b|No space left on device/i,
        out_of_memory:/\\bENOMEM\\b|JavaScript heap out of memory/i,
        killed:/\\bSIGKILL\\b|\\bSIGABRT\\b/,
        browser_launch:/browserType\\.launch|Failed to launch browser/i,
        browser_server:/config\\.webServer|web server failed to start/i,
        module_resolution:/ERR_MODULE_NOT_FOUND|Cannot find module/i
      };
      for(const [kind,pattern] of Object.entries(hints))if(pattern.test(text))stderrKinds.add(kind);
      stderrBoundary=text.slice(-160);
    });'''
        failure_fields = '''    reportState,
    counts,
    stderrKinds:[...stderrKinds].sort(),
    signal:/^SIG(?:ABRT|KILL|TERM)$/u.test(signal??"")?signal:undefined,
    frames,'''
        if (text.count(failure_anchor)!=1 or text.count(stderr_anchor)!=1
            or text.count('    frames,')!=1 or text.count('firstFailure(report)')!=6):
            raise ValueError('PROCUREMENT_320_PROJECT_FAILURE_OBSERVATION_ANCHOR')
        text = text.replace(failure_anchor,failure_probe).replace(stderr_anchor,stderr_probe)
        text = text.replace('    frames,',failure_fields)
        text = text.replace('firstFailure(report)','firstFailure(report,stderrKinds,child.signalCode)')
        anchor = '    const ownerTarget=new URL(context.ownerUrl);'
        observation = '''    const detailAcl=await context.sql(`SELECT jsonb_build_object(
      'activity',has_function_privilege('project_business_scope_runtime','public.jg_read_payment_detail_activity_v1(text,text,text)','EXECUTE'),
      'agreement',has_function_privilege('project_business_scope_runtime','public.jg_read_payment_contract_agreement_detail_v1(text,text,text)','EXECUTE'),
      'allocations',has_function_privilege('project_business_scope_runtime','public.jg_read_payment_detail_allocations_v1(text,text,text)','EXECUTE'),
      'snapshots',has_function_privilege('project_business_scope_runtime','public.jg_read_payment_detail_snapshots_v1(text,text,text,boolean)','EXECUTE')
    );`);
    receipt.paymentDetailExecute=JSON.parse(detailAcl.stdout);
'''
        if text.count(anchor) != 1:
            raise ValueError('PROCUREMENT_320_PAYMENT_DETAIL_OBSERVATION_ANCHOR')
        text = text.replace(anchor, observation + anchor)
        anchor = '  await ownerSql("ROLE_SETUP",defaultSetup);'
        reads = r'''  const currentSetup=defaultSetup.replace(/\nCOMMIT;\s*$/u,`
    GRANT SELECT (id,"paymentRequestId","paymentExecutionId","amountCents","receivedAt","fundRegistrationId")
      ON public."PaymentExecutionRefund" TO project_business_scope_runtime;
    GRANT SELECT (id,"paymentRequestId",status,"amountDeltaCents")
      ON public."PaymentExecutionCorrection" TO project_business_scope_runtime;
    COMMIT;`);
  condition(currentSetup!==defaultSetup,"PROJECT_SCOPE_329_PAYMENT_DETAIL_READS");
  await ownerSql("ROLE_SETUP",currentSetup);'''
        if text.count(anchor) != 1:
            raise ValueError('PROCUREMENT_320_PROJECT_READ_ANCHOR')
        text = text.replace(anchor, reads)
        spec = out / 'workspace/services/api/src/database/project-business-scope-http-postgres.spec.ts'
        fixture = spec.read_text()
        reviewers = {
            '  let financeDirector: Actor;': '  let financeDirector: Actor;\n  let contractDirector: Actor;',
            '    await person("contract_director", [null]);':
                '    contractDirector = await person("contract_director", [null]);',
            'materialDirector, financeDirector, employee]) {':
                'materialDirector, financeDirector, contractDirector, employee]) {',
            'for (const actor of [financeDirector, chairman]) {':
                'for (const actor of [financeDirector, contractDirector, chairman]) {',
        }
        for old, new in reviewers.items():
            if fixture.count(old) != 1:
                raise ValueError('PROCUREMENT_320_PROJECT_APPROVAL_REVIEWER_ANCHOR')
            fixture = fixture.replace(old, new)
        signature = '  async function advanceInput() {'
        coordinates = '''  function paymentApprovalCoordinates(context: Record<string, unknown>) {
    const { expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt } = context;
    return { expectedPaymentUpdatedAt, expectedApprovalInstanceId, expectedNodeIndex, expectedApprovalUpdatedAt };
  }

'''
        if fixture.count(signature) != 1:
            raise ValueError('PROCUREMENT_320_PROJECT_APPROVAL_HELPER_ANCHOR')
        fixture = fixture.replace(signature, coordinates + signature)
        start = fixture.index('  it("普通付款继承合同项目，错误全局项目经理或其他项目经理都不能代批"')
        end = fixture.index('  it("公司级合同经办可选所有启用项目，项目经办只可选所属项目"', start)
        payment_case = fixture[start:end]
        context_uses = {
            'firstView': 2, 'managerView': 1, 'view': 1, 'directorView': 1,
            'selfView': 2, 'pendingView': 2, 'delegatedView': 1,
        }
        for detail, expected in context_uses.items():
            spread = f'...{detail}.body.reviewApprovalContext'
            if payment_case.count(spread) != expected:
                raise ValueError('PROCUREMENT_320_PROJECT_APPROVAL_COORDINATES_ANCHOR')
            payment_case = payment_case.replace(spread, f'...paymentApprovalCoordinates({detail}.body.reviewApprovalContext)')
        fixture = fixture[:start] + payment_case + fixture[end:]
        current_fixture = (workspace / spec.relative_to(out / 'workspace')).read_text()
        loan_regions = [
            ('      const claim = await request("/expense-claims", materialDirector,',
             '      const position = await db.position.findUniqueOrThrow'),
            ('    const input = { claimType: ',
             '    expect((await request("/expense-claims", materialDirector, { ...input, applicantUserId: materialDirector.id }))'),
        ]
        for start_marker, end_marker in loan_regions:
            if any(text.count(start_marker) != 1 for text in (fixture, current_fixture)):
                raise ValueError('PROCUREMENT_329_EXPENSE_INTAKE_FIXTURE_ANCHOR')
            start = fixture.index(start_marker)
            end = fixture.index(end_marker, start)
            current_start = current_fixture.index(start_marker)
            current_end = current_fixture.index(end_marker, current_start)
            fixture = fixture[:start] + current_fixture[current_start:current_end] + fixture[end:]
        write(spec, fixture.encode())
    if lane == 'general16':
        anchor = '  await ownerSql("ROLE_SETUP",roleSetup("procurement",database,password));'
        reads = r'''  const originalSetup=roleSetup("procurement",database,password);
  const currentSetup=originalSetup.replace(/\nCOMMIT;\s*$/u,`
    GRANT SELECT (id,"procurementId","supplierName","effectiveTotalAmountCents","createdAt")
      ON public."ActualPurchaseBatch" TO general_procurement_runtime;
    GRANT SELECT (id,"executionType","expenseClaimPaymentExecutionId","amountCents","receivedAt",
      reason,"evidenceReference","accountId","recordedByUserId","createdAt")
      ON public."PaymentExecutionRefund" TO general_procurement_runtime;
    DO $scope$ BEGIN
      IF EXISTS (
        SELECT FROM unnest(ARRAY['public."ActualPurchaseBatch"'::regclass,'public."PaymentExecutionRefund"'::regclass]) r(oid)
        WHERE has_table_privilege('general_procurement_runtime',r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege('general_procurement_runtime',r.oid,'INSERT,UPDATE,REFERENCES')
      ) THEN RAISE EXCEPTION 'PROCUREMENT_329_READ_SCOPE'; END IF;
    END $scope$;
    COMMIT;`);
  condition(currentSetup!==originalSetup,"PROCUREMENT_329_BUSINESS_READS");
  await ownerSql("ROLE_SETUP",currentSetup);
'''
        if text.count(anchor) != 1:
            raise ValueError('PROCUREMENT_329_BUSINESS_READ_ANCHOR')
        text = text.replace(anchor, reads.rstrip())
        failure_anchor = '        pgPermission,\n        browser:'
        observation = r'''        pgPermission,
        jestReport:report?"present":"missing",
        processSignal:/^SIG(?:ABRT|KILL|TERM)$/u.test(exit[1]??"")?exit[1]:undefined,
        processFailureKinds:Object.entries({
          jest_exit:/process\.exit called with|Jest worker encountered/u,
          heap:/JavaScript heap out of memory|\bENOMEM\b/u,
          filesystem:/\b(?:ENOSPC|EMFILE|EACCES)\b/u,
          process_limit:/\bEAGAIN\b|Resource temporarily unavailable/u,
          browser_launch:/browserType\.launch|Failed to launch browser/iu,
          browser_deadline:/config\.webServer|Test timeout of [0-9]+ms exceeded/iu,
          unhandled_exception:/UnhandledPromiseRejection|uncaughtException/u,
          test_summary:/Test Suites:|Tests:/u
        }).filter(([,pattern])=>pattern.test(rawOutput)).map(([kind])=>kind),
        browser:'''
        if text.count(failure_anchor) != 1:
            raise ValueError('PROCUREMENT_329_GENERAL_FAILURE_OBSERVATION_ANCHOR')
        text = text.replace(failure_anchor, observation)
    write(consumer,text.encode())
for name in ['owner-observation.cjs', *(
    ['project-scope-http-report.cjs', 'project-scope-browser-report.cjs', 'project-scope-browser-pins.json']
    if lane == 'project11' else []
)]:
    material = read(runtime / name)
    if digest(material) != original['runtime'][name]:
        raise ValueError(f'PROCUREMENT_295_REPORT_PIN {name}')
    write(out / ('procurement-owner-observation.cjs' if name == 'owner-observation.cjs' else name), material)
print(json.dumps({'lane': lane, 'candidateDriftPaths': len(seen),
                  'runtimeWorkspaceOverlays': len([p for p in (out/'workspace').rglob('*') if p.is_file()])}))
