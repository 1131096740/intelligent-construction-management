"""Local fixture driver: lose SSH pipes/HUP while the real server awaits a decision."""
import fcntl
import json
import os
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path

session_root = Path(os.environ['DEPLOY_SESSION_ROOT'])
lock_path = session_root.parent / 'deploy.lock'
lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
os.dup2(lock_fd, 9)
if lock_fd != 9:
    os.close(lock_fd)
fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
process = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, pass_fds=(9,))
os.close(9)
action = os.environ.get('DISCONNECT_DECISION', 'CONFIRM')
expected_exit = 0 if action == 'CONFIRM' else 1
try:
    # Unbuffered reads keep the bound effective even if startup never reaches the prompt.
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    output = b''
    deadline = time.monotonic() + 30
    while b'Expected content: CONFIRM ' not in output:
        assert time.monotonic() < deadline, 'deployment never reached manual confirmation'
        if selector.select(0.1):
            chunk = os.read(process.stdout.fileno(), 65536)
            assert chunk, output.decode(errors='replace')
            output += chunk
    selector.close()
    process.stdout.close()
    process.send_signal(signal.SIGHUP)
    process.wait(timeout=5)
    # The same descriptor contract used by both SSH launchers must still exclude
    # another checkout/deployment after the observing SSH shell has died.
    with lock_path.open('r+') as probe:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            raise AssertionError('transport exit released the active deployment lock')
    if action != 'TIMEOUT':
        sha = 'f' * 40 if action == 'WRONG_SHA' else os.environ['TARGET_SHA']
        decision = 'CONFIRM' if action == 'WRONG_SHA' else action
        Path(os.environ['DEPLOY_CONFIRMATION_FILE']).write_text(decision + ' ' + sha + '\n')
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        receipts = list(session_root.glob('session.*/result.json'))
        if receipts:
            receipt = json.loads(receipts[0].read_text())
            assert receipt == {'targetSha': os.environ['TARGET_SHA'], 'exitCode': expected_exit}, receipt
            assert receipts[0].stat().st_mode & 0o777 == 0o600
            evidence = receipts[0].parent / 'evidence'
            assert evidence.stat().st_mode & 0o777 == 0o700
            assert json.loads((evidence / 'release.json').read_text()) == {
                'schemaVersion': 1, 'targetSha': os.environ['TARGET_SHA'], 'scope': 'full'}
            web = json.loads((evidence / 'candidate-web.json').read_text())
            assert 'dist/release.txt' in web['entries'] and 'release.txt' not in web['entries']
            for name in ['stage-web', 'snapshot-api', 'snapshot-web', 'installed-api', 'installed-web']:
                path = evidence / (name + '.diff.json')
                assert path.stat().st_mode & 0o777 == 0o600
                assert json.loads(path.read_text())['status'] == 'passed'
            assert (evidence / 'staged-runtime/web-admin/dist/release.txt').is_file()
            assert (evidence / 'previous-runtime/api/dist/release.txt').is_file()
            if action != 'CONFIRM':
                for name in ['recovered-api', 'recovered-web']:
                    assert json.loads((evidence / (name + '.diff.json')).read_text())['status'] == 'passed'
            break
        time.sleep(0.05)
    else:
        raise AssertionError('disconnected deployment never finalized its result')
    # Check the public read-only interface; a failed deployment still has a readable result.
    status = subprocess.run(sys.argv[1:] + ['--status', receipts[0].parent.name], capture_output=True, text=True, timeout=5)
    assert status.returncode == 0, status.stderr
    assert json.loads(status.stdout.splitlines()[-1]) == receipt
    with lock_path.open('r+') as probe:
        # Receipt publication precedes worker exit by a few instructions.
        deadline = time.monotonic() + 3
        while True:
            try:
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                assert time.monotonic() < deadline, 'finished deployment retained its lock'
                time.sleep(0.05)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
