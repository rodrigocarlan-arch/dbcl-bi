"""Persistência PostgreSQL reutilizando as regras validadas do cadastro local."""
from __future__ import annotations
import json,os
from cadastros.store import Store

JSON_COLUMNS={'payload','before_json','after_json','value'}
class Row(dict):
    def __getitem__(self,key):
        if isinstance(key,int):return list(self.values())[key]
        return super().__getitem__(key)
class Cursor:
    def __init__(self,cursor):self.cursor=cursor
    def _row(self,values):
        if values is None:return None
        result=Row()
        for column,value in zip(self.cursor.description,values):
            name=column.name
            result[name]=json.dumps(value,ensure_ascii=False,allow_nan=False) if name in JSON_COLUMNS and value is not None else value
        return result
    def fetchone(self):return self._row(self.cursor.fetchone())
    def fetchall(self):return [self._row(row) for row in self.cursor.fetchall()]
    def __iter__(self):return iter(self.fetchall())
class Connection:
    def __init__(self,url,read_only=False):self.url=url;self.read_only=read_only;self.connection=None
    def __enter__(self):
        import psycopg
        self.connection=psycopg.connect(self.url,connect_timeout=15,autocommit=False)
        try:
            self.connection.execute('SET LOCAL search_path TO dbcl_v4, pg_catalog')
            self.connection.execute("SET LOCAL lock_timeout = '10s'")
            self.connection.execute("SET LOCAL statement_timeout = '20s'")
            if self.read_only:self.connection.execute('SET TRANSACTION READ ONLY')
            return self
        except BaseException:
            self.connection.close();raise
    def execute(self,sql,params=()):
        if sql=='BEGIN':
            # Snapshot com registros, configurações e revisão do mesmo instante.
            self.connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            return None
        if sql=='BEGIN IMMEDIATE':
            if self.read_only:raise ValueError('Conexão somente leitura')
            # Mesma exclusão de escritores do SQLite; adequada ao cadastro pequeno.
            self.connection.execute('LOCK TABLE records, audit, settings IN EXCLUSIVE MODE')
            return None
        sql=sql.replace('? IS NULL','?::text IS NULL').replace('?','%s')
        return Cursor(self.connection.execute(sql,params))
    def __exit__(self,kind,error,traceback):
        try:
            if kind is None:self.connection.commit()
            else:self.connection.rollback()
        finally:self.connection.close()
        return False
class PgStore(Store):
    def __init__(self,url=None,read_only=False):
        self.url=url or os.environ.get('DBCL_DATABASE_URL') or os.environ.get('POSTGRES_URL')
        if not self.url:raise ValueError('Banco online não configurado')
        self.read_only=read_only
    def connect(self):return Connection(self.url,self.read_only)
    def backup(self):
        raise ValueError('Backup online requer exportação administrativa; cópia local não substitui backup do servidor')
    def publication_status(self):
        with self.connect() as con:
            row=con.execute('SELECT id,revision,source_sha256 FROM publications ORDER BY id DESC LIMIT 1').fetchone()
        return dict(row) if row else None
    def artifact(self,name):
        if name not in ('data.js','strategic-decisions.js','crm.json'):raise ValueError('Artefato não permitido')
        with self.connect() as con:
            row=con.execute('SELECT body ->> ? AS content FROM publications ORDER BY id DESC LIMIT 1',(name,)).fetchone()
        return row['content'] if row else None
    def catalog(self):
        content=self.artifact('crm.json')
        if content is None:raise RuntimeError('Catálogo ainda não publicado')
        return json.loads(content)
