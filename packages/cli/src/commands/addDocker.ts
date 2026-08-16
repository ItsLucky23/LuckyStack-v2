//? Framework-owned Docker baseline for existing consumer projects. The raw asset
//? bundle stays byte-identical to create-luckystack-app/template; this command
//? renders project/router/database-specific placeholders while never overwriting
//? an existing consumer-owned Docker file.

import fs from 'node:fs';
import path from 'node:path';
import {
  assetPath,
  err,
  ok,
  setScript,
  toError,
  type ConsumerProject,
  type Result,
} from '../lib/project';

type DatabaseProvider = 'mongodb' | 'postgresql' | 'mysql' | 'sqlite';

interface DatabaseRender {
  services: string;
  url: string;
  buildUrl: string;
  dependsOn: string;
  volumes: string;
  appVolume: string;
  appDataDeclaration: string;
  remoteExample: string;
}

const detectDatabaseProvider = (root: string): DatabaseProvider => {
  const schemaPath = path.join(root, 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const match = /provider\s*=\s*"(mongodb|postgresql|mysql|sqlite)"/.exec(fs.readFileSync(schemaPath, 'utf8'));
    if (match?.[1]) return match[1] as DatabaseProvider;
  }
  const envPath = path.join(root, '.env');
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const url = /^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m.exec(env)?.[1] ?? '';
  if (url.startsWith('postgres')) return 'postgresql';
  if (url.startsWith('mysql')) return 'mysql';
  if (url.startsWith('file:')) return 'sqlite';
  return 'mongodb';
};

const databaseRender = (provider: DatabaseProvider, projectName: string): DatabaseRender => {
  if (provider === 'postgresql') {
    return {
      services: [
        '  database:', '    image: postgres:17-alpine', '    environment:',
        `      POSTGRES_DB: ${projectName}`, '      POSTGRES_USER: luckystack',
        '      POSTGRES_PASSWORD: ${LUCKYSTACK_LOCAL_DATABASE_PASSWORD:-docker-local-change-me}',
        '    volumes:', '      - database_data:/var/lib/postgresql/data', '    healthcheck:',
        `      test: ["CMD-SHELL", "pg_isready -U luckystack -d ${projectName}"]`,
        '      interval: 3s', '      timeout: 5s', '      retries: 30',
        '    restart: unless-stopped', '',
      ].join('\n'),
      url: `postgresql://luckystack:\${LUCKYSTACK_LOCAL_DATABASE_PASSWORD:-docker-local-change-me}@database:5432/${projectName}`,
      buildUrl: `postgresql://luckystack:docker-build-only@database:5432/${projectName}`,
      dependsOn: '      database:\n        condition: service_healthy\n',
      volumes: '  database_data:\n', appVolume: '', appDataDeclaration: '',
      remoteExample: `postgresql://luckystack:<password>@host.docker.internal:5432/${projectName}`,
    };
  }
  if (provider === 'mysql') {
    return {
      services: [
        '  database:', '    image: mysql:8.4', '    environment:',
        `      MYSQL_DATABASE: ${projectName}`, '      MYSQL_USER: luckystack',
        '      MYSQL_PASSWORD: ${LUCKYSTACK_LOCAL_DATABASE_PASSWORD:-docker-local-change-me}',
        '      MYSQL_ROOT_PASSWORD: ${LUCKYSTACK_LOCAL_DATABASE_ROOT_PASSWORD:-docker-local-root-change-me}',
        '    volumes:', '      - database_data:/var/lib/mysql', '    healthcheck:',
        '      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 --silent"]',
        '      interval: 3s', '      timeout: 5s', '      retries: 30',
        '    restart: unless-stopped', '',
      ].join('\n'),
      url: `mysql://luckystack:\${LUCKYSTACK_LOCAL_DATABASE_PASSWORD:-docker-local-change-me}@database:3306/${projectName}`,
      buildUrl: `mysql://luckystack:docker-build-only@database:3306/${projectName}`,
      dependsOn: '      database:\n        condition: service_healthy\n',
      volumes: '  database_data:\n', appVolume: '', appDataDeclaration: '',
      remoteExample: `mysql://luckystack:<password>@host.docker.internal:3306/${projectName}`,
    };
  }
  if (provider === 'sqlite') {
    return {
      services: '', url: 'file:/app/data/production.db', buildUrl: 'file:/tmp/luckystack-build.db', dependsOn: '', volumes: '',
      appVolume: '      - app_data:/app/data\n', appDataDeclaration: '  app_data:\n',
      remoteExample: 'file:/app/data/production.db',
    };
  }
  return {
    services: [
      '  database:', '    image: mongo:7.0',
      '    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]',
      '    volumes:', '      - database_data:/data/db', '    healthcheck:',
      '      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand(\'ping\').ok", "mongodb://127.0.0.1:27017/admin"]',
      '      interval: 3s', '      timeout: 5s', '      retries: 30',
      '    restart: unless-stopped', '', '  database-init:', '    image: mongo:7.0',
      '    depends_on:', '      database:', '        condition: service_healthy',
      '    volumes:', '      - ./docker/mongo-replica-init.js:/docker/mongo-replica-init.js:ro',
      '    entrypoint: ["mongosh", "--host", "database:27017", "--quiet", "/docker/mongo-replica-init.js"]',
      '    restart: "no"', '',
    ].join('\n'),
    url: `mongodb://database:27017/${projectName}?replicaSet=rs0&directConnection=true`,
    buildUrl: `mongodb://database:27017/${projectName}`,
    dependsOn: '      database-init:\n        condition: service_completed_successfully\n',
    volumes: '  database_data:\n', appVolume: '', appDataDeclaration: '',
    remoteExample: `mongodb://host.docker.internal:27017/${projectName}?replicaSet=rs0&directConnection=true`,
  };
};

