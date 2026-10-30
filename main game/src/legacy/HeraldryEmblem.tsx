import { memo, useId, useMemo } from "react";
import { describeHeraldry } from "../../../shared/legacy/content/heraldry";
import type { HeraldryAspect } from "../../../shared/legacy/heraldry/shapes";
import type { Heraldry } from "../../../shared/legacy/types";
import { cachedHeraldryPaths } from "./heraldry-path-cache";

interface HeraldryEmblemProps {
  heraldry: Heraldry;
  aspect: HeraldryAspect;
  swallowtail?: boolean;
  className?: string;
  /** Accessible name; defaults to the blazon. Pass "" for a decorative emblem. */
  label?: string;
}

/** Renders the shared heraldry shapes as SVG elements (no HTML injection), matching rasterizeHeraldry. */
export const HeraldryEmblem = memo(function HeraldryEmblem({ heraldry, aspect, swallowtail = false, className, label }: HeraldryEmblemProps) {
  const clipId = `heraldry-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const paths = useMemo(() => cachedHeraldryPaths(heraldry, aspect, swallowtail), [heraldry, aspect, swallowtail]);
  const name = label ?? describeHeraldry(heraldry);
  return <svg className={className} viewBox={paths.viewBox} role={name ? "img" : undefined} aria-label={name || undefined} aria-hidden={name ? undefined : true} focusable="false">
    <defs><clipPath id={clipId}><path d={paths.outline} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`} fillRule="nonzero">
      {paths.layers.map((layer, index) => {
        const fimbriation = layer.role === "charge" ? paths.fimbriation : null;
        return <path
          key={index}
          d={layer.d}
          fill={layer.color}
          fillOpacity={layer.opacity < 1 ? layer.opacity : undefined}
          stroke={fimbriation ? fimbriation.color : undefined}
          strokeWidth={fimbriation ? fimbriation.width : undefined}
          strokeLinejoin={fimbriation ? "round" : undefined}
          paintOrder={fimbriation ? "stroke" : undefined}
        />;
      })}
    </g>
  </svg>;
});
