import { Link } from 'react-router';
import { AtlasIllustration, SitePage } from '@/components/Site';

const STEPS = [
  { mark: '一', title: 'Import', body: 'Point VECTORA at a GitHub repository, a ZIP archive or a folder on your machine. Ignore rules are respected and nothing in the repository is ever run.' },
  { mark: '二', title: 'Index', body: 'Source files are parsed into syntax trees. Classes, functions, imports, routes and data models are extracted with the file and line they came from.' },
  { mark: '三', title: 'Resolve', body: 'References are tied to definitions only when there is scope evidence for it. What cannot be resolved is reported, not guessed.' },
  { mark: '四', title: 'Explore', body: 'The result is one knowledge graph, shown three ways. Select a node anywhere and the other views follow.' },
];

const VIEWS = [
  { name: 'Graph Explorer', dimension: 'Two dimensions', body: 'Pan and zoom through files and symbols. Selecting a node highlights what it depends on and what depends on it, and dims the rest.' },
  { name: '3D Atlas', dimension: 'Three dimensions', body: 'The repository at the centre, subsystems as regions around it, files and symbols inside their regions. Fly to a node, unfold it, return to the whole.' },
  { name: 'Mind Map', dimension: 'Hierarchy', body: 'Subsystems, folders, files and symbols as a tree you can expand, rearrange and export. Concepts sit beside the structure they were found in.' },
];

const LANGUAGES: [string, string][] = [
  ['TypeScript and JavaScript', 'type-checked symbol resolution'],
  ['Python', 'syntax-tree analysis'],
  ['Java, Go, Rust, C, C++, C#', 'syntax-tree analysis'],
];

