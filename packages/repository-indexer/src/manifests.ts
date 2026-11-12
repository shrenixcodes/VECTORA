/**
 * Reads package manifests and derives declared dependencies, workspace
 * packages, frameworks and declared entry points. Manifests are parsed as
 * data; nothing in them is executed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorkspacePackage } from '@vectora/language-adapters';
import type { ScannedFile } from './scan';

export interface DeclaredDependency {
  name: string;
  version: string | null;
  manifest: string;
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo' | 'maven' | 'nuget';
  dev: boolean;
  line: number;
  evidence: string;
}

export interface ManifestInfo {
  dependencies: DeclaredDependency[];
  workspacePackages: WorkspacePackage[];
  frameworks: { name: string; evidence: string }[];
  declaredEntryPoints: { path: string; reason: string }[];
  description: string | null;
  descriptionSource: string | null;
  goModules: { dir: string; module: string }[];
  cargoCrates: { dir: string; name: string }[];
  manifests: string[];
}

const FRAMEWORKS: Record<string, string> = {
  react: 'React', 'react-dom': 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', '@angular/core': 'Angular',
  express: 'Express', fastify: 'Fastify', koa: 'Koa', '@nestjs/core': 'NestJS', hono: 'Hono', vite: 'Vite', webpack: 'webpack',
  tailwindcss: 'Tailwind CSS', three: 'Three.js', electron: 'Electron', '@tauri-apps/api': 'Tauri', prisma: 'Prisma', '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle ORM', typeorm: 'TypeORM', sequelize: 'Sequelize', mongoose: 'Mongoose', vitest: 'Vitest', jest: 'Jest',
  '@playwright/test': 'Playwright', graphql: 'GraphQL', 'react-native': 'React Native', zustand: 'Zustand', redux: 'Redux',
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', sqlalchemy: 'SQLAlchemy', pytest: 'pytest', celery: 'Celery', pydantic: 'Pydantic',
  numpy: 'NumPy', pandas: 'pandas', torch: 'PyTorch', tensorflow: 'TensorFlow', starlette: 'Starlette', aiohttp: 'aiohttp',
  'github.com/gin-gonic/gin': 'Gin', 'github.com/labstack/echo': 'Echo', 'github.com/gorilla/mux': 'Gorilla Mux', 'gorm.io/gorm': 'GORM',
  'github.com/spf13/cobra': 'Cobra', tokio: 'Tokio', 'actix-web': 'Actix Web', axum: 'Axum', rocket: 'Rocket', serde: 'Serde', diesel: 'Diesel',
  clap: 'clap', 'org.springframework.boot': 'Spring Boot', 'org.springframework': 'Spring', 'org.hibernate': 'Hibernate', junit: 'JUnit',
  'Microsoft.AspNetCore.App': 'ASP.NET Core', 'Microsoft.EntityFrameworkCore': 'Entity Framework Core',
};

const read = (abs: string): string | null => {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const lineOf = (text: string, needle: string): number => {
  const i = text.indexOf(needle);
  return i === -1 ? 1 : text.slice(0, i).split('\n').length;
};

export function readManifests(rootDir: string, files: ScannedFile[]): ManifestInfo {
  const info: ManifestInfo = {
    dependencies: [],
    workspacePackages: [],
    frameworks: [],
    declaredEntryPoints: [],
    description: null,
    descriptionSource: null,
    goModules: [],
    cargoCrates: [],
    manifests: [],
  };
  const fileSet = new Set(files.map((f) => f.path));
  const frameworkSeen = new Set<string>();
  const addDep = (d: DeclaredDependency) => {
    info.dependencies.push(d);
    const fw = FRAMEWORKS[d.name] ?? FRAMEWORKS[d.name.toLowerCase()] ?? Object.entries(FRAMEWORKS).find(([k]) => k.includes('.') && d.name.startsWith(k))?.[1];
    if (fw && !frameworkSeen.has(fw)) {
      frameworkSeen.add(fw);
      info.frameworks.push({ name: fw, evidence: `${d.manifest}:${d.line} declares ${d.name}` });
    }
  };
  const findEntry = (dir: string, candidates: (string | undefined)[]): string | null => {
    for (const c of candidates) {
      if (!c || typeof c !== 'string') continue;
      const base = path.posix.normalize(path.posix.join(dir, c));
      const stem = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
      for (const p of [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`]) if (fileSet.has(p)) return p;
      // Built output usually mirrors src/.
      const src = base.replace(/^(.*?\/)?(dist|build|lib|out)\//, '$1src/').replace(/\.(js|mjs|cjs)$/, '');
      for (const p of [`${src}.ts`, `${src}.tsx`, `${src}.js`]) if (fileSet.has(p)) return p;
    }
    return null;
  };

  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf('/') + 1);
    const dir = dirOf(f.path);
    if (base === 'package.json') {
      const text = read(f.absPath);
      if (!text) continue;
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      info.manifests.push(f.path);
      for (const [field, dev] of [['dependencies', false], ['devDependencies', true], ['peerDependencies', false], ['optionalDependencies', false]] as const) {
        const deps = pkg[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
          const needle = `"${name}"`;
          addDep({ name, version: typeof version === 'string' ? version : null, manifest: f.path, ecosystem: 'npm', dev, line: lineOf(text, needle), evidence: `${needle}: "${String(version)}"` });
        }
      }
      const exp = pkg.exports;
      const exportEntry =
        typeof exp === 'string' ? exp : exp && typeof exp === 'object' ? ((exp as Record<string, unknown>)['.'] as unknown) : undefined;
      const exportPath =
        typeof exportEntry === 'string'
          ? exportEntry
          : exportEntry && typeof exportEntry === 'object'
            ? (Object.values(exportEntry as Record<string, unknown>).find((v) => typeof v === 'string') as string | undefined)
            : undefined;
      const entry = findEntry(dir, [pkg.source as string, exportPath, pkg.module as string, pkg.main as string, 'src/index', 'index']);
      if (typeof pkg.name === 'string') info.workspacePackages.push({ name: pkg.name, dir, entry });
      if (typeof pkg.main === 'string' || exportPath) {
        const e = findEntry(dir, [exportPath, pkg.main as string]);
        if (e) info.declaredEntryPoints.push({ path: e, reason: `${f.path} "main"/"exports"` });
      }
      const bin = pkg.bin;
      for (const b of typeof bin === 'string' ? [bin] : bin && typeof bin === 'object' ? Object.values(bin as Record<string, string>) : []) {
        const e = findEntry(dir, [b]);
        if (e) info.declaredEntryPoints.push({ path: e, reason: `${f.path} "bin"` });
      }
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === 'object') {
        for (const key of ['start', 'dev', 'serve']) {
          const cmd = (scripts as Record<string, unknown>)[key];
          if (typeof cmd !== 'string') continue;
          const m = /(?:node|tsx|ts-node|bun|deno run)\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*([\w./-]+\.(?:[cm]?[jt]sx?))/.exec(cmd);
          const e = m ? findEntry(dir, [m[1]]) : null;
          if (e) info.declaredEntryPoints.push({ path: e, reason: `${f.path} script "${key}"` });
        }
      }
      if (dir === '' && typeof pkg.description === 'string' && pkg.description.trim()) {
        info.description = pkg.description.trim();
        info.descriptionSource = f.path;
      }
    } else if (base === 'requirements.txt' || /^requirements[-_.].*\.txt$/.test(base)) {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.split('#')[0]!.trim();
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([<>=!~].*)?$/.exec(line);
        if (m) addDep({ name: m[1]!.toLowerCase(), version: m[2]?.trim() ?? null, manifest: f.path, ecosystem: 'pypi', dev: /dev|test/.test(base), line: i + 1, evidence: line });
      });
    } else if (base === 'pyproject.toml') {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      const lines = text.split(/\r?\n/);
      let section = '';
      let inArray = false;
      lines.forEach((raw, i) => {
        const line = raw.trim();
        const sec = /^\[([^\]]+)\]$/.exec(line);
        if (sec) {
          section = sec[1]!;
          inArray = false;
          return;
        }
        if (section === 'project' && /^dependencies\s*=\s*\[/.test(line)) inArray = !line.includes(']');
        const inDepsArray = (section === 'project' && (inArray || /^dependencies\s*=/.test(line))) || /optional-dependencies|dependency-groups/.test(section);
        if (inDepsArray) {
          for (const m of line.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([<>=!~][^"']*)?["']/g))
            addDep({ name: m[1]!.toLowerCase(), version: m[2]?.trim() ?? null, manifest: f.path, ecosystem: 'pypi', dev: section !== 'project', line: i + 1, evidence: line });
          if (inArray && line.includes(']')) inArray = false;
        } else if (/^tool\.poetry\.(dev-)?dependencies|^tool\.poetry\.group\..*\.dependencies/.test(section)) {
          const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.+)$/.exec(line);
          if (m && m[1] !== 'python') addDep({ name: m[1]!.toLowerCase(), version: m[2]!.replace(/["']/g, ''), manifest: f.path, ecosystem: 'pypi', dev: /dev|group/.test(section), line: i + 1, evidence: line });
        }
        if (dir === '' && (section === 'project' || section === 'tool.poetry') && !info.description) {
          const d = /^description\s*=\s*["'](.+)["']\s*$/.exec(line);
          if (d) {
            info.description = d[1]!;
            info.descriptionSource = f.path;
          }
        }
      });
    } else if (base === 'go.mod') {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      const mod = /^module\s+(\S+)/m.exec(text);
      if (mod) info.goModules.push({ dir, module: mod[1]! });
      text.split(/\r?\n/).forEach((raw, i) => {
        const m = /^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/\S+)\s+(v\S+)/.exec(raw);
        if (m) addDep({ name: m[1]!, version: m[2]!, manifest: f.path, ecosystem: 'go', dev: /\/\/\s*indirect/.test(raw), line: i + 1, evidence: raw.trim() });
      });
    } else if (base === 'Cargo.toml') {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      let section = '';
      text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        const sec = /^\[([^\]]+)\]$/.exec(line);
        if (sec) {
          section = sec[1]!;
          return;
        }
        if (section === 'package') {
          const n = /^name\s*=\s*"([^"]+)"/.exec(line);
          if (n) info.cargoCrates.push({ dir, name: n[1]! });
          const d = /^description\s*=\s*"([^"]+)"/.exec(line);
          if (d && dir === '' && !info.description) {
            info.description = d[1]!;
            info.descriptionSource = f.path;
          }
        } else if (/dependencies$/.test(section)) {
          const m = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
          if (m) {
            const v = /"([^"]+)"/.exec(m[2]!);
            addDep({ name: m[1]!, version: v?.[1] ?? null, manifest: f.path, ecosystem: 'cargo', dev: section !== 'dependencies', line: i + 1, evidence: line });
          }
        }
      });
    } else if (base === 'pom.xml') {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const g = /<groupId>([^<]+)<\/groupId>/.exec(m[1]!)?.[1];
        const a = /<artifactId>([^<]+)<\/artifactId>/.exec(m[1]!)?.[1];
        const v = /<version>([^<]+)<\/version>/.exec(m[1]!)?.[1] ?? null;
        if (g && a) addDep({ name: `${g}:${a}`, version: v, manifest: f.path, ecosystem: 'maven', dev: /<scope>test<\/scope>/.test(m[1]!), line: lineOf(text, m[0]), evidence: `${g}:${a}${v ? `:${v}` : ''}` });
        if (g && FRAMEWORKS[g] && !frameworkSeen.has(FRAMEWORKS[g]!)) {
          frameworkSeen.add(FRAMEWORKS[g]!);
          info.frameworks.push({ name: FRAMEWORKS[g]!, evidence: `${f.path} declares ${g}:${a}` });
        }
      }
    } else if (base.endsWith('.csproj')) {
      const text = read(f.absPath);
      if (!text) continue;
      info.manifests.push(f.path);
      for (const m of text.matchAll(/<(PackageReference|FrameworkReference)\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g))
        addDep({ name: m[2]!, version: m[3] ?? null, manifest: f.path, ecosystem: 'nuget', dev: false, line: lineOf(text, m[0]), evidence: m[0] });
      if (/Sdk="Microsoft\.NET\.Sdk\.Web"/.test(text) && !frameworkSeen.has('ASP.NET Core')) {
        frameworkSeen.add('ASP.NET Core');
        info.frameworks.push({ name: 'ASP.NET Core', evidence: `${f.path} uses Microsoft.NET.Sdk.Web` });
      }
    }
  }

  // Fall back to the first paragraph of the root README for the description.
  if (!info.description) {
    const readme = files.find((f) => /^readme(\.(md|rst|txt))?$/i.test(f.path));
    const text = readme ? read(readme.absPath) : null;
    if (readme && text) {
      const para = text
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .find((p) => p && !/^(#|=|!\[|<|\[!\[|---|```)/.test(p) && p.length > 20);
      if (para) {
        const clean = para.replace(/\s+/g, ' ').replace(/[*_`]/g, '');
        info.description = clean.length > 400 ? `${clean.slice(0, 397)}...` : clean;
        info.descriptionSource = readme.path;
      }
    }
  }
  return info;
}

const CONFIG_NAMES = new Set([
  'package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'go.mod', 'cargo.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'makefile', 'cmakelists.txt', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env.example', '.editorconfig', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.prettierrc', '.prettierrc.json', '.babelrc', '.npmrc', 'tox.ini',
  'pytest.ini', 'manage.py', 'webpack.config.js', 'rollup.config.js', 'turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml', 'vercel.json',
  'netlify.toml', 'procfile', 'appsettings.json', '.gitignore', '.gitattributes', '.dockerignore',
]);

export function isConfigFile(p: string): boolean {
  const base = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  if (CONFIG_NAMES.has(base)) return true;
  if (/^(vite|vitest|playwright|eslint|tailwind|postcss|next|nuxt|svelte|astro|jest|babel|drizzle|tsup|rollup|webpack)\.config\.[cm]?[jt]s$/.test(base)) return true;
  if (/\.(csproj|sln|tf|tfvars)$/.test(base)) return true;
  if (p.startsWith('.github/') && /\.ya?ml$/.test(base)) return true;
  if (/^tsconfig\..*\.json$/.test(base) || /^dockerfile\./.test(base) || /^\.env\./.test(base)) return true;
  return false;
}

export const isTestFile = (p: string): boolean =>
  /(^|\/)(__tests__|tests?|spec|e2e)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p) || /_test\.(go|py)$/.test(p) || /Tests?\.(java|cs)$/.test(p);
