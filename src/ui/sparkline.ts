export function buildSparkline(pts: number[], top: number): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const W = 80, H = 20, pad = 2;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("result-sparkline");
  svg.style.top = `${top}px`;
  const min = Math.min(...pts), max = Math.max(...pts);
  if (min === max) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(pad));
    line.setAttribute("y1", String(H / 2));
    line.setAttribute("x2", String(W - pad));
    line.setAttribute("y2", String(H / 2));
    line.setAttribute("stroke", "var(--result)");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  } else {
    const coords = pts.map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (W - 2 * pad);
      const y = pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("points", coords);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "var(--result)");
    poly.setAttribute("stroke-width", "1.5");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    svg.appendChild(poly);
    const last = pts[pts.length - 1];
    const cx = (W - pad).toFixed(1);
    const cy = (pad + (1 - (last - min) / (max - min)) * (H - 2 * pad)).toFixed(1);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("r", "2");
    dot.setAttribute("fill", "var(--result)");
    svg.appendChild(dot);
  }
  return svg;
}
