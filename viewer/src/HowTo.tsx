import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { animate, motion, useMotionValue } from "motion/react";

const KEY = "robofly-how-to";

const STEPS = [
  { title: "Play", body: "Play starts the fly. The status reads Searching.", anchor: ".dock-main" },
  { title: "Look", body: "Drag the court to look around. Follow keeps the camera on the fly.", anchor: ".world" },
  { title: "Priority", body: "Predator, Food, or Pad. The lit one is what the fly is doing.", anchor: ".priority-ribbon" },
  { title: "Chip", body: "Press the corner die to open the tick.", anchor: ".chip-mini" },
  { title: "Build", body: "Edit room places food, walls, pads, and hunters.", anchor: "[data-howto=build]" },
];

function remembered() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* Storage can be blocked. The tour still closes. */
  }
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function placeCard(anchor: DOMRect, width: number, height: number) {
  const gap = 16;
  const candidates = [
    { left: anchor.left, top: anchor.top - height - gap },
    { left: anchor.left, top: anchor.bottom + gap },
    { left: anchor.right + gap, top: anchor.top },
    { left: anchor.left - width - gap, top: anchor.top },
  ];
  const fits = (box: { left: number; top: number }) =>
    box.left >= 12 && box.top >= 12 && box.left + width <= window.innerWidth - 12 && box.top + height <= window.innerHeight - 12;
  return (
    candidates.find(fits) ?? {
      left: Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12),
      top: Math.max(12, anchor.top - height - gap),
    }
  );
}

function hole(rect: DOMRect) {
  const pad = 8;
  const left = rect.left - pad;
  const top = rect.top - pad;
  const right = rect.right + pad;
  const bottom = rect.bottom + pad;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
}

export function HowTo() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [spot, setSpot] = useState<DOMRect | null>(null);
  const actions = useRef<Dialog.Root.Actions | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const placed = useRef(false);
  const closing = useRef(false);

  useEffect(() => {
    if (!remembered()) setOpen(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    document.querySelector("[data-howto-current]")?.removeAttribute("data-howto-current");
    const node = document.querySelector(STEPS[step].anchor);
    if (!node) return;
    node.setAttribute("data-howto-current", "");
    const rect = node.getBoundingClientRect();
    setSpot(rect);
    const width = cardRef.current?.offsetWidth ?? 280;
    const height = cardRef.current?.offsetHeight ?? 168;
    const { left, top } = placeCard(rect, width, height);
    if (!placed.current) {
      x.set(rect.left);
      y.set(rect.top);
      placed.current = true;
    }
    if (reduced()) {
      x.set(left);
      y.set(top);
      return;
    }
    const spring = { type: "spring" as const, duration: 0.5, bounce: 0 };
    const ax = animate(x, left, spring);
    const ay = animate(y, top, spring);
    return () => {
      if (closing.current) return;
      ax.stop();
      ay.stop();
    };
  }, [step, open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const node = document.querySelector(STEPS[step].anchor);
      if (node) setSpot(node.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, step]);

  function close(details?: { preventUnmountOnClose: () => void }) {
    if (closing.current) return;
    closing.current = true;
    details?.preventUnmountOnClose();
    remember();
    setOpen(false);
    document.querySelector("[data-howto-current]")?.removeAttribute("data-howto-current");
    const node = document.querySelector(STEPS[step].anchor);
    const rect = node?.getBoundingClientRect();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      actions.current?.unmount();
    };
    if (!rect || reduced()) {
      done();
      return;
    }
    const spring = { type: "spring" as const, duration: 0.5, bounce: 0 };
    const ax = animate(x, rect.left, spring);
    const ay = animate(y, rect.top, spring);
    void Promise.all([ax.finished, ay.finished]).then(done);
    window.setTimeout(done, 700);
  }

  const current = STEPS[step];
  return (
    <Dialog.Root
      open={open}
      actionsRef={actions}
      disablePointerDismissal
      modal
      onOpenChange={(next, details) => {
        if (!next) close(details);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="howto-backdrop" style={spot ? { clipPath: hole(spot) } : undefined} />
        <Dialog.Popup className="howto-popup" initialFocus={nextRef}>
          <motion.div ref={cardRef} className="howto-card" style={{ x, y }}>
            <Dialog.Title className="howto-title">{current.title}</Dialog.Title>
            <Dialog.Description className="howto-body">{current.body}</Dialog.Description>
            <div className="howto-actions">
              <button type="button" className="howto-skip" onClick={() => actions.current?.close()}>
                Skip
              </button>
              <button
                ref={nextRef}
                type="button"
                className="howto-next"
                onClick={() => {
                  if (step < STEPS.length - 1) setStep(step + 1);
                  else actions.current?.close();
                }}
              >
                {step === STEPS.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </motion.div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