const routerService = (projectName: string, databaseUrl: string): string => [
  '  router:', '    build:', '      context: .', '      target: router',
  '    env_file:', '      - path: .env', '        required: false',
  '      - path: .env.docker', '        required: false', '    environment:',
  '      NODE_ENV: production', '      LUCKYSTACK_ENV_FILES: /dev/null',
  '      LUCKYSTACK_ENV: docker', '      LUCKYSTACK_ROUTER_PRESET: ${LUCKYSTACK_PRESET:-default}',
  '      ROUTER_PORT: "4000"', `      PROJECT_NAME: ${projectName}-docker`,
  `      DATABASE_URL: \${LUCKYSTACK_DATABASE_URL:-${databaseUrl}}`,
  '      REDIS_HOST: ${LUCKYSTACK_REDIS_HOST:-redis}',
  '      REDIS_PORT: ${LUCKYSTACK_REDIS_PORT:-6379}',
  '      REDIS_USER: ${LUCKYSTACK_REDIS_USER:-default}',
  '      REDIS_PASSWORD: ${LUCKYSTACK_REDIS_PASSWORD:-docker-local-change-me}',
  '    depends_on:', '      app:', '        condition: service_healthy',
  '      redis:', '        condition: service_healthy', '    extra_hosts:',
  '      - host.docker.internal:host-gateway', '    read_only: true',
  '    tmpfs:', '      - /tmp', '    security_opt:', '      - no-new-privileges:true',
  '    cap_drop:', '      - ALL', '    stop_grace_period: 20s',
  '    restart: unless-stopped', '', '',
].join('\n');

export const renderDockerVariables = (project: ConsumerProject): Record<string, string> => {
  const rawName = typeof project.pkg.name === 'string' ? project.pkg.name : path.basename(project.root);
  const normalizedName = rawName.toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  const projectName = normalizedName.length > 0 ? normalizedName : 'luckystack-app';
  const database = databaseRender(detectDatabaseProvider(project.root), projectName);
  const hasRouter = Boolean(project.pkg.dependencies?.['@luckystack/router'] ?? project.pkg.devDependencies?.['@luckystack/router']);
  return {
    PROJECT_NAME: projectName,
    DOCKER_DATABASE_SERVICES: database.services,
    DOCKER_DATABASE_URL: database.url,
    DOCKER_BUILD_DATABASE_URL: database.buildUrl,
    DOCKER_DATABASE_DEPENDS_ON: database.dependsOn,
    DOCKER_DATABASE_VOLUMES: database.volumes,
    DOCKER_APP_DATA_VOLUME: database.appVolume,
    DOCKER_APP_DATA_DECLARATION: database.appDataDeclaration,
    DOCKER_REMOTE_DATABASE_URL_EXAMPLE: database.remoteExample,
    DOCKER_BACKEND_TARGET: hasRouter ? 'router:4000' : 'app:4100',
    DOCKER_ROUTER_SERVICE: hasRouter ? routerService(projectName, database.url) : '',
    DOCKER_WEB_DEPENDENCY: hasRouter ? 'router' : 'app',
  };
};

