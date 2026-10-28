"use client";

import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";

import { cn } from "@/lib/utils";

// ─── Color palettes ───────────────────────────────────────────────

export type RGB = readonly [number, number, number];

export type PaletteBand = Readonly<{
  color: RGB;
  op: number;
}>;

export type GridBeamPaletteLayers = Readonly<{
  h: readonly PaletteBand[];
  v: readonly PaletteBand[];
}>;

export const PALETTES = {
  teal: {
    dark: {
      h: [
        { color: [20, 184, 166] as const, op: 0.45 },
        { color: [45, 212, 191] as const, op: 0.42 },
        { color: [13, 148, 136] as const, op: 0.45 },
        { color: [14, 165, 233] as const, op: 0.4 },
        { color: [94, 234, 212] as const, op: 0.42 },
        { color: [20, 184, 166] as const, op: 0.45 },
      ],
      v: [
        { color: [20, 184, 166] as const, op: 0.45 },
        { color: [14, 165, 233] as const, op: 0.42 },
        { color: [45, 212, 191] as const, op: 0.45 },
        { color: [13, 148, 136] as const, op: 0.4 },
        { color: [94, 234, 212] as const, op: 0.45 },
        { color: [20, 184, 166] as const, op: 0.42 },
      ],
    },
    light: {
      h: [
        { color: [13, 148, 136] as const, op: 0.35 },
        { color: [15, 118, 110] as const, op: 0.3 },
      ],
      v: [
        { color: [13, 148, 136] as const, op: 0.35 },
        { color: [15, 118, 110] as const, op: 0.3 },
      ],
    },
  },
  ocean: {
    dark: {
      h: [
        { color: [20, 184, 166] as const, op: 0.42 },
        { color: [60, 140, 255] as const, op: 0.38 },
        { color: [45, 212, 191] as const, op: 0.42 },
        { color: [130, 70, 255] as const, op: 0.35 },
        { color: [50, 120, 230] as const, op: 0.38 },
        { color: [20, 184, 166] as const, op: 0.42 },
      ],
      v: [
        { color: [45, 212, 191] as const, op: 0.42 },
        { color: [120, 80, 240] as const, op: 0.35 },
        { color: [20, 184, 166] as const, op: 0.42 },
        { color: [60, 100, 255] as const, op: 0.35 },
        { color: [45, 212, 191] as const, op: 0.42 },
        { color: [80, 120, 220] as const, op: 0.35 },
      ],
    },
    light: {
      h: [
        { color: [20, 140, 180] as const, op: 0.28 },
        { color: [40, 100, 210] as const, op: 0.24 },
      ],
      v: [
        { color: [40, 100, 210] as const, op: 0.28 },
        { color: [20, 140, 180] as const, op: 0.24 },
      ],
    },
  },
  mono: {
    dark: {
      h: [
        { color: [200, 200, 200] as const, op: 0.2 },
        { color: [180, 180, 180] as const, op: 0.16 },
        { color: [190, 190, 190] as const, op: 0.2 },
      ],
      v: [
        { color: [185, 185, 185] as const, op: 0.2 },
        { color: [170, 170, 170] as const, op: 0.16 },
      ],
    },
    light: {
      h: [{ color: [90, 90, 90] as const, op: 0.13 }],
      v: [{ color: [100, 100, 100] as const, op: 0.13 }],
    },
  },
} as const;

export type GridBeamPaletteKey = keyof typeof PALETTES;
export type GridBeamColorScheme = "dark" | "light";
export type GridBeamThemeProp = "dark" | "light" | "system";

export function resolveGridBeamPalette(
  variant: GridBeamPaletteKey = "teal",
  scheme: GridBeamColorScheme = "dark"
): GridBeamPaletteLayers {
  const chosen = PALETTES[variant] ?? PALETTES.teal;
  return chosen[scheme];
}

// ─── Canvas animation hook ─────────────────────────────────────────

export type BeamCanvasRuntimeConfig = Readonly<{
  rows: number;
  cols: number;
  palette: GridBeamPaletteLayers;
  active: boolean;
  fadingOut: boolean;
  fadeStart: number | null;
  duration: number;
  strength: number;
  breathe: boolean;
}>;

function useBeamCanvas(
  canvasRef: { current: HTMLCanvasElement | null },
  configRef: { current: BeamCanvasRuntimeConfig }
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const render = (time: number) => {
      const { rows, cols, palette, active, duration, strength } = configRef.current;

      ctx.clearRect(0, 0, width, height);

      if (active && width > 0 && height > 0) {
        const rowHeight = height / rows;
        const colWidth = width / cols;
        const t = (time % duration) / duration;

        // Draw horizontal moving beams along grid lines
        for (let r = 1; r < rows; r++) {
          const y = r * rowHeight;
          const band = palette.h[r % palette.h.length];
          const beamWidth = Math.min(width * 0.45, 260);
          const x = (t * (width + beamWidth * 2) - beamWidth + (r * 73)) % (width + beamWidth * 1.5) - beamWidth * 0.5;

          const grad = ctx.createLinearGradient(x, y, x + beamWidth, y);
          grad.addColorStop(0, `rgba(${band.color.join(",")}, 0)`);
          grad.addColorStop(0.5, `rgba(${band.color.join(",")}, ${band.op * strength})`);
          grad.addColorStop(1, `rgba(${band.color.join(",")}, 0)`);

          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.max(0, x), y);
          ctx.lineTo(Math.min(width, x + beamWidth), y);
          ctx.stroke();
        }

        // Draw vertical moving beams along grid lines
        for (let c = 1; c < cols; c++) {
          const x = c * colWidth;
          const band = palette.v[c % palette.v.length];
          const beamHeight = Math.min(height * 0.45, 220);
          const y = ((1 - t) * (height + beamHeight * 2) - beamHeight + (c * 61)) % (height + beamHeight * 1.5) - beamHeight * 0.5;

          const grad = ctx.createLinearGradient(x, y, x, y + beamHeight);
          grad.addColorStop(0, `rgba(${band.color.join(",")}, 0)`);
          grad.addColorStop(0.5, `rgba(${band.color.join(",")}, ${band.op * strength})`);
          grad.addColorStop(1, `rgba(${band.color.join(",")}, 0)`);

          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, Math.max(0, y));
          ctx.lineTo(x, Math.min(height, y + beamHeight));
          ctx.stroke();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [canvasRef, configRef]);
}

