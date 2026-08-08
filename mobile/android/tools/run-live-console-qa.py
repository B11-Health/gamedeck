#!/usr/bin/env python3
import argparse, json, os, re, subprocess, time
from pathlib import Path

PACKAGE = 'io.gamedeck.mobile.desktoppreview.qa'
MAIN = f'{PACKAGE}/io.gamedeck.mobile.MainActivity'
ACTION = 'io.gamedeck.mobile.QA'
PLAY_ACTION = 'io.gamedeck.mobile.PLAY_QA'
QA = Path('/storage/emulated/0/Download/GameDeck-QA')
DIAG = Path(f'/storage/emulated/0/Android/media/{PACKAGE}/GameDeck-Console/diagnostics')
OUTROOT = Path('/storage/emulated/0/Download/GameDeck-Live-QA')

DEFAULT_CASES = [
    ('atari2600', 0, 'atari2600'),
    ('gb', 0, 'gb'),
    ('gba', 0, 'gba'),
    ('mastersystem', 0, 'mastersystem'),
    ('gamegear', 0, 'gamegear'),
    ('megadrive', 0, 'genesis'),
    ('sega32x', 0, 'sega32x'),
    ('pcengine', 0, 'pce'),
    ('snes', 0, 'snes'),
    ('nds', 0, 'nds'),
    ('fbneo', 0, 'arcade'),
    ('dreamcast', 0, 'dreamcast'),
    ('n64dd', 0, 'n64'),
]


def sh(*args, timeout=60, check=False):
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError(p.stdout.strip() or f'command failed: {args!r}')
    return p.stdout


def foreground_main():
    sh('am', 'start', '--user', '0', '--activity-clear-top', '-n', MAIN, timeout=30)
    time.sleep(1.5)


def broadcast(command):
    return sh('am', 'broadcast', '--user', '0', '-a', ACTION, '--es', 'command', command, timeout=30)


def play_broadcast(command):
    return sh('am', 'broadcast', '--user', '0', '-a', PLAY_ACTION, '--es', 'command', command, timeout=30)


def process_alive():
    out = sh('ps', '-A', timeout=10)
    return any(
        line.split() and line.split()[-1].startswith(PACKAGE)
        for line in out.splitlines()
    )