export function Landing() {
  return (
    <SitePage>
      {/* Hero — text held to a narrow left column, the drawing bleeding off the right edge */}
      <section className="relative mx-auto grid max-w-[1320px] gap-y-10 px-6 pb-8 pt-10 md:grid-cols-12 md:px-12 md:pt-20" aria-labelledby="hero-title">
        <p className="spine absolute left-[18px] top-24 hidden xl:block" aria-hidden="true">
          {'VECTORA　構造を読む'}
        </p>
        <div className="md:col-span-5 md:pt-10 xl:col-start-2 xl:col-span-4">
          <h1 id="hero-title" className="font-editorial text-(length:--text-display) leading-[1.08]">
            Understand what connects.
          </h1>
          <p className="mt-7 max-w-[34ch] text-[1.0625rem] leading-[1.75] text-ink-2">Explore the hidden architecture of software. Transform repositories into structured, interactive knowledge maps.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/import" className="btn btn-primary h-[44px] px-6 text-[0.875rem]">
              Explore a repository
            </Link>
            <Link to="/about" className="btn h-[44px] px-6 text-[0.875rem]">
              Learn about VECTORA
            </Link>
          </div>
        </div>
        <figure className="m-0 md:col-span-7 md:col-start-6 md:-mr-12">
          <AtlasIllustration className="aspect-[5/4] w-full" />
          <figcaption className="meta mt-2 md:pr-12 md:text-right">Illustration of the 3D Atlas: a repository, its subsystems and their contents.</figcaption>
        </figure>
      </section>

      <hr className="rule mx-6 md:mx-12" />

      {/* Product visualisation */}
      <section className="mx-auto grid max-w-[1320px] gap-x-12 gap-y-6 px-6 py-20 md:grid-cols-12 md:px-12" aria-labelledby="product-title">
        <h2 id="product-title" className="font-editorial text-(length:--text-page) md:col-span-5 md:col-start-2">
          A repository is a set of relationships. Reading files one by one hides them.
        </h2>
        <div className="space-y-5 text-[1rem] leading-[1.8] text-ink-2 md:col-span-4 md:col-start-8 md:pt-3">
          <p>VECTORA reads the source, records which function calls which, which class extends which, which route leads to which handler, and keeps the line of code that proves it.</p>
          <p>Every relationship in the graph can be opened to show its evidence. Groupings that are interpretations, such as concepts, are marked as derived and drawn differently from verified structure.</p>
        </div>
      </section>

      {/* How it works — a real sequence, so it is numbered */}
      <section className="border-y border-line bg-surface" aria-labelledby="how-title">
        <div className="mx-auto max-w-[1320px] px-6 py-20 md:px-12">
          <h2 id="how-title" className="font-editorial text-(length:--text-page) md:ml-[8.33%]">
            How it works
          </h2>
          <ol className="m-0 mt-12 grid list-none gap-x-10 gap-y-10 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t border-ink pt-4">
                <span className="font-editorial text-[1.5rem] text-clay" aria-hidden="true">
                  {s.mark}
                </span>
                <span className="sr-only">Step {i + 1}: </span>
                <h3 className="mt-3 text-[1.0625rem] font-medium">{s.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-[1.75] text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Exploration capabilities */}
      <section className="mx-auto max-w-[1320px] px-6 py-20 md:px-12" aria-labelledby="explore-title">
        <div className="grid gap-x-12 md:grid-cols-12">
          <h2 id="explore-title" className="font-editorial text-(length:--text-page) md:col-span-4 md:col-start-2">
            One graph, three ways to read it
          </h2>
          <ul className="m-0 mt-8 list-none p-0 md:col-span-6 md:col-start-7 md:mt-2">
            {VIEWS.map((v) => (
              <li key={v.name} className="grid grid-cols-[1fr] gap-x-8 border-t border-line py-6 sm:grid-cols-[9rem_1fr]">
                <p className="label pt-1">{v.dimension}</p>
                <div>
                  <h3 className="text-[1.125rem] font-medium">{v.name}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-[1.75] text-ink-2">{v.body}</p>
                </div>
              </li>
            ))}
            <li className="border-t border-line py-6 text-[0.9375rem] leading-[1.75] text-ink-2">
              Around them: an inspector with the original source, search across files, symbols and documentation, a dependency explorer with circular imports and unresolved references, and questions answered with file and line citations.
            </li>
          </ul>
        </div>
      </section>

      {/* Supported source formats */}
      <section className="mx-auto max-w-[1320px] px-6 pb-20 md:px-12" aria-labelledby="formats-title">
        <div className="grid gap-x-12 gap-y-10 border-t border-line pt-14 md:grid-cols-12">
          <div className="md:col-span-5 md:col-start-2">
            <h2 id="formats-title" className="font-editorial text-[1.5rem]">
              Supported sources
            </h2>
            <dl className="m-0 mt-6">
              {[
                ['GitHub repository', 'Public repositories by URL. Private repositories with an access token you provide; it is stored encrypted on your machine.'],
                ['ZIP archive', 'Checked before extraction. Nested project folders are detected and you choose the root.'],
                ['Local folder', 'Read in place through the local engine. .gitignore and your own exclusion rules apply.'],
              ].map(([k, v]) => (
                <div key={k} className="border-b border-line py-4">
                  <dt className="font-medium">{k}</dt>
                  <dd className="m-0 mt-1 text-[0.9375rem] leading-[1.7] text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="md:col-span-4 md:col-start-8">
            <h2 className="font-editorial text-[1.5rem]">Languages analysed</h2>
            <ul className="m-0 mt-6 list-none p-0">
              {LANGUAGES.map(([k, v]) => (
                <li key={k} className="border-b border-line py-4">
                  <p className="font-medium">{k}</p>
                  <p className="label mt-1">{v}</p>
                </li>
              ))}
            </ul>
            <p className="label mt-4">Files in other languages are listed and searchable but not analysed at symbol level. Language coverage is shown for every repository.</p>
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="border-y border-line bg-surface" aria-labelledby="privacy-title">
        <div className="mx-auto grid max-w-[1320px] gap-x-12 gap-y-6 px-6 py-20 md:grid-cols-12 md:px-12">
          <h2 id="privacy-title" className="font-editorial text-(length:--text-page) md:col-span-4 md:col-start-2">
            Your code stays on your machine
          </h2>
          <ul className="m-0 list-none space-y-4 p-0 text-[1rem] leading-[1.75] text-ink-2 md:col-span-5 md:col-start-7">
            <li>Indexing, the graph database and search all run in a local engine. No source code is uploaded.</li>
            <li>Repository dependencies are never installed and repository scripts are never executed.</li>
            <li>The only network requests are the ones you start: downloading a repository from GitHub, and an optional narrative service that is off by default.</li>
            <li>Exports leave out source text unless you ask for it, and everything can be deleted from Settings.</li>
          </ul>
        </div>
      </section>

      {/* About */}
      <section className="mx-auto grid max-w-[1320px] gap-x-12 gap-y-6 px-6 pt-20 md:grid-cols-12 md:px-12" aria-labelledby="about-title">
        <h2 id="about-title" className="font-editorial text-[1.5rem] md:col-span-3 md:col-start-2">
          About
        </h2>
        <div className="md:col-span-6 md:col-start-6">
          <p className="font-editorial text-[1.25rem] leading-[1.7]">
            VECTORA is a codebase intelligence platform that transforms software repositories into structured, interactive knowledge maps. It reveals how components, modules, dependencies and concepts connect, giving developers a new way to understand complex software systems.
          </p>
          <p className="mt-6">
            <Link to="/about">Philosophy, supported languages, credits and licence</Link>
          </p>
        </div>
      </section>
    </SitePage>
  );
}
