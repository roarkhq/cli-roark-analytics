# Changelog

## [0.5.0](https://github.com/roarkhq/cli-roark-analytics/compare/v0.4.0...v0.5.0) (2026-09-03)


### Features

* **cli:** cli update ([#17](https://github.com/roarkhq/cli-roark-analytics/issues/17)) ([32f7850](https://github.com/roarkhq/cli-roark-analytics/commit/32f78506c711cc88f361cae5bd9c0b29c8790571))

## [0.4.0](https://github.com/roarkhq/cli-roark-analytics/compare/v0.3.0...v0.4.0) (2026-09-03)


### Features

* **cli:** cli update ([#13](https://github.com/roarkhq/cli-roark-analytics/issues/13)) ([390b149](https://github.com/roarkhq/cli-roark-analytics/commit/390b1493da72b1e2bc5e9bd1fbdb103f9854e476))

## [0.3.0](https://github.com/roarkhq/cli-roark-analytics/compare/v0.2.0...v0.3.0) (2026-09-02)


### Features

* **auth:** browser-based login (OAuth authorization-code + PKCE) ([#6](https://github.com/roarkhq/cli-roark-analytics/issues/6)) ([62c476e](https://github.com/roarkhq/cli-roark-analytics/commit/62c476ea4d383842bf57fe9645ba65a77297d503))
* **auth:** verify token on login, warn on env-var shadow, clearer errors ([#5](https://github.com/roarkhq/cli-roark-analytics/issues/5)) ([5b7a256](https://github.com/roarkhq/cli-roark-analytics/commit/5b7a2568149cf36d1cabe2cfe84afc63b4ef7939))
* **cli:** add the roark command line interface ([9ad4541](https://github.com/roarkhq/cli-roark-analytics/commit/9ad45413fca0e0864db5827c9511b4c2757103eb))
* **cli:** cli update ([e28294f](https://github.com/roarkhq/cli-roark-analytics/commit/e28294fec4df79eb40a184b6996a31f2ed45a7db))
* **cli:** cli update ([8c16aed](https://github.com/roarkhq/cli-roark-analytics/commit/8c16aed1a2b5fdebfd0303f0905b8d596b4d2acb))
* **cli:** cli update ([131c7c3](https://github.com/roarkhq/cli-roark-analytics/commit/131c7c37e05b28ea31934708c774c4c512191a60))
* **cli:** cli update ([c46b935](https://github.com/roarkhq/cli-roark-analytics/commit/c46b935e23f0e40e290a2430879e3c5bb9e7fe77))
* **cli:** cli update ([35b9b0b](https://github.com/roarkhq/cli-roark-analytics/commit/35b9b0b5eee942b4ed24e4ca6e6aedf5fafa5a54))
* **cli:** config diff/apply for config-as-code directories ([#1143](https://github.com/roarkhq/cli-roark-analytics/issues/1143)) ([d4ff899](https://github.com/roarkhq/cli-roark-analytics/commit/d4ff8999e223e9c3c0e36c6f910d08058507841b))
* **cli:** install with a script, not a global npm install ([6db9132](https://github.com/roarkhq/cli-roark-analytics/commit/6db91327c257d38de08dcf816cd103eb13ee3aaa))
* **cli:** ship a shrinkwrap so an install resolves the same tree twice ([415cc82](https://github.com/roarkhq/cli-roark-analytics/commit/415cc8269939265d9b3a3a9827c4a09a568144bb))


### Bug Fixes

* **cli:** do not send a stored credential to a base URL a project file chose ([1d50a94](https://github.com/roarkhq/cli-roark-analytics/commit/1d50a9447e1a5bc988e9d2e2d641f58ed5865b87))
* **cli:** make a truncated download do nothing ([9a52f2f](https://github.com/roarkhq/cli-roark-analytics/commit/9a52f2fb6dc1938bbd6d5919fae2a4673622f15f))
* **cli:** only read stdin when there is something to read from ([66c7061](https://github.com/roarkhq/cli-roark-analytics/commit/66c706157bee14727b96a1970fa49474755f0812))
* **cli:** report the version the package actually publishes ([bbaf3ac](https://github.com/roarkhq/cli-roark-analytics/commit/bbaf3ac48a3e39c6f626810547caf9b7329fb4bd))
* **cli:** warn instead of failing when the shrinkwrap cannot be built ([09f0a2c](https://github.com/roarkhq/cli-roark-analytics/commit/09f0a2c793ec5ab3efdc55608229a7da9bb1f414))


### Chores

* **cli:** 0.2.0 ([cd35004](https://github.com/roarkhq/cli-roark-analytics/commit/cd350040d4dcbbb4eaeaa714ce5a759ffe627c88))
* **cli:** drop the inert x-release-please-version marker ([e3747f7](https://github.com/roarkhq/cli-roark-analytics/commit/e3747f7b30bb9b345020debc8475a685576a4c60))
* **cli:** pin shell scripts to LF line endings ([1a65bea](https://github.com/roarkhq/cli-roark-analytics/commit/1a65bea0f823abfa84818646b738031d018cf73c))
* **cli:** start the CLI at 0.1.0 rather than mirroring the SDK ([e9dad1d](https://github.com/roarkhq/cli-roark-analytics/commit/e9dad1d3e8672a71bfda639599361ef1e2d70c3a))
* stand the package up on its own ([068005f](https://github.com/roarkhq/cli-roark-analytics/commit/068005f5f6154e7131926328246ec96ae10e0626))
