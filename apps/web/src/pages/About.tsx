import type { ReactNode } from 'react';
import { APP_VERSION } from '@vectora/shared';
import { SitePage } from '@/components/Site';
import { useHealth } from '@/lib/api';

const CREDITS: [string, string, string][] = [
  ['TypeScript', 'Compiler API used for TypeScript and JavaScript analysis', 'Apache-2.0'],
  ['Tree-sitter', 'Parsing for Java, Go, Rust, C, C++ and C#', 'MIT'],
  ['Python', 'Standard-library ast module for Python analysis', 'PSF'],
  ['SQLite', 'Local graph database (built into Node.js)', 'Public domain'],
  ['Fastify', 'Local engine HTTP server', 'MIT'],
  ['React and Vite', 'Application framework and build tool', 'MIT'],
  ['Sigma.js and Graphology', 'Two-dimensional graph rendering and graph algorithms', 'MIT'],
  ['Three.js, React Three Fiber and drei', 'Three-dimensional rendering', 'MIT'],
  ['d3-force-3d', 'Force simulation for the 3D layout', 'MIT'],
  ['React Flow and dagre', 'Mind map canvas and hierarchical layout', 'MIT'],
  ['CodeMirror 6', 'Source preview', 'MIT'],
  ['Radix UI, cmdk and Lucide', 'Accessible dialogs, command palette and icons', 'MIT / ISC'],
  ['Tailwind CSS', 'Styling', 'MIT'],
  [
    'Zen Kaku Gothic New, Shippori Mincho, IBM Plex Mono',
    'Typefaces, bundled with the application',
    'SIL OFL 1.1',
  ],
];

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-8 gap-x-12 gap-y-4 border-t border-line py-12 md:grid-cols-12"
    >
      <h2 id={`${id}-title`} className="font-editorial text-[1.5rem] md:col-span-3 md:col-start-2">
        {title}
      </h2>
      <div className="max-w-[68ch] space-y-4 text-[1rem] leading-[1.8] md:col-span-6 md:col-start-6">
        {children}
      </div>
    </section>
  );
}