const render = (source: string, variables: Record<string, string>): string => {
  let rendered = source;
  for (const [key, value] of Object.entries(variables)) rendered = rendered.replaceAll(`{{${key}}}`, value);
  const unresolved = /\{\{[A-Z0-9_]+\}\}/.exec(rendered)?.[0];
  if (unresolved) throw new Error(`Unresolved Docker asset placeholder: ${unresolved}`);
  return rendered;
};

const assetFiles = (root: string): string[] => {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  };
  walk(root);
  return files;
};

export const addDocker = (project: ConsumerProject): Result<void> => {
  try {
    const sourceRoot = assetPath('docker');
    const variables = renderDockerVariables(project);
    const written: string[] = [];
    for (const relative of assetFiles(sourceRoot)) {
      const destinationRelative = relative.replaceAll('_dot_', '.');
      const destination = path.join(project.root, destinationRelative);
      if (fs.existsSync(destination)) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, render(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'), variables));
      written.push(destinationRelative);
    }
    setScript(project, 'docker:up', 'docker compose up --build -d');
    setScript(project, 'docker:down', 'docker compose down');
    setScript(project, 'docker:check', 'luckystack docker check');
    console.log(written.length > 0 ? `• added Docker assets: ${written.join(', ')}` : '• Docker assets already present; nothing overwritten');
    console.log('✓ Docker baseline ready. Review docs/DOCKER.md, then run `npm run docker:check`.');
    return ok();
  } catch (error) {
    return err(toError(error));
  }
};

export const checkDocker = (project: ConsumerProject): Result<void> => {
  try {
    const required = ['Dockerfile', 'compose.yaml', '.dockerignore', 'docker/nginx.conf', 'docker/start.sh'];
    const missing = required.filter((relative) => !fs.existsSync(path.join(project.root, relative)));
    if (missing.length > 0) throw new Error(`Missing Docker assets: ${missing.join(', ')}. Run \`npx luckystack add docker\`.`);
    const combined = required.map((relative) => fs.readFileSync(path.join(project.root, relative), 'utf8')).join('\n');
    if (/\{\{[A-Z0-9_]+\}\}/.test(combined)) throw new Error('Docker assets still contain unresolved scaffold placeholders.');
    const config = fs.readFileSync(path.join(project.root, 'config.ts'), 'utf8');
    const hasRouter = Boolean(project.pkg.dependencies?.['@luckystack/router'] ?? project.pkg.devDependencies?.['@luckystack/router']);
    if (hasRouter && !config.includes("invocation: 'routed-http'")) {
      throw new Error("@luckystack/router is installed but transport.invocation is not 'routed-http'.");
    }
    console.log(`Docker check: project=${typeof project.pkg.name === 'string' ? project.pkg.name : path.basename(project.root)}`);
    console.log(`  router=${hasRouter ? 'enabled' : 'disabled'} invocation=${hasRouter ? 'routed-http' : 'socket'}`);
    console.log(`  preset=${process.env.LUCKYSTACK_PRESET ?? 'default'} public=http://127.0.0.1:${process.env.LUCKYSTACK_PORT ?? '8080'}`);
    console.log(`  database=${detectDatabaseProvider(project.root)} redis=${process.env.LUCKYSTACK_REDIS_HOST ?? 'local-compose'}`);
    console.log('✓ Docker assets and transport wiring are consistent.');
    return ok();
  } catch (error) {
    return err(toError(error));
  }
};
