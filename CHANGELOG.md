# [1.3.0](https://github.com/robbeverhelst/wakehook/compare/v1.2.1...v1.3.0) (2026-11-19)


### Features

* always send top-level kind + update (0 on wake) so receiver templates resolve ([#54](https://github.com/robbeverhelst/wakehook/issues/54)) ([893dbc4](https://github.com/robbeverhelst/wakehook/commit/893dbc413f7e04d5d12bee6a21ee4f3a7d007593))

## [1.2.1](https://github.com/robbeverhelst/wakehook/compare/v1.2.0...v1.2.1) (2026-11-19)


### Bug Fixes

* right sleep duration on partial Fitbit syncs, update events with corrected numbers ([#53](https://github.com/robbeverhelst/wakehook/issues/53)) ([c28eb76](https://github.com/robbeverhelst/wakehook/commit/c28eb76acac7957999ab14ba0c41aaaaa5cb0c57))

# [1.2.0](https://github.com/robbeverhelst/wakehook/compare/v1.1.0...v1.2.0) (2026-06-15)


### Features

* **subscribers:** configurable signature header + combined OpenClaw/Hermes skill ([cb26ffb](https://github.com/robbeverhelst/wakehook/commit/cb26ffb4d28d4ca55dd7b0edb5c4dacd505ff3e0)), closes [#25](https://github.com/robbeverhelst/wakehook/issues/25)

# [1.1.0](https://github.com/robbeverhelst/wakehook/compare/v1.0.0...v1.1.0) (2026-06-14)


### Features

* **poll:** window-gated polling around the morning window ([ad938c7](https://github.com/robbeverhelst/wakehook/commit/ad938c7172c2e6543e5ed508e83bedd1f046780c))

# [1.0.0](https://github.com/robbeverhelst/wakehook/compare/v0.2.0...v1.0.0) (2026-06-14)


* feat(subscribers)!: per-subscriber headers; drop the openclaw preset ([87ad604](https://github.com/robbeverhelst/wakehook/commit/87ad6047ff988553f97285d15d80a8507242d037))


### BREAKING CHANGES

* the `openclaw` preset is removed — use `generic` (default) with
`headers` and an OpenClaw hooks.mappings entry.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

# [0.2.0](https://github.com/robbeverhelst/wakehook/compare/v0.1.0...v0.2.0) (2026-06-14)


### Bug Fixes

* **google:** drop include_granted_scopes from the consent URL ([8bb6b45](https://github.com/robbeverhelst/wakehook/commit/8bb6b45922331d8b529de3916edae2b930d0188d))


### Features

* **google:** poll mode + correct v4 sleep read shape ([5dd55c2](https://github.com/robbeverhelst/wakehook/commit/5dd55c21296de789c4c32b829e59113421ec9720))
