# Ketos documentation

The current manual lives in `docs/docs`. Build and verify it locally:

```bash
npm ci
npm run check:links
npm run build
```

Do not add release history, community promotion, unverified deployment claims,
or external OpenAPI fetches. Examples must use current `ketos`/`kfx` commands,
`KETOS_*` environment variables, `x-api-key` for `KETOS_API_KEY`, and
`X-KETOS-GLOBAL-VAR-*` request variables. `Authorization: Bearer` is only for
JWT/OAuth authentication.
