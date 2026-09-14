"""Local-only Core contract POC. Synthetic authority; not a deployable Core adapter."""
import base64, copy, hashlib, hmac, json, secrets, threading, time, unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from uuid import UUID, uuid4
from schema_validation import validate

class Denied(Exception):
    def __init__(self, status=403, code='FORBIDDEN'):
        self.status, self.code = status, code
        super().__init__(code)

def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise Denied(400, 'INVALID_REQUEST')

def uuid(value):
    try:
        if str(UUID(value)) != value: raise ValueError()
    except (ValueError, TypeError, AttributeError): raise Denied(400, 'INVALID_REQUEST')
    return value

def email(value):
    # Match historical ASCII edge-space rejection; reject all Unicode edge spaces too.
    if not isinstance(value, str) or value != value.strip() or not 3 <= len(value) <= 254:
        return None
    if value.count('@') != 1 or any(c.isspace() for c in value): return None
    local, domain = value.split('@')
    if not local or not domain or not value.isascii(): return None
    return value.lower()  # No Gmail dot/plus rewriting; no implicit Unicode/IDNA aliasing.

def text(value, minimum=2, maximum=100):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise Denied(400, 'INVALID_REQUEST')
    return value.strip()

def folded(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))

class CoreAuthority:
    """Only this mock owns users, sessions, membership and directory visibility."""
    def __init__(self, key, clock=time.time):
        self.key, self.clock = key, clock
        self.users, self.teams, self.sessions = {}, {}, {}
        self.nonces, self.rates = {}, {}
        self.available = True
        self.lock = threading.RLock()

    def sign(self, data): return hmac.new(self.key, data, hashlib.sha256).hexdigest()

    def handle(self, path, body, headers):
        with self.lock:
            if not self.available: raise Denied(503, 'CORE_UNAVAILABLE')
            try:
                stamp, nonce, signature = headers['X-Time'], headers['X-Nonce'], headers['X-Signature']
                signed = path.encode() + b'\n' + stamp.encode() + b'\n' + nonce.encode() + b'\n' + body
                if abs(self.clock() - int(stamp)) > 30 or len(nonce) != 32 or not hmac.compare_digest(self.sign(signed), signature):
                    raise ValueError()
            except (KeyError, ValueError, TypeError): raise Denied(401, 'SERVICE_AUTH_REQUIRED')
            self.nonces = {k: v for k, v in self.nonces.items() if v > self.clock()}
            if nonce in self.nonces: raise Denied(401, 'REPLAY')
            self.nonces[nonce] = self.clock() + 61
            try: request = json.loads(body)
            except (ValueError, UnicodeError): raise Denied(400, 'INVALID_REQUEST')
            keys = {'/v1/verified-email': ['core_user_id','session_id','expected_email'],
                    '/v1/directory': ['core_user_id','session_id','kind','query','limit','cursor'],
                    '/v1/team-snapshot': ['core_user_id','session_id','core_team_id']}
            if path not in keys: raise Denied(404, 'NOT_FOUND')
            exact(request, keys[path])
            uid, sid = uuid(request['core_user_id']), uuid(request['session_id'])
            user = self.users.get(uid)
            session = self.sessions.get(sid)
            if not user or not user['active'] or user.get('deleted') or not session or session['user_id'] != uid or session['expires_at'] <= self.clock() or session.get('revoked'):
                raise Denied(403)
            if path == '/v1/verified-email':
                expected = email(request['expected_email'])
                if expected is None: raise Denied(400, 'INVALID_REQUEST')
                current = email(user.get('email'))
                verified = bool(current and user.get('email_verified') is True)
                return {'verified': verified, 'matches': bool(verified and current == expected), 'checked_at': int(self.clock())}
            if path == '/v1/team-snapshot':
                team = self.teams.get(uuid(request['core_team_id']))
                if not team or not team['active'] or team.get('deleted') or uid not in team['importers']:
                    raise Denied(404, 'NOT_FOUND')
                if len(team['players'])>80: raise Denied(409,'INVALID_REQUEST')
                players = [self.player(p) for p in team['players'] if self.visible(self.users.get(p))]
                return {'core_team_id': request['core_team_id'], 'name': team['name'], 'crest_url': team['crest_url'],
                        'players': players, 'source_revision': team['revision'], 'captured_at': int(self.clock())}
            kind, query, limit, cursor = request['kind'], text(request['query']), request['limit'], request['cursor']
            if kind not in ('players', 'teams') or type(limit) is not int or not 1 <= limit <= 12 or (cursor is not None and (not isinstance(cursor,str) or len(cursor)>2048)):
                raise Denied(400, 'INVALID_REQUEST')
            rate = [t for t in self.rates.get(uid, []) if t > self.clock()-60]
            if len(rate) >= 30: raise Denied(429, 'RATE_LIMITED')
            self.rates[uid] = rate + [self.clock()]
            binding = [uid, sid, kind, folded(query), limit]
            after = ''
            if cursor:
                try:
                    payload, sig = cursor.split('.')
                    if not hmac.compare_digest(self.sign(payload.encode()), sig): raise ValueError()
                    decoded = json.loads(base64.urlsafe_b64decode(payload))
                    if decoded['binding'] != binding or decoded['expires_at'] <= self.clock(): raise ValueError()
                    after = decoded['after']
                except (ValueError, KeyError, TypeError): raise Denied(400, 'INVALID_CURSOR')
            if kind == 'players':
                rows = [self.player(k) for k,u in self.users.items() if self.visible(u) and folded(query) in folded(u['display_name'])]
            else:
                rows = [{'core_team_id': k, 'name': t['name'], 'crest_url': t['crest_url']} for k,t in self.teams.items()
                        if t['active'] and not t.get('deleted') and t.get('discoverable') is True and uid in t['importers'] and folded(query) in folded(t['name'])]
            id_field = 'core_user_id' if kind == 'players' else 'core_team_id'
            rows = sorted((r for r in rows if r[id_field] > after), key=lambda r:r[id_field])
            page = rows[:limit]
            next_cursor = None
            if len(rows) > limit:
                payload = base64.urlsafe_b64encode(encode({'binding':binding,'after':page[-1][id_field],'expires_at':int(self.clock())+60})).decode()
                next_cursor = payload+'.'+self.sign(payload.encode())
            return {'items':page,'next_cursor':next_cursor}

    @staticmethod
    def visible(user):
        return bool(user and user['active'] and not user.get('deleted') and user.get('discoverable') is True)

    def player(self, uid):
        u=self.users[uid]
        return {'core_user_id':uid,'display_name':u['display_name'],'avatar_url':u['avatar_url'],'positions':list(u['positions'])}

