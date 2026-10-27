import { useEffect, useId, useRef, type PointerEvent } from "react";
import { animate } from "motion";
import { escapeTrace, pitchTrace } from "./traces";

const ink = "#16140F";
const muted = "#6D675E";
const amber = "#F0B429";
const line = "#E0DBD2";
const quiet = "#E7E2DA";
const paper = "#F6F4F1";

function svgProps(label: string) {
  return {
    className: "figure-svg",
    role: "img" as const,
    "aria-label": label,
    xmlns: "http://www.w3.org/2000/svg",
  };
}

function Arrow({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0 0 L8 4 L0 8 Z" fill={color} />
    </marker>
  );
}

export function Tick() {
  const rawId = useId();
  const inkId = `${rawId}-ink`;
  const amberId = `${rawId}-amber`;
  const pathRef = useRef<SVGPathElement>(null);
  const play = useRef<ReturnType<typeof animate> | null>(null);
  const offset = useRef(0);
  const reduced = useRef(false);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      path.style.strokeDashoffset = "0";
      offset.current = 0;
      return;
    }
    path.style.strokeDashoffset = `${length}`;
    offset.current = length;
    const host = path.closest("figure") ?? path;
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        run(length);
      },
      { threshold: 0.35 },
    );
    watch.observe(host);
    return () => {
      watch.disconnect();
      play.current?.stop();
    };
  }, []);

  function run(from: number) {
    const path = pathRef.current;
    if (!path || reduced.current) return;
    play.current?.stop();
    play.current = animate(from, 0, {
      duration: 0.9,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (value) => {
        offset.current = value;
        path.style.strokeDashoffset = String(value);
      },
    });
  }

  function grab(event: PointerEvent<SVGPathElement>) {
    if (reduced.current) return;
    play.current?.stop();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent<SVGPathElement>) {
    const path = pathRef.current;
    if (!path || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const length = path.getTotalLength();
    const next = Math.min(length, Math.max(0, offset.current - event.movementX));
    offset.current = next;
    path.style.strokeDashoffset = String(next);
  }

  const boxes = [
    ["Sensors", "vision, odor, contact, loom"],
    ["256 membranes", "0.92v + drive"],
    ["Synapse memory", "670 weights"],
    ["Motor accumulators", "12 pairs"],
    ["Body plant", "pitch, lift, yaw"],
  ];

  return (
    <svg {...svgProps("One 50 ms tick through the chip")} viewBox="0 0 960 200">
      <defs>
        <Arrow id={inkId} color={ink} />
        <Arrow id={amberId} color={amber} />
      </defs>
      {boxes.map(([name, sub], index) => {
        const x = 12 + index * 190;
        return (
          <g key={name}>
            <rect x={x} y={20} width={164} height={64} fill={paper} stroke={ink} />
            <text x={x + 82} y={46} textAnchor="middle" fill={ink} fontSize="13" fontWeight="600">
              {name}
            </text>
            <text x={x + 82} y={66} textAnchor="middle" fill={muted} fontSize="11">
              {sub}
            </text>
            {index < 4 ? (
              <line x1={x + 168} y1={52} x2={x + 186} y2={52} stroke={ink} strokeWidth="1.5" markerEnd={`url(#${inkId})`} />
            ) : null}
          </g>
        );
      })}
      <path
        ref={pathRef}
        d="M 488 84 L 488 156 L 294 156 L 294 84"
        fill="none"
        stroke={amber}
        strokeWidth="1.5"
        markerEnd={`url(#${amberId})`}
        style={{ cursor: "grab" }}
        onPointerDown={grab}
        onPointerMove={drag}
        onPointerUp={() => run(offset.current)}
      />
      <text x={390} y={174} textAnchor="middle" fill={amber} fontSize="12" fontWeight="600">
        spikes · 50 ms
      </text>
    </svg>
  );
}

