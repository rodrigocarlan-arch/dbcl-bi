"""SQLite local, revisões otimistas e auditoria na mesma transação."""
from __future__ import annotations
import hashlib,json,math,os,re,sqlite3,uuid
from datetime import datetime
from pathlib import Path

KINDS={'people','rates','contracts'}
DEFAULT_DB=Path.home()/'Library/Application Support/DBCL BI V4/cadastros.sqlite3'
def db_path(): return Path(os.environ.get('DBCL_CADASTROS_DB',str(DEFAULT_DB)))
def canonical(value): return str(value).strip().upper()
def encode(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def now(): return datetime.now().astimezone().isoformat(timespec='seconds')
class Conflict(ValueError): pass

def period_at(periods,month):
    found=[p for p in periods if (p['start'] is None or p['start']<=month) and (p['end'] is None or p['end']>=month)]
    if len(found)>1: raise ValueError('Vigências sobrepostas')
    return found[0] if found else None

def text(value,name,limit=200):
    if not isinstance(value,str) or not value.strip() or len(value)>limit: raise ValueError(f'{name}: texto obrigatório com até {limit} caracteres')
    return value.strip()

def validate(kind,payload):
    if kind not in KINDS or not isinstance(payload,dict): raise ValueError('Cadastro inválido')
    if kind=='contracts':
        from .contracts import validate_contract
        return validate_contract(payload)
    allowed={'name','key','aliases','periods','origin'} if kind=='people' else {'name','periods','origin'}
    if set(payload)-allowed: raise ValueError('Campos desconhecidos no cadastro')
    text(payload.get('name'),'Nome')
    origin=payload.get('origin','manual')
    if origin not in ('manual','legacy'): raise ValueError('Origem inválida')
    if kind=='people':
        text(payload.get('key'),'Identificador')
        if not isinstance(payload.get('aliases'),list): raise ValueError('Aliases inválidos')
        for alias in payload['aliases']:text(alias,'Nome na origem')
    periods=payload.get('periods')
    if not isinstance(periods,list) or not 1<=len(periods)<=100: raise ValueError('Informe de 1 a 100 vigências')
    for p in periods:
        expected={'start','end','cargo','team','active'} if kind=='people' else {'start','end','custo','mensal','pontual'}
        if not isinstance(p,dict) or set(p)!=expected: raise ValueError('Campos da vigência inválidos')
        for field in ('start','end'):
            value=p[field]
            if value is not None and (not isinstance(value,str) or not re.fullmatch(r'(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])',value)): raise ValueError('Competência deve estar em AAAA-MM')
        if p['start'] is None and origin!='legacy': raise ValueError('Nova vigência precisa de competência inicial')
        if p['start'] and p['end'] and p['start']>p['end']: raise ValueError('Vigência termina antes de iniciar')
        if kind=='people':
            if origin!='legacy' or p['start'] is not None:
                text(p['cargo'],'Cargo');text(p['team'],'Time')
            if not isinstance(p['cargo'],str) or not isinstance(p['team'],str) or type(p['active']) is not bool:raise ValueError('Vínculo inválido')
        else:
            for key in ('custo','mensal','pontual'):
                value=p[key]
                if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1000000 or abs(value*100-round(value*100))>1e-6:raise ValueError('Tarifas devem ser valores de 0 a 1.000.000 com até duas casas decimais')
    ordered=sorted(periods,key=lambda p:p['start'] or '')
    for left,right in zip(ordered,ordered[1:]):
        if left['end'] is None or right['start'] is None or left['end']>=right['start']:raise ValueError('Vigências sobrepostas')
    return payload

class Store:
    def __init__(self,path=None,read_only=False):
        self.path=Path(path or db_path());self.read_only=read_only
        if read_only:
            if not self.path.is_file():raise FileNotFoundError('Cadastro ainda não inicializado')
            return
        self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with self.connect() as con:
            con.executescript('''
            CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,reason TEXT NOT NULL,before_json TEXT,after_json TEXT);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            ''')
        os.chmod(self.path,0o600)
    def connect(self):
        con=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True,timeout=20) if self.read_only else sqlite3.connect(self.path,timeout=20);con.row_factory=sqlite3.Row;return con
    def snapshot(self):
        with self.connect() as con:
            con.execute('BEGIN')
            rows=con.execute('SELECT * FROM records ORDER BY kind,id').fetchall()
            settings={r['key']:json.loads(r['value']) for r in con.execute('SELECT * FROM settings')}
            revision=con.execute('SELECT COALESCE(MAX(seq),0) FROM audit').fetchone()[0]
        entities={k:[] for k in KINDS}
        for r in rows:entities[r['kind']].append({'id':r['id'],'revision':r['revision'],**json.loads(r['payload'])})
        return {'schema':1,'revision':revision,'settings':settings,**entities}
    def history(self,record_id=None):
        with self.connect() as con:
            rows=con.execute('SELECT * FROM audit WHERE (? IS NULL OR record_id=?) ORDER BY seq DESC LIMIT 200',(record_id,record_id)).fetchall()
        return [{**dict(r),'before_json':json.loads(r['before_json']) if r['before_json'] else None,'after_json':json.loads(r['after_json']) if r['after_json'] else None} for r in rows]
    def _check_unique(self,con,kind,record_id,payload):
        for row in con.execute('SELECT id,payload FROM records WHERE kind=? AND id!=?',(kind,record_id)):
            other=json.loads(row['payload'])
            if kind=='contracts' and other['code']==payload['code']:raise ValueError('Código de venda já possui contrato cadastrado')
            if kind=='rates' and canonical(other['name'])==canonical(payload['name']):raise ValueError('Cargo já cadastrado')
            if kind=='people':
                own={canonical(x) for x in [payload['name'],payload['key'],*payload['aliases']]}
                existing={canonical(x) for x in [other['name'],other['key'],*other['aliases']]}
                if own & existing:raise ValueError('Nome ou alias já vinculado a outra pessoa')
    def save(self,kind,record_id,payload,revision,reason,actor='Rodrigo · sessão local'):
        validate(kind,payload);reason=text(reason,'Motivo',1000)
        if type(revision) is not int or revision<0:raise ValueError('Revisão inválida')
        if record_id is None:record_id=str(uuid.uuid4())
        with self.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            row=con.execute('SELECT * FROM records WHERE id=?',(record_id,)).fetchone()
            if row and (row['kind']!=kind or row['revision']!=revision) or not row and revision!=0:raise Conflict('Cadastro mudou. Recarregue antes de salvar.')
            previous=json.loads(row['payload']) if row else None
            if row and kind=='contracts':
                if previous['code']!=payload['code']:raise ValueError('Código do contrato não pode ser alterado; preserve o histórico')
                old_components={c['id']:c for c in previous['components']}
                new_components={c['id']:c for c in payload['components']}
                if old_components.keys()-new_components.keys():raise ValueError('Componente salvo não pode ser excluído; encerre sua vigência')
                for key,component in old_components.items():
                    if any(component[k]!=new_components[key][k] for k in ('source_rows','source_notes')):raise ValueError('Referências da importação devem ser preservadas')
            if row and kind=='rates' and previous['name']!=payload['name']:raise ValueError('Cargo já utilizado não pode ser renomeado; crie um novo cargo e sua vigência')
            if row and kind=='people' and previous['key']!=payload['key']:raise ValueError('Identificador de origem não pode ser alterado')
            if (not row and payload.get('origin')=='legacy') or (row and previous.get('origin','manual')!=payload.get('origin','manual')):raise ValueError('Origem de legado só pode ser criada pela importação')
            self._check_unique(con,kind,record_id,payload)
            self._validate_roles(con,kind,payload)
            con.execute('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision',(kind,record_id,encode(payload),revision+1))
            con.execute('INSERT INTO audit(at,actor,kind,record_id,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?)',(now(),actor,kind,record_id,reason,encode(previous) if previous else None,encode(payload)))
        return {'id':record_id,'revision':revision+1,**payload}
    def _validate_roles(self,con,kind,payload):
        if kind!='people':return
        roles={canonical(json.loads(r[0])['name']) for r in con.execute("SELECT payload FROM records WHERE kind='rates'")}
        for period in payload['periods']:
            if period['start'] is not None and canonical(period['cargo']) not in roles:raise ValueError('Cadastre primeiro a tarifa do cargo escolhido')
    def import_initial(self,people,rates,source_hash):
        with self.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            if con.execute('SELECT COUNT(*) FROM records').fetchone()[0]:raise Conflict('Cadastro já inicializado; importação não sobrescreve edições')
            for kind,items in (('rates',rates),('people',people)):
                for payload in items:
                    validate(kind,payload);record_id=str(uuid.uuid4());self._check_unique(con,kind,record_id,payload)
                    con.execute('INSERT INTO records VALUES(?,?,?,1)',(kind,record_id,encode(payload)))
                    con.execute('INSERT INTO audit(at,actor,kind,record_id,reason,after_json) VALUES(?,?,?,?,?,?)',(now(),'Migração conferida',kind,record_id,'Importação inicial de pessoas.xlsx',encode(payload)))
            con.execute('INSERT INTO settings VALUES(?,?)',('source_hash',encode(source_hash)))
            con.execute('INSERT INTO settings VALUES(?,?)',('enabled',encode(False)))
    def import_contracts(self,contracts,report):
        with self.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            if con.execute("SELECT 1 FROM settings WHERE key='contracts_import'").fetchone() or con.execute("SELECT 1 FROM records WHERE kind='contracts'").fetchone():raise Conflict('Mensalistas já importados; não sobrescrever edições')
            for payload in contracts:
                validate('contracts',payload);record_id=str(uuid.uuid4());self._check_unique(con,'contracts',record_id,payload)
                con.execute('INSERT INTO records VALUES(?,?,?,1)',('contracts',record_id,encode(payload)))
                con.execute('INSERT INTO audit(at,actor,kind,record_id,reason,after_json) VALUES(?,?,?,?,?,?)',(now(),'Migração conferida','contracts',record_id,'Importação inicial de mensalistas.xlsx',encode(payload)))
            for key,value in [('contracts_import',report),('contracts_enabled',False)]:
                con.execute('INSERT INTO settings VALUES(?,?)',(key,encode(value)))
    def enable_contracts(self,enabled=True):
        with self.connect() as con:
            con.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('contracts_enabled',encode(enabled)))
    def enable(self):
        with self.connect() as con:
            con.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('enabled','true'))
    def backup(self):
        target=self.path.parent/'backups'/f'cadastros-{datetime.now().strftime("%Y%m%d-%H%M%S-%f")}.sqlite3';target.parent.mkdir(exist_ok=True,mode=0o700)
        with self.connect() as source,sqlite3.connect(target) as dest:source.backup(dest)
        os.chmod(target,0o600);return target
    def content_hash(self):
        return hashlib.sha256(encode(self.snapshot()).encode()).hexdigest()


def calculation_hash(snapshot,include_contracts=None):
    if include_contracts is None:include_contracts=bool(snapshot['settings'].get('contracts_enabled'))
    keys=['people','rates','revision']+(['contracts'] if include_contracts else [])
    return hashlib.sha256(encode({k:snapshot[k] for k in keys}).encode()).hexdigest()
