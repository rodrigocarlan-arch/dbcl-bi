"""Entrypoint empacotado como api/index.py no destino Vercel."""
import json,os,mimetypes
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from online.auth import Auth
from online.store import PgStore
from online.service import Service
from online.web import Site,PUBLIC
from urllib.parse import urlsplit
class handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.respond()
 def do_POST(self):self.respond()
 def respond(self):
  try:
   path=urlsplit(self.path).path
   if self.command=='GET' and path in PUBLIC:
    file=Path(__file__).resolve().parents[1]/'online/login'/PUBLIC[path]
    data=file.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'text/plain');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
   if self.command=='GET' and path in ('/','/index.html') and '__Host-dbcl_session=' not in self.headers.get('Cookie',''):
    self.send_response(303);self.send_header('Location','/login');self.send_header('Cache-Control','no-store');self.end_headers();return
   length=int(self.headers.get('Content-Length','0'))
   if not 0<=length<=1_000_000:raise ValueError('Tamanho inválido')
   body=json.loads(self.rfile.read(length)) if self.command=='POST' and length else None
   store=PgStore();auth=Auth();service=Service(auth,store,os.environ.get('DBCL_APP_ORIGIN') or ('https://'+os.environ['VERCEL_URL'] if os.environ.get('VERCEL_URL') else ''),catalog=store.catalog,publication=store.publication_status)
   site=Site(service,Path(__file__).resolve().parents[1]/'private',store.artifact)
   status,headers,data=site.handle(self.command,self.path,dict(self.headers),body)
  except Exception:status,headers,data=503,{'Cache-Control':'no-store','Content-Type':'application/json'},b'{"error":"Configuracao online ainda pendente"}'
  self.send_response(status)
  for key,value in headers.items():self.send_header(key,value)
  self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
