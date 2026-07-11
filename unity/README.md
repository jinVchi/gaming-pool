# unity/

One Unity project per game, WebGL builds output here. Each build is served locally
in dev (see `apps/web`) and uploaded to R2 in production — never bundled into `apps/web`.

Layout once games are added:

```
unity/
  {slug}/           # Unity project
    Build/          # WebGL build output (git-ignored)
```
