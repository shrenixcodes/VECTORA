import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { SitePage } from './components/Site';
import { Empty, Loading } from './components/ui';
import { About } from './pages/About';
import { ImportPage } from './pages/ImportPage';
import { Landing } from './pages/Landing';
import { Dependencies } from './workspace/Dependencies';
import { Documentation, SourceView } from './workspace/Documentation';
import { Overview } from './workspace/Overview';
import { SearchView } from './workspace/SearchView';
import { SettingsView } from './workspace/SettingsView';
import { WorkspaceLayout } from './workspace/WorkspaceLayout';

// The three renderers are loaded on demand: each pulls in a sizeable graphics library.
const GraphExplorer = lazy(() =>
  import('./workspace/GraphExplorer').then((m) => ({ default: m.GraphExplorer })),
);
const Atlas = lazy(() => import('./workspace/Atlas').then((m) => ({ default: m.Atlas })));
const MindMap = lazy(() => import('./workspace/MindMap').then((m) => ({ default: m.MindMap })));

const view = (el: React.ReactNode) => <Suspense fallback={<Loading label="Loading view" />}>{el}</Suspense>;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/import" element={<ImportPage />} />
        <Route
          path="/settings"
          element={
            <SitePage>
              <SettingsView />
            </SitePage>
          }
        />
        <Route path="/w/:repoId" element={<WorkspaceLayout />}>
          <Route index element={<Overview />} />
          <Route path="mindmap" element={view(<MindMap />)} />
          <Route path="graph" element={view(<GraphExplorer />)} />
          <Route path="atlas" element={view(<Atlas />)} />
          <Route path="dependencies" element={<Dependencies />} />
          <Route path="search" element={<SearchView />} />
          <Route path="docs" element={<Documentation />} />
          <Route path="source" element={<SourceView />} />
          <Route path="settings" element={<SettingsView />} />
        </Route>
        <Route
          path="*"
          element={
            <SitePage>
              <Empty title="This page does not exist">
                <p>
                  <Link to="/">Return to the start</Link>
                </p>
              </Empty>
            </SitePage>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
