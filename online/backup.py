"""Exportação consistente dos cadastros; restauração apenas para arquivo novo."""
import hashlib
import json
import os
from pathlib import Path
from cadastros.store import Store, encode


def export(store):
    with store.connect() as con:
        con.execute('BEGIN')
        records = [dict(r) for r in con.execute('SELECT kind,id,payload,revision FROM records ORDER BY kind,id')]
        audit = [dict(r) for r in con.execute('SELECT * FROM audit ORDER BY seq')]
        settings = [dict(r) for r in con.execute('SELECT * FROM settings ORDER BY key')]
    body = {'records': records, 'audit': audit, 'settings': settings}
    return {'format': 'dbcl-cadastros-v1', 'body': body,
            'sha256': hashlib.sha256(encode(body).encode()).hexdigest()}


def restore(bundle, destination):
    from cadastros.recovery import inspect_backup
    if bundle.get('format') != 'dbcl-cadastros-v1':
        raise ValueError('Formato de backup inválido')
    body = bundle['body']
    if hashlib.sha256(encode(body).encode()).hexdigest() != bundle['sha256']:
        raise ValueError('Backup alterado ou incompleto')
    destination = Path(destination)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    try:
        store = Store(destination)
        with store.connect() as con:
            for r in body['records']:
                con.execute('INSERT INTO records(kind,id,payload,revision) VALUES(?,?,?,?)',
                            (r['kind'],r['id'],r['payload'],r['revision']))
            for r in body['audit']:
                con.execute('INSERT INTO audit(seq,at,actor,kind,record_id,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
                            tuple(r[k] for k in ('seq','at','actor','kind','record_id','reason','before_json','after_json')))
            for r in body['settings']:
                con.execute('INSERT INTO settings(key,value) VALUES(?,?)',(r['key'],r['value']))
        report = inspect_backup(destination)
        if export(store)['sha256'] != bundle['sha256']:
            raise ValueError('Restauração divergiu do backup')
        return report
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--restore-to',required=True,type=Path)
    args=parser.parse_args()
    print(json.dumps(restore(json.loads(args.source.read_text()),args.restore_to)))
