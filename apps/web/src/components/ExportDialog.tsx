import { useEffect, useState } from 'react';
import { api, downloadUrl } from '@/lib/api';
import { useWs } from '@/workspace/context';
import { Dialog, Notice } from './ui';

const FORMATS: { id: string; label: string; detail: string; graph: boolean }[] = [
  {
    id: 'json',
    label: 'Graph as JSON',
    detail: 'Every node and relationship with ids, locations, extraction method and confidence.',
    graph: true,
  },
  {
    id: 'graphml',
    label: 'Graph as GraphML',
    detail: 'For Gephi, yEd, Cytoscape and other graph tools.',
    graph: true,
  },
  {
    id: 'markdown',
    label: 'Repository analysis (Markdown)',
    detail: 'Languages, subsystems, entry points, dependencies and unresolved references.',
    graph: false,
  },
  {
    id: 'architecture',
    label: 'Architecture documentation (Markdown)',
    detail: 'Subsystem dependencies, endpoints, models, flows and circular imports.',
    graph: false,
  },
];

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { repo, settings } = useWs();
  const [includeSource, setIncludeSource] = useState(settings.privacy.includeSourceInExports);
  useEffect(() => {
    if (open) setIncludeSource(settings.privacy.includeSourceInExports);
  }, [open, settings.privacy.includeSourceInExports]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      description={`${repo.name} — exports keep node ids and relationships intact.`}
    >
      <ul className="m-0 list-none p-0">
        {FORMATS.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-6 border-b border-line py-3">
            <div>
              <p className="text-[0.9375rem]">{f.label}</p>
              <p className="label">{f.detail}</p>
            </div>
            <button
              className="btn btn-sm shrink-0"
              onClick={() => downloadUrl('', api.exportUrl(repo.id, f.id, f.graph && includeSource))}
              data-testid={`export-${f.id}`}
            >
              Download
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[0.875rem]">
        <input
          type="checkbox"
          className="mt-1 accent-(--indigo)"
          checked={includeSource}
          onChange={(e) => setIncludeSource(e.target.checked)}
        />
        <span>
          Include source text in graph exports
          <span className="label block">
            Adds the evidence lines, signatures and doc comments taken from the repository. Leave this off
            when sharing a graph of private code.
          </span>
        </span>
      </label>
      {includeSource ? (
        <div className="mt-4">
          <Notice tone="warning">
            The JSON and GraphML files will contain lines of source code from this repository.
          </Notice>
        </div>
      ) : null}
      <p className="label mt-5">
        The Mind Map exports SVG and PNG, and the Graph Explorer and 3D Atlas export PNG, from their own
        toolbars.
      </p>
    </Dialog>
  );
}