const POPULATIONS = [
  ["Vision", 64, paper],
  ["Odor", 16, paper],
  ["Contact", 8, paper],
  ["Loom", 8, paper],
  ["Interneurons", 136, quiet],
  ["Motors", 24, amber],
] as const;

export function Populations() {
  const scale = 920 / 256;
  let x = 20;
  const placed = POPULATIONS.map(([name, count, fill]) => {
    const width = count * scale;
    const segment = { name, fill, x, width };
    x += width;
    return segment;
  });
  return (
    <svg {...svgProps("The 256-cell genome")} viewBox="0 0 960 120">
      {placed.map((segment) => (
        <rect key={segment.name} x={segment.x} y={52} width={segment.width} height={40} fill={segment.fill} stroke={ink} />
      ))}
      {placed.map((segment) => {
        const inside = segment.name.length * 7.2 < segment.width - 8;
        const y = inside ? 76 : segment.name === "Contact" ? 16 : 36;
        return (
          <text
            key={segment.name}
            x={segment.x + segment.width / 2}
            y={y}
            textAnchor="middle"
            fill={ink}
            fontSize="12"
            fontWeight="600"
          >
            {segment.name}
          </text>
        );
      })}
    </svg>
  );
}

export function Escape() {
  const rawId = useId();
  const marker = `${rawId}-ink`;
  const boxes = [
    ["Loom bin", 16, 52, 128, paper],
    ["LPLC2", 176, 52, 120, paper],
    ["LC4", 328, 52, 120, paper],
    ["Giant fiber", 480, 44, 132, amber],
    ["Escape", 680, 12, 112, paper],
    ["PSI", 680, 100, 112, paper],
    ["Thrust", 824, 100, 112, paper],
    ["Contralateral yaw", 164, 148, 156, paper],
  ] as const;
  const arrows = [
    [144, 72, 176, 72],
    [296, 72, 328, 72],
    [448, 72, 480, 72],
    [612, 56, 680, 32],
    [612, 96, 680, 120],
    [792, 120, 824, 120],
    [236, 92, 236, 148],
  ];
  return (
    <svg {...svgProps("Escape genome chain")} viewBox="0 0 960 210">
      <defs>
        <Arrow id={marker} color={ink} />
      </defs>
      {boxes.map(([name, x, y, width, fill]) => (
        <g key={name}>
          <rect x={x} y={y} width={width} height={40} fill={fill} stroke={ink} />
          <text x={x + width / 2} y={y + 25} textAnchor="middle" fill={ink} fontSize="13" fontWeight="600">
            {name}
          </text>
        </g>
      ))}
      {arrows.map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ink} strokeWidth="1.5" markerEnd={`url(#${marker})`} />
      ))}
    </svg>
  );
}

