import { Moon, Sun } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { APP_VERSION } from '@vectora/shared';
import { useSettings } from '@/lib/api';
import { useReducedMotion, useTheme } from '@/lib/theme';
import { type Palette, mix, paletteFor } from '@/lib/tokens';
import { IconButton, Wordmark, cx } from './ui';

/** Theme for pages outside a workspace. Works even when the local engine is not running. */
export function useSiteTheme(): { theme: 'light' | 'dark'; palette: Palette; toggle: () => void; reducedMotion: boolean } {
  const { settings, update } = useSettings();
  const [local, setLocal] = useState<'light' | 'dark' | 'system' | undefined>(undefined);
  const theme = useTheme(settings?.appearance.theme ?? local);
  const reducedMotion = useReducedMotion(settings);
  return {
    theme,
    palette: paletteFor(theme),
    reducedMotion,
    toggle: () => {
      const next = theme === 'dark' ? 'light' : 'dark';
      if (settings) update({ appearance: { theme: next } });
      else setLocal(next);
    },
  };
}

export function SiteHeader() {
  const { theme, toggle } = useSiteTheme();
  const link = ({ isActive }: { isActive: boolean }) => cx('text-[0.875rem] no-underline transition-colors duration-200', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink');
  return (
    <header className="flex items-center justify-between gap-6 px-6 py-5 md:px-12">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Link to="/" className="no-underline" aria-label="VECTORA home">
        <Wordmark className="text-[0.8125rem]" />
      </Link>
      <nav aria-label="Site" className="flex items-center gap-5 md:gap-8">
        <NavLink to="/import" className={link}>
          Repositories
        </NavLink>
        <NavLink to="/about" className={link}>
          About
        </NavLink>
        <NavLink to="/settings" className={link}>
          Settings
        </NavLink>
        <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggle} className="btn-quiet">
          {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
        </IconButton>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line px-6 py-10 md:px-12">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-end justify-between gap-8">
        <div>
          <Wordmark className="text-[0.8125rem]" />
          <p className="font-editorial mt-2 text-[1.0625rem]">Understand what connects.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-[0.875rem] text-ink-2">
          <Link to="/import">Explore a repository</Link>
          <Link to="/about">About</Link>
          <Link to="/about#documentation">Documentation</Link>
          <Link to="/about#changelog">Changelog</Link>
          <Link to="/about#license">License</Link>
        </nav>
        <p className="meta">Version {APP_VERSION}, MIT licence</p>
      </div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Illustration of the 3D Atlas: a fixed, generated structure (a centre, six
 * regions, points around them) drawn in perspective. It is a drawing of the
 * idea, not data from a repository, and is captioned as such where used.
 */
export function AtlasIllustration({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { palette, reducedMotion } = useSiteTheme();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Deterministic pseudo-random numbers so the drawing is identical on every visit.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    type P = { x: number; y: number; z: number; r: number; kind: 0 | 1 | 2 };
    const points: P[] = [{ x: 0, y: 0, z: 0, r: 7, kind: 0 }];
    const links: [number, number, boolean][] = [];
    const hubs: number[] = [];
    for (let h = 0; h < 6; h++) {
      const a = (h / 6) * Math.PI * 2 + 0.4;
      const hub: P = { x: Math.cos(a) * 150, y: (rnd() - 0.5) * 110, z: Math.sin(a) * 150, r: 4.5, kind: 1 };
      hubs.push(points.length);
      links.push([0, points.length, false]);
      points.push(hub);
      const count = 9 + Math.floor(rnd() * 9);
      for (let i = 0; i < count; i++) {
        const t = rnd() * Math.PI * 2;
        const u = Math.acos(2 * rnd() - 1);
        const d = 26 + rnd() * 42;
        links.push([hubs[h]!, points.length, false]);
        points.push({ x: hub.x + Math.sin(u) * Math.cos(t) * d, y: hub.y + Math.cos(u) * d, z: hub.z + Math.sin(u) * Math.sin(t) * d, r: 1.4 + rnd() * 1.4, kind: 2 });
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = 7 + Math.floor(rnd() * (points.length - 7));
      const b = 7 + Math.floor(rnd() * (points.length - 7));
      if (a !== b) links.push([a, b, true]);
    }

    let angle = 0.6;
    let raf = 0;
    let visible = true;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const s = Math.min(w, h) / 470;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const proj = points.map((p) => {
        const x = p.x * cos - p.z * sin;
        const z = p.x * sin + p.z * cos;
        const y = p.y * 0.94 - z * 0.2;
        const k = 620 / (620 + z);
        return { x: w / 2 + x * k * s, y: h / 2 + y * k * s, k, z };
      });
      for (const [a, b, cross] of links) {
        const pa = proj[a]!;
        const pb = proj[b]!;
        const depth = Math.max(0, Math.min(1, ((pa.z + pb.z) / 2 + 220) / 440));
        ctx.strokeStyle = mix(cross ? palette.clay : palette.textMuted, palette.canvas, 0.35 + depth * 0.5);
        ctx.lineWidth = cross ? 0.9 : 0.7;
        ctx.setLineDash(cross ? [3, 4] : []);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      points
        .map((p, i) => ({ p, q: proj[i]! }))
        .sort((a, b) => b.q.z - a.q.z)
        .forEach(({ p, q }) => {
          const depth = Math.max(0, Math.min(1, (q.z + 220) / 440));
          const base = p.kind === 0 ? palette.text : p.kind === 1 ? palette.indigo : palette.textSecondary;
          ctx.fillStyle = mix(base, palette.canvas, depth * 0.6);
          const r = p.r * q.k * s * 1.25;
          ctx.beginPath();
          if (p.kind === 1) ctx.rect(q.x - r, q.y - r, r * 2, r * 2);
          else ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
          ctx.fill();
        });
    };
    const loop = () => {
      angle += 0.0011;
      draw();
      if (visible && !reducedMotion) raf = requestAnimationFrame(loop);
    };
    draw();
    // Animate only while the drawing is on screen and motion is allowed.
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !reducedMotion) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [palette, reducedMotion]);
  return <canvas ref={ref} className={className} role="img" aria-label="Illustration: a central repository node surrounded by six clusters of connected points, drawn in perspective." />;
}
