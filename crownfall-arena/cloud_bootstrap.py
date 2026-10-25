#!/usr/bin/env python3
"""Backup-first cloud portability helper. Default/check never launches Blender.

Original lib/scripts stay untouched. prepare creates path-adjusted runtime copies;
extract verifies ordinary Git chunks (or optional LFS) before unpacking. render requires
an explicit --allow-render and uses local Blender only: no MCP or paid services.
"""
from pathlib import Path
import argparse, ast, contextlib, hashlib, json, os, runpy, shutil, subprocess, sys, time, zipfile

NAME = 'Crownfall_Main_v029_sorcerer.blend'

def blender_binary():
    supplied = os.environ.get('BLENDER_BIN')
    if supplied:
        found = shutil.which(supplied) or (supplied if Path(supplied).is_file() else None)
        if not found:
            raise RuntimeError('BLENDER_BIN does not name an executable file')
        return str(found)
    return shutil.which('blender')

def patch_copy(source, arena, repo):
    """Replace only top-level path assignments in COPIES; compile every result."""
    text = source.read_text(encoding='utf-8-sig')
    tree = ast.parse(text, filename=str(source))
    lines = text.splitlines(keepends=True)
    edits = []
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        names = [n.id for n in targets if isinstance(n, ast.Name)]
        key = next((n for n in names if n in ('CL', 'ROOT')), None)
        if key:
            value = arena if key == 'CL' else repo
            edits.append((node.lineno - 1, node.end_lineno, key + ' = ' + repr(str(value)) + '\n'))
    for start, end, replacement in reversed(edits):
        lines[start:end] = [replacement]
    result = ''.join(lines)
    compile(result, str(source), 'exec')
    return result

def prepare(arena, repo):
    runtime = arena / '.cloud_runtime'
    count = 0
    for folder in ('lib', 'scripts'):
        source_root = arena / folder
        if not source_root.is_dir():
            raise RuntimeError('Missing preserved pipeline folder: ' + str(source_root))
        for source in source_root.rglob('*.py'):
            destination = runtime / source.relative_to(arena)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(patch_copy(source, arena, repo), encoding='utf-8')
            count += 1
    entry = runtime / 'blender_entry.py'
    entry.write_text('''from pathlib import Path
import os,sys,runpy
arena=Path(os.environ['CF_ROOT']).resolve()
runtime=arena/'.cloud_runtime'
sys.path.insert(0,str(runtime/'lib'))
script=runtime/'scripts'/'render_variant.py'
args=sys.argv[sys.argv.index('--')+1:]
sys.argv=[str(script),'--']+args
os.chdir(arena)
runpy.run_path(str(script),run_name='__main__')
''', encoding='utf-8')
    return {'runtime': str(runtime), 'copied_python_files': count, 'originals_modified': False}

def reassemble_parts(arena):
    """Ordinary-Git fallback; verify every part and the exact complete ZIP."""
    directory = arena / 'main' / 'archive_parts'
    manifest = directory / (NAME + '.zip.parts.json')
    if not manifest.is_file():
        return None
    info = json.loads(manifest.read_text(encoding='utf-8'))
    if info.get('archive_name') != NAME + '.zip' or not info.get('parts'):
        raise RuntimeError('Unexpected archive-parts manifest name or empty parts')
    archive = arena / 'main' / info['archive_name']
    temporary = archive.with_suffix('.zip.assembling')
    whole, byte_count = hashlib.sha256(), 0
    try:
        with temporary.open('wb') as output:
            for part in info['parts']:
                name = part['path']
                if Path(name).name != name or (directory/name).resolve().parent != directory.resolve():
                    raise RuntimeError('Unsafe archive part path')
                path = directory / name
                if not path.is_file() or path.stat().st_size != int(part['bytes']):
                    raise RuntimeError('Missing/truncated ordinary-Git part: ' + name)
                digest, count = hashlib.sha256(), 0
                with path.open('rb') as source:
                    for block in iter(lambda: source.read(1024*1024), b''):
                        digest.update(block)
                        whole.update(block)
                        output.write(block)
                        count += len(block)
                if count != int(part['bytes']) or digest.hexdigest() != part['sha256']:
                    raise RuntimeError('Archive part SHA256/size mismatch: ' + name)
                byte_count += count
        if byte_count != int(info['archive_bytes']) or whole.hexdigest() != info['archive_sha256']:
            raise RuntimeError('Reassembled ZIP SHA256/size mismatch')
        temporary.replace(archive)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    print(json.dumps({'reassembled_zip':str(archive),'bytes':byte_count,'sha256':whole.hexdigest(),'parts':len(info['parts']),'git_lfs_required':False}))
    return archive