def wait_json(path, since, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if path.is_file() and path.stat().st_mtime >= since - 1:
                return json.loads(path.read_text(errors='replace'))
        except Exception:
            pass
        time.sleep(.4)
    return None


def parse_contract(text):
    d = {}
    for line in text.splitlines():
        if not line or line.startswith('[') or '\t' in line or '=' not in line:
            continue
        k, v = line.split('=', 1)
        d[k] = v
    return d


def parse_native_state(text):
    d = {}
    for line in text.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            d[k.strip()] = v.strip()
    return d


def read_state(path):
    try:
        raw = path.read_text(errors='replace') if path.is_file() else ''
    except Exception:
        raw = ''
    return raw, parse_native_state(raw)


def wait_contract(expected_system, since, timeout=25):
    p = DIAG / 'controller-contract.txt'
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if p.is_file() and p.stat().st_mtime >= since - 1:
                raw = p.read_text(errors='replace')
                parsed = parse_contract(raw)
                if parsed.get('system') == expected_system:
                    return raw, parsed
        except Exception:
            pass
        time.sleep(.35)
    return '', {}


def newest_exit_for_gameplay(since_ms):
    p = Path(f'/storage/emulated/0/Android/media/{PACKAGE}/GameDeck-Console/qa/application-exit-history.jsonl')
    found = None
    if not p.is_file():
        return None
    for line in p.read_text(errors='replace').splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        for e in row.get('exits', []):
            if e.get('timestamp', 0) >= since_ms and ':gameplay' in e.get('process', ''):
                if found is None or e['timestamp'] > found['timestamp']:
                    found = e
    return found


def clear_runtime_diagnostics():
    for name in ('native-play-state.txt', 'native-runtime-state.txt', 'controller-contract.txt', 'play-qa-command.txt'):
        try:
            (DIAG / name).unlink(missing_ok=True)
        except Exception:
            pass


def snapshot_runtime(result, case_key):
    java_raw, java_state = read_state(DIAG / 'native-play-state.txt')
    native_raw, native_state = read_state(DIAG / 'native-runtime-state.txt')
    result['javaState'] = java_state
    result['nativeState'] = native_state
    states = OUTROOT / 'states'
    states.mkdir(parents=True, exist_ok=True)
    if java_raw:
        (states / f'{case_key}-java.txt').write_text(java_raw)
    if native_raw:
        (states / f'{case_key}-native.txt').write_text(native_raw)
    frames_text = native_state.get('frames', java_state.get('frames', '0'))
    try:
        result['frames'] = int(frames_text or 0)
    except (TypeError, ValueError):
        result['frames'] = 0
    result['nativeStage'] = native_state.get('native_stage', native_state.get('stage', ''))


def finish_gameplay(result, since):
    # Exit through the private debug receiver so Activity.onDestroy/nativeRelease is exercised,
    # rather than relaunching MainActivity and obscuring lifecycle evidence.
    play_broadcast('exit:back')
    deadline = time.time() + 12
    clean = False
    while time.time() < deadline:
        _, native_state = read_state(DIAG / 'native-runtime-state.txt')
        if native_state.get('phase') == 'native-release-complete':
            clean = True
            break
        time.sleep(.35)
    result['cleanRelease'] = clean
    time.sleep(.8)
    result['exit'] = newest_exit_for_gameplay(int(since * 1000))


def capture_runtime(case_key):
    for suffix, command in (
        ('baseline', f'screenshot:{case_key}-baseline'),
        ('pulse', 'controls:pulse'),
    ):
        play_broadcast(command)
        if suffix == 'pulse':
            time.sleep(.08)
            play_broadcast(f'screenshot:{case_key}-pulse')
    time.sleep(.8)


def evaluate_runtime(result):
    if not result.get('controller'):
        return 'bootstrap-or-contract-failed'
    if not result.get('processAliveBeforeExit'):
        return 'runtime-process-exited'
    if result.get('frames', 0) <= 0:
        return 'no-native-frames'
    if not result.get('cleanRelease'):
        return 'release-incomplete'
    return 'pass'


def observe_launched_runtime(result, expected_system, launch_since, case_key, run_seconds, capture=False):
    contract_raw, contract = wait_contract(expected_system, launch_since, 30)
    result['controller'] = contract
    if contract_raw:
        case_dir = OUTROOT / 'contracts'
        case_dir.mkdir(parents=True, exist_ok=True)
        (case_dir / f'{case_key}.txt').write_text(contract_raw)
    if not contract:
        result['result'] = 'bootstrap-or-contract-failed'
        result['exit'] = newest_exit_for_gameplay(int(launch_since * 1000))
        snapshot_runtime(result, case_key)
        return result

    time.sleep(run_seconds)
    result['processAliveBeforeExit'] = process_alive()
    snapshot_runtime(result, case_key)
    if capture and result['processAliveBeforeExit']:
        capture_runtime(case_key)
    if result['processAliveBeforeExit']:
        finish_gameplay(result, launch_since)
    else:
        result['cleanRelease'] = False
        result['exit'] = newest_exit_for_gameplay(int(launch_since * 1000))
    snapshot_runtime(result, case_key)
    result['result'] = evaluate_runtime(result)
    return result


def run_case(folder, rank, expected_system, run_seconds=6, queue_wait=12, capture=False):
    result = {'folder': folder, 'rank': rank, 'expectedSystem': expected_system, 'startedAt': time.time()}
    foreground_main()
    broadcast('fixture:on')

    q_since = time.time()
    broadcast(f'e2e:queue:{folder}:{rank}')
    qpath = QA / f'e2e-queue-{folder}-{rank}.json'
    q = wait_json(qpath, q_since, min(queue_wait, 15))
    result['queue'] = q
    if not q or not q.get('ok'):
        result['result'] = 'queue-failed'
        return result

    time.sleep(max(1, queue_wait - 2))
    launch = None
    launch_since = None
    clear_runtime_diagnostics()
    for _attempt in range(6):
        foreground_main()
        broadcast('fixture:on')
        launch_since = time.time()
        broadcast(f'e2e:launch:{folder}:{rank}')
        lpath = QA / f'e2e-launch-{folder}-{rank}.json'
        launch = wait_json(lpath, launch_since, 5)
        if launch and launch.get('ok') and isinstance(launch.get('launch'), dict) and launch['launch'].get('ok'):
            break
        time.sleep(2)
    result['launch'] = launch
    if not launch or not launch.get('ok') or not isinstance(launch.get('launch'), dict) or not launch['launch'].get('ok'):
        result['result'] = 'launch-failed'
        return result

    return observe_launched_runtime(
        result, expected_system, launch_since, f'{folder}-{rank}', run_seconds, capture=capture
    )


def run_title_case(title, expected_system, run_seconds=8, capture=False):
    key = re.sub(r'[^A-Za-z0-9._-]+', '-', title).strip('-')[:64] or expected_system
    result = {'title': title, 'expectedSystem': expected_system, 'startedAt': time.time()}
    # Close any stale singleTop gameplay task before starting a title case. qa.86+ also
    # recreates onNewIntent, but the runner remains deterministic across older QA builds.
    try:
        play_broadcast('exit:back')
        time.sleep(.6)
    except Exception:
        pass
    foreground_main()
    broadcast('fixture:on')
    clear_runtime_diagnostics()
    artifact = QA / 'runtime-launch-title.json'
    try:
        artifact.unlink(missing_ok=True)
    except Exception:
        pass
    launch_since = time.time()
    broadcast(f'runtime:launch-title:{title}')
    launch = wait_json(artifact, launch_since, 15)
    result['launch'] = launch
    if not launch or not launch.get('ok'):
        result['result'] = 'launch-failed'
        return result
    return observe_launched_runtime(result, expected_system, launch_since, f'{expected_system}-{key}', run_seconds, capture=capture)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', action='append', default=[], help='folder:rank:expectedSystem')
    ap.add_argument('--title-case', action='append', default=[], help='expectedSystem|installed managed title')
    ap.add_argument('--run-seconds', type=float, default=6.0)
    ap.add_argument('--queue-wait', type=float, default=12.0)
    ap.add_argument('--capture', action='store_true', help='capture baseline + pressed/pulse runtime screenshots')
    args = ap.parse_args()

    cases = []
    for value in args.case:
        folder, rank, system = value.split(':', 2)
        cases.append((folder, int(rank), system))
    title_cases = []
    for value in args.title_case:
        system, title = value.split('|', 1)
        title_cases.append((title, system))
    if not cases and not title_cases:
        cases = DEFAULT_CASES

    OUTROOT.mkdir(parents=True, exist_ok=True)
    results = []
    out = OUTROOT / 'controller-live-results.json'

    for case in cases:
        print(f'== {case[0]} -> {case[2]} ==', flush=True)
        try:
            r = run_case(*case, run_seconds=args.run_seconds, queue_wait=args.queue_wait, capture=args.capture)
        except Exception as e:
            r = {'folder': case[0], 'rank': case[1], 'expectedSystem': case[2], 'result': 'runner-error', 'error': str(e)}
        results.append(r)
        out.write_text(json.dumps({'updatedAt': time.time(), 'results': results}, indent=2))
        print(r['result'], 'frames=', r.get('frames', 0), 'profile=', r.get('controller', {}).get('profile', ''), flush=True)

    for title, system in title_cases:
        print(f'== title {title} -> {system} ==', flush=True)
        try:
            r = run_title_case(title, system, run_seconds=args.run_seconds, capture=args.capture)
        except Exception as e:
            r = {'title': title, 'expectedSystem': system, 'result': 'runner-error', 'error': str(e)}
        results.append(r)
        out.write_text(json.dumps({'updatedAt': time.time(), 'results': results}, indent=2))
        print(r['result'], 'frames=', r.get('frames', 0), 'profile=', r.get('controller', {}).get('profile', ''), flush=True)

    print(out)


if __name__ == '__main__':
    main()
