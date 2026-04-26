import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { COORDINATE_SYSTEM, OrbitView, PointCloudLayer } from "deck.gl";

type P = { readonly p: [number, number, number] };

function fibonacciSphere(n: number, r: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    out.push({
      p: [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)],
    });
  }
  return out;
}

/**
 * @see FR-023 — point-cloud globe, slow rotation, breathing pulse, manual retry.
 */
export function FailWhale({ onRetry }: { readonly onRetry: () => void }) {
  const data = useMemo(() => fibonacciSphere(1600, 1e5), []);
  const [t, setT] = useState(0);
  const [viewState, setViewState] = useState({
    target: [0, 0, 0] as [number, number, number],
    rotationX: 30,
    rotationOrbit: 0,
    zoom: 0,
  });

  useEffect(() => {
    let r = 0;
    const tick = (now: number) => {
      r = requestAnimationFrame(tick);
      setT(now);
      setViewState((vs) => ({
        ...vs,
        rotationOrbit: (now * 0.012) % 360,
        zoom: 0.15 * Math.sin(now * 0.0008),
      }));
    };
    r = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r);
  }, []);

  const layer = useMemo(
    () =>
      new PointCloudLayer<P>({
        id: "fail-whale-globe",
        data,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (d) => d.p,
        getColor: [100, 170, 255, 220] as [number, number, number, number],
        pointSize: 1.6 + 0.3 * Math.sin(t * 0.002),
        sizeUnits: "pixels",
        updateTriggers: { pointSize: t },
      }),
    [data, t],
  );

  return (
    <div
      className="fail-whale"
      style={{
        position: "fixed",
        inset: 0,
        background: "#050608",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.9 }}>
        <DeckGL
          views={new OrbitView({ id: "orbit" })}
          viewState={viewState}
          controller={false}
          layers={[layer]}
          style={{ position: "absolute", top: "0", left: "0", right: "0", bottom: "0" }}
        />
      </div>
      <p
        style={{
          position: "relative",
          zIndex: 2,
          color: "rgba(200, 220, 255, 0.85)",
          fontSize: 16,
          margin: "0 0 20px 0",
        }}
      >
        World map could not be loaded
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          position: "relative",
          zIndex: 2,
          padding: "10px 20px",
          fontSize: 14,
          cursor: "pointer",
          background: "linear-gradient(180deg, #2a3a55, #1a2230)",
          color: "#e6edf3",
          border: "1px solid rgba(120, 180, 255, 0.4)",
          borderRadius: 8,
        }}
      >
        Retry
      </button>
    </div>
  );
}
