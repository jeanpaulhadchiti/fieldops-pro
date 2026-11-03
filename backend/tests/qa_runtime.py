"""Manage only this QA run's labelled disposable PostgreSQL container.

Credentials live in an ignored local file; never print connection strings.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.env.qa-runtime'


def main():
    action = sys.argv[1]
    if action == 'start':
        if STATE.exists():
            raise RuntimeError('A QA runtime already exists; inspect before replacing it')
        suffix = uuid.uuid4().hex[:12]
        name = 'fieldops-qa-' + suffix
        database = 'fieldops_day9_test_' + suffix
        password = secrets.token_urlsafe(32)
        env = {**os.environ, 'POSTGRES_PASSWORD': password}
        subprocess.run(['docker', 'run', '-d', '--name', name, '--label', 'fieldops.qa.disposable=true',
                        '-e', 'POSTGRES_USER=qa', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=' + database,
                        '-p', '127.0.0.1::5432', 'postgres:17-alpine'], env=env, check=True, capture_output=True)
        port = subprocess.check_output(['docker', 'port', name, '5432/tcp'], text=True).strip().split(':')[-1]
        STATE.write_text(json.dumps({'name': name, 'database': database,
            'url': f'postgresql+psycopg://qa:{password}@127.0.0.1:{port}/{database}'}), encoding='utf-8')
        for _ in range(60):
            if subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'qa', '-d', database], capture_output=True).returncode == 0:
                print('Disposable PostgreSQL ready:', name)
                return
            time.sleep(0.5)
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    state = json.loads(STATE.read_text(encoding='utf-8'))
    if action == 'stop':
        label = subprocess.check_output(['docker', 'inspect', '--format', '{{ index .Config.Labels "fieldops.qa.disposable" }}', state['name']], text=True).strip()
        if label != 'true' or not state['name'].startswith('fieldops-qa-'):
            raise RuntimeError('Refusing to remove an unverified container')
        subprocess.run(['docker', 'rm', '-f', state['name']], check=True, capture_output=True)
        STATE.unlink()
        print('Disposable QA database removed')
        return
    env = {**os.environ, 'FIELDOPS_TEST_DATABASE_URL': state['url']}
    if action == 'test':
        pattern = sys.argv[2] if len(sys.argv) > 2 else 'test_*integration.py'
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', pattern, '-v'], cwd=ROOT / 'backend', env=env)
    elif action == 'browser':
        runtime = Path(os.environ.get('LOCALAPPDATA', '')) / 'OpenAI/Codex/runtimes/cua_node'
        candidates = list(runtime.glob('*/bin/node_modules/playwright/index.mjs')) if runtime.exists() else []
        if candidates:
            env.setdefault('FIELDOPS_PLAYWRIGHT_MODULE', candidates[0].as_uri())
        result = subprocess.run(['node', sys.argv[2]], cwd=ROOT / 'frontend', env=env)
    else:
        raise RuntimeError('Unknown action')
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
