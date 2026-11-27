from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

historical, archive, common, out, shard, count = sys.argv[1:]
if count not in {'295', '329', '330', '331', '332', '334', '346', '349', '350', '352'}:
    raise SystemExit('POL108_MIGRATION_COUNT')
historical,archive,common,out=map(Path,(historical,archive,common,out))
plan=Path(__file__).parent
pins=json.loads((archive/'profile.json').read_text())['pol108Assembly']

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def patch(target, delta):
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(target),str(delta)],check=True)

out.mkdir()
for name in ['pol108-289.cjs','pol108-observability.cjs','pol108-shards.cjs',
             'fixtures/jest.runtime.config.cjs',*(('fixtures/operating-projection-postgresql.cases.ts',) if shard=='core' else ())]:
    source=historical/name
    target=out/source.name
    shutil.copyfile(source,target)
    pin=pins.get(source.name)
    if pin:
        delta=archive/(source.name+'.patch')
        if digest(target)!=pin['baseSha256'] or digest(delta)!=pin['patchSha256']:
            raise SystemExit('POL108_ARCHIVE_PREIMAGE')
        patch(target,delta)
        if digest(target)!=pin['resultSha256']:
            raise SystemExit('POL108_ARCHIVE_POSTIMAGE')
if shard=='core':
    cases = out/'operating-projection-postgresql.cases.ts'
    patch(cases, plan/'pol108-core-cases.patch')
    if count != '295':
        text = cases.read_text()
        original = 'COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 295'
        if text.count(original) != 1:
            raise SystemExit('POL108_320_LEDGER_COUNT_ANCHOR')
        text = text.replace(original, original.removesuffix('295') + count)
        if count in {'350', '352'}:
            anchor = '''                AND EXISTS (SELECT FROM "_prisma_migrations"
                  WHERE migration_name = '20261119003500_fund_balance_correction_controlled_round'
'''
            checkpoints = '''                AND EXISTS (SELECT FROM "_prisma_migrations"
                  WHERE migration_name = '20261129018000_reimbursement_exact_cash_cost_links'
                    AND checksum = '58b3cc0404a85a97dbb484654245d4bd042e5fb2014f32997244b2597cb5110b'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
                AND EXISTS (SELECT FROM "_prisma_migrations"
                  WHERE migration_name = '20261129019000_signed_settlement_exact_operating_cost'
                    AND checksum = '86ad90ea7fad6231f1d8b24dd8e4eb25d5ba0b1696d3544f5999680ebaa4c6e4'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
'''
            if count == '352':
                checkpoints += '''                AND EXISTS (SELECT FROM "_prisma_migrations"
                  WHERE migration_name = '20261129020000_company_transfer_settled_return'
                    AND checksum = 'cbaf785b470e8e0de1d79256e9ed19b181bf875131c741d866754fd1277d8fff'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
                AND EXISTS (SELECT FROM "_prisma_migrations"
                  WHERE migration_name = '20261129021000_company_history_expense'
                    AND checksum = '8cb43f1ae9a6fb6108280f1ea08df4d2d2edf7c060b39b37dfbeeaff7ae368e5'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
'''
            if text.count(anchor) != 1:
                raise SystemExit('POL108_350_CORE_CHECKPOINT_ANCHOR')
            text = text.replace(anchor, checkpoints + anchor)
        cases.write_text(text)
        core_fingerprints = {
            '346': '90ebf581a9ba6d2019560facab6a6329c5b0626c2908b73a526015fbc1437e77',
            '349': 'e3c97dd22f1481fc5c3651ea74608ee255959f1406db78b5cec54351bfc7be89',
            '350': '6e94dde323576d1c6e4a98ee36b1205567fa9e5c8858a2d2a7a3ee0d28845de3',
            '352': '16be31ad9c69d4a52256fa27c085708b65f742f9cda13d6abc5980fdb36b3e1c',
        }
        if count in core_fingerprints and digest(cases) != core_fingerprints[count]:
            raise SystemExit('POL108_'+count+'_CORE_FIXTURE')
installer=out/'installer.cjs'
if count in {'334', '346', '349', '350', '352'}:
    subprocess.run(['node', str(plan/'stage-historical-takeover-333.cjs'), str(out), 'historical-settlement-334'],check=True)
else:
    shutil.copyfile(common/'installer.cjs',installer)
if count in {'346', '349', '350', '352'}:
    deltas = ['installer.patch']
    if count in {'349', '350', '352'}:
        deltas.append('installer-349.patch')
    if count in {'350', '352'}:
        deltas.append('installer-350.patch')
    if count == '352':
        deltas.append('installer-352.patch')
    for delta in deltas:
        subprocess.run(['git', 'apply', '--unidiff-zero', str((plan/'expense-witness'/delta).resolve())],
                       cwd=out, check=True)
    mode = 'company-history-352' if count == '352' else 'signed-settlement-350' if count == '350' else f'expense-witness-{count}'
    profile = (plan/f'{mode}-profile.cjs').resolve()
    canonical = subprocess.check_output(
        ['node', '-p', 'require(process.argv[1]).installerSha256', str(profile)], text=True).strip()
    if digest(installer) != canonical:
        raise SystemExit('POL108_'+count+'_INSTALLER_PREIMAGE')
    patch(installer, plan/f'pol108-{count}-installer.patch')
    installer_fingerprints = {
        '346': 'fd1c86f6bc0654199efdeed8ba3753ad8376d99d2b660e9a70e1cf3564110719',
        '349': '6c49a48ceb13a8c04b1cc6ab135de854dcdfef8dd7117070b2881cf1e3e137e5',
        '350': '049c6c7959490d8e33e38104cb250e8f3a32c31a3e7623d455708d6fe0968b66',
        '352': 'c4914cbbe9b2bd46799775cac7f84eb425a2587d7ea91dff1dff63038e463105',
    }
    if digest(installer) != installer_fingerprints[count]:
        raise SystemExit('POL108_'+count+'_INSTALLER_POSTIMAGE')
else:
    patch(installer,plan/'pol108-installer.patch')
if count == '334':
    if digest(installer) != 'e3a90eb052cce82cd3baa6ed10475e2e793995226a96719164fb66dab52d9fe9':
        raise SystemExit('POL108_334_INSTALLER_PREIMAGE')
    patch(installer,plan/'pol108-334-installer.patch')
    if digest(installer) != '6e5ac94e0bf949e315baca0a56e4489c969700e7009c8898140a13e3dae295d2':
        raise SystemExit('POL108_334_INSTALLER_POSTIMAGE')
for file in out.iterdir():
    file.chmod(0o644)