def extract_scene(arena, repo):
    # The ordinary-Git chunk fallback takes precedence: exhausted LFS quota
    # must not block recovery of the packed scene from verified Git parts.
    archive = reassemble_parts(arena)
    if archive is None:
        subprocess.run(['git', '-C', str(repo), 'lfs', 'pull'], check=True)
    destination = arena / 'main' / NAME
    if destination.is_file() and destination.stat().st_size > 1024:
        print('Keeping existing packed scene: ' + str(destination))
        return
    candidates = [arena/'main'/(NAME+'.zip'), arena/(NAME+'.zip'), repo/(NAME+'.zip'), Path(__file__).resolve().parent/(NAME+'.zip')]
    archive = archive or next((p for p in candidates if p.is_file()), None)
    if archive is None or not zipfile.is_zipfile(archive):
        raise RuntimeError('Hydrated scene ZIP missing/incomplete. Run git lfs pull and verify the backup upload finished.')
    with zipfile.ZipFile(archive) as bundle:
        files = [i for i in bundle.infolist() if not i.is_dir()]
        if len(files) != 1 or files[0].filename != NAME:
            raise RuntimeError('Expected a single basename-only packed .blend entry; refusing other archive paths')
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.blend.part')
        with bundle.open(files[0]) as src, temporary.open('wb') as dst:
            shutil.copyfileobj(src, dst, length=1024*1024)
        if temporary.stat().st_size != files[0].file_size:
            raise RuntimeError('Extracted scene byte count mismatch')
        temporary.replace(destination)
    print(json.dumps({'extracted': str(destination), 'bytes': destination.stat().st_size}))

@contextlib.contextmanager
def render_slot(arena):
    if os.name != 'posix':
        raise RuntimeError('This runner targets Linux; the preserved original Windows runner is separate')
    import fcntl
    locks = arena / '.cloud_runtime' / 'locks'
    locks.mkdir(parents=True, exist_ok=True)
    handle = None
    try:
        while handle is None:
            for number in range(2):
                candidate = (locks / ('slot'+str(number)+'.lock')).open('a+')
                try:
                    fcntl.flock(candidate, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    handle = candidate
                    break
                except BlockingIOError:
                    candidate.close()
            if handle is None:
                time.sleep(2)
        yield
    finally:
        if handle:
            fcntl.flock(handle, fcntl.LOCK_UN)
            handle.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', nargs='?', choices=['check','prepare','extract','render'], default='check')
    parser.add_argument('--arena', type=Path)
    parser.add_argument('--version', default='v029_sorcerer')
    parser.add_argument('--variant', default='keyhalf-disc-skygrade-rim-lava2-light2-fill')
    parser.add_argument('--pct', type=int, default=50)
    parser.add_argument('--timeout', type=int, default=2400)
    parser.add_argument('--allow-render', action='store_true')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    arena = (args.arena or (here if (here/'lib').is_dir() else here/'crownfall-arena')).resolve()
    repo = arena.parent
    if args.action == 'check':
        print(json.dumps({'arena':str(arena),'blender':blender_binary(),'packed_scene':(arena/'main'/NAME).is_file(),
                          'backup_only':True,'blender_started':False,'paid_jobs_started':False},indent=2))
    elif args.action == 'extract':
        extract_scene(arena, repo)
    elif args.action == 'prepare':
        print(json.dumps(prepare(arena, repo),indent=2))
    else:
        if not args.allow_render:
            raise RuntimeError('Current request is BACKUP ONLY. Local rendering requires a later explicit user instruction and --allow-render.')
        binary = blender_binary()
        if not binary:
            raise RuntimeError('Blender not installed: set BLENDER_BIN or make blender available on PATH. No installer is run.')
        if not (arena/'main'/('Crownfall_Main_'+args.version+'.blend')).is_file():
            raise RuntimeError('Packed scene missing. Hydrate/extract the backup first; do not rebuild from omitted asset archives.')
        prepare(arena, repo)
        env = dict(os.environ, CF_ROOT=str(arena))
        logs = arena/'logs'
        logs.mkdir(exist_ok=True)
        log = logs/('cloud_render_'+time.strftime('%Y%m%d_%H%M%S')+'.log')
        command = [binary,'-b','--factory-startup','--python-exit-code','1','--python',str(arena/'.cloud_runtime/blender_entry.py'),'--',args.version,args.variant,str(args.pct)]
        with render_slot(arena), log.open('w',encoding='utf-8') as stream:
            result = subprocess.run(command,cwd=arena,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=args.timeout)
        print(json.dumps({'returncode':result.returncode,'log':str(log)}))
        return result.returncode
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print('cloud_bootstrap: '+str(error),file=sys.stderr)
        raise SystemExit(1)
