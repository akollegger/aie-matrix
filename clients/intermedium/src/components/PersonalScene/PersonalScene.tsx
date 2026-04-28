import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GhostInteriorityOverlay } from "./GhostInteriority.js";
import type { GhostPosition } from "../../types/ghostPosition.js";

function RotatingCloud({ positions, color }: { positions: Float32Array; color: THREE.Color }) {
  const ref = useRef<THREE.Points>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.15;
  });
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);
  const material = useMemo(
    () => new THREE.PointsMaterial({ color, size: 0.025, sizeAttenuation: true }),
    [color],
  );
  return <points ref={ref} geometry={geometry} material={material} />;
}

/** Flat hexagonal floor tile (FR-030). */
function FloorTile({ color }: { color: THREE.Color }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 6;
      const x = Math.cos(angle) * 0.95;
      const y = Math.sin(angle) * 0.95;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  const edgeLine = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 6;
      pts.push(new THREE.Vector3(Math.cos(angle) * 0.95, 0, Math.sin(angle) * 0.95));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: "#6496c8", transparent: true, opacity: 0.55 });
    return new THREE.Line(geo, mat);
  }, []);
  return (
    <>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={edgeLine} />
    </>
  );
}

interface PersonalSceneProps {
  readonly ghost: GhostPosition | null;
  readonly ghostColor?: string;
}

/**
 * React Three Fiber scene for the Personal stop (ADR-0006, FR-029, FR-030).
 * Non-geospatial: ghost point-cloud + floor tile + interiority annotation overlay.
 */
export function PersonalScene({ ghost: _, ghostColor = "#e05060" }: PersonalSceneProps) {
  const pointColor = useMemo(() => new THREE.Color(ghostColor), [ghostColor]);
  const tileColor = useMemo(() => new THREE.Color(ghostColor), [ghostColor]);

  const cloudPositions = useMemo(() => {
    const count = 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.cbrt(Math.random()) * 0.85;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + 1.1;
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    return pos;
  }, []);

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Canvas
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        camera={{ position: [0, 2, 5], fov: 45 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#060a12"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 4, 2]} intensity={0.8} />
        <FloorTile color={tileColor} />
        <RotatingCloud positions={cloudPositions} color={pointColor} />
      </Canvas>
      <GhostInteriorityOverlay />
    </div>
  );
}