class CoreServer:
    def __init__(self, authority):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass  # Never log bodies, query text, email or authentication headers.
            def do_POST(self):
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0 < length <= 16384: raise Denied(413,'INVALID_REQUEST')
                    result=authority.handle(self.path,self.rfile.read(length),self.headers)
                    status=200
                except Denied as error: status,result=error.status,{'error':error.code}
                except (ValueError,TypeError): status,result=400,{'error':'INVALID_REQUEST'}
                data=encode(result)
                self.send_response(status)
                self.send_header('Content-Type','application/json')
                self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(data)))
                self.end_headers(); self.wfile.write(data)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def close(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

class CoreClient:
    def __init__(self, url, key, clock=time.time):
        # No env-selected remote URLs, browser credentials or production transport.
        from urllib.parse import urlsplit
        parsed=urlsplit(url)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.path or parsed.username or parsed.query or parsed.fragment:
            raise ValueError('LOCAL_ONLY')
        self.url,self.key,self.clock=url,key,clock
    def call(self,path,request):
        body=encode(request); stamp=str(int(self.clock()));nonce=secrets.token_hex(16)
        signature=hmac.new(self.key,path.encode()+b'\n'+stamp.encode()+b'\n'+nonce.encode()+b'\n'+body,hashlib.sha256).hexdigest()
        req=Request(self.url+path,body,{'Content-Type':'application/json','X-Time':stamp,'X-Nonce':nonce,'X-Signature':signature},method='POST')
        try:
            with urlopen(req, timeout=2) as response:
                raw=response.read(262145)
                if len(raw)>262144:raise ValueError('RESPONSE_TOO_LARGE')
                result=json.loads(raw)
                schema={'/v1/verified-email':'verifiedEmailResponse','/v1/team-snapshot':'teamSnapshotResponse',
                        '/v1/directory':'playersResponse' if request.get('kind')=='players' else 'teamsResponse'}[path]
                validate(result,schema)
                if path=='/v1/team-snapshot' and result['core_team_id']!=request['core_team_id']:raise ValueError('WRONG_TEAM')
                if path in ('/v1/verified-email','/v1/team-snapshot'):
                    checked=result.get('checked_at',result.get('captured_at'))
                    if not 0<=self.clock()-checked<=3:raise ValueError('STALE_RESPONSE')
                return result
        except HTTPError as error:
            # Keep downstream body out of errors/logs, including proxy diagnostics.
            status=error.code
            error.close()
            raise Denied(status,'CORE_DENIED' if status<500 else 'CORE_UNAVAILABLE') from None
        except (URLError,TimeoutError,OSError,ValueError): raise Denied(503,'CORE_UNAVAILABLE') from None

class TorneosPOC:
    """Mock gateway authentication + local domain store. Never exposed as production HTTP."""
    def __init__(self, core):
        self.core=core;self.sessions={};self.scopes={};self.invitations={};self.snapshots={};self.keys={}
        self.lock=threading.RLock()
    def actor(self, session):
        # Opaque synthetic gateway handle, not user-supplied JWT claims or user id.
        actor=self.sessions.get(session)
        if actor is None: raise Denied(401,'AUTH_REQUIRED')
        return actor
    def scope(self, actor, organization, tournament, capability):
        if capability not in self.scopes.get((actor['core_user_id'],organization,tournament),set()): raise Denied()
    def accept(self, session, invitation):
        actor=self.actor(session)
        with self.lock:
            invite=self.invitations.get(invitation)
            if not invite or invite['status']!='pending': raise Denied()
            result=self.core.call('/v1/verified-email',{**actor,'expected_email':invite['email']})
            if result.get('verified') is not True or result.get('matches') is not True: raise Denied()
            invite['status']='accepted';invite['accepted_by']=actor['core_user_id']
            # Persist neither Core email nor verification response.
            return {'status':'accepted'}
    def search(self,session,organization,tournament,kind,query,limit=8,cursor=None):
        actor=self.actor(session)
        self.scope(actor,organization,tournament,'search.'+kind)
        return self.core.call('/v1/directory',{**actor,'kind':kind,'query':query,'limit':limit,'cursor':cursor})
    def import_team(self,session,organization,tournament,team,key):
        actor=self.actor(session)
        self.scope(actor,organization,tournament,'import')
        uuid(key)
        # Fresh Core authorization even for retries; an outage never bypasses the contract.
        source=self.core.call('/v1/team-snapshot',{**actor,'core_team_id':team})
        binding=(actor['core_user_id'],organization,tournament,team)
        with self.lock:
            if key in self.keys and self.keys[key]!=binding: raise Denied(409,'IDEMPOTENCY_CONFLICT')
            self.keys[key]=binding
            unique=(organization,tournament,team)
            if unique not in self.snapshots:
                self.snapshots[unique]={'id':str(uuid4()),'organization_id':organization,'tournament_id':tournament,
                    'imported_by':actor['core_user_id'],'ownership':'torneos_competition_snapshot','source':copy.deepcopy(source)}
            return copy.deepcopy(self.snapshots[unique])
