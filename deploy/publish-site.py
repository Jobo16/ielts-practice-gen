"""Run with sudo on the target host; preserve other sites, validate before reload."""
import fcntl
import subprocess
from pathlib import Path
import tempfile

with open('/run/lock/caddy-reading-gen.lock','w') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    current=Path('/etc/caddy/Caddyfile')
    original=current.read_bytes()
    text=original.decode()
    begin,end='# BEGIN ieltsbuddy-reading-gen','# END ieltsbuddy-reading-gen'
    block=Path(__file__).with_name('site.caddy').read_text().strip()
    if begin in text:
        assert text.count(begin)==text.count(end)==1
        start=text.index(begin);stop=text.index(end)+len(end)
        updated=text[:start]+block+text[stop:]
    else:
        assert 'ieltsbuddy-reading-gen.jobo.asia' not in text
        updated=text.rstrip()+'\n\n'+block+'\n'
    with tempfile.TemporaryDirectory(prefix='caddy-reading-') as tmp:
        candidate=Path(tmp)/'Caddyfile';candidate.write_text(updated)
        subprocess.run(['caddy','fmt','--overwrite',str(candidate)],check=True)
        subprocess.run(['caddy','validate','--config',str(candidate),'--adapter','caddyfile'],check=True)
        assert current.read_bytes()==original, 'Caddyfile changed concurrently; retry'
        backup=Path('/opt/stacks/ieltsbuddy-reading-gen/Caddyfile.before')
        if not backup.exists():
            backup.write_bytes(original);backup.chmod(0o600)
        subprocess.run(['install','-o','root','-g','caddy','-m','0640',str(candidate),str(current)],check=True)
        try:
            subprocess.run(['systemctl','reload','caddy'],check=True)
        except subprocess.CalledProcessError:
            current.write_bytes(original)
            subprocess.run(['systemctl','reload','caddy'],check=True)
            raise
