# create-luckystack-app

Create a new [LuckyStack](https://github.com/ItsLucky23/LuckyStack-v2) project in a fresh directory. Requires Node.js and a package manager; consult `package.json` for the supported engine and run `npx create-luckystack-app --help` for current options.

```bash
npx create-luckystack-app my-app
cd my-app
cp .env_template .env
cp .env.local_template .env.local
# Set local secrets in .env.local; never commit them.
npm run server # terminal 1
npm run client # terminal 2
```

Follow the generated project's README for data-layer initialization and its configured frontend address. Redis and a database are needed only for selected features.

For an existing project, upgrade its installed `@luckystack/*` packages, then run `npx luckystack update`. Review `.new` sidecars before adopting framework-owned changes; the upgrade path preserves user edits. The starter source belongs to the generated app, while installed framework packages remain independently upgradeable.

See [packaging architecture](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/docs/ARCHITECTURE_PACKAGING.md) for the ownership boundary and [developer guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/docs/DEVELOPER_GUIDE.md) for more context.
