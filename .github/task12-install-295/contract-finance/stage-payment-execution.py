import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

archive_arg, common_arg, stage_arg, *options = sys.argv[1:]
if options == ['--company-history-352']:
    subprocess.run([sys.executable, __file__, archive_arg, common_arg, stage_arg, '--signed-settlement-350'], check=True)
    stage = Path(stage_arg)
    plan = Path(__file__).parent
    for patch in ('expense-witness/installer-352.patch', 'payment-execution-352-fixtures.patch'):
        subprocess.run(['git', 'apply', '--unidiff-zero', '-p0' if patch.startswith('payment-') else '-p1', str((plan / patch).resolve())], cwd=stage, check=True)
    installer = stage / 'installer.cjs'
    old = b'PAYMENT_EXECUTION_ORIGINAL_RETAINED_VALID_(295|329|330|331|332|334|346|349|350)'
    contents = installer.read_bytes()
    if contents.count(old) != 1:
        raise SystemExit('PAYMENT_352_RETAINED_VALID_PREIMAGE')
    installer.write_bytes(contents.replace(old, old[:-1] + b'|352)'))
    for name, digest in {
        'installer.cjs': 'f51860f93670e10534cad3173d8a5d1e415a3e31ac0c5cf5d4355dbf8d38674a',
        'fresh.cjs': 'b2a8367928d1f9656ac3146710fe613c6b5ca7aced79736760585083c5bef2ec',
        'valid.cjs': 'a2ba2d80cb43a52baa0cf0debf02f18d8b204fa9569d5bcaeb0ead6134645f3d',
        'payment-execution-concurrency.spec.ts': 'ec78af354d1c0904ea6e7e3e87a5f92e5fa62b3fd3f27ed5875dfa6a9be3d916',
        'contract-finance-owned.test-support.ts': 'd12ddb8a4d8a898f5f33f6e166e1b7fbdc6884ebde4a0a153e0dacd6819c515c',
    }.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'PAYMENT_352_POSTIMAGE {name}')
    for file in stage.rglob('*'):
        if file.is_file():
            file.chmod(0o644)
    raise SystemExit(0)
modes = ([], ['--text-direct-330'], ['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334'], ['--expense-witness-346'], ['--expense-witness-349'], ['--signed-settlement-350'])
if options not in modes:
    raise SystemExit('PAYMENT_STAGE_MODE')
archive, common, stage = map(Path, (archive_arg, common_arg, stage_arg))
plan = Path(__file__).parent
pins = json.loads((archive / 'material.json').read_text())['inputs']
for name, checksum in pins.items():
    source = archive / name
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
        raise SystemExit(f'PAYMENT_295_MATERIAL_PIN {name}')
    target = stage / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

installer = stage / 'installer.cjs'
expense_witness = options in modes[5:]
precision = options in modes[6:]
signed_settlement = options == ['--signed-settlement-350']
historical_settlement = options in modes[4:]
if historical_settlement:
    subprocess.run(['node', str((plan / 'stage-historical-takeover-333.cjs').resolve()),
                    str(stage.resolve()), 'historical-settlement-334'], check=True)
    if expense_witness:
        subprocess.run(['git', 'apply', '--unidiff-zero',
                        str((plan / 'expense-witness/installer.patch').resolve())], cwd=stage, check=True)
        if hashlib.sha256(installer.read_bytes()).hexdigest() != '50208a12c5ac61b396655807e87f8c86ea92db83aa2a3297c38f253735ce155d':
            raise SystemExit('PAYMENT_346_INSTALLER_PREIMAGE')
        if precision:
            subprocess.run(['git', 'apply', '--unidiff-zero',
                            str((plan / 'expense-witness/installer-349.patch').resolve())], cwd=stage, check=True)
            if hashlib.sha256(installer.read_bytes()).hexdigest() != 'a38d1424c1f096d1ed43cffbdd70f99521281a30d09bf5792261a4bbd3ff540a':
                raise SystemExit('PAYMENT_349_INSTALLER_PREIMAGE')
        if signed_settlement:
            subprocess.run(['git', 'apply', '--unidiff-zero',
                            str((plan / 'expense-witness/installer-350.patch').resolve())], cwd=stage, check=True)
            if hashlib.sha256(installer.read_bytes()).hexdigest() != '092c7fc57d3c8c9a065264cee5b0253b2b91497448198ab02ed46362be6ee2c0':
                raise SystemExit('PAYMENT_350_INSTALLER_PREIMAGE')
else:
    shutil.copyfile(common / 'installer.cjs', installer)
subprocess.run(['git', 'apply', '-p0',
                str((plan / 'payment-execution-installer.patch').resolve())], cwd=stage, check=True)
for name in ('fresh.cjs','valid.cjs','payment-execution-concurrency.spec.ts'):
    subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/name),str(plan/(name+'.patch'))],check=True)
subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/'payment-execution-concurrency.spec.ts'),
                str(plan/('payment-concurrency-330.patch' if options else 'payment-concurrency-320.patch'))],check=True)
if options in modes[2:]:
    support = 'contract-finance-owned.test-support.ts'
    shutil.copyfile(plan / support, stage / support)
    for name, delta, before, after in [
        ('fresh.cjs', 'payment-execution-331-fresh.cjs.patch',
         '1f5957b83f6d5326fbfac99f379f8c00e77e8ac98b5dbbcf1a876ace6e8a2231', '1694f94fb0248da07f88f7f7b76d83c64195d1fcb13379aadc321b71c6da48b0'),
        ('valid.cjs', 'payment-execution-331-valid.cjs.patch',
         '6bf94f42923a2113a5b5c9818b429fdc21e8f8d35f933661a7bf2798bd9063cf', '677fee72f86c38beab8cb47938be858aa59a648146d0fed1556bf5d9028eb6c0'),
        ('payment-execution-concurrency.spec.ts', 'payment-execution-331-payment-execution-concurrency.spec.ts.patch',
         'd487a5eb5c61992366e9c370999986c43f161c26b7fcd7c0e41278b6fcc16a50', '0cd8ebc9938760d0af40b4825cd00d23d4bcdf733df65a5cc96e7b178e20e020'),
        ('contract-finance-owned.test-support.ts', 'payment-execution-331-contract-finance-owned.test-support.ts.patch',
         'ac5534e836fce1a78b9e50523bf5edd35b751be6d18525fd7fa2af775150771d', '2c3ab7ebeedc7da20ae1a1b1c189fb3e36781b9b6fd6e69e62c59a1d00d70377'),
    ]:
        target = stage / name
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise SystemExit(f'PAYMENT_331_PREIMAGE {name}')
        subprocess.run(['patch', '--silent', '--batch', '--forward', '--fuzz=0',
                        str(target), str(plan / delta)], check=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != after:
            raise SystemExit(f'PAYMENT_331_POSTIMAGE {name}')
if options in modes[3:]:
    for name, delta, before, after in [
        ('fresh.cjs', 'payment-execution-332-fresh.cjs.patch',
         '1694f94fb0248da07f88f7f7b76d83c64195d1fcb13379aadc321b71c6da48b0', 'c68867cf66ec834c5d05be44bdfe17975497d9d216a0a4b654a8dcfb9ce891cf'),
        ('valid.cjs', 'payment-execution-332-valid.cjs.patch',
         '677fee72f86c38beab8cb47938be858aa59a648146d0fed1556bf5d9028eb6c0', '213b61fbd163f4ac150f33c463419e382240cd1b78d6ed1a60f724c001a2bd2f'),
        ('payment-execution-concurrency.spec.ts', 'payment-execution-332-payment-execution-concurrency.spec.ts.patch',
         '0cd8ebc9938760d0af40b4825cd00d23d4bcdf733df65a5cc96e7b178e20e020', '60fadabef257b2eab2eb359f8add2e8c2455a1b44be09aba4bcf8d8bece1b56e'),
        ('contract-finance-owned.test-support.ts', 'payment-execution-332-contract-finance-owned.test-support.ts.patch',
         '2c3ab7ebeedc7da20ae1a1b1c189fb3e36781b9b6fd6e69e62c59a1d00d70377', 'be618a894a7aaf7f0ab007b1049a2f98f81c330f2352f01f97aeebf0bcd63cc5'),
    ]:
        target = stage / name
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise SystemExit(f'PAYMENT_332_PREIMAGE {name}')
        subprocess.run(['patch', '--silent', '--batch', '--forward', '--fuzz=0',
                        str(target), str(plan / delta)], check=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != after:
            raise SystemExit(f'PAYMENT_332_POSTIMAGE {name}')
if historical_settlement:
    core = json.loads((plan / 'core-payment-334-fixtures.json').read_bytes())
    entries = (
        ('installer.cjs', '1c8fc6101879482fd323988bc19b218a5ef63b001b98c1d6146cd9186595d1cb',
         '6e6e8036a5e0af54a0ab161fdae44a01b29055173193263be1821b041cea52f1'),
        ('fresh.cjs', 'c68867cf66ec834c5d05be44bdfe17975497d9d216a0a4b654a8dcfb9ce891cf',
         'f4e7f359d1e130584e0c1832305935569162615ae9c83802eb928aef8108f45c'),
        ('valid.cjs', '213b61fbd163f4ac150f33c463419e382240cd1b78d6ed1a60f724c001a2bd2f',
         '244f4bd15389f1b7559c9f575f65c875649657e7ad4921ec6c0be853c1a5dc3a'),
        ('payment-execution-concurrency.spec.ts', '60fadabef257b2eab2eb359f8add2e8c2455a1b44be09aba4bcf8d8bece1b56e',
         'd57ee4073dd761d704cc9ab7fc2c45d38a0125653d8e3e985772c9d74abb60d9'),
        ('contract-finance-owned.test-support.ts', 'be618a894a7aaf7f0ab007b1049a2f98f81c330f2352f01f97aeebf0bcd63cc5',
         core['fixtures']['contract-finance-owned.test-support.ts']),
    )
    for name, before, after in entries:
        if expense_witness and name == 'installer.cjs':
            continue
        target = stage / name
        delta = f'payment-execution-334-{name}.patch'
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise SystemExit(f'PAYMENT_334_PREIMAGE {name}')
        if delta in core['materials'] and hashlib.sha256((plan / delta).read_bytes()).hexdigest() != core['materials'][delta]:
            raise SystemExit(f'PAYMENT_334_MATERIAL {name}')
        subprocess.run(['patch', '--silent', '--batch', '--forward', '--fuzz=0',
                        str(target), str(plan / delta)], check=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != after:
            raise SystemExit(f'PAYMENT_334_POSTIMAGE {name}')

if expense_witness:
    old = b'PAYMENT_EXECUTION_ORIGINAL_RETAINED_VALID_(295|329|330|331|332)'
    contents = installer.read_bytes()
    if contents.count(old) != 1:
        raise SystemExit('PAYMENT_346_RETAINED_VALID_PREIMAGE')
    final_modes = b'|334|346'
    if precision:
        final_modes += b'|349'
    if signed_settlement:
        final_modes += b'|350'
    final_modes += b')'
    installer.write_bytes(contents.replace(old, old[:-1] + final_modes))
    subprocess.run(['git', 'apply', '-p0',
                    str((plan / 'payment-execution-346-fixtures.patch').resolve())], cwd=stage, check=True)

    for name, digest in {
        'installer.cjs': '7f9e10a584ac09252a292064013b950897cfbdb35da2fbd142759f44efb1d38f',
        'fresh.cjs': '905653234f6bfde440594050d1bb13d514d710337c21d7a093b7937a6d42534a',
        'valid.cjs': 'c2294fb345d4b43024cb08231ddc529d6660eb2946fa792be8eda4aba52ecfa1',
        'payment-execution-concurrency.spec.ts': '56d1cb18351ea8d9fbe36a33bc3542f20f8ac174ba212d15960f304b56941235',
        'contract-finance-owned.test-support.ts': 'e2afc9fe3da2262eee0c2cb3d13c113eff125c24fda9f959eb09949639ffa8ff',
    }.items():
        if precision and name == 'installer.cjs':
            continue
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'PAYMENT_346_POSTIMAGE {name}')

if precision:
    subprocess.run(['git', 'apply', '-p0',
                    str((plan / 'payment-execution-349-fixtures.patch').resolve())], cwd=stage, check=True)
    for name, digest in {
        'installer.cjs': 'c330c490d5659ff6a9f785f844d4317d7f3d61a76598ab3920bb8bcaf7c5ff89',
        'fresh.cjs': 'e012450b438a72878451249284ffc6f4ab8c845456365412bcdaf39068bd0909',
        'valid.cjs': 'f0074c37cc2e85d2c99df33709d980446141056e89d44bd5254dcecc1fcabffa',
        'payment-execution-concurrency.spec.ts': '34123b38d07507b6a589980877144bc7c08a14195d118c0a4de17f728da3baa2',
        'contract-finance-owned.test-support.ts': 'fc17a8068503366316ef5cba8c86e376d2b8ddb88dd5cf82237e80d2b9229e39',
    }.items():
        if signed_settlement and name == 'installer.cjs':
            continue
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'PAYMENT_349_POSTIMAGE {name}')

if signed_settlement:
    subprocess.run(['git', 'apply', '--unidiff-zero', '-p0',
                    str((plan / 'payment-execution-350-fixtures.patch').resolve()),
                    str((plan / 'core-payment-350-ledger.patch').resolve())], cwd=stage, check=True)
    for name, digest in {
        'installer.cjs': '485b3c7ed1191d6e88c93545c1937dd65726b76f573039ba765d46a1341b458a',
        'fresh.cjs': '16b69dc37f2f0792c1b6ae9e31333ee0e70bb9c1d5fb606675d7de11ac7e2a74',
        'valid.cjs': 'bd4f0cee52a630fd2ff9358582ea1bb2ad04c05b79ec076ec5f9cd800d940559',
        'payment-execution-concurrency.spec.ts': 'd4422a89e7a95046b27ef66318f536072590854d3d18bad4cb1607f50c81c610',
        'contract-finance-owned.test-support.ts': '87bb2cae10d3cb927c5e2f32c624f57c53e992949bf8ea7efe357cd989c28e7e',
    }.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'PAYMENT_350_POSTIMAGE {name}')

for file in stage.rglob('*'):
    if file.is_file():
        file.chmod(0o644)