export interface UseGridBeamOptions {
  rows?: number;
  cols?: number;
  colorVariant?: GridBeamPaletteKey;
  theme?: GridBeamThemeProp;
  active?: boolean;
  duration?: number;
  strength?: number;
  breathe?: boolean;
}

export function useGridBeam({
  rows: rowsProp = 2,
  cols: colsProp = 3,
  colorVariant = "teal",
  active = true,
  duration = 4500,
  strength = 1,
  breathe = false,
}: UseGridBeamOptions = {}) {
  const rows = Math.max(2, rowsProp);
  const cols = Math.max(2, colsProp);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const [fadeStart, setFadeStart] = useState<number | null>(null);

  const palette = useMemo(
    () => resolveGridBeamPalette(colorVariant, "dark"),
    [colorVariant]
  );

  const configRef = useRef<BeamCanvasRuntimeConfig>({
    rows,
    cols,
    palette,
    active,
    fadingOut,
    fadeStart,
    duration,
    strength,
    breathe,
  });
  configRef.current = {
    rows,
    cols,
    palette,
    active,
    fadingOut,
    fadeStart,
    duration,
    strength,
    breathe,
  };

  useBeamCanvas(canvasRef, configRef);

  return {
    canvasRef,
    palette,
    rows,
    cols,
  };
}

export type GridBeamDividersProps = ComponentProps<"svg"> &
  Readonly<{
    rows: number;
    cols: number;
    dividerStroke?: string;
  }>;

export function GridBeamDividers({
  rows,
  cols,
  dividerStroke = "rgba(238, 231, 219, 0.08)",
  className,
  ...props
}: GridBeamDividersProps) {
  return (
    <svg
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-1 h-full w-full",
        className
      )}
      preserveAspectRatio="none"
      role="presentation"
      {...props}
    >
      {Array.from({ length: rows - 1 }, (_, r) => {
        const y = `${((r + 1) / rows) * 100}%`;
        return (
          <line
            key={`h-${rows}-${y}`}
            stroke={dividerStroke}
            strokeWidth={1}
            x1="0"
            x2="100%"
            y1={y}
            y2={y}
          />
        );
      })}
      {Array.from({ length: cols - 1 }, (_, c) => {
        const x = `${((c + 1) / cols) * 100}%`;
        return (
          <line
            key={`v-${cols}-${x}`}
            stroke={dividerStroke}
            strokeWidth={1}
            x1={x}
            x2={x}
            y1="0"
            y2="100%"
          />
        );
      })}
    </svg>
  );
}

export type GridBeamCanvasProps = ComponentProps<"canvas"> &
  Readonly<{
    borderRadius?: number;
  }>;

export const GridBeamCanvas = forwardRef<
  HTMLCanvasElement,
  GridBeamCanvasProps
>(function GridBeamCanvas({ className, style, borderRadius, ...props }, ref) {
  return (
    <canvas
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-2 h-full w-full",
        className
      )}
      ref={ref}
      style={{ borderRadius, ...style } as CSSProperties}
      {...props}
    />
  );
});

export type GridBeamContentProps = ComponentProps<"div">;

export function GridBeamContent({ className, ...props }: GridBeamContentProps) {
  return (
    <div
      className={cn("relative z-3", className)}
      data-slot="grid-beam-content"
      {...props}
    />
  );
}

export type GridBeamProps = UseGridBeamOptions &
  ComponentProps<"div"> &
  Readonly<{
    borderRadius?: number;
  }>;

export function GridBeam({
  children,
  className,
  style,
  borderRadius,
  rows,
  cols,
  colorVariant = "teal",
  theme,
  active = true,
  duration = 4500,
  strength = 1,
  breathe = false,
  ...props
}: GridBeamProps) {
  const {
    canvasRef,
    rows: r,
    cols: c,
  } = useGridBeam({
    rows,
    cols,
    colorVariant,
    theme,
    active,
    duration,
    strength,
    breathe,
  });

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      data-slot="grid-beam"
      style={{ borderRadius, ...style }}
      {...props}
    >
      <GridBeamDividers cols={c} rows={r} />
      <GridBeamCanvas borderRadius={borderRadius} ref={canvasRef} />
      <GridBeamContent>{children}</GridBeamContent>
    </div>
  );
}

export default GridBeam;