export function About() {
  const health = useHealth();
  return (
    <SitePage>
      <article className="mx-auto max-w-[1320px] px-6 md:px-12">
        <header className="grid gap-x-12 pb-16 pt-10 md:grid-cols-12 md:pt-20">
          <div className="md:col-span-8 md:col-start-2">
            <p className="font-medium tracking-[0.32em]">VECTORA</p>
            <h1 className="font-editorial mt-4 text-(length:--text-display) leading-[1.1]">
              Understand what connects.
            </h1>
            <p className="font-editorial mt-10 max-w-[38ch] text-[1.375rem] leading-[1.7] md:ml-[25%]">
              VECTORA is a codebase intelligence platform that transforms software repositories into
              structured, interactive knowledge maps. It reveals how components, modules, dependencies and
              concepts connect, giving developers a new way to understand complex software systems.
            </p>
          </div>
        </header>

        <Block id="philosophy" title="Product philosophy">
          <p>
            Software is understood through its connections: what calls what, what depends on what, where a
            request ends up. Those connections are spread across hundreds of files, and reading the files in
            order does not reveal them.
          </p>
          <p>VECTORA is built on three commitments.</p>
          <p>
            <strong className="font-medium">Evidence first.</strong> Every relationship carries the file, the
            line and the method that found it. A reference that cannot be tied to a definition is reported as
            unresolved. It is never drawn as if it were known.
          </p>
          <p>
            <strong className="font-medium">Local by default.</strong> Analysis, storage and search run on
            your own machine. The application works with no account and no hosted service.
          </p>
          <p>
            <strong className="font-medium">Restraint.</strong> The interface follows the Japanese ideas of
            kanso, simplicity, and ma, the meaningful interval. Space, type and a small palette do the work;
            decoration does not.
          </p>
        </Block>

        <Block id="how" title="How VECTORA works">
          <p>
            A repository goes through a fixed pipeline: discovery of files and manifests, syntax analysis by a
            language adapter, resolution of references across files, tracing of execution flows, grouping into
            subsystems and concepts, and generation of a validated knowledge graph that is stored in a local
            database.
          </p>
          <p>
            The Graph Explorer, the 3D Atlas and the Mind Map all read that one graph and share one selection.
            Verified structure and derived interpretation are kept apart throughout, and drawn differently.
          </p>
        </Block>

        <Block id="languages" title="Supported languages">
          <p>
            Symbol-level analysis is available for the languages below. Other files are indexed as files only,
            and each repository shows its own language coverage.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Language</th>
                <th>Tier</th>
                <th>Technique</th>
              </tr>
            </thead>
            <tbody>
              {(health.data?.languages ?? FALLBACK_LANGUAGES).map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="meta">{l.tier}</td>
                  <td className="label">
                    {l.id === 'typescript' || l.id === 'javascript'
                      ? 'TypeScript Compiler API with type-checked resolution'
                      : l.id === 'python'
                        ? 'Python ast module with import and scope resolution'
                        : 'Tree-sitter syntax tree with import and scope resolution'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label">
            Tier 1 languages have the most precise relationship resolution. VECTORA does not claim to support
            every language.
          </p>
        </Block>

        <Block id="privacy" title="Privacy principles">
          <ul className="m-0 list-none space-y-3 p-0">
            <li>Source code is read and analysed locally. It is not uploaded.</li>
            <li>Repository scripts are never executed and repository dependencies are never installed.</li>
            <li>
              Access tokens are stored encrypted on your machine, sent only to GitHub in a request header, and
              never written to logs, URLs or exports.
            </li>
            <li>
              Exports contain names, paths and line numbers. Lines of source are included only when you ask
              for them.
            </li>
            <li>
              The one optional external service, a narrative summary for answers, is off by default and
              receives only the findings already shown on screen.
            </li>
            <li>All stored data can be deleted from Settings.</li>
          </ul>
        </Block>

        <Block id="credits" title="Technology credits">
          <p>VECTORA stands on open-source work. With thanks to the people who maintain it.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Used for</th>
                <th>Licence</th>
              </tr>
            </thead>
            <tbody>
              {CREDITS.map(([name, use, lic]) => (
                <tr key={name}>
                  <td className="whitespace-nowrap">{name}</td>
                  <td className="label whitespace-normal">{use}</td>
                  <td className="meta whitespace-nowrap">{lic}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label">
            The full inventory of dependency licences is generated into <code>docs/LICENSES.md</code> in the
            VECTORA folder.
          </p>
        </Block>

        <Block id="license" title="Version and licence">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-[0.9375rem]">
            <dt className="text-ink-3">Version</dt>
            <dd className="m-0 font-mono">{APP_VERSION}</dd>
            <dt className="text-ink-3">Local engine</dt>
            <dd className="m-0">
              {health.data
                ? `running, version ${health.data.version} on Node.js ${health.data.node}`
                : health.isLoading
                  ? 'checking'
                  : 'not reachable'}
            </dd>
            <dt className="text-ink-3">Licence</dt>
            <dd className="m-0">MIT. See the LICENSE file in the VECTORA folder.</dd>
          </dl>
        </Block>

        <Block id="documentation" title="Documentation">
          <p>
            The documentation ships with the application, in the <code>docs</code> folder:
          </p>
          <ul className="m-0 list-none p-0 font-mono text-[0.8125rem] leading-[2]">
            {[
              'USER_GUIDE.md',
              'ARCHITECTURE.md',
              'DATA_MODEL.md',
              'INDEXING_PIPELINE.md',
              'VISUALIZATION.md',
              'SECURITY.md',
              'PERFORMANCE.md',
              'TROUBLESHOOTING.md',
            ].map((f) => (
              <li key={f}>docs/{f}</li>
            ))}
          </ul>
          <p id="changelog" className="scroll-mt-8">
            Changes between versions are recorded in <code>docs/CHANGELOG.md</code>.
          </p>
        </Block>
      </article>
    </SitePage>
  );
}

const FALLBACK_LANGUAGES = [
  { id: 'typescript', name: 'TypeScript', tier: 1 },
  { id: 'javascript', name: 'JavaScript', tier: 1 },
  { id: 'python', name: 'Python', tier: 1 },
  { id: 'java', name: 'Java', tier: 2 },
  { id: 'go', name: 'Go', tier: 2 },
  { id: 'rust', name: 'Rust', tier: 2 },
  { id: 'c', name: 'C', tier: 2 },
  { id: 'cpp', name: 'C++', tier: 2 },
  { id: 'csharp', name: 'C#', tier: 2 },
];
