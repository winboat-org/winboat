# WinBoat Guest API

## Capability discovery

`GET /health` is intentionally unauthenticated so a loopback host can check
readiness before it has loaded the shared Guest token. In addition to
`{"status":"ok"}`, current servers return an API version, authentication
scheme, and a list of versioned capabilities:

```json
{
  "status": "ok",
  "apiVersion": 1,
  "authentication": "bearer",
  "capabilities": ["apps-query-v1"]
}
```

Unknown capability names must be ignored. Clients may use a capability only
after it is advertised. Existing Guest versions that return only `status`
remain valid.

## Bounded app projection

`apps-query-v1` adds a filtered, icon-free form of the existing authenticated
`GET /apps` endpoint. It is intended for callers that need to discover a small
set of executables under a known installation root without generating every
application icon.

All of the following query parameters are required except `limit`:

| Parameter | Contract |
| --- | --- |
| `includeIcons` | Must be `false`. The projected path never loads or encodes icons. |
| `pathPrefix` | Local absolute Windows directory containing immediate child installation directories. UNC paths, control characters, wildcards, traversal, invalid Windows path characters, trailing dots or spaces in components, and paths over 4 KiB are rejected. |
| `pathSuffix` | Relative executable path below each immediate child of `pathPrefix`, beginning with `\`. The same path restrictions apply. |
| `fields` | Comma-separated projection of `Name`, `Path`, and `Source`, bounded to 128 bytes; `Path` is required. Unknown, duplicate, and control-character fields are rejected. |
| `limit` | Optional integer from 1 through 128; defaults to 128. |

For example:

```text
GET /apps?includeIcons=false&pathPrefix=C%3A%5CProgram%20Files%5CMendix%5C&pathSuffix=%5Cmodeler%5Cstudiopro.exe&fields=Name%2CPath%2CSource&limit=128
Authorization: Bearer <shared guest token>
```

The response is always a JSON array, including when zero or one app matches.
The server checks only `pathPrefix/<immediate child>/<pathSuffix>`, rejects
reparse points at every traversed component including ancestors of
`pathPrefix`, resolves an existing leaf, and
returns at most `limit` entries. Execution is limited to 10 seconds and the
serialized response to 256 KiB. Invalid queries return 400, authentication
failures return 401, timeouts return 504, and execution or response-limit
failures return 500.

A request without projected-query parameters retains the original `/apps`
behavior, including its existing execution and response semantics. Clients
should use this legacy request only when `apps-query-v1` is absent; they should
not downgrade after an advertised projected request fails.
