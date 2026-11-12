import { Suspense, lazy } from 'react';
import type { CodePreviewProps } from './CodePreviewImpl';

// The editor and its language grammars are loaded when the first source preview is shown.
const Impl = lazy(() => import('./CodePreviewImpl').then((m) => ({ default: m.CodePreview })));

export function CodePreview(props: CodePreviewProps) {
  return (
    <Suspense fallback={<p className="meta">Loading source…</p>}>
      <Impl {...props} />
    </Suspense>
  );
}
