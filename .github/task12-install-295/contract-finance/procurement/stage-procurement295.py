from pathlib import Path
from hashlib import sha256
import gzip
import json
import subprocess
import sys

plan = Path(__file__).resolve().parent
lane, repo_name, workspace_name, out_name, *opts = sys.argv[1:]
if opts not in ([], ['--current-320']):
    sys.exit('PROCUREMENT_MODE')
current320 = bool(opts)
if lane not in ('general16', 'project11'):
    sys.exit('PROCUREMENT_295_MODE')
repo, workspace, out = map(Path, (repo_name, workspace_name, out_name))
prior = repo / '.github/task12-install-290/procurement'
common = repo / '.github/task12-install-295/contract-finance/common'
port = json.loads((plan / 'port-pins.json').read_bytes())
original = json.loads((prior / 'pins.json').read_bytes())[lane]
delta_file = 'candidate-delta320.json' if current320 else 'candidate-delta.json'
delta = {row['path']: row for row in json.loads((plan / delta_file).read_bytes())}
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
# 329 uses the current approval protocol in both HTTP regression suites.
# Historical modes still stage their original pinned overlays.
current_test_fixtures = {
    'services/api/src/database/general-procurement-http-postgres.spec.ts',
    'services/api/src/database/project-business-scope-http-postgres.spec.ts',
} if current320 else set()
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
        archived = proof['expected']
        if isinstance(archived, dict):
            archived = archived[lane]
        if archived != expected or proof['candidate'] != tested:
            raise ValueError(f'PROCUREMENT_295_CANDIDATE_PIN {relative}')
        seen.add(relative)
        # 角色材料同时是候选增量时，仍须把候选字节送进容器；否则容器会用旧镜像副本，
        # 既丢失新授权又让 staged_role 闭合失败。
        if relative in role_material or relative in current_test_fixtures:
            write(out / 'workspace' / relative, read(current))
        if relative in role_material:
            staged_role.add(relative)
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

patch(common / 'installer.cjs', out / 'installer.cjs', port['installer'], 'installer-procurement.patch')
for name, pin in port[lane].items():
    patch(runtime / name, out / name, pin, pin['patch'])
if current320:
    consumer = out/'consumer.cjs'
    text = consumer.read_text()
    replacements = {
        'context.candidateTree===require("./scope.json").tree':
            'context.candidateTree===require("./contract-finance-source.json").sourceTree',
        'receipt.combinedAfterBusiness?.ledgerSha256===terminal.final':
            "receipt.combinedAfterBusiness?.ledgerSha256===require('./contract-finance-source.json').ledgerSha256 && "
            "receipt.forward320?.count===329 && "
            "receipt.forward320?.sourceTree===require('./contract-finance-source.json').sourceTree && "
            "receipt.forward320?.sameBaseB7===true && receipt.combinedAfterBusiness?.count===329",
    }
    status = ('GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1' if lane=='general16' else 'PROJECT_SCOPE_ORIGINAL_11')
    replacements[status+'_295_PASSED'] = status+'_329_PASSED'
    for old, new in replacements.items():
        if text.count(old)!=1:
            raise ValueError('PROCUREMENT_320_CONSUMER_ANCHOR')
        text = text.replace(old,new)
    if lane == 'project11':
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
        write(spec, (fixture[:start] + payment_case + fixture[end:]).encode())
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