function wedge(cx: number, cy: number, radius: number, index: number) {
  const start = ((index * 45 - 90) * Math.PI) / 180;
  const end = (((index + 1) * 45 - 90) * Math.PI) / 180;
  const points = [`${cx} ${cy}`];
  for (let step = 0; step <= 10; step += 1) {
    const angle = start + ((end - start) * step) / 10;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy - radius * Math.sin(angle)).toFixed(1)}`);
  }
  return `M ${points.join(" L ")} Z`;
}

export function LoomRose() {
  const cx = 480;
  const cy = 168;
  const radius = 112;
  return (
    <svg {...svgProps("Eight body-frame looming bins")} viewBox="0 0 960 340">
      {Array.from({ length: 8 }, (_, index) => {
        const forward = index === 3 || index === 4;
        const rear = index === 0 || index === 7;
        const start = ((index * 45 - 90) * Math.PI) / 180;
        const end = (((index + 1) * 45 - 90) * Math.PI) / 180;
        const mid = (start + end) / 2;
        return (
          <g key={index}>
            <path d={wedge(cx, cy, radius, index)} fill={forward ? amber : rear ? quiet : paper} stroke={ink} />
            <text
              x={cx + 68 * Math.cos(mid)}
              y={cy - 68 * Math.sin(mid) + 4}
              textAnchor="middle"
              fill={ink}
              fontSize="13"
              fontWeight="600"
            >
              {index}
            </text>
          </g>
        );
      })}
      <text x={cx} y={28} textAnchor="middle" fill={ink} fontSize="13" fontWeight="600">
        ahead
      </text>
      <text x={300} y={cy + 4} textAnchor="middle" fill={muted} fontSize="12">
        left
      </text>
      <text x={cx} y={308} textAnchor="middle" fill={muted} fontSize="12">
        rear
      </text>
    </svg>
  );
}

function seriesPath(values: number[], min: number, max: number) {
  const left = 48;
  const right = 900;
  const top = 28;
  const bottom = 176;
  return values
    .map((value, index) => {
      const x = left + (index / (values.length - 1)) * (right - left);
      const y = bottom - ((value - min) / (max - min)) * (bottom - top);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Pitch() {
  const height = seriesPath(pitchTrace.map((row) => row.z), 1.05, 1.55);
  const nose = seriesPath(pitchTrace.map((row) => row.pitch), -0.2, 0.2);
  const last = pitchTrace.length - 1;
  const x = 48 + (last / last) * (900 - 48);
  const heightY = 176 - ((pitchTrace[last].z - 1.05) / 0.5) * (176 - 28);
  const pitchY = 176 - ((pitchTrace[last].pitch - -0.2) / 0.4) * (176 - 28);
  return (
    <svg {...svgProps("Pitch and height, one point per tick")} viewBox="0 0 960 210">
      <line x1="48" y1="176" x2="920" y2="176" stroke={line} />
      <text x="888" y="196" fill={muted} fontSize="11">
        tick
      </text>
      <path d={nose} fill="none" stroke={ink} strokeWidth="2" />
      <path d={height} fill="none" stroke={amber} strokeWidth="2" />
      <text x={x - 8} y={heightY - 8} textAnchor="end" fill={amber} fontSize="12" fontWeight="600">
        Height
      </text>
      <text x={x - 8} y={pitchY + 16} textAnchor="end" fill={ink} fontSize="12" fontWeight="600">
        Pitch
      </text>
    </svg>
  );
}

export function EscapeRates() {
  const left = 48;
  const right = 900;
  const base = 168;
  const top = 36;
  const xAt = (index: number) => left + (index / (escapeTrace.length - 1)) * (right - left);
  const stems: { key: string; index: number; x: number; height: number; color: string; label: string }[] = [];
  const seen = { yawRight: false, escape: false, thrust: false };
  escapeTrace.forEach((row, index) => {
    (
      [
        ["yawRight", "Yaw right", amber, -6],
        ["escape", "Escape", ink, 0],
        ["thrust", "Thrust", muted, 6],
      ] as const
    ).forEach(([key, label, color, shift]) => {
      const value = row[key];
      if (value < 0.05) return;
      stems.push({
        key: `${key}-${index}`,
        index,
        x: xAt(index) + shift,
        height: value * (base - top),
        color,
        label: seen[key] ? "" : label,
      });
      seen[key] = true;
    });
  });
  let labelCursor = 0;
  return (
    <svg {...svgProps("Motor rates during escape")} viewBox="0 0 960 210">
      {stems.map((stem) => {
        const labelX = stem.label ? Math.max(stem.x, labelCursor) : 0;
        if (stem.label) labelCursor = labelX + 92;
        return (
          <g key={stem.key}>
            <rect x={stem.x} y={base - stem.height} width="4" height={stem.height} fill={stem.color} />
            {stem.label ? (
              <text x={labelX} y={base - stem.height - 8} fill={stem.color} fontSize="12" fontWeight="600">
                {stem.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x="888" y="192" fill={muted} fontSize="11">
        tick
      </text>
    </svg>
  );
}
