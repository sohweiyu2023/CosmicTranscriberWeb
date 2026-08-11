from __future__ import annotations

import hashlib
import json
import pathlib
import sys

# Diagnostic-only compatibility patch for the installed dependency tree.
# Reproduces the runtime portions of nodejs/undici PR #5547 exactly enough for
# Undici 7.29.0, without changing package.json/package-lock.json or product code.
# Upstream merged PR: https://github.com/nodejs/undici/pull/5547
# Upstream merge commit: 197a83db6c3b022d1fe0d02ccea12e05f7154704

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'work').resolve()
UNDICI = ROOT / 'node_modules' / 'undici'
PACKAGE = UNDICI / 'package.json'
REQUEST = UNDICI / 'lib' / 'core' / 'request.js'
CLIENT_H1 = UNDICI / 'lib' / 'dispatcher' / 'client-h1.js'
EXPECTED_VERSION = '7.29.0'
MARKER = '// CTW_DIAG_UNDICI_729_UPSTREAM_TOS_FIX'


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding='utf-8')
    except FileNotFoundError:
        fail(f'Missing required Undici file: {path}')
        raise


def replace_exactly_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        fail(f'Undici 7.29.0 compatibility patch refused: expected exactly one {label}; found {count}.')
    return text.replace(before, after, 1)


pkg = json.loads(read(PACKAGE))
version = pkg.get('version')
if version != EXPECTED_VERSION:
    fail(f'Undici compatibility patch refused: expected {EXPECTED_VERSION}, found {version!r}.')

request_text = read(REQUEST)
client_text = read(CLIENT_H1)

if MARKER in request_text or MARKER in client_text:
    fail('Undici compatibility patch refused: diagnostic marker already present.')

request_text = replace_exactly_once(
    request_text,
    '    this.typeOfService = typeOfService ?? 0\n',
    f'    this.typeOfService = typeOfService {MARKER}\n',
    'request default-ToS assignment',
)

client_text = replace_exactly_once(
    client_text,
    "const kSocketUsed = Symbol('kSocketUsed')\n\nlet extractBody\n",
    "const kSocketUsed = Symbol('kSocketUsed')\n"
    "const kTypeOfService = Symbol('kTypeOfService')\n\n"
    "let extractBody\n",
    'HTTP/1 socket symbol anchor',
)

helper_anchor = (
    "// https://www.rfc-editor.org/rfc/rfc7230#section-3.3.2\n"
    "function shouldSendContentLength (method) {\n"
    "  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && method !== 'TRACE' && method !== 'CONNECT'\n"
    "}\n\n"
    "/**\n"
)
helper_replacement = (
    "// https://www.rfc-editor.org/rfc/rfc7230#section-3.3.2\n"
    "function shouldSendContentLength (method) {\n"
    "  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && method !== 'TRACE' && method !== 'CONNECT'\n"
    "}\n\n"
    "function setTypeOfService (socket, request) {\n"
    "  if (typeof socket.setTypeOfService !== 'function') {\n"
    "    return\n"
    "  }\n\n"
    "  const typeOfService = request.typeOfService\n\n"
    "  if (typeOfService === undefined) {\n"
    "    return\n"
    "  }\n\n"
    "  const currentTypeOfService = socket[kTypeOfService]\n\n"
    "  if (currentTypeOfService === typeOfService) {\n"
    "    return\n"
    "  }\n\n"
    "  try {\n"
    "    socket.setTypeOfService(typeOfService)\n"
    "    socket[kTypeOfService] = typeOfService\n"
    "  } catch {\n"
    "    // QoS marking is best-effort. setTypeOfService() can throw synchronously on\n"
    "    // some platforms depending on socket state, but that must not abort the request.\n"
    "  }\n"
    "}\n\n"
    "/**\n"
)
client_text = replace_exactly_once(
    client_text,
    helper_anchor,
    helper_replacement,
    'HTTP/1 helper insertion anchor',
)

client_text = replace_exactly_once(
    client_text,
    "  if (socket.setTypeOfService) {\n"
    "    socket.setTypeOfService(request.typeOfService)\n"
    "  }\n",
    "  setTypeOfService(socket, request)\n",
    'HTTP/1 direct setTypeOfService call',
)

REQUEST.write_text(request_text, encoding='utf-8', newline='\n')
CLIENT_H1.write_text(client_text, encoding='utf-8', newline='\n')

# Fail closed on the semantic invariants from upstream PR #5547.
request_after = read(REQUEST)
client_after = read(CLIENT_H1)
checks = {
    'request preserves unspecified ToS': 'this.typeOfService = typeOfService ' + MARKER in request_after,
    'request no longer coerces unspecified ToS to zero': 'this.typeOfService = typeOfService ?? 0' not in request_after,
    'client tracks applied ToS': "const kTypeOfService = Symbol('kTypeOfService')" in client_after,
    'client skips unspecified ToS': 'if (typeOfService === undefined)' in client_after,
    'client suppresses synchronous QoS failure': 'socket.setTypeOfService(typeOfService)' in client_after and '  } catch {' in client_after,
    'client no longer directly applies request ToS': 'socket.setTypeOfService(request.typeOfService)' not in client_after,
    'client routes writes through helper': client_after.count('setTypeOfService(socket, request)') == 1,
}
for name, ok in checks.items():
    print(f"{'PASS' if ok else 'FAIL'} {name}")
if not all(checks.values()):
    fail('Undici compatibility patch postcondition failure.')

for path in (REQUEST, CLIENT_H1):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f'PATCHED_SHA256 {path.relative_to(ROOT)} {digest}')
print(f'Undici {EXPECTED_VERSION} upstream ToS compatibility patch: PASS')
