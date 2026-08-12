import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSparkline } from "./sparkline";

describe("buildSparkline", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElementNS: vi.fn((ns, tag) => {
        const attributes: Record<string, string> = {};
        const classes: string[] = [];
        const children: any[] = [];
        const style: Record<string, string> = {};

        return {
          tagName: tag,
          namespaceURI: ns,
          setAttribute: vi.fn((key, val) => {
            attributes[key] = val;
          }),
          getAttribute: vi.fn((key) => attributes[key]),
          classList: {
            add: vi.fn((cls) => {
              classes.push(cls);
            }),
            contains: vi.fn((cls) => classes.includes(cls)),
          },
          style,
          appendChild: vi.fn((child) => {
            children.push(child);
          }),
          _getAttributes: () => attributes,
          _getClasses: () => classes,
          _getChildren: () => children,
        };
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a base SVG element with correct attributes and style", () => {
    const pts = [10, 20, 30];
    const svg = buildSparkline(pts, 150) as any;

    expect(document.createElementNS).toHaveBeenCalledWith("http://www.w3.org/2000/svg", "svg");
    expect(svg.tagName).toBe("svg");
    expect(svg._getAttributes()).toMatchObject({
      width: "80",
      height: "20",
      viewBox: "0 0 80 20",
    });
    expect(svg._getClasses()).toContain("result-sparkline");
    expect(svg.style.top).toBe("150px");
  });

  it("appends a straight line when all points are equal (min === max)", () => {
    const pts = [10, 10, 10];
    const svg = buildSparkline(pts, 0) as any;

    const children = svg._getChildren();
    expect(children.length).toBe(1);

    const line = children[0];
    expect(line.tagName).toBe("line");
    expect(line._getAttributes()).toMatchObject({
      x1: "2",
      y1: "10",
      x2: "78",
      y2: "10",
      stroke: "var(--result)",
      "stroke-width": "1.5",
    });
  });

  it("appends a polyline and a circle for varying points", () => {
    const pts = [10, 20, 30]; // min=10, max=30
    const svg = buildSparkline(pts, 0) as any;

    const children = svg._getChildren();
    expect(children.length).toBe(2);

    const polyline = children[0];
    expect(polyline.tagName).toBe("polyline");
    expect(polyline._getAttributes()).toMatchObject({
      fill: "none",
      stroke: "var(--result)",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    // Check points calculation
    const pointsStr = polyline._getAttributes().points;
    expect(typeof pointsStr).toBe("string");
    const points = pointsStr.split(" ");
    expect(points.length).toBe(3);

    // First point should be at x=2 (pad), y=18 (H-pad because value is min)
    expect(points[0]).toBe("2.0,18.0");
    // Middle point should be at x=40 (pad + W/2), y=10 (pad + H/2 because value is mid)
    expect(points[1]).toBe("40.0,10.0");
    // Last point should be at x=78 (W-pad), y=2 (pad because value is max)
    expect(points[2]).toBe("78.0,2.0");

    const circle = children[1];
    expect(circle.tagName).toBe("circle");
    expect(circle._getAttributes()).toMatchObject({
      cx: "78.0",
      cy: "2.0",
      r: "2",
      fill: "var(--result)",
    });
  });
});
