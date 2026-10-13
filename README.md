# LuckyStack

A socket-first fullstack framework for real-time React applications.

LuckyStack keeps typed invocation, realtime delivery and application-owned behaviour separate so an app can grow beyond one backend without replacing its programming model. Optional packages let consumers adopt capabilities without copying framework internals into their app.

## Start an application

Use a supported runtime/package manager from the scaffolder's package manifest. Provision the database and Redis required by your selected features.

```sh
npx create-luckystack-app my-app
cd my-app
```

Follow the generated project's setup instructions, supply secrets outside Git, then start its backend and frontend in separate terminals:

```sh
npm run server
npm run client
```

Use the URLs printed by the running processes, not a copied default port. For choices and command options, run the scaffolder with `--help`.

## Contribute to the framework

```sh
git clone https://github.com/ItsLucky23/LuckyStack-v2
cd LuckyStack-v2
npm install
cp .env_template .env
cp .env.local_template .env.local
npm run build
```

Review configuration before starting the reference app. Never commit real secrets. See [the contributor guide](docs/DEVELOPER_GUIDE.md) for verification and [CONTRIBUTING.md](CONTRIBUTING.md) for package-boundary rationale.

## Find the right context

- [Package purposes](docs/PACKAGE_OVERVIEW.md): choose an existing capability before building it again.
- [Architecture](docs/ARCHITECTURE_PACKAGING.md): design constraints and ownership boundaries; related topics live beside it.
- [Hosting](docs/HOSTING.md) and [upgrades](docs/UPGRADING.md): minimal operator instructions and safety checks.
- [AGENTS.md](AGENTS.md): shared AI working rules. Package `AGENTS.md` files hold local design constraints, not function inventories.

Types, exports, configuration and implementation behaviour are authoritative in code. Documentation explains why; generated context queries help find the source.

## License

MIT
