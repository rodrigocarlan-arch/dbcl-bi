"""Entrega HTTP restrita: login público, interface e indicadores autenticados."""
import gzip,json,mimetypes
from pathlib import Path
from http.cookies import SimpleCookie,CookieError
from urllib.parse import unquote,urlsplit
from .service import COOKIE
from .auth import AuthError
PUBLIC={'/login':'index.html','/login/':'index.html','/login/login.js':'login.js','/login/style.css':'style.css'}
PRIVATE={'/':'index.html','/index.html':'index.html',**{('/'+f):f for f in ['bootstrap.js','core.js','app.js','v4.js','admin.js','contracts-admin.js','styles/base.css','styles/v4.css','vendor/chart.umd.js']}}
class Site:
 def __init__(self,service,private_root,artifact):self.service=service;self.root=Path(private_root);self.artifact=artifact
 def handle(self,method,path,headers,body=None):
  h={k.lower():v for k,v in headers.items()};path=unquote(urlsplit(path).path)
  common={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}
  def reply(status,content,ctype='text/plain; charset=utf-8',extra=None):
   data=content.encode() if isinstance(content,str) else content;out={**common,'Content-Type':ctype,**(extra or {})}
   if len(data)>1024 and 'gzip' in h.get('accept-encoding','').lower():data=gzip.compress(data);out.update({'Content-Encoding':'gzip','Vary':'Accept-Encoding'})
   if len(data)>4_000_000:return 503,common,b'Indicadores excedem o limite de entrega; publicacao precisa ser revisada.'
   return status,out,data
  if h.get('host')!=self.service.host:return reply(403,'Host não permitido')
  if path.startswith('/api/'):
   status,out,data=self.service.handle(method,path,headers,body);return reply(status,json.dumps(data,ensure_ascii=False),extra=out)
  if method!='GET':return reply(405,'Método não permitido')
  if path in PUBLIC:
   file=Path(__file__).with_name('login')/PUBLIC[path];return reply(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'text/plain')
  try:
   cookie=SimpleCookie();cookie.load(h.get('cookie',''));self.service.auth.authenticate(cookie[COOKIE].value if COOKIE in cookie else None)
  except (AuthError,CookieError):return reply(303,'',extra={'Location':'/login'})
  try:
   if path in ('/data.js','/strategic-decisions.js'):
    content=self.artifact(path[1:])
    if content is None:return reply(503,'Primeira publicação dos indicadores ainda pendente')
    return reply(200,content,'application/javascript; charset=utf-8')
   if path not in PRIVATE:return reply(404,'Arquivo indisponível')
   file=self.root/PRIVATE[path]
   return reply(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'application/octet-stream')
  except Exception:return reply(503,'Não foi possível carregar a versão publicada')
