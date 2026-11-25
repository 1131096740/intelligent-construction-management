import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

archive_arg, common_arg, stage_arg, *options = sys.argv[1:]
if options not in ([], ['--text-direct-330'], ['--payment-remainder-331'], ['--upward-archive-332']):
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
shutil.copyfile(common / 'installer.cjs', installer)
subprocess.run(['git', 'apply', '--unidiff-zero', '-p0',
                str((plan / 'payment-execution-installer.patch').resolve())], cwd=stage, check=True)
for name in ('fresh.cjs','valid.cjs','payment-execution-concurrency.spec.ts'):
    subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/name),str(plan/(name+'.patch'))],check=True)
subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/'payment-execution-concurrency.spec.ts'),
                str(plan/('payment-concurrency-330.patch' if options else 'payment-concurrency-320.patch'))],check=True)
if options in (['--payment-remainder-331'], ['--upward-archive-332']):
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
if options == ['--upward-archive-332']:
    for name, delta, before, after in [
        ('fresh.cjs', 'payment-execution-332-fresh.cjs.patch',
         '1694f94fb0248da07f88f7f7b76d83c64195d1fcb13379aadc321b71c6da48b0', 'c68867cf66ec834c5d05be44bdfe17975497d9d216a0a4b654a8dcfb9ce891cf'),
        ('valid.cjs', 'payment-execution-332-valid.cjs.patch',
         '677fee72f86c38beab8cb47938be858aa59a648146d0fed1556bf5d9028eb6c0', '213b61fbd163f4ac150f33c463419e382240cd1b78d6ed1a60f724c001a2bd2f'),
        ('payment-execution-concurrency.spec.ts', 'payment-execution-332-payment-execution-concurrency.spec.ts.patch',
         '0cd8ebc9938760d0af40b4825cd00d23d4bcdf733df65a5cc96e7b178e20e020', '60fadabef257b2eab2eb359f8add2e8c2455a1b44be09aba4bcf8d8bece1b56e'),
        ('contract-finance-owned.test-support.ts', 'payment-execution-332-contract-finance-owned.test-support.ts.patch',
         '2c3ab7ebeedc7da20ae1a1b1c189fb3e36781b9b6fd6e69e62c59a1d00d70377', '6859cac4c6e0613641409657fd9bf74b1cba34115af2b6d3ef28a5295451fa3a'),
    ]:
        target = stage / name
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise SystemExit(f'PAYMENT_332_PREIMAGE {name}')
        subprocess.run(['patch', '--silent', '--batch', '--forward', '--fuzz=0',
                        str(target), str(plan / delta)], check=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != after:
            raise SystemExit(f'PAYMENT_332_POSTIMAGE {name}')
for file in stage.rglob('*'):
    if file.is_file():
        file.chmod(0o644)
