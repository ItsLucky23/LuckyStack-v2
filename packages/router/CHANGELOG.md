# Changelog

All notable changes to `@luckystack/router` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The router refused to start on a standard HTTPS deployment.** Every binding
  must declare an explicit port — but the check tested `new URL(target).port`,
  which is EMPTY for a protocol's DEFAULT port. So `https://api.example.com:443/x`
  looked identical to the port-less `https://api.example.com/x`, and an operator
  who wrote `:443` was told their port was "missing", with no way to comply short
  of picking a non-default port. Present since 0.2.0.

  `:443` and `:80` are now accepted; a genuinely port-less binding is still
  rejected, because relying on 80/443 by omission is how a multi-instance topology
  silently collapses onto one target. The check reads the raw URL text, so IPv6
  literals (`http://[::1]:4100`) and userinfo containing `@` are handled correctly.

## [0.1.0]

### Added

- Initial public release as part of the LuckyStack package split.
