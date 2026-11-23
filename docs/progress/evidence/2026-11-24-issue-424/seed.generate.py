import hashlib, json, uuid

out = []
def q(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"
def jq(obj):
    return q(json.dumps(obj, ensure_ascii=False, separators=(',', ':'))) + "::jsonb"
def uid():
    global counter
    counter += 1
    return str(uuid.UUID(int=counter))
counter = 0

def ins(table, cols, rows):
    if not rows: return
    out.append(f'INSERT INTO public."{table}" (' + ','.join('"'+c+'"' for c in cols) + ') VALUES')
    vals = []
    for r in rows:
        vals.append('(' + ','.join(r) + ')')
    out.append(',\n'.join(vals) + ';')

# users
users = [uid() for _ in range(24)]
ins('User', ['id','name','phone','isActive','createdAt','updatedAt'],
    [[q(u), q(f'演练用户{i+1:02d}'), q(f'1390000{i:04d}'), 'true', q('2024-01-01 08:00:00'), q('2024-01-01 08:00:00')] for i,u in enumerate(users)])

# companies
companies = []
for i, (name, code) in enumerate([
    ('华东建工集团有限公司','91310000MA1A00001A'),
    ('华南建设发展有限公司','91440000MA2B00002B'),
    ('西南工程服务有限公司','91510000MA3C00003C'),
    ('北方设备租赁有限公司','91110000MA4D00004D')]):
    ce = uid(); cv = uid()
    companies.append({'id':ce,'ver':cv,'name':name,'code':code})
    ins('CompanyEntity', ['id','name','unifiedSocialCreditCode','isActive','dataStatus','currentVersionNo','createdAt','updatedAt','registeredAddress'],
        [[q(ce), q(name), q(code), 'true', q('complete'), '1', q('2024-01-01 08:00:00'), q('2024-01-01 08:00:00'), q('上海市浦东新区演练路1号')]])
    ins('CompanyEntityVersion', ['id','companyEntityId','versionNo','name','unifiedSocialCreditCode','registeredAddress','isActive','action','actorUserId','createdAt'],
        [[q(cv), q(ce), '1', q(name), q(code), q('上海市浦东新区演练路1号'), 'true', q('create'), q(users[0]), q('2024-01-01 08:00:00')]])

# projects
projects = []
for i in range(8):
    p = uid(); projects.append(p)
    ins('Project', ['id','code','name','isActive','takeoverStatus','createdAt','updatedAt','operatingLedgerEffectiveDate','takeoverCompletedDate'],
        [[q(p), q(f'XM-2024-{i+1:03d}'), q(f'虚构工程项目{i+1}'), 'true', q('takeover_completed' if i%2==0 else 'preparing'), q('2024-02-01 08:00:00'), q('2024-02-01 08:00:00'), q('2024-03-01') if i%2==0 else 'NULL', q('2024-03-15') if i%2==0 else 'NULL']])

# participating companies (2 per project)
ppc = []
for i,p in enumerate(projects):
    for k in (0,1):
        c = companies[(i+k)%3]; row = uid(); ppc.append(row)
        ins('ProjectParticipatingCompany', ['id','projectId','companyEntityId','companyEntityVersionId','companyNameSnapshot','companyCreditCodeSnapshot','effectiveFrom','changeReason','addedByUserId','createdAt','updatedAt'],
            [[q(row), q(p), q(c['id']), q(c['ver']), q(c['name']), q(c['code']), q('2024-02-01'), q('seed'), q(users[0]), q('2024-02-01 08:00:00'), q('2024-02-01 08:00:00')]])

# files (vouchers)
files = []
for i in range(500):
    f = uid(); files.append(f)
    sha = hashlib.sha256(f'seed-file-{i}'.encode()).hexdigest()
    ins('FileObject', ['id','bucket','objectKey','originalName','mimeType','sizeBytes','uploadedByUserId','createdAt','contentSha256','storageStatus'],
        [[q(f), q('jg-private'), q(f'seed/voucher-{i:04d}.pdf'), q(f'付款凭证{i:04d}.pdf'), q('application/pdf'), str(2048+i), q(users[i%24]), q('2024-05-01 09:00:00'), q(sha), q('active')]])

# contracts + versions + terms
contracts = []
term_versions = []
stages = []
for i in range(80):
    ct = uid(); p = projects[i%8]; owner = users[i%12]
    c = companies[i%3]
    has_change = (i % 3 == 0)
    v1 = uid(); v2 = uid() if has_change else None
    base = 10_000_000 + i*137_000
    delta = 15_000 + i*100 if has_change else 0
    contracts.append({'id':ct,'p':p,'v1':v1,'v2':v2,'base':base,'delta':delta,'co':c})
    ins('Contract', ['id','projectId','code','name','counterparty','createdAt','updatedAt','companyEntityId','companyEntityName','contractTypeKey','ownerUserId','source'],
        [[q(ct), q(p), q(f'HT-2024-{i+1:04d}'), q(f'虚构施工合同{i+1}'), q(f'虚构相对方{i+1}'), q('2024-03-01 09:00:00'), q('2024-06-01 09:00:00'), q(c['id']), q(c['name']), q('construction'), q(owner), q('system')]])
    def ver_row(vid, no, change, status, amount, base_id=None, sup_id=None, change_reason=None, direction=None, change_amount=None, original_base=None):
        return [q(vid), q(ct), str(no), q(change), q(status), str(amount), q('2024-06-01 09:00:00'), q('2024-06-01 09:00:00'),
                q('manual'), jq({'seed':True,'version':no}), jq({'seed':True}), jq({'seed':True,'contract':i}),
                '0', '0',
                q(base_id) if base_id else 'NULL', q(sup_id) if sup_id else 'NULL',
                q(change_reason) if change_reason else 'NULL', q(direction) if direction else 'NULL',
                str(change_amount) if change_amount is not None else 'NULL', str(original_base) if original_base is not None else 'NULL',
                q('capped'), q('single_rate'), q('unconfirmed'), '0', q('our_company'), '1', '1',
                q(c['id']), q(c['ver']), q(c['name']), q(c['code'])]
    # explicit column list
    cols = ['id','contractId','versionNo','changeType','status','amountCents','effectiveAt','updatedAt','amountSource','clauseSnapshot','templateSnapshot','draftData',
            'cumulativeIncreaseCents','cumulativeDecreaseCents','baseVersionId','supersedesVersionId','changeReason','changeDirection','changeAmountCents','originalBaseAmountCents',
            'amountLimitType','taxMode','taxFactStatus','taxFactRevision','signingSubjectType','documentContentRevision','numericProtocolVersion',
            'companyEntityIdSnapshot','companyEntityVersionId','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot']
    ins('ContractVersion', cols, [ver_row(v1, 1, 'original', 'superseded' if has_change else 'effective', base)])
    if has_change:
        ins('ContractVersion', cols, [ver_row(v2, 2, 'change', 'effective', base+delta, v1, v1, '虚构补充协议', 'increase', delta, base)])
    tv = uid(); term_versions.append(tv)
    ins('PaymentTermsVersion', ['id','contractId','contractVersionId','versionNo','status','originalText','createdAt','updatedAt'],
        [[q(tv), q(ct), q(v2 or v1), '1', q('effective'), q('按进度付款，质保金5%'), q('2024-06-01 09:00:00'), q('2024-06-01 09:00:00')]])
    for s in range(2):
        st = uid(); stages.append((st, tv))
        ins('PaymentTermsStage', ['id','paymentTermsVersionId','name','basis','ratioBps','fixedAmountCents','triggerEvent','dueDays','requiresInvoice','allowsEarlyPayment','allowsInstallments','originalText','createdAt'],
            [[q(st), q(tv), q(f'第{s+1}期'), q('进度'), '5000', str(1_000_000), q('settlement_effective'), '30', 'false', 'false', 'true', q(f'第{s+1}期付款条款'), q('2024-06-01 09:00:00')]])

# settlements + lines + requests + executions
settlements = []
requests = []
executions = []
for i in range(120):
    c = contracts[i % 80]
    st = uid(); payable = max(1_000_000, c['base']//4 + (i%7)*11_111)
    # 1-3 requests, total = payable portion (use 75% of payable for partial, 100% for i%4==0)
    ratio_pct = 100 if i % 4 == 0 else 60
    total_req = payable * ratio_pct // 100
    n = 1 + (i % 3)
    parts = [total_req//n]*(n-1) + [total_req - (total_req//n)*(n-1)]
    settlements.append({'id':st,'p':c['p'],'ct':c['id'],'ver':c['v2'] or c['v1'],'terms':term_versions[i%80],'payable':payable,'paid':total_req,'status':'paid' if ratio_pct==100 else 'partially_paid','code':f'JS-2024-{i+1:04d}'})
    ins('Settlement', ['id','projectId','contractId','contractVersionId','paymentTermsVersionId','code','periodLabel','status','amountCents','payableAmountCents','paidAmountCents','createdAt','updatedAt','isFinal','sourceType'],
        [[q(st), q(c['p']), q(c['id']), q(c['v2'] or c['v1']), q(term_versions[i%80]), q(f'JS-2024-{i+1:04d}'), q(f'2024年第{i%12+1}期'), q('paid' if ratio_pct==100 else 'partially_paid'), str(payable), str(payable), str(total_req), q('2024-07-01 09:00:00'), q('2024-08-01 09:00:00'), 'false', q('settlement')]])
    # 3 lines summing to payable
    l1 = payable//4; l2 = payable//4; l3 = payable - l1 - l2
    for k, amt in enumerate([l1,l2,l3]):
        sl = uid()
        ins('SettlementLine', ['id','settlementId','sourceType','name','amountCents','reason','sortOrder','createdAt','updatedAt'],
            [[q(sl), q(st), q('manual_adjustment'), q(f'虚构结算明细{k+1}'), str(amt), q('seed adjustment'), str(k), q('2024-07-01 09:00:00'), q('2024-07-01 09:00:00')]])
    offset = 0
    for k, amt in enumerate(parts):
        r = uid(); requests.append({'id':r,'st':st,'amt':amt,'ver':c['v2'] or c['v1'],'terms':term_versions[i%80],'p':c['p'],'ct':c['id'],'co':c['co']})
        ins('PaymentRequest', ['id','projectId','settlementId','contractId','contractVersionId','paymentTermsVersionId','code','status','requestedAmountCents','approvedAmountCents','paidAmountCents','createdAt','updatedAt','sourceType','paymentSubjectType'],
            [[q(r), q(c['p']), q(st), q(c['id']), q(c['v2'] or c['v1']), q(term_versions[i%80]), q(f'FK-2024-{len(requests):05d}'), q('paid'), str(amt), str(amt), str(amt), q('2024-08-02 09:00:00'), q('2024-09-01 09:00:00'), q('settlement'), q('our_company')]])
        # 1-2 executions summing to amt
        m = 1 + ((i+k) % 2)
        e_parts = [amt//m]*(m-1) + [amt - (amt//m)*(m-1)]
        for e_amt in e_parts:
            e = uid(); executions.append(e)
            ins('PaymentExecution', ['id','paymentRequestId','settlementId','amountCents','paidAt','executedByUserId','voucherFileId','createdAt','paymentSubjectType','idempotencyKey','companyEntityIdSnapshot','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot'],
                [[q(e), q(r), q(st), str(e_amt), q('2024-09-05 10:00:00'), q(users[(i+k)%12]), q(files[(len(executions))%500]), q('2024-09-05 10:00:00'), q('our_company'), q(f'legacy:payment_execution:{e}'), q(c['co']['id']), q(c['co']['name']), q(c['co']['code'])]])

# spot procurements
for i in range(80):
    sp = uid(); spv = uid(); p = projects[i%8]
    ins('SpotProcurement', ['id','projectId','code','applicantUserId','handlerUserId','currentVersionId','status','approvedAmountCents','actualCostCents','createdAt','updatedAt'],
        [[q(sp), q(p), q(f'CX-2024-{i+1:04d}'), q(users[i%12]), q(users[(i+1)%12]), q(spv), q('closed'), str(200_000+i*1000), str(190_000+i*900), q('2024-04-01 09:00:00'), q('2024-05-01 09:00:00')]])
    ins('SpotProcurementVersion', ['id','procurementId','versionNo','status','reason','handlerUserId','createdByUserId','updatedAt','applicationDepartmentSnapshot','applicationNameSnapshot','purchaserNameSnapshot','purchaserDepartmentNameSnapshot','totalAmountCents'],
        [[q(spv), q(sp), '1', q('approved'), q('虚构零星采购'), q(users[(i+1)%12]), q(users[i%12]), q('2024-05-01 09:00:00'), q('工程部'), q('项目部'), q('采购经办'), q('工程部'), str(200_000+i*1000)]])
    for k in range(3):
        spl = uid()
        ins('SpotProcurementLine', ['id','versionId','sortOrder','materialName','specification','unit','quantity','unitPrice','amountCents','createdAt'],
            [[q(spl), q(spv), str(k+1), q(f'虚构材料{k+1}'), q('规格A'), q('吨'), '10.5', '1200.00', str(12600), q('2024-04-01 09:00:00')]])

# takeover batches + 12k rows
tb = []
for i in range(4):
    b = uid(); tb.append(b)
    ins('OperatingTakeoverBatch', ['id','projectId','batchNo','sourceFileName','sceneKeys','status','revision','importFingerprint','totalRows','readyRows','blockedRows','warningRows','createdByUserId','createdAt','updatedAt'],
        [[q(b), q(projects[i]), q(f'JG-2024-{i+1:02d}'), q(f'历史接管底稿{i+1}.xlsx'), jq(['legacy_contract','legacy_expense']), q('activated'), '1', q(hashlib.sha256(f'batch-{i}'.encode()).hexdigest()), '3000', '2850', '100', '50', q(users[i]), q('2024-02-10 09:00:00'), q('2024-03-01 09:00:00')]])
out.append(f'''
INSERT INTO public."OperatingTakeoverRow" (id,"batchId","rowNo","sceneKey","definitionVersion","businessRef","occurredAt","periodLabel","amountCents","valuesSnapshot","evidenceLevel","reviewStatus","duplicateStatus","revision","createdAt","updatedAt")
SELECT 'otr-'||lpad(i::text,8,'0'), (ARRAY[{','.join(q(x) for x in tb)}])[1+((i-1)/3000)::int], 1+((i-1)%3000), 'legacy_contract', 1, 'LEGACY-'||lpad(i::text,8,'0'),
  DATE '2023-01-01' + ((i%700)::int), '2023-'||lpad((1+(i%12))::text,2,'0'), 100000 + (i%97)*1379,
  jsonb_build_object('seed',true,'seq',i,'counterparty','虚构历史相对方'), 'B', 'accepted', 'none', 1,
  TIMESTAMP '2024-02-10 09:00:00' + ((i%1000)||' minutes')::interval, TIMESTAMP '2024-02-10 09:00:00' + ((i%1000)||' minutes')::interval
FROM generate_series(1,12000) AS g(i);''')

# audit logs 20k
audit_users = 'ARRAY[' + ','.join(q(x) for x in users[:12]) + ']'
out.append('''
INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata,"createdAt")
SELECT 'aud-'||lpad(i::text,8,'0'), (''' + audit_users + ''')[1+(i%12)],
  (ARRAY['contract.version.effective','settlement.effective','payment.executed','payment.request.approved'])[1+(i%4)],
  (ARRAY['contract_version','settlement','payment_execution'])[1+(i%3)],
  'seed-business-'||lpad((i%500)::text,6,'0'),
  jsonb_build_object('seed',true,'seq',i,'amountCents',100000+(i%997)*137,'trace','am424'),
  TIMESTAMP '2024-01-01 00:00:00' + (i||' seconds')::interval
FROM generate_series(1,20000) AS g(i);''')

# approvals
for i in range(200):
    ai = uid(); biz = (contracts[i%80]['v2'] or contracts[i%80]['v1'])
    status = 'approved' if i%3 else 'in_approval'
    ins('ApprovalInstance', ['id','flowType','businessType','businessId','status','currentNodeIndex','frozenNodes','applicantUserId','createdAt','updatedAt'],
        [[q(ai), q('contract.approve'), q('contract_version'), q(biz), q(status), '1' if status=='approved' else '0', jq([{'name':'合同部主管','mode':'all','roleKeys':['contract_director']},{'name':'总经理','mode':'any','roleKeys':['general_manager','chairman']}]), q(users[i%12]), q('2024-06-02 09:00:00'), q('2024-06-03 09:00:00')]])
    for k, act in enumerate(['submit','approve']):
        aa = uid()
        ins('ApprovalActionLog', ['id','approvalInstanceId','action','actorUserId','comment','metadata','approvedRoleKey','createdAt'],
            [[q(aa), q(ai), q(act), q(users[(i+k)%12]), q('虚构审批意见'), jq({'seed':True,'seq':i*2+k}), q('contract_director'), q('2024-06-02 10:00:00')]])

sql = 'BEGIN;\nSET LOCAL session_replication_role = replica;\n' + '\n'.join(out) + '\nCOMMIT;\n'
import sys
open(sys.argv[1] if len(sys.argv)>1 else 'seed.sql','w').write(sql)
print('sql bytes', len(sql))
print('contracts', len(contracts), 'settlements', len(settlements), 'requests', len(requests), 'executions', len(executions))
