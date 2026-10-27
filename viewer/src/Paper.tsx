import type { ComponentType } from "react";
import { Escape, EscapeRates, LoomRose, Pitch, Populations, Tick } from "./figures";
import { arxivUrl, githubUrl } from "./links";
import { SiteNav } from "./SiteNav";

const FIGURES: { Figure: ComponentType; caption: string }[] = [
  {
    Figure: Tick,
    caption: "One 50 ms tick. Sensory current enters 256 membranes. Spikes address the 670 stored weights on the next tick. Twelve motor pairs accumulate into the body plant.",
  },
  {
    Figure: Populations,
    caption: "The 256-cell genome. Vision, odor, contact, and looming are the sensory populations. Twelve motor pairs occupy the last 24 cells.",
  },
  {
    Figure: Escape,
    caption: "The escape genome. A loom bin drives LPLC2, LC4, the giant fiber, escape, and thrust through the PSI. LPLC2 also drives the yaw pair that turns away.",
  },
  {
    Figure: LoomRose,
    caption: "Eight body-frame looming bins. Ahead is up and left is positive. Bins 0 and 7, behind the fly, use the weaker yaw weight.",
  },
  {
    Figure: Pitch,
    caption: "Pitch and height on the yard, one point per 50 ms tick. The nose and the height fall, then rise, and the body holds the band above the hunter.",
  },
  {
    Figure: EscapeRates,
    caption: "Motor rates from the loom scene. Yaw right fires as the fly turns off the threat, then escape and thrust alternate for the dash.",
  },
];

export function Paper() {
  const github = githubUrl();
  const arxiv = arxivUrl();
  return (
    <div className="company paper-page">
      <SiteNav current="paper" />
      <article className="paper-doc">
        <header className="paper-hero">
          <p className="essay-kicker">Preprint</p>
          <h1>A Fly Genome for Robots: 256 Neurons on Arduino and Raspberry Pi</h1>
          <p className="essay-lead">
            We describe a representation of the fly&apos;s sensorimotor genome, compiled so a robot can run it. The genome is the published escape and motor program: eight looming bins, LPLC2, LC4, the giant fiber, a PSI, thrust, and the motor pairs. It is 256 leaky integrate-and-fire neurons and 670 synapses, and it steps every 50&nbsp;ms. The same tick runs in a Python simulator, in the WebAssembly Playground, and as firmware for a Raspberry Pi or an Arduino-class board.
          </p>
          <div className="hero-actions paper-actions">
            <a className="btn primary" href="/paper/robofly.pdf">
              Download PDF
            </a>
            <a className="btn" href="/paper/main.tex">
              Source (.tex)
            </a>
            {arxiv ? (
              <a className="btn" href={arxiv} target="_blank" rel="noopener noreferrer">
                arXiv
              </a>
            ) : null}
            {github ? (
              <a className="btn" href={github} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            ) : null}
          </div>
        </header>

        <section className="paper-section">
          <h2>Figures</h2>
          <p className="cap-body">
            The figures below are from the preprint. The Playground is the same controller playing live — a custom room with flies, bees, and food, and the chip breakdown under the yard.
          </p>
          <div className="paper-figures">
            {FIGURES.map(({ Figure, caption }) => (
              <figure className="paper-figure" key={caption}>
                <Figure />
                <figcaption>{caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="paper-section">
          <h2>The full account</h2>
          <p>
            The PDF holds the membrane update, the motor rate, the looming weights, the pitch and lift that move the body, the wall mix, the pin maps, and the references. The home page is the short product account. The Playground is the running copy of the tick.
          </p>
          <div className="hero-actions paper-actions">
            <a className="btn primary" href="/paper/robofly.pdf">
              Download PDF
            </a>
            <a className="btn" href="/playground">
              Open the playground
            </a>
          </div>
        </section>
      </article>
    </div>
  );
}
