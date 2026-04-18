import { Effect, Ref } from "effect";
import { useEffect, useState } from "react";

/** Polls an Effect `Ref` on an interval so Ink can re-render. */
export function usePollRef<A>(ref: Ref.Ref<A>, intervalMs = 100): A {
  const [value, setValue] = useState<A>(() => Effect.runSync(Ref.get(ref)));

  useEffect(() => {
    const tick = () => {
      void Effect.runPromise(Ref.get(ref)).then(setValue);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [ref, intervalMs]);

  return value;
}
